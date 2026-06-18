let vscode = require('vscode');
let { config } = require('./Helpers');

class PHPImplementationProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
        this.traceOutput = vscode.window.createOutputChannel('PHP Resolver - Implementation Trace');
    }

    async provideImplementation(document, position) {
        if (!this.definitionIndex) {
            return [];
        }

        let result = await this.definitionIndex.findImplementationsWithTrace(document, position);

        if (config('definitionTrace')) {
            this.traceOutput.appendLine('---');
            this.traceOutput.appendLine('file=' + document.uri.fsPath + ' line=' + (position.line + 1));
            for (let line of result.trace) {
                this.traceOutput.appendLine(line);
            }
            this.traceOutput.appendLine('implementation-count=' + result.locations.length);
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

module.exports = PHPImplementationProvider;
