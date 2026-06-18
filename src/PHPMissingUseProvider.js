let vscode = require('vscode');
let { config } = require('./Helpers');

class PHPMissingUseProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async provideCodeActions(document, range, context) {
        if (!this.definitionIndex) {
            return [];
        }

        if (!config('enableMissingUseModule')) {
            return [];
        }

        let actions = [];

        for (let diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'php-resolver-missing-use') {
                continue;
            }

            let missingClassName = diagnostic.message;
            let classRecords = await this.definitionIndex.findAvailableClassesNamed(missingClassName);
            if (classRecords.length === 0) {
                continue;
            }

            let position = diagnostic.range.start;

            for (let record of classRecords.slice(0, 3)) {
                let fqcn = record.fqcn || record.name;

                let addUseAction = new vscode.CodeAction(
                    'Add use ' + fqcn,
                    vscode.CodeActionKind.QuickFix
                );
                addUseAction.diagnostics = [diagnostic];
                addUseAction.edit = new vscode.WorkspaceEdit();

                let useStatement = 'use ' + fqcn + ';';
                let insertPos = await this.findUseInsertPosition(document);
                if (insertPos) {
                    addUseAction.edit.insert(document.uri, insertPos, useStatement + '\n');
                }
                addUseAction.isPreferred = true;
                actions.push(addUseAction);

                let fullyQualifyAction = new vscode.CodeAction(
                    'Use \\' + fqcn,
                    vscode.CodeActionKind.QuickFix
                );
                fullyQualifyAction.diagnostics = [diagnostic];
                fullyQualifyAction.edit = new vscode.WorkspaceEdit();
                fullyQualifyAction.edit.replace(
                    document.uri,
                    diagnostic.range,
                    '\\' + fqcn
                );
                actions.push(fullyQualifyAction);
            }
        }

        return actions;
    }

    async findUseInsertPosition(document) {
        let text = document.getText();
        let namespaceMatch = text.match(/^\s*namespace\s+([^;{]+)\s*[;{]/m);
        let lastUseMatch = text.match(/^use\s+[^;]+;/gm);

        let insertLine = 0;

        if (namespaceMatch) {
            let namespaceEndOffset = text.indexOf(namespaceMatch[0]) + namespaceMatch[0].length;
            let nextNewline = text.indexOf('\n', namespaceEndOffset);
            insertLine = document.positionAt(nextNewline).line + 1;
        }

        if (lastUseMatch && lastUseMatch.length > 0) {
            let lastUse = lastUseMatch[lastUseMatch.length - 1];
            let lastUseOffset = text.lastIndexOf(lastUse);
            let lastUseEnd = lastUseOffset + lastUse.length;
            let afterLastUse = text.indexOf('\n', lastUseEnd);
            insertLine = document.positionAt(afterLastUse).line + 1;
        }

        if (insertLine >= document.lineCount) {
            return null;
        }

        let insertPos = new vscode.Position(insertLine, 0);
        return insertPos;
    }
}

module.exports = PHPMissingUseProvider;
