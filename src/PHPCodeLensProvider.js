let vscode = require('vscode');

class PHPCodeLensProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }

    async provideCodeLenses(document) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let entry = this.definitionIndex.fileEntries.get(document.uri.fsPath);
        if (!entry || !entry.symbols) {
            return [];
        }

        let lenses = [];
        for (let symbol of entry.symbols) {
            if (symbol.kind === 'class' || symbol.kind === 'function' || symbol.kind === 'method') {
                let line = Math.max(0, (symbol.line || 1) - 1);
                let range = new vscode.Range(line, 0, line, 0);
                lenses.push(new vscode.CodeLens(range, undefined));
            }
        }

        return lenses;
    }

    async resolveCodeLens(codeLens, token) {
        if (!this.definitionIndex) {
            return codeLens;
        }

        let line = codeLens.range.start.line;
        let filePath = null;

        // Find which document this lens belongs to
        for (let editor of vscode.window.visibleTextEditors) {
            let entry = this.definitionIndex.fileEntries.get(editor.document.uri.fsPath);
            if (entry && entry.symbols) {
                for (let sym of entry.symbols) {
                    if (Math.max(0, (sym.line || 1) - 1) === line) {
                        filePath = editor.document.uri.fsPath;
                        break;
                    }
                }
            }
            if (filePath) break;
        }

        if (!filePath) {
            codeLens.command = { title: '', command: '' };
            return codeLens;
        }

        let entry = this.definitionIndex.fileEntries.get(filePath);
        if (!entry) {
            codeLens.command = { title: '', command: '' };
            return codeLens;
        }

        let symbol = null;
        for (let sym of entry.symbols) {
            if (Math.max(0, (sym.line || 1) - 1) === line) {
                symbol = sym;
                break;
            }
        }

        if (!symbol) {
            codeLens.command = { title: '', command: '' };
            return codeLens;
        }

        let parts = [];

        // Count references via token index
        let refCount = this._estimateReferences(symbol);
        if (refCount > 0) {
            parts.push(refCount + ' reference' + (refCount !== 1 ? 's' : ''));
        }

        // Count implementations for classes
        if (symbol.kind === 'class') {
            let implCount = this._countImplementations(symbol);
            if (implCount > 0) {
                parts.push(implCount + ' implementation' + (implCount !== 1 ? 's' : ''));
            }
        }

        let title = parts.length > 0 ? parts.join(' | ') : '0 references';

        codeLens.command = {
            title: title,
            command: 'editor.action.findReferences',
            arguments: [vscode.Uri.file(filePath), new vscode.Position(line, 0)]
        };

        return codeLens;
    }

    _estimateReferences(symbol) {
        let key = symbol.name.toLowerCase();
        let fileSet = this.definitionIndex.tokenToFiles.get(key);
        if (fileSet) {
            // Subtract 1 for the definition file itself
            return Math.max(0, fileSet.size - 1);
        }
        return 0;
    }

    _countImplementations(symbol) {
        if (!symbol.fqcn) return 0;
        let target = symbol.fqcn.replace(/^\\+/, '').toLowerCase();
        let children = this.definitionIndex.parentToChildren.get(target);
        return children ? children.size : 0;
    }

    dispose() {}
}

module.exports = PHPCodeLensProvider;
