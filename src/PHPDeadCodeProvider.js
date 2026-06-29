let vscode = require('vscode');
let fs = require('fs');

class PHPDeadCodeProvider {
    constructor(definitionIndex, logger) {
        this.definitionIndex = definitionIndex;
        this.logger = logger;
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection('php-resolver-dead-code');
        this._fileTextCache = new Map();
    }

    async runScan() {
        if (!this.definitionIndex) {
            return { count: 0, report: '' };
        }

        await this.definitionIndex.waitUntilReady();
        this.diagnosticsCollection.clear();
        this._fileTextCache.clear();

        let diagnosticMap = new Map();
        let issueCount = 0;
        let results = []; // For the report

        for (let entry of this.definitionIndex.fileEntries.values()) {
            if (!entry.symbols) continue;
            // Skip vendor files
            if (this.definitionIndex.isVendorPath && this.definitionIndex.isVendorPath(entry.filePath)) {
                continue;
            }

            for (let symbol of entry.symbols) {
                if (symbol.kind !== 'class' && symbol.kind !== 'function' && symbol.kind !== 'method') continue;

                let tokenKey = symbol.name.toLowerCase();
                let fileSet = this.definitionIndex.tokenToFiles.get(tokenKey);

                // A symbol with 0 or 1 file reference (just its own file) is potentially dead
                let refCount = 0;
                if (fileSet) {
                    for (let refPath of fileSet) {
                        if (refPath !== entry.filePath) {
                            refCount++;
                        }
                    }
                }

                if (refCount === 0) {
                    // Skip entry points / common patterns
                    if (this._isLikelyEntryPoint(symbol, entry)) {
                        continue;
                    }

                    // For methods and functions: check same-class references (self::, $this->, static::)
                    // Functions are also checked because class methods inside if(!class_exists())
                    // wrappers can be parsed as functions due to brace detection edge cases
                    if (symbol.kind === 'method' || symbol.kind === 'function') {
                        if (await this._hasSameClassReference(symbol, entry)) {
                            continue;
                        }
                    }

                    // For methods and functions: check WordPress hook registrations
                    if (symbol.kind === 'method' || symbol.kind === 'function') {
                        if (await this._hasHookReference(symbol, entry)) {
                            continue;
                        }
                    }

                    let line = Math.max(0, (symbol.line || 1) - 1);
                    let range = new vscode.Range(line, 0, line, 200);

                    let kindLabel = symbol.kind === 'class' ? (symbol.classType || 'class') : (symbol.kind === 'method' ? 'method' : 'function');
                    let diagnostic = new vscode.Diagnostic(
                        range,
                        `${kindLabel} "${symbol.name}" appears unused (no references found)`,
                        vscode.DiagnosticSeverity.Hint
                    );
                    diagnostic.source = 'php-resolver-dead-code';
                    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];

                    let uri = vscode.Uri.file(entry.filePath);
                    if (!diagnosticMap.has(uri.toString())) {
                        diagnosticMap.set(uri.toString(), { uri, diagnostics: [] });
                    }
                    diagnosticMap.get(uri.toString()).diagnostics.push(diagnostic);

                    results.push({
                        kind: kindLabel,
                        name: symbol.name,
                        fqcn: symbol.fqcn || symbol.fqfn || symbol.methodKey || symbol.name,
                        filePath: entry.filePath,
                        line: symbol.line || 1
                    });
                    issueCount++;
                }
            }
        }

        this._fileTextCache.clear();

        for (let { uri, diagnostics } of diagnosticMap.values()) {
            this.diagnosticsCollection.set(uri, diagnostics);
        }

        if (this.logger) {
            this.logger.logMessage(`Dead code scan: ${issueCount} potentially unused symbols found`, 'INFO');
        }

        // Build report
        let report = this._buildReport(results);

