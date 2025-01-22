const path = require('path');
let vscode = require('vscode');
let spawn = require('cross-spawn');
let fs = require('fs');
let { activeEditor, config, showMessage, showErrorMessage, USER_CONFIG_FIXER_FILE_NAME, EXTENSION_NAME } = require('./Helpers');

class PHPCsFixer {
    userConfigFileUri = path.join(__dirname, '../' + USER_CONFIG_FIXER_FILE_NAME);
    dataReceived = '';
    libName = 'phpcsfixer';

    setLogger(logger) {
        this.logger = logger;
    }

    async fixPHP() {

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: false
        },
            async (progress, token) => {
                return new Promise((async (resolve) => {
                    let beautyCommand = config('phpCsFixerCommand');

                    const filename = activeEditor().document.fileName;
                    const opts = { cwd: path.dirname(filename) };

                    let configFile = this.getFilePath(['.php-cs-fixer.php', '.php-cs-fixer.dist.php'], opts.cwd);

                    progress.report({ message: EXTENSION_NAME + `: Started PHP CS fixer command` });

                    if (undefined === configFile) {
                        // No config file found, read the rules from the configuration (if any) and write them into a file.
                        let rules = config('fixerConfigString');

                        if ('' !== rules) {
                            this.writeUserConfigFile(rules);
                            configFile = this.userConfigFileUri;
                        } else {
                            // No rules set anywhere - leave it empty then
                            configFile = '';
                        }
                    }

                    if ('' === beautyCommand) {
                        this.logger.logMessage(this.libName + ' - No executable is set', 'ERROR');
                        resolve(null);
                        return showErrorMessage(this.libName + ` executable is not set.`);
                    }

                    let commandExists = require('command-exists').sync;

                    if (!commandExists(beautyCommand)) {
                        this.logger.logMessage(this.libName + ' - Executable is set, but can not be found: "' + beautyCommand + '"', 'ERROR');
                        resolve(null);
                        return showErrorMessage(this.libName + ` executable is not found.`);
                    }

                    let standards = config('phpFixerRules');

                    let args = ["fix", activeEditor().document.uri.fsPath, "-vvv", "--using-cache=no"];

                    if ('' !== beautyCommand && '' === configFile) {
                        standards = "--rules=" + JSON.stringify(standards);

                        args.push(standards);
                    }

                    if ('' !== configFile) {
                        let config = "--config=" + configFile;

                        args.push(config);
                    }

                    progress.report({ message: EXTENSION_NAME + `: Spawning PHP CS Fixer command` });

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
                        progress.report({ increment: 100, message: EXTENSION_NAME + `: PHP CS Fixer Finished` });
                        resolve(null);
                    });

                    this.logger.logMessage(this.libName + ' - Writing to the stdin', 'INFO');

                    await this.format(child);
                }));

            }
        );
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

    /**
     * finds if any of filenames exists in basePath and parent directories
     * and returns the path
     * @param {array} fileNames 
     * @param {string} basePath 
     * @returns string | undefined
     */
    getFilePath(fileNames, basePath) {
        if (fileNames.length === 0) {
            return undefined;
        }

        let currentPath;
        let currentFile;
        //let triedPaths;
        let foundPath;

        for (let i = 0; i < fileNames.length; i++) {
            currentFile = fileNames[i];

            // log(currentFile);
            if (this.absoluteExists(currentFile)) {
                // log('found absolute');
                return currentFile;
            }

            currentPath = basePath;
            // triedPaths = [currentPath];
            while (!fs.existsSync(currentPath + path.sep + currentFile)) {
                let lastPath = currentPath;
                currentPath = path.resolve(currentPath, '..');
                // log(currentPath);
                // log(lastPath + ":" + currentPath);
                if (lastPath === currentPath) {
                    // log('not found');
                    break;
                } else {
                    // triedPaths.push(currentPath);
                }
            }

            foundPath = currentPath + path.sep + currentFile;
            // log(foundPath);
            this.logger.logMessage(this.libName + ' Checking ' + foundPath, 'INFO');
            if (fs.existsSync(foundPath)) {
                // log('really found ' + foundPath);
                this.logger.logMessage(this.libName + ' - Using config file: ' + foundPath, 'INFO');
                return foundPath;
            }
        };

        this.logger.logMessage(this.libName + ' - No config file found!', 'INFO');
        return undefined;
    }

    absoluteExists(filePath) {
        return path.isAbsolute(filePath) && fs.existsSync(filePath);
    }

    async writeUserConfigFile(string) {
        await fs.writeFileSync(this.userConfigFileUri, string);
    }
}

module.exports = PHPCsFixer;