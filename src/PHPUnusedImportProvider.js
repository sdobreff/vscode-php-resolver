let vscode = require('vscode');

class PHPUnusedImportProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection('php-resolver-unused-imports');
        this._debounceTimers = new Map();
    }

    scheduleAnalysis(document) {
        let key = document.uri.toString();
        if (this._debounceTimers.has(key)) {
            clearTimeout(this._debounceTimers.get(key));
        }
        this._debounceTimers.set(key, setTimeout(() => {
            this._debounceTimers.delete(key);
            this.analyzeDocument(document);
        }, 800));
    }

    analyzeDocument(document) {
        if (!document || document.languageId !== 'php' && document.languageId !== 'hack') {
            return;
        }

        let text = document.getText();
        let lines = text.split(/\r?\n/);
        let diagnostics = [];

        // Find all use statements
        let useStatements = [];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let match = line.match(/^\s*use\s+(?:function\s+|const\s+)?([A-Za-z\\][A-Za-z0-9\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/);
            if (match) {
                let fqcn = match[1];
                let alias = match[2] || fqcn.split('\\').pop();
                useStatements.push({ line: i, fqcn, alias, raw: line });
            }
        }

        if (useStatements.length === 0) return;

        // Get the text AFTER the last use statement
        let lastUseLine = useStatements[useStatements.length - 1].line;
        let bodyText = lines.slice(lastUseLine + 1).join('\n');

        // Also check annotations/attributes
        let headerText = lines.slice(0, useStatements[0].line).join('\n');

        for (let stmt of useStatements) {
            let alias = stmt.alias;

            // Check if the alias appears in the body text as a word boundary match
            let pattern = new RegExp('\\b' + this._escapeRegex(alias) + '\\b');
            let isUsed = pattern.test(bodyText);

            // Also check in phpdoc annotations (@var ClassName, @param ClassName, etc.)
            if (!isUsed) {
                isUsed = pattern.test(headerText);
            }

            if (!isUsed) {
                let lineText = lines[stmt.line];
                let startCol = lineText.indexOf('use');
                let range = new vscode.Range(
                    stmt.line, startCol,
                    stmt.line, lineText.length
                );

                let diagnostic = new vscode.Diagnostic(
                    range,
                    `Unused import: ${stmt.alias} (${stmt.fqcn})`,
                    vscode.DiagnosticSeverity.Hint
                );
                diagnostic.source = 'php-resolver-unused-imports';
                diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticsCollection.set(document.uri, diagnostics);
    }

    /**
     * Remove all unused imports from the document.
     */
    async removeUnusedImports(document) {
        let text = document.getText();
        let lines = text.split(/\r?\n/);

        let useStatements = [];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let match = line.match(/^\s*use\s+(?:function\s+|const\s+)?([A-Za-z\\][A-Za-z0-9\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/);
            if (match) {
                let fqcn = match[1];
                let alias = match[2] || fqcn.split('\\').pop();
                useStatements.push({ line: i, fqcn, alias });
            }
        }

        if (useStatements.length === 0) return;

        let lastUseLine = useStatements[useStatements.length - 1].line;
        let bodyText = lines.slice(lastUseLine + 1).join('\n');

        let linesToRemove = [];
        for (let stmt of useStatements) {
            let pattern = new RegExp('\\b' + this._escapeRegex(stmt.alias) + '\\b');
            if (!pattern.test(bodyText)) {
                linesToRemove.push(stmt.line);
            }
        }

        if (linesToRemove.length === 0) {
            vscode.window.showInformationMessage('No unused imports found.');
            return;
        }

        let edit = new vscode.WorkspaceEdit();
        for (let lineNum of linesToRemove.reverse()) {
            // Remove the line and trailing newline
            let range = new vscode.Range(
                new vscode.Position(lineNum, 0),
                new vscode.Position(lineNum + 1, 0)
            );
            edit.delete(document.uri, range);
        }

        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage(`Removed ${linesToRemove.length} unused import(s).`);
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    clear() {
        this.diagnosticsCollection.clear();
    }

    dispose() {
        for (let timer of this._debounceTimers.values()) {
            clearTimeout(timer);
        }
        this._debounceTimers.clear();
        this.diagnosticsCollection.dispose();
    }
}

module.exports = PHPUnusedImportProvider;
