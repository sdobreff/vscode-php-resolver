let vscode = require('vscode');

class Logger {
    outputChannel = vscode.window.createOutputChannel(
        "PHP Resolver"
    );

    focus() {
        this.outputChannel.show();
    }

    /**
     * Append messages to the output channel and format it with a title
     *
     * @param message The message to append to the output channel
     */
    logMessage(message, logLevel) {
        const title = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`["${logLevel}" - ${title}] ${message}`);

        if ('ERROR' === logLevel) {
            this.outputChannel.show();
        }
    }
}

module.exports = Logger;