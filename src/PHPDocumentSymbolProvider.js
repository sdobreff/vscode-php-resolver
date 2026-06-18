let vscode = require('vscode');

class PHPDocumentSymbolProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async provideDocumentSymbols(document) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let entry = this.definitionIndex.fileEntries.get(document.uri.fsPath);
        if (!entry || !entry.symbols) {
            return this._parseDocumentSymbols(document);
        }

        let symbols = [];
        let classSymbols = new Map();

        // First pass: create class containers
        for (let sym of entry.symbols) {
            if (sym.kind === 'class') {
                let line = Math.max(0, (sym.line || 1) - 1);
                let range = new vscode.Range(line, 0, line, 0);
                let docSym = new vscode.DocumentSymbol(
                    sym.name,
                    sym.fqcn || '',
                    this._classSymbolKind(sym),
                    range,
                    range
                );
                docSym.children = [];
                classSymbols.set(sym.name, docSym);
                symbols.push(docSym);
            }
        }

        // Second pass: add methods under their class
        for (let sym of entry.symbols) {
            if (sym.kind === 'method') {
                let line = Math.max(0, (sym.line || 1) - 1);
                let range = new vscode.Range(line, 0, line, 0);
                let docSym = new vscode.DocumentSymbol(
                    sym.name,
                    sym.methodKey || '',
                    vscode.SymbolKind.Method,
                    range,
                    range
                );

                // Try to find parent class
                let className = sym.className || (sym.methodKey ? sym.methodKey.split('::')[0].split('\\').pop() : null);
                if (className && classSymbols.has(className)) {
                    classSymbols.get(className).children.push(docSym);
                } else {
                    symbols.push(docSym);
                }
            } else if (sym.kind === 'function') {
                let line = Math.max(0, (sym.line || 1) - 1);
                let range = new vscode.Range(line, 0, line, 0);
                symbols.push(new vscode.DocumentSymbol(
                    sym.name,
                    sym.fqfn || '',
                    vscode.SymbolKind.Function,
                    range,
                    range
                ));
            }
        }

        // Add properties and constants from parsing
        let extraSymbols = this._parsePropertiesAndConstants(document, classSymbols);
        symbols = symbols.concat(extraSymbols);

        return symbols;
    }

    _parsePropertiesAndConstants(document, classSymbols) {
        let text = document.getText();
        let lines = text.split(/\r?\n/);
        let extra = [];

        let currentClass = null;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Detect class context
            let classMatch = line.match(/\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/);
            if (classMatch) {
                currentClass = classMatch[1];
            }

            // Properties: public|protected|private [static] [?Type] $name
            let propMatch = line.match(/\b(?:public|protected|private)\s+(?:static\s+)?(?:\??\w+\s+)?\$([A-Za-z_][A-Za-z0-9_]*)/);
            if (propMatch) {
                let range = new vscode.Range(i, 0, i, 0);
                let sym = new vscode.DocumentSymbol(
                    '$' + propMatch[1],
                    '',
                    vscode.SymbolKind.Property,
                    range,
                    range
                );
                if (currentClass && classSymbols.has(currentClass)) {
                    classSymbols.get(currentClass).children.push(sym);
                } else {
                    extra.push(sym);
                }
            }

            // Constants: const NAME = 
            let constMatch = line.match(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=/);
            if (constMatch) {
                let range = new vscode.Range(i, 0, i, 0);
                let sym = new vscode.DocumentSymbol(
                    constMatch[1],
                    '',
                    vscode.SymbolKind.Constant,
                    range,
                    range
                );
                if (currentClass && classSymbols.has(currentClass)) {
                    classSymbols.get(currentClass).children.push(sym);
                } else {
                    extra.push(sym);
                }
            }
        }

        return extra;
    }

    _parseDocumentSymbols(document) {
        // Fallback when index doesn't have the file
        let text = document.getText();
        let symbols = [];

        let classRegex = /\b(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
        let funcRegex = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

        let match;
        while ((match = classRegex.exec(text)) !== null) {
            let pos = document.positionAt(match.index);
            let range = new vscode.Range(pos, pos);
            symbols.push(new vscode.DocumentSymbol(
                match[1], '', vscode.SymbolKind.Class, range, range
            ));
        }

        while ((match = funcRegex.exec(text)) !== null) {
            let pos = document.positionAt(match.index);
            let range = new vscode.Range(pos, pos);
            symbols.push(new vscode.DocumentSymbol(
                match[1], '', vscode.SymbolKind.Function, range, range
            ));
        }

        return symbols;
    }

    _classSymbolKind(sym) {
        if (sym.classType === 'interface') return vscode.SymbolKind.Interface;
        if (sym.classType === 'trait') return vscode.SymbolKind.Struct;
        if (sym.classType === 'enum') return vscode.SymbolKind.Enum;
        return vscode.SymbolKind.Class;
    }
}

module.exports = PHPDocumentSymbolProvider;
