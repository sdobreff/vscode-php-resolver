let vscode = require('vscode');
let fs = require('fs');

class PHPDocInheritanceProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    /**
     * Enhance a hover result with inherited PHPDoc when the current method has none.
     */
    async provideHover(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        await this.definitionIndex.waitUntilReady();

        let wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!wordRange) return null;

        let word = document.getText(wordRange);
        let line = document.lineAt(position.line).text;

        // Only applies to method names in method declarations
        let methodDeclMatch = line.match(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (!methodDeclMatch || methodDeclMatch[1] !== word) {
            return null;
        }

        // Check if current method already has a docblock
        let hasDocblock = this._hasDocblockAbove(document, position.line);
        if (hasDocblock) return null;

        // Find the containing class
        let entry = this.definitionIndex.fileEntries.get(document.uri.fsPath);
        if (!entry || !entry.symbols) return null;

        let classRecord = null;
        for (let sym of entry.symbols) {
            if (sym.kind === 'class' && sym.line <= position.line + 1) {
                classRecord = sym;
            }
        }

        if (!classRecord || !Array.isArray(classRecord.parents) || classRecord.parents.length === 0) {
            return null;
        }

        // Walk up the inheritance chain to find a docblock for this method
        let inheritedDoc = await this._findInheritedDoc(word, classRecord.parents);
        if (!inheritedDoc) return null;

        let markdown = new vscode.MarkdownString();
        markdown.appendMarkdown('**Inherited documentation:**\n\n');
        markdown.appendCodeblock(inheritedDoc, 'phpdoc');

        return new vscode.Hover(markdown, wordRange);
    }

    async _findInheritedDoc(methodName, parents) {
        let visited = new Set();
        let queue = [...parents];

        while (queue.length > 0) {
            let parentFqcn = queue.shift();
            let parentKey = String(parentFqcn || '').replace(/^\\+/, '').toLowerCase();

            if (visited.has(parentKey)) continue;
            visited.add(parentKey);

            let parentRecords = this.definitionIndex.classIndex.get(parentKey);
            if (!parentRecords || parentRecords.length === 0) continue;

            let parentRecord = parentRecords[0];

            // Read the parent file and look for method + docblock
            let doc = await this._extractMethodDocblock(parentRecord.filePath, methodName);
            if (doc) return doc;

            // Continue up the chain
            if (Array.isArray(parentRecord.parents)) {
                queue.push(...parentRecord.parents);
            }
        }

        return null;
    }

    async _extractMethodDocblock(filePath, methodName) {
        try {
            let text = await this.definitionIndex._readFileCached(filePath);
            if (!text) return null;

            let lines = text.split(/\r?\n/);
            let methodRegex = new RegExp('\\bfunction\\s+' + this._escapeRegex(methodName) + '\\s*\\(');

            for (let i = 0; i < lines.length; i++) {
                if (methodRegex.test(lines[i])) {
                    // Look backwards for a docblock
                    return this._extractDocblockBefore(lines, i);
                }
            }
        } catch {
            // ignore
        }

        return null;
    }

    _extractDocblockBefore(lines, lineIndex) {
        // Walk backwards from lineIndex-1 looking for */
        let endLine = -1;
        for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 5); i--) {
            let trimmed = lines[i].trim();
            if (trimmed === '' || trimmed.startsWith('//')) continue;
            if (trimmed.endsWith('*/')) {
                endLine = i;
                break;
            }
            break;
        }

        if (endLine === -1) return null;

        // Find the start of the docblock (/**)
        let startLine = -1;
        for (let i = endLine; i >= Math.max(0, endLine - 50); i--) {
            if (lines[i].trim().startsWith('/**')) {
                startLine = i;
                break;
            }
        }

        if (startLine === -1) return null;

        let docLines = lines.slice(startLine, endLine + 1);
        return docLines.join('\n');
    }

    _hasDocblockAbove(document, lineNumber) {
        for (let i = lineNumber - 1; i >= Math.max(0, lineNumber - 3); i--) {
            let trimmed = document.lineAt(i).text.trim();
            if (trimmed === '') continue;
            if (trimmed.endsWith('*/')) return true;
            break;
        }
        return false;
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

module.exports = PHPDocInheritanceProvider;
