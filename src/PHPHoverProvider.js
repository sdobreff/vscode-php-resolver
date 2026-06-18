let vscode = require('vscode');

class PHPHoverProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async provideHover(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        let result = await this.definitionIndex.findHover(document, position);
        if (!result) {
            return null;
        }

        return new vscode.Hover(result.contents, result.range);
    }
}

module.exports = PHPHoverProvider;
