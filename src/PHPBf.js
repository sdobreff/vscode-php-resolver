let vscode = require('vscode');
let spawn = require('cross-spawn');
const path = require('path');
let fs = require('fs');
let { activeEditor, config, showMessage, showErrorMessage } = require('./Helpers');

class PHPBf {

    dataReceived = '';
    libName = 'phpcbf';

    setLogger(logger) {
        this.logger = logger;
    }

    async fixPHP() {
        let text = activeEditor().document.getText();

        let beautyCommand = config('phpBeautifierCommand');

        if ('' === beautyCommand) {
            this.logger.logMessage(this.libName + ' - No executable is set', 'ERROR');
            return showErrorMessage(`{this.libName} executable is not set.`);
        }

        let commandExists = require('command-exists').sync;

        if (!commandExists(beautyCommand)) {
            this.logger.logMessage(this.libName + ' - Executable is set, but can not be found: "' + beautyCommand + '"', 'ERROR');
            return showErrorMessage(this.libName + ` executable is not found - ` + beautyCommand);
        }

        this.logger.logMessage(this.libName + ' - Extracting standards from directory structure', 'INFO');

        const filename = activeEditor().document.fileName;
        const opts = { cwd: path.dirname(filename) };
        let standardsFileName = config('phpCustomStandardsFile');
        let standardsFile = undefined;
        if ('' !== standardsFileName) {
            standardsFile = this.getFilePath([standardsFileName], opts.cwd);
        }

        let standards = '';

        if (undefined === standardsFile) {
            this.logger.logMessage(this.libName + ' - No standards in dir structure - fall back to the configuration', 'INFO');
            this.logger.logMessage(this.libName + ' - Extracting standards from the configuration', 'INFO');
            standards = config('phpStandards');
        } else {
            this.logger.logMessage(this.libName + ' - Standards config file found!', 'INFO');
            standards = standardsFile;
        }

        let args = ["-q", "-"];

        if ('' !== standards) {
            standards = "--standard=" + standards;

            args.push(standards);
        }

        this.logger.logMessage(this.libName + ' - Command - "' + beautyCommand + '"', 'INFO');
        this.logger.logMessage(this.libName + ' - Arguments set - ' + args.join(' '), 'INFO');

        const child = spawn(beautyCommand, args, { encoding: 'utf8' });

        child.stdin.write(text);
        child.stdin.end();

        child.on('exit', (exitCode, signalCode) => {
            switch (exitCode) {
                case null: {
                    this.logger.logMessage(this.libName + ' - Nothing is returned from the beautifier', 'INFO');
                    break;
                }
                case 0: {
                    this.logger.logMessage(this.libName + ' - No fixable errors', 'INFO');
                    showMessage('No fixable errors were found');
                    break
                }
                case 1: {
                    this.logger.logMessage(this.libName + ' - All errors are fixed', 'INFO');
                    showMessage('All fixable errors were resolved');
                    this.logger.logMessage(this.libName + ' - Replacing the code', 'INFO');
                    this.formatDocument();
                    break
                }
                case 2: {
                    this.logger.logMessage(this.libName + ' - Failed to fix some of the errors', 'INFO');
                    showMessage('Failed to fix some of the fixable errors');
                    this.logger.logMessage(this.libName + ' - Replacing the code', 'INFO');
                    this.formatDocument();
                    break
                }
                case 3: {
                    this.logger.logMessage(this.libName + ' - Configuration problem - check the arguments and PHP Resolver Output', 'ERROR');
                    this.logger.logMessage(this.libName + ' - ' + this.dataReceived, 'ERROR');

                    showMessage('Mismatched configuration provided');
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