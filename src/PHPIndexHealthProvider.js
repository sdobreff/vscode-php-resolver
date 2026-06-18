let vscode = require('vscode');

class PHPIndexHealthProvider {
    constructor(definitionIndex, logger) {
        this.definitionIndex = definitionIndex;
        this.logger = logger;
        this.statusBarItem = null;
        this._updateTimer = null;
    }

    activate(context) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            50
        );
        this.statusBarItem.command = 'phpResolver.showIndexHealth';
        this.statusBarItem.tooltip = 'PHP Resolver Index Health';
        context.subscriptions.push(this.statusBarItem);

        this.scheduleUpdate();

        context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => {
            this.scheduleUpdate();
        }));
    }

    scheduleUpdate() {
        if (this._updateTimer) {
            clearTimeout(this._updateTimer);
        }
        this._updateTimer = setTimeout(() => {
            this._updateTimer = null;
            this.updateStatusBar();
        }, 2000);
    }

    updateStatusBar() {
        if (!this.statusBarItem || !this.definitionIndex) {
            return;
        }

        let stats = this.getStats();
        this.statusBarItem.text = '$(symbol-class) ' + stats.classes + ' $(symbol-method) ' + stats.methods + ' $(symbol-function) ' + stats.functions;
        this.statusBarItem.show();
    }

    getStats() {
        let index = this.definitionIndex;
        let files = index.fileEntries ? index.fileEntries.size : 0;
        let classes = 0;
        let functions = 0;
        let methods = 0;
        let interfaces = 0;
        let traits = 0;

        if (index.fileEntries) {
            for (let entry of index.fileEntries.values()) {
                for (let symbol of (entry.symbols || [])) {
                    if (symbol.kind === 'class') {
                        if (symbol.classType === 'interface') {
                            interfaces++;
                        } else if (symbol.classType === 'trait') {
                            traits++;
                        }
                        classes++;
                    } else if (symbol.kind === 'function') {
                        functions++;
                    } else if (symbol.kind === 'method') {
                        methods++;
                    }
                }
            }
        }

        return { files, classes, functions, methods, interfaces, traits };
    }

    showHealthReport() {
        let stats = this.getStats();
        let index = this.definitionIndex;

        let lines = [];
        lines.push('PHP Resolver — Index Health Report');
        lines.push('');
        lines.push('Files indexed:      ' + stats.files);
        lines.push('Classes:            ' + stats.classes);
        lines.push('  Interfaces:       ' + stats.interfaces);
        lines.push('  Traits:           ' + stats.traits);
        lines.push('  Concrete classes: ' + (stats.classes - stats.interfaces - stats.traits));
        lines.push('Functions:          ' + stats.functions);
        lines.push('Methods:            ' + stats.methods);
        lines.push('Total symbols:      ' + (stats.classes + stats.functions + stats.methods));
        lines.push('');
        lines.push('Index status:       ' + (index._ready ? 'Ready' : 'Initializing...'));
        lines.push('Persistent cache:   ' + (index.shouldPersistCache() ? 'Enabled' : 'Disabled'));
        lines.push('Vendor indexing:    ' + (index.shouldIncludeVendor() ? 'Enabled' : 'Disabled'));

        let cachePath = index.getCachePath();
        if (cachePath) {
            lines.push('Cache path:         ' + cachePath);
        }

        lines.push('');

        // Top 10 namespaces by symbol count
        let nsCounts = new Map();
        if (index.fileEntries) {
            for (let entry of index.fileEntries.values()) {
                let ns = entry.namespace || '(global)';
                nsCounts.set(ns, (nsCounts.get(ns) || 0) + (entry.symbols || []).length);
            }
        }
        let sortedNs = [...nsCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        if (sortedNs.length > 0) {
            lines.push('Top namespaces:');
            for (let [ns, count] of sortedNs) {
                lines.push('  ' + ns + ': ' + count + ' symbols');
            }
        }

        return lines.join('\n');
    }

    dispose() {
        if (this._updateTimer) {
            clearTimeout(this._updateTimer);
        }
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
        }
    }
}

module.exports = PHPIndexHealthProvider;
