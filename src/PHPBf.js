let vscode = require('vscode');
let spawn = require('cross-spawn');
let { activeEditor, config, showMessage, showErrorMessage } = require('./Helpers');

class PHPBf {

    dataReceived = '';

    setLogger(logger) {
        this.logger = logger;
    }

    async fixPHP() {
        let text = activeEditor().document.getText();

        let beautyCommand = config('phpBeautifierCommand');

        if ('' === beautyCommand) {
            this.logger.logMessage('phpcbf - No executable is set', 'ERROR');
            return showErrorMessage(`phpcbf executable is not set.`);
        }

        let standards = config('phpStandards');

        let args = ["-q", "-"];

        if ('' !== beautyCommand) {
            standards = "--standard=" + standards;

            args.push(standards);
        }
        this.logger.logMessage('phpcbf - Arguments set - ' + args.join(' '), 'INFO');

        const child = spawn(beautyCommand, args, { encoding: 'utf8' });

        child.stdin.write(text);
        child.stdin.end();

        child.on('exit', (exitCode, signalCode) => {
            switch (exitCode) {
                case null: {
                    this.logger.logMessage('phpcbf - Nothing is returned from the beautifier', 'INFO');
                    break;
                }
                case 0: {
                    this.logger.logMessage('phpcbf - No fixable errors', 'INFO');
                    showMessage('No fixable errors were found');
                    break
                }
                case 1: {
                    this.logger.logMessage('phpcbf - All errors are fixed', 'INFO');
                    showMessage('All fixable errors were resolved');
                    this.logger.logMessage('phpcbf - Replacing the code', 'INFO');
                    this.formatDocument();
                    break
                }
                case 2: {
                    this.logger.logMessage('phpcbf - Failed to fix some of the errors', 'INFO');
                    showMessage('Failed to fix some of the fixable errors');
                    this.logger.logMessage('phpcbf - Replacing the code', 'INFO');
                    this.formatDocument();
                    break
                }
                case 3: {
                    this.logger.logMessage('phpcbf - Configuration problem - check the arguments and PHP Resolver Output', 'ERROR');
                    this.logger.logMessage('phpcbf - ' + this.dataReceived, 'ERROR');

                    showMessage('Mismatched configuration provided');
                    break
                }
                default:
                    break;
            }
        });

        this.logger.logMessage('phpcbf - Writing to the stdin', 'INFO');

        await this.format(child);
    }

    async format(child) {
        this.dataReceived = '';
        return await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                if (data) {
                    this.logger.logMessage('phpcbf - Collecting data ...', 'INFO');
                    this.dataReceived += data.toString();
                }
            });
            child.stdout.on('end', (data) => {
                if ('' === this.dataReceived) {
                    this.logger.logMessage('phpcbf - No data is received - check that the command exists', 'ERROR');
                } else {
                    this.logger.logMessage('phpcbf - All the output is received - waiting for exit code', 'INFO');
                }
            });
        });

    }

    registerDocumentFormatter(
        document,
        range
    ) {
        this.logger.logMessage('phpcbf - Registering formatter', 'INFO');
        this.fixPHP();
    }

    async formatDocument() {
        return await new Promise((resolve) => {
            let invalidRange = new vscode.Range(0, 0, activeEditor().document.lineCount, 0);
            let validFullRange = activeEditor().document.validateRange(invalidRange);

            resolve(activeEditor().edit(editBuilder => {
                editBuilder.replace(validFullRange, this.dataReceived);
            }).catch(err => console.log(err)));
        });
    }
}

module.exports = PHPBf;