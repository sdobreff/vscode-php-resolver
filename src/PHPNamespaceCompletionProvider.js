let vscode = require('vscode');

class PHPNamespaceCompletionProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async provideCompletionItems(document, position, token, context) {
        if (!this.definitionIndex) {
            return [];
        }

        let line = document.lineAt(position.line).text;
        let textBefore = line.substring(0, position.character);

        // Only complete in `use` statements or after namespace separators in type positions
        let useMatch = textBefore.match(/^\s*use\s+(.*)$/);
        let nsTypeMatch = textBefore.match(/(?:new\s+|instanceof\s+|catch\s*\(\s*|:\s*\??)([A-Za-z_][A-Za-z0-9_\\]*)$/);

        if (!useMatch && !nsTypeMatch) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let prefix = useMatch ? useMatch[1].trim() : (nsTypeMatch ? nsTypeMatch[1] : '');
        let prefixLower = prefix.toLowerCase().replace(/\\+/g, '\\');

        let items = [];
        let seen = new Set();

        // Search class index for matches
        for (let [fqcn, records] of this.definitionIndex.classIndex) {
            if (records.length === 0) continue;
            let record = records[0];
            let fullName = record.fqcn || record.name;

            // Filter by prefix
            if (prefixLower && !fullName.toLowerCase().startsWith(prefixLower) &&
                !record.name.toLowerCase().startsWith(prefixLower.split('\\').pop())) {
                continue;
            }

            if (seen.has(fullName.toLowerCase())) continue;
            seen.add(fullName.toLowerCase());

            let item = new vscode.CompletionItem(fullName, this._completionKind(record));
            item.detail = record.classType || 'class';
            item.insertText = useMatch ? fullName + ';' : this._insertText(record, document);
            item.filterText = record.name + ' ' + fullName;
            item.sortText = record.name.toLowerCase();

            if (useMatch) {
                // Replace the entire use statement content
                let startCol = textBefore.indexOf(prefix);
                if (startCol >= 0) {
                    item.range = new vscode.Range(
                        position.line, startCol,
                        position.line, line.length
                    );
                }
            }

            items.push(item);

            // Limit to avoid overwhelming the UI
            if (items.length >= 100) break;
        }

        return items;
    }

    _completionKind(record) {
        if (record.classType === 'interface') return vscode.CompletionItemKind.Interface;
        if (record.classType === 'trait') return vscode.CompletionItemKind.Struct;
        if (record.classType === 'enum') return vscode.CompletionItemKind.Enum;
        return vscode.CompletionItemKind.Class;
    }

    _insertText(record, document) {
        // For type positions, insert just the short name (assume import exists or will be added)
        return record.name;
    }
}

module.exports = PHPNamespaceCompletionProvider;
