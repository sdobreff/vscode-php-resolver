let vscode = require('vscode');
let spawn = require('cross-spawn');
const path = require('path');
let fs = require('fs');
let { activeEditor, config, showMessage, showErrorMessage } = require('./Helpers');

class PHPCs {
    diagnosticCollection = vscode.languages.createDiagnosticCollection(
        "php"
    );
    libName = 'phpcs';

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
        this.logger.logMessage(this.libName + ' - Dispose diagnostic collection', 'INFO');

        // this.disposeDiagnosticCollection();

        this.logger.logMessage(this.libName + ' - The document URI ' + activeEditor().document.uri, 'INFO');

        let text = activeEditor().document.getText();

        let snifferCommand = config('phpSnifferCommand');

        if ('' === snifferCommand) {
            this.logger.logMessage(this.libName + ' is command is not provided', 'ERROR');
            return showErrorMessage(this.libName + ` executable is not set.`);
        }

        let commandExists = require('command-exists').sync;

        if (!commandExists(snifferCommand)) {
            this.logger.logMessage(this.libName + ' - Executable is set, but can not be found: "' + snifferCommand + '"', 'ERROR');
            return showErrorMessage(this.libName + ` executable is not found - ` + snifferCommand);
        }

        let args = ["-q", "-", "--report=json"];

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

        if ('' !== standards) {
            standards = "--standard=" + standards;

            args.push(standards);
        }

        this.logger.logMessage(this.libName + ' - Command - "' + snifferCommand + '"', 'INFO');

        this.logger.logMessage(this.libName + ' - Spawning the command with parameters - ' + args.join(' '), 'INFO');
        const child = spawn(snifferCommand, args, { encoding: 'utf8' });

        this.logger.logMessage(this.libName + ' - Writing the extracted file content to the stdin', 'INFO');
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
                    showMessage(this.libName + ' - Mismatch configuration provided');
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

    async format(child) {
        const PHPCSMessageType = {
            ERROR: "ERROR",
            WARNING: "WARNING",
        }

        let dataReceived = '';

        return await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                if (data) {
                    this.logger.logMessage(this.libName + ' - Collecting data ...', 'INFO');
                    dataReceived += data.toString();
                }
            });

            child.stdout.on('end', (data) => {
                if (!dataReceived) {
                    this.logger.logMessage(this.libName + ' - No data received - exit', 'INFO');
                    resolve();
                }
                this.logger.logMessage(this.libName + ' - Collecting the output finished starting parsing', 'INFO');
                try {
                    let snifferResponse = JSON.parse(dataReceived);
                    for (const file in snifferResponse['files']) {
                        const diagnostics = [];
                        snifferResponse['files'][file].messages.forEach(
                            ({ message, line, column, type, source }) => {
                                const zeroLine = line - 1;
                                const ZeroColumn = column - 1;

                                this.logger.logMessage(this.libName + ' - Problem found on line ' + line + ' column ' + column, 'INFO');
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

                                this.logger.logMessage(this.libName + ' - Determining the type of severity ' + severity, 'INFO');

                                let output = message + "\nSource: " + source;

                                output += `\nPHP Resolver`;

                                const diagnostic = new vscode.Diagnostic(
                                    range,
                                    output,
                                    severity
                                );
                                diagnostic.source = this.libName;
                                this.logger.logMessage(this.libName + ' - Adding to diagnostic collection', 'INFO');
                                diagnostics.push(diagnostic);
                            }
                        );
                        this.logger.logMessage(this.libName + ' - All the diagnostics are collected - adding to the document', 'INFO');
                        this.diagnosticCollection.set(activeEditor().document.uri, diagnostics);
                    }
                    resolve();
                } catch (e) {
                    this.logger.logMessage(this.libName + ' - Failed collecting proper output - ' + e.message, 'ERROR');
                    this.logger.logMessage(this.libName + ' - Received - ' + dataReceived, 'INFO');
                    resolve(showErrorMessage(this.libName + ` Fatal error occurred.`));
                }
            });
        });
    }
}

module.exports = PHPCs;