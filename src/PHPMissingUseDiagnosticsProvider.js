let vscode = require('vscode');
let { config } = require('./Helpers');

const BUILTIN_TYPES = new Set([
    'int', 'integer', 'float', 'double', 'string', 'bool', 'boolean',
    'array', 'object', 'callable', 'iterable', 'void', 'never', 'null',
    'mixed', 'true', 'false', 'self', 'static', 'parent', 'resource',
    'stdclass', 'closure', 'generator', 'throwable', 'exception',
    'error', 'traversable', 'countable', 'serializable', 'jsonserializable',
    'iterator', 'iteratoraggregate', 'arrayaccess', 'stringable',
    'datetime', 'datetimeinterface', 'datetimeimmutable',
    'weakreference', 'weakmap', 'fiber',
]);

class PHPMissingUseDiagnosticsProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection('php-resolver-missing-use');
        this._debounceTimer = null;
        this._runGeneration = 0;
    }

    scheduleAnalysis(document) {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this.analyzeDocument(document);
        }, 600);
    }

    async analyzeDocument(document) {
        if (!this.definitionIndex || config('enableMissingUseModule') === false) {
            this.diagnosticsCollection.clear();
            return;
        }

        // Guard against concurrent runs — only the latest run applies results
        let generation = ++this._runGeneration;

        await this.definitionIndex.waitUntilReady();
        if (generation !== this._runGeneration) return;

        let diagnostics = [];
        let text = document.getText();
        let seen = new Set();

        // Parse imports from LIVE document text (not stale index cache)
        // so removals are detected immediately without reloading
        let liveContext = this.definitionIndex.parseNamespaceAndImports(text);
        let importedNames = new Set();
        for (let alias of Object.keys(liveContext.imports)) {
            importedNames.add(alias.toLowerCase());
        }

        // Build set of class names defined in this file
        let filePath = document.uri.fsPath;
        let entry = this.definitionIndex.fileEntries.get(filePath);
        let localClassNames = new Set();
        if (entry && entry.symbols) {
            for (let sym of entry.symbols) {
                if (sym.kind === 'class') {
                    localClassNames.add(sym.name.toLowerCase());
                }
            }
        }

        // Collect all class name tokens from various PHP patterns
        let patterns = [
            // new ClassName(
            /\bnew\s+([A-Z_][A-Za-z0-9_]*)\s*[\(\{;]/g,
            // ClassName::  (static access)
            /\b([A-Z_][A-Za-z0-9_]*)\s*::/g,
            // instanceof ClassName
            /\binstanceof\s+([A-Z_][A-Za-z0-9_]*)/g,
            // catch (ClassName
            /\bcatch\s*\(\s*([A-Z_][A-Za-z0-9_]*)/g,
            // Type hints: (ClassName $param  or  , ClassName $param  or  ?ClassName $param
            /[,(]\s*\??([A-Z_][A-Za-z0-9_]*)\s+\$/g,
            // Return types:  ): ClassName  or  : ?ClassName
            /\)\s*:\s*\??([A-Z_][A-Za-z0-9_]*)\b/g,
            // Property types:  public ClassName $prop  (typed properties)
            /\b(?:public|protected|private|readonly)\s+\??([A-Z_][A-Za-z0-9_]*)\s+\$/g,
            // extends ClassName
            /\bextends\s+([A-Z_][A-Za-z0-9_]*)\b/g,
            // implements ClassName (may have commas)
            /\bimplements\s+([A-Z_][A-Za-z0-9_]*)\b/g,
        ];

        // Collect all tokens first, then batch-resolve
        let tokensToCheck = [];

        for (let pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                let token = match[1];

                // Skip fully-qualified names, built-in types
                if (token.includes('\\')) continue;
                if (BUILTIN_TYPES.has(token.toLowerCase())) continue;

                // Quick pre-filter: if imported or locally defined, skip
                if (importedNames.has(token.toLowerCase())) continue;
                if (localClassNames.has(token.toLowerCase())) continue;

                let offset = match.index + match[0].indexOf(token);
                let position = document.positionAt(offset);
                let lineKey = token + ':' + position.line;
                if (seen.has(lineKey)) continue;
                seen.add(lineKey);

                tokensToCheck.push({ token, position, lineKey });
            }
        }

        // Batch resolve: only call canResolveToken for tokens not pre-filtered
        for (let { token, position } of tokensToCheck) {
            if (generation !== this._runGeneration) return;

            let range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
            if (!range) continue;

            let isResolvable = await this.definitionIndex.canResolveToken(document, position, token);
            if (generation !== this._runGeneration) return;

            if (!isResolvable) {
                // Check the class actually exists somewhere in the workspace
                let available = await this.definitionIndex.findAvailableClassesNamed(token);
                if (generation !== this._runGeneration) return;

                if (available.length > 0) {
                    let diagnostic = new vscode.Diagnostic(
                        range,
                        `'${token}' is not imported`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'php-resolver-missing-use';
                    diagnostic.code = token;
                    diagnostics.push(diagnostic);
                }
            }
        }

        this.diagnosticsCollection.set(document.uri, diagnostics);
    }

    dispose() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        if (this.diagnosticsCollection) {
            this.diagnosticsCollection.dispose();
        }
    }
}

module.exports = PHPMissingUseDiagnosticsProvider;
