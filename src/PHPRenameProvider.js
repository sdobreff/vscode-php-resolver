let vscode = require('vscode');

class PHPRenameProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async prepareRename(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        let renameContext = await this.definitionIndex.getRenameContext(document, position);
        if (!renameContext) {
            return null;
        }

        if (renameContext.range) {
            return renameContext.range;
        }

        return null;
    }

    async provideRenameEdits(document, position, newName) {
        if (!this.definitionIndex) {
            return null;
        }

        return this.definitionIndex.buildRenameWorkspaceEdit(document, position, newName);
    }
}

module.exports = PHPRenameProvider;
