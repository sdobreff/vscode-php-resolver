const path = require('path');
let spawn = require('cross-spawn');
let fs = require('fs');
let { activeEditor, config, showMessage, showErrorMessage, USER_CONFIG_FIXER_FILE_NAME } = require('./Helpers');

class PHPCsFixer {
    userConfigFileUri = path.join(__dirname, '../' + USER_CONFIG_FIXER_FILE_NAME);
    dataReceived = '';

    setLogger(logger) {
        this.logger = logger;
    }

    async fixPHP() {
        let beautyCommand = config('phpCsFixerCommand');
        let configFile = config('fixerConfigString');

        if ('' !== configFile) {
            this.writeUserConfigFile(configFile);
        }

        if ('' === beautyCommand) {
            this.logger.logMessage('phpcsfixer - No executable is set', 'ERROR');
            return showErrorMessage(`phpcsfixer executable is not set.`);
        }

        let standards = config('phpFixerRules');

        let args = ["fix", activeEditor().document.uri.fsPath, "-vvv", "--using-cache=no"];

        if ('' !== beautyCommand && '' === configFile) {
            standards = "--rules=" + JSON.stringify(standards);

            args.push(standards);
        }

        if ('' !== configFile) {
            let config = "--config=" + this.userConfigFileUri;

            args.push(config);
        }

        this.logger.logMessage('phpcsfixer - Arguments set - ' + args.join(' '), 'INFO');

        const child = spawn(beautyCommand, args, { encoding: 'utf8' });

        child.stdin.end();

        child.on('exit', (exitCode, signalCode) => {
            switch (exitCode) {
                case null: {
                    this.logger.logMessage('phpcsfixer - Nothing is returned from the fixer', 'INFO');
                    break;
                }
                case 0: {
                    this.logger.logMessage('phpcsfixer - Everything is fixed', 'INFO');
                    showMessage('Everything is fixed');
                    break
                }
                case 1: {
                    showMessage('General error (or PHP minimal requirement not matched).');
                    this.logger.logMessage('phpcsfixer - ' + this.dataReceived, 'ERROR');
                    break
                }
                case 2: {
                    this.logger.logMessage('phpcsfixer - Failed to fix some of the errors', 'INFO');
                    showMessage('Failed to fix some of the fixable errors');
                    this.logger.logMessage('phpcsfixer - Replacing the code', 'INFO');
                    break
                }
                case 16: {
                    this.logger.logMessage('phpcsfixer - Configuration problem - check the arguments and PHP Resolver Output', 'ERROR');
                    this.logger.logMessage('phpcsfixer - ' + this.dataReceived, 'ERROR');

                    showMessage('phpcsfixer - Mismatched configuration provided');
                    break
                }
                default:
                    break;
            }
        });

        this.logger.logMessage('phpcsfixer - Writing to the stdin', 'INFO');

        await this.format(child);
    }

    async format(child) {
        this.dataReceived = '';
        return await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                if (data) {
                    this.logger.logMessage('phpcsfixer - Collecting data ...', 'INFO');
                    this.dataReceived += data.toString();
                }
            });
            child.stdout.on('end', (data) => {
                if ('' === this.dataReceived) {
                    this.logger.logMessage('phpcsfixer - No data is received - check that the command exists', 'ERROR');
                } else {
                    this.logger.logMessage('phpcsfixer - All the output is received - waiting for exit code', 'INFO');
                }
            });
        });

    }

    getUserConfig() {
        return new Promise((resolve, reject) => {
            try {
                if (fs.existsSync(this.userConfigFileUri)) {
                    resolve(require(this.userConfigFileUri));
                } else {
                    resolve(false);
                }
            } catch {

            }
        });
    }

    async writeUserConfigFile(string) {
        await fs.writeFileSync(this.userConfigFileUri, string);
    }
}

module.exports = PHPCsFixer;