let vscode = require('vscode');

class PHPCircularDependencyProvider {
    constructor(definitionIndex, logger) {
        this.definitionIndex = definitionIndex;
        this.logger = logger;
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection('php-resolver-circular-deps');
    }

    async runScan() {
        if (!this.definitionIndex) {
            return 0;
        }

        await this.definitionIndex.waitUntilReady();
        this.diagnosticsCollection.clear();

        // Build a directed graph: namespace → Set<imported namespaces>
        let graph = new Map();
        let fileToNamespace = new Map();

        for (let entry of this.definitionIndex.fileEntries.values()) {
            if (!entry.namespace) continue;
            if (this.definitionIndex.isVendorPath && this.definitionIndex.isVendorPath(entry.filePath)) {
                continue;
            }

            let ns = entry.namespace.toLowerCase();
            fileToNamespace.set(entry.filePath, ns);

            if (!graph.has(ns)) {
                graph.set(ns, new Set());
            }

            // Add edges from imports
            if (Array.isArray(entry.imports)) {
                for (let imp of entry.imports) {
                    let importedNs = this._getNamespace(imp.fqcn || '').toLowerCase();
                    if (importedNs && importedNs !== ns) {
                        graph.get(ns).add(importedNs);
                    }
                }
            }
        }

        // Detect cycles using DFS
        let cycles = this._findCycles(graph);

        let diagnosticMap = new Map();
        let issueCount = 0;

        for (let cycle of cycles) {
            // Find files that belong to the first namespace in the cycle
            for (let [filePath, ns] of fileToNamespace) {
                if (ns === cycle[0]) {
                    let line = 0;
                    // Find the namespace declaration line
                    let entry = this.definitionIndex.fileEntries.get(filePath);
                    if (entry && entry.symbols && entry.symbols.length > 0) {
                        line = Math.max(0, (entry.symbols[0].line || 1) - 1);
                    }

                    let cyclePath = cycle.map(c => c.split('\\').pop()).join(' → ') + ' → ' + cycle[0].split('\\').pop();
                    let range = new vscode.Range(line, 0, line, 200);
                    let diagnostic = new vscode.Diagnostic(
                        range,
                        `Circular dependency: ${cyclePath}`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'php-resolver-circular-deps';

                    let uri = vscode.Uri.file(filePath);
                    if (!diagnosticMap.has(uri.toString())) {
                        diagnosticMap.set(uri.toString(), { uri, diagnostics: [] });
                    }
                    diagnosticMap.get(uri.toString()).diagnostics.push(diagnostic);
                    issueCount++;
                    break; // One diagnostic per cycle
                }
            }
        }

        for (let { uri, diagnostics } of diagnosticMap.values()) {
            this.diagnosticsCollection.set(uri, diagnostics);
        }

        if (this.logger) {
            this.logger.logMessage(`Circular dependency scan: ${cycles.length} cycles found`, 'INFO');
        }

        return issueCount;
    }

    _findCycles(graph) {
        let visited = new Set();
        let inStack = new Set();
        let cycles = [];

        let dfs = (node, path) => {
            if (inStack.has(node)) {
                // Found a cycle
                let cycleStart = path.indexOf(node);
                if (cycleStart !== -1) {
                    cycles.push(path.slice(cycleStart));
                }
                return;
            }

            if (visited.has(node)) return;

            visited.add(node);
            inStack.add(node);
            path.push(node);

            let neighbors = graph.get(node);
            if (neighbors) {
                for (let neighbor of neighbors) {
                    if (graph.has(neighbor)) {
                        dfs(neighbor, [...path]);
                    }
                }
            }

            inStack.delete(node);
        };

        for (let node of graph.keys()) {
            if (!visited.has(node)) {
                dfs(node, []);
            }
        }

        // Deduplicate cycles (normalize by smallest member first)
        let unique = new Map();
        for (let cycle of cycles) {
            let key = [...cycle].sort().join('|');
            if (!unique.has(key)) {
                unique.set(key, cycle);
            }
        }

        return [...unique.values()];
    }

    _getNamespace(fqcn) {
        let parts = fqcn.replace(/^\\+/, '').split('\\');
        parts.pop(); // Remove class name
        return parts.join('\\');
    }

    clear() {
        this.diagnosticsCollection.clear();
    }

    dispose() {
        this.diagnosticsCollection.dispose();
    }
}

module.exports = PHPCircularDependencyProvider;
