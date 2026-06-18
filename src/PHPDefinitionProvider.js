let vscode = require('vscode');
let { config } = require('./Helpers');

class PHPDefinitionProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
        this.traceOutput = vscode.window.createOutputChannel('PHP Resolver - Definition Trace');
    }

    async provideDefinition(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        let result = await this.definitionIndex.findDefinitionWithTrace(document, position);

        if (config('definitionTrace')) {
            let tokenRange = document.getWordRangeAtPosition(position, /[A-Za-z_\\][A-Za-z0-9_\\]*/);
            let token = tokenRange ? document.getText(tokenRange) : '<unknown>';

            this.traceOutput.appendLine('---');
            this.traceOutput.appendLine('file=' + document.uri.fsPath);
            this.traceOutput.appendLine('line=' + (position.line + 1) + ' token=' + token);
            for (let line of result.trace) {
                this.traceOutput.appendLine(line);
            }

            if (Array.isArray(result.locations) && result.locations.length > 0) {
                this.traceOutput.appendLine('resolved-count=' + result.locations.length);
                this.traceOutput.appendLine('resolved-first=' + result.locations[0].uri.fsPath + ':' + (result.locations[0].range.start.line + 1));
            } else {
                this.traceOutput.appendLine('resolved-count=0');
            }
        }

        return result.locations;
    }

    showTraceOutput() {
        this.traceOutput.show(true);
    }

    dispose() {
        if (this.traceOutput) {
            this.traceOutput.dispose();
        }
    }
}

module.exports = PHPDefinitionProvider;
