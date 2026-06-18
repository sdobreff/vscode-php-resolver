let vscode = require('vscode');

class PHPDeadCodeProvider {
    constructor(definitionIndex, logger) {
        this.definitionIndex = definitionIndex;
        this.logger = logger;
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection('php-resolver-dead-code');
    }

    async runScan() {
        if (!this.definitionIndex) {
            return { count: 0, report: '' };
        }

        await this.definitionIndex.waitUntilReady();
        this.diagnosticsCollection.clear();

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
                if (symbol.kind !== 'class' && symbol.kind !== 'function') continue;

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

                    let line = Math.max(0, (symbol.line || 1) - 1);
                    let range = new vscode.Range(line, 0, line, 200);

                    let kindLabel = symbol.kind === 'class' ? (symbol.classType || 'class') : 'function';
                    let diagnostic = new vscode.Diagnostic(
                        range,
                        `${kindLabel} "${symbol.name}" appears unused (no references found in other files)`,
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
                        fqcn: symbol.fqcn || symbol.fqfn || symbol.name,
                        filePath: entry.filePath,
                        line: symbol.line || 1
                    });
                    issueCount++;
                }
            }
        }

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
        lines.push(`(No cross-file references detected)`);
        lines.push('');

        // Group by kind
        let classes = results.filter(r => r.kind !== 'function');
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

        // Skip main/index files
        let baseName = entry.filePath.split('/').pop().toLowerCase();
        if (baseName === 'index.php' || baseName === 'functions.php' || baseName === 'bootstrap.php') {
            return true;
        }

        return false;
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