        return { count: issueCount, report };
    }

    _buildReport(results) {
        if (results.length === 0) {
            return 'No potentially unused symbols found.';
        }

        let lines = [];
        lines.push(`Dead Code Scan Report`);
        lines.push(`${'='.repeat(60)}`);
        lines.push(`Found ${results.length} potentially unused symbols`);
        lines.push(`(No references detected)`);
        lines.push('');

        // Group by kind
        let classes = results.filter(r => r.kind !== 'function' && r.kind !== 'method');
        let methods = results.filter(r => r.kind === 'method');
        let functions = results.filter(r => r.kind === 'function');

        if (classes.length > 0) {
            lines.push(`--- Classes/Interfaces/Traits (${classes.length}) ---`);
            lines.push('');
            classes.sort((a, b) => a.name.localeCompare(b.name));
            for (let r of classes) {
                lines.push(`${r.filePath}:${r.line}: [${r.kind}] ${r.fqcn}`);
            }
            lines.push('');
        }

        if (methods.length > 0) {
            lines.push(`--- Methods (${methods.length}) ---`);
            lines.push('');
            methods.sort((a, b) => a.name.localeCompare(b.name));
            for (let r of methods) {
                lines.push(`${r.filePath}:${r.line}: ${r.fqcn}()`);
            }
            lines.push('');
        }

        if (functions.length > 0) {
            lines.push(`--- Functions (${functions.length}) ---`);
            lines.push('');
            functions.sort((a, b) => a.name.localeCompare(b.name));
            for (let r of functions) {
                lines.push(`${r.filePath}:${r.line}: ${r.fqcn}()`);
            }
            lines.push('');
        }

        lines.push(`${'='.repeat(60)}`);
        lines.push('Note: Results also appear in the Problems panel (Hint severity).');
        lines.push('Symbols matching common framework patterns (controllers, migrations, etc.) are excluded.');

        return lines.join('\n');
    }

    _isLikelyEntryPoint(symbol, entry) {
        let name = symbol.name.toLowerCase();

        // Skip test classes
        if (name.endsWith('test') || name.startsWith('test')) return true;

        // Skip common WordPress/framework patterns
        if (symbol.kind === 'class') {
            // Controllers, Commands, Migrations, Seeders, Factories are often auto-discovered
            let skipSuffixes = ['controller', 'command', 'migration', 'seeder', 'factory', 'middleware', 'provider', 'listener', 'observer', 'policy', 'request', 'resource', 'event', 'job', 'mail', 'notification', 'exception'];
            for (let suffix of skipSuffixes) {
                if (name.endsWith(suffix)) return true;
            }
        }

        // Skip magic methods and common framework methods
        if (symbol.kind === 'method') {
            if (name.startsWith('__')) return true; // __construct, __destruct, __get, etc.
            let frameworkMethods = ['boot', 'register', 'handle', 'invoke', 'run', 'setup', 'teardown', 'up', 'down'];
            if (frameworkMethods.includes(name)) return true;
        }

        // Skip main/index files
        let baseName = entry.filePath.split('/').pop().toLowerCase();
        if (baseName === 'index.php' || baseName === 'functions.php' || baseName === 'bootstrap.php') {
            return true;
        }

        return false;
    }

    async _getFileText(filePath) {
        if (this._fileTextCache.has(filePath)) {
            return this._fileTextCache.get(filePath);
        }
        try {
            let text = await fs.promises.readFile(filePath, 'utf8');
            this._fileTextCache.set(filePath, text);
            return text;
        } catch {
            return null;
        }
    }

    /**
     * Check if a method is referenced within the same class via self::, $this->, or static::
     */
    async _hasSameClassReference(symbol, entry) {
        let text = await this._getFileText(entry.filePath);
        if (!text) return false;

        let escaped = this._escapeRegex(symbol.name);
        // Match self::method(, static::method(, $this->method(
        let pattern = new RegExp(
            `(?:self|static)\\s*::\\s*${escaped}\\s*\\(|\\$this\\s*->\\s*${escaped}\\s*\\(`,
            'i'
        );
        return pattern.test(text);
    }

    /**
     * Check if a method/function is registered as a WordPress hook callback.
     * Checks same-file for array callbacks: add_action('hook', [$this, 'method'])
     * and string callbacks: add_action('hook', 'function_name')
     */
    async _hasHookReference(symbol, entry) {
        let text = await this._getFileText(entry.filePath);
        if (!text) return false;

        let escaped = this._escapeRegex(symbol.name);

        // Array callback: add_action/add_filter('...', [..., 'methodName'])
        let arrayPattern = new RegExp(
            `(?:add_action|add_filter)\\s*\\([^)]*\\[[^\\]]*,\\s*['"]${escaped}['"]\\s*\\]`,
            'i'
        );
        if (arrayPattern.test(text)) return true;

        // String callback: add_action/add_filter('...', 'functionName')
        if (symbol.kind === 'function') {
            let stringPattern = new RegExp(
                `(?:add_action|add_filter)\\s*\\([^,]+,\\s*['"]${escaped}['"]`,
                'i'
            );
            if (stringPattern.test(text)) return true;
        }

        return false;
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    clear() {
        this.diagnosticsCollection.clear();
    }

    provideDocumentLinks(document) {
        let links = [];
        let pattern = /^(\/[^:]+):(\d+):/gm;
        let text = document.getText();
        let match;
        while ((match = pattern.exec(text)) !== null) {
            let filePath = match[1];
            let line = Math.max(0, parseInt(match[2], 10) - 1);
            let startPos = document.positionAt(match.index);
            let endPos = document.positionAt(match.index + match[1].length + 1 + match[2].length);
            let range = new vscode.Range(startPos, endPos);
            let uri = vscode.Uri.parse(
                `command:vscode.open?${encodeURIComponent(JSON.stringify([
                    vscode.Uri.file(filePath),
                    { selection: { startLineNumber: line + 1, startColumn: 1, endLineNumber: line + 1, endColumn: 1 } }
                ]))}`
            );
            let link = new vscode.DocumentLink(range, uri);
            link.tooltip = `Open ${filePath.split('/').pop()} at line ${line + 1}`;
            links.push(link);
        }
        return links;
    }

    dispose() {
        this.diagnosticsCollection.dispose();
    }
}

module.exports = PHPDeadCodeProvider;
