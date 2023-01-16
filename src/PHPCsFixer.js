const path = require('path');
let spawn = require('cross-spawn');
let fs = require('fs');
let { activeEditor, config, showMessage, showErrorMessage, USER_CONFIG_FIXER_FILE_NAME } = require('./Helpers');

class PHPCsFixer {
    userConfigFileUri = path.join(__dirname, '../' + USER_CONFIG_FIXER_FILE_NAME);
    dataReceived = '';
    libName = 'phpcsfixer';

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
            this.logger.logMessage(this.libName + ' - No executable is set', 'ERROR');
            return showErrorMessage(this.libName + ` executable is not set.`);
        }

        let commandExists = require('command-exists').sync;

        if (!commandExists(beautyCommand)) {
            this.logger.logMessage(this.libName + ' - Executable is set, but can not be found: "' + beautyCommand + '"', 'ERROR');
            return showErrorMessage(this.libName + ` executable is not found.`);
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

        this.logger.logMessage(this.libName + ' - Command - "' + beautyCommand + '"', 'INFO');
        this.logger.logMessage(this.libName + ' - Arguments set - ' + args.join(' '), 'INFO');

        const child = spawn(beautyCommand, args, { encoding: 'utf8' });

        child.stdin.end();

        child.on('exit', (exitCode, signalCode) => {
            switch (exitCode) {
                case null: {
                    this.logger.logMessage(this.libName + ' - Nothing is returned from the fixer', 'INFO');
                    break;
                }
                case 0: {
                    this.logger.logMessage(this.libName + ' - Everything is fixed', 'INFO');
                    showMessage('Everything is fixed');
                    break
                }
                case 1: {
                    showMessage('General error (or PHP minimal requirement not matched).');
                    this.logger.logMessage(this.libName + ' - ' + this.dataReceived, 'ERROR');
                    break
                }
                case 2: {
                    this.logger.logMessage(this.libName + ' - Failed to fix some of the errors', 'INFO');
                    showMessage('Failed to fix some of the fixable errors');
                    this.logger.logMessage(this.libName + ' - Replacing the code', 'INFO');
                    break
                }
                case 16: {
                    this.logger.logMessage(this.libName + ' - Configuration problem - check the arguments and PHP Resolver Output', 'ERROR');
                    this.logger.logMessage(this.libName + ' - ' + this.dataReceived, 'ERROR');

                    showMessage(this.libName + ' - Mismatched configuration provided');
                    break
                }
                default:
                    break;
            }
        });

        this.logger.logMessage(this.libName + ' - Writing to the stdin', 'INFO');

        await this.format(child);
    }

    async format(child) {
        this.dataReceived = '';
        return await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                if (data) {
                    this.logger.logMessage(this.libName + ' - Collecting data ...', 'INFO');
                    this.dataReceived += data.toString();
                }
            });
            child.stdout.on('end', (data) => {
                if ('' === this.dataReceived) {
                    this.logger.logMessage(this.libName + ' - No data is received - check that the command exists', 'ERROR');
                } else {
                    this.logger.logMessage(this.libName + ' - All the output is received - waiting for exit code', 'INFO');
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