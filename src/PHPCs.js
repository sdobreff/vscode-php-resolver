let vscode = require('vscode');
let spawn = require('cross-spawn');
let { activeEditor, config, showMessage, showErrorMessage } = require('./Helpers');

class PHPCs {
    diagnosticCollection = vscode.languages.createDiagnosticCollection(
        "php"
    );

    setLogger(logger) {
        this.logger = logger;
    }

    disposeDiagnosticCollection() {
        if (undefined !== activeEditor()) {
            this.diagnosticCollection.delete(activeEditor().document.uri);
        }
        this.diagnosticCollection.clear();
    }

    async fixPHP() {
        this.logger.logMessage('phpcs - Dispose diagnostic collection', 'INFO');

        this.disposeDiagnosticCollection();

        this.logger.logMessage('phpcs - The document URI ' + activeEditor().document.uri, 'INFO');

        let text = activeEditor().document.getText();

        let snifferCommand = config('phpSnifferCommand');

        if ('' === snifferCommand) {
            this.logger.logMessage('phpcs is command is not provided', 'ERROR');
            return showErrorMessage(`phpcs executable is not set.`);
        }

        this.logger.logMessage('phpcs - Extracting standards from the configuration', 'INFO');
        let standards = config('phpStandards');

        let args = ["-q", "-", "--report=json"];

        if ('' !== snifferCommand) {
            standards = "--standard=" + standards;

            args.push(standards);
        }

        this.logger.logMessage('phpcs - Spawning the command with parameters - ' + args.join(' '), 'INFO');
        const child = spawn(snifferCommand, args, { encoding: 'utf8' });

        this.logger.logMessage('phpcs - Writing the extracted file content to the stdin', 'INFO');
        child.stdin.write(text);
        child.stdin.end();

        // let stdout = "";
        // let stderr = "";

        // child.stdout.on("data", (data) => (stdout += data));
        // child.stderr.on("data", (data) => (stderr += data));

        child.on('exit', (exitCode, signalCode) => {
            switch (exitCode) {
                case null: {
                    break;
                }
                case 0: {
                    // showMessage('phpcs - No errors found');
                    break
                }
                case 1: {
                    // showMessage('phpcs - All fixable errors were resolved PHPCS');
                    break
                }
                case 2: {
                    // showMessage('phpcs - Failed to fix some of the fixable errors');
                    break
                }
                case 3: {
                    showMessage('phpcs - Mismatch configuration provided');
                    break
                }
                default:
                    break;
            }
        });

        await this.format(child);

        // let diagnosticCollection = vscode.languages.createDiagnosticCollection(
        //     "php"
        // );

        // const range = new vscode.Range(
        //     0,
        //     0,
        //     0,
        //     0
        // );

        // const diagnostic = new vscode.Diagnostic(
        //     range,
        //     'Mamata si traka',
        //     vscode.DiagnosticSeverity.Error
        // );
        // diagnostic.source = "kur";

        // const diagnostics = [];

        // diagnostics.push(diagnostic);

        // diagnosticCollection.set(this.resolver.activeEditor().document.uri, diagnostics);
    }

    async format(child) {
        const PHPCSMessageType = {
            ERROR: "ERROR",
            WARNING: "WARNING",
        }

        let dataReceived = '';

        return await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                if (data) {
                    this.logger.logMessage('phpcs - Collecting data ...', 'INFO');
                    dataReceived += data.toString();
                }
            });

            child.stdout.on('end', (data) => {
                if (!dataReceived) {
                    this.logger.logMessage('phpcs - No data received - exit', 'INFO');
                    resolve();
                }
                this.logger.logMessage('phpcs - Collecting the output finished starting parsing', 'INFO');
                try {
                    let snifferResponse = JSON.parse(dataReceived);
                    for (const file in snifferResponse['files']) {
                        const diagnostics = [];
                        snifferResponse['files'][file].messages.forEach(
                            ({ message, line, column, type, source }) => {
                                const zeroLine = line - 1;
                                const ZeroColumn = column - 1;

                                this.logger.logMessage('phpcs - Problem found on line ' + line + ' column ' + column, 'INFO');
                                const range = new vscode.Range(
                                    zeroLine,
                                    ZeroColumn,
                                    zeroLine,
                                    ZeroColumn
                                );

                                const severity =
                                    type === PHPCSMessageType.ERROR
                                        ? vscode.DiagnosticSeverity.Error
                                        : vscode.DiagnosticSeverity.Warning;

                                this.logger.logMessage('phpcs - Determining the type of severity ' + severity, 'INFO');

                                let output = message + "\nSource: " + source;

                                output += `\nPHP Resolver`;

                                const diagnostic = new vscode.Diagnostic(
                                    range,
                                    output,
                                    severity
                                );
                                diagnostic.source = "phpcs";
                                this.logger.logMessage('phpcs - Adding to diagnostic collection', 'INFO');
                                diagnostics.push(diagnostic);
                            }
                        );
                        this.logger.logMessage('phpcs - All the diagnostics are collected - adding to the document', 'INFO');
                        this.diagnosticCollection.set(activeEditor().document.uri, diagnostics);
                    }
                    resolve();
                } catch (e) {
                    this.logger.logMessage('phpcs - Failed collecting proper output - ' + e.message, 'ERROR');
                    this.logger.logMessage('phpcs - Received - ' + dataReceived, 'INFO');
                    resolve(showErrorMessage(`phpcs Fatal error occurred.`));
                }
            });
        });
    }
}

module.exports = PHPCs;