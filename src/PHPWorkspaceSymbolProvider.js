let vscode = require('vscode');

class PHPWorkspaceSymbolProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async provideWorkspaceSymbols(query) {
        if (!this.definitionIndex) {
            return [];
        }

        return this.definitionIndex.findWorkspaceSymbols(query || '');
    }
}

module.exports = PHPWorkspaceSymbolProvider;
