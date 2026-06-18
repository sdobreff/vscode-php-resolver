let vscode = require('vscode');
let { config } = require('./Helpers');

class PHPWorkspaceDiagnosticsProvider {
    constructor(definitionIndex, logger) {
        this.definitionIndex = definitionIndex;
        this.logger = logger;
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection('php-resolver-workspace');
        this._running = false;
    }

    async runFullScan() {
        if (this._running || !this.definitionIndex) {
            return;
        }

        this._running = true;

        try {
            await this.definitionIndex.waitUntilReady();

            let allDiagnostics = new Map();

            this.detectDuplicateClasses(allDiagnostics);
            this.detectDuplicateFunctions(allDiagnostics);
            this.detectUnresolvedParents(allDiagnostics);

            // Apply diagnostics
            this.diagnosticsCollection.clear();
            for (let [filePath, diagnostics] of allDiagnostics) {
                if (diagnostics.length > 0) {
                    this.diagnosticsCollection.set(vscode.Uri.file(filePath), diagnostics);
                }
            }

            let totalIssues = 0;
            for (let diags of allDiagnostics.values()) {
                totalIssues += diags.length;
            }

            if (this.logger) {
                this.logger.logMessage('Workspace diagnostics scan complete: ' + totalIssues + ' issues found', 'INFO');
            }

            return totalIssues;
        } finally {
            this._running = false;
        }
    }

    detectDuplicateClasses(allDiagnostics) {
        let index = this.definitionIndex;
        if (!index.classIndex) {
            return;
        }

        for (let [fqcn, records] of index.classIndex) {
            if (records.length <= 1) {
                continue;
            }

            // Filter to non-vendor records
            let nonVendor = records.filter(r => !index.isVendorPath(r.filePath));
            if (nonVendor.length <= 1) {
                continue;
            }

            for (let record of nonVendor) {
                let diag = new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(Math.max(0, record.line - 1), 0),
                        new vscode.Position(Math.max(0, record.line - 1), 200)
                    ),
                    'Duplicate declaration: ' + (record.fqcn || record.name) + ' (also declared in ' + this.otherLocations(nonVendor, record) + ')',
                    vscode.DiagnosticSeverity.Warning
                );
                diag.source = 'php-resolver';

                if (!allDiagnostics.has(record.filePath)) {
                    allDiagnostics.set(record.filePath, []);
                }
                allDiagnostics.get(record.filePath).push(diag);
            }
        }
    }

    detectDuplicateFunctions(allDiagnostics) {
        let index = this.definitionIndex;
        if (!index.functionIndex) {
            return;
        }

        for (let [fqfn, records] of index.functionIndex) {
            if (records.length <= 1) {
                continue;
            }

            let nonVendor = records.filter(r => !index.isVendorPath(r.filePath));
            if (nonVendor.length <= 1) {
                continue;
            }

            for (let record of nonVendor) {
                let diag = new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(Math.max(0, record.line - 1), 0),
                        new vscode.Position(Math.max(0, record.line - 1), 200)
                    ),
                    'Duplicate function: ' + (record.fqfn || record.name) + ' (also declared in ' + this.otherLocations(nonVendor, record) + ')',
                    vscode.DiagnosticSeverity.Warning
                );
                diag.source = 'php-resolver';

                if (!allDiagnostics.has(record.filePath)) {
                    allDiagnostics.set(record.filePath, []);
                }
                allDiagnostics.get(record.filePath).push(diag);
            }
        }
    }

    detectUnresolvedParents(allDiagnostics) {
        let index = this.definitionIndex;
        if (!index.fileEntries) {
            return;
        }

        for (let entry of index.fileEntries.values()) {
            if (!entry.symbols) {
                continue;
            }

            for (let symbol of entry.symbols) {
                if (symbol.kind !== 'class' || !Array.isArray(symbol.parents)) {
                    continue;
                }

                for (let parent of symbol.parents) {
                    let parentKey = parent.toLowerCase();
                    let parentRecords = index.classIndex.get(parentKey) || [];
                    if (parentRecords.length === 0) {
                        let diag = new vscode.Diagnostic(
                            new vscode.Range(
                                new vscode.Position(Math.max(0, symbol.line - 1), 0),
                                new vscode.Position(Math.max(0, symbol.line - 1), 200)
                            ),
                            'Unresolved parent: ' + parent + ' (not found in workspace index)',
                            vscode.DiagnosticSeverity.Information
                        );
                        diag.source = 'php-resolver';

                        if (!allDiagnostics.has(symbol.filePath)) {
                            allDiagnostics.set(symbol.filePath, []);
                        }
                        allDiagnostics.get(symbol.filePath).push(diag);
                    }
                }
            }
        }
    }

    otherLocations(records, current) {
        let others = records.filter(r => r.filePath !== current.filePath || r.line !== current.line);
        if (others.length === 0) {
            return 'same file';
        }

        let paths = others.map(r => {
            let base = r.filePath.split('/').pop() || r.filePath.split('\\').pop();
            return base + ':' + r.line;
        });

        return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ' +' + (paths.length - 3) + ' more' : '');
    }

    clear() {
        this.diagnosticsCollection.clear();
    }

    dispose() {
        if (this.diagnosticsCollection) {
            this.diagnosticsCollection.dispose();
        }
    }
}

module.exports = PHPWorkspaceDiagnosticsProvider;
