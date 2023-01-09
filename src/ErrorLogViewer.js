let vscode = require('vscode');
let Tail = require('tail').Tail;
const { config } = require('./Helpers');
const notifier = require('node-notifier');
let FileSize = require('./FileSize');

class ErrorLogViewer {
    file = '';
    line = 0;

    outputChannel = vscode.window.createOutputChannel(
        "PHP Resolver - PHP error log", 'PHPLog'
    );

    watch() {
        let logFile = config('phpLogFile');
        try {
            let tail = new Tail(logFile);
            tail.on('line', async (data) => {
                this.outputChannel.appendLine(this.parseLog(data));
                let truncateSize = config('errorLogTruncateSize');
                if (truncateSize) {
                    let fileSize = new FileSize;
                    let fileSizeInBytes = await fileSize.getFileSizeInBytes(logFile);
                    // 2 means megabytes - probably implementing some parser for that is a good idea.
                    if (fileSize.getBytesType(fileSizeInBytes) >= 2 && fileSize.getHumanSize(fileSizeInBytes, fileSize.getBytesType(fileSizeInBytes)) > truncateSize) {
                        fileSize.truncateFile(logFile);
                    }
                }

                if (data.includes('PHP Fatal error')) {
                    this.outputChannel.show();
                    let that = this;
                    const path = require('path');
                    notifier.notify(
                        {
                            title: 'PHP error was triggered',
                            message: 'Click here to go to the file generated the error',
                            open: "vscode://file" + this.extractErrorFileAndLine(data),
                            icon: path.join(__dirname, '/../images/icon.png'), // Absolute path (doesn't work on balloons)
                            // sound: true, // Only Notification Center or Windows Toasters
                            wait: true // Wait with callback, until user action is taken against notification, does not apply to Windows Toasters as they always wait or notify-send as it does not support the wait option
                        },
                        function (error, response, metadata) {
                            if (response === 'activate') {

                                vscode.workspace.openTextDocument(that.file)
                                    .then(doc => {
                                        vscode.window.showTextDocument(doc, { preview: true })
                                            .then(x => {
                                                let activeEditor = vscode.window.activeTextEditor;
                                                let range = activeEditor.document.lineAt(that.line - 1).range;
                                                activeEditor.selection = new vscode.Selection(range.start, range.end);
                                                activeEditor.revealRange(range);
                                            })
                                    });
                            }
                        }
                    );
                }
            });
            tail.on("error", function (error) {
                this.outputChannel.appendLine(error);
            });
        } catch (ex) {
            this.outputChannel.appendLine(ex);
        }

        // fs.open(logFile, 'r', (err, fd) => {
        //     if (err) {
        //         if (err.code === 'ENOENT') {
        //             console.error(logFile + ' does not exist');
        //             return;
        //         }

        //         throw err;
        //     }

        //     try {
        //         var rs = fs.createReadStream(logFile, { flags: 'r', encoding: 'utf8' });
        //         fs.watch(logFile, (event) => {
        //             if (event === 'change') {
        //                 let self = this;
        //                 rs.on('data', function (data) {
        //                     self.outputChannel.appendLine('kur');
        //                     self.outputChannel.appendLine(data);
        //                 });
        //             }
        //         });
        //     } finally {
        //         fs.close(fd, (err) => {
        //             if (err) throw err;
        //         });
        //     }
        // });
    }

    parseLog(text) {
        let regex = /(#\d+\s)([\w\\\/\-\.\:\s]+)\((\d+)\)/gm;
        /**
         * Skip ... in use in ,,,
         */
        let regexSingleLine = /\s+in\s+(?!use\sin\s)([\w\\\/\-\.\:\s]+)\s+on\s+line\s+(\d+)/gm;
        let regexSingleThrown = /\s+in\s+([\w\\\/\-\.\:\s]+):(\d+)/gm;

        let protocol = 'file://';
        if (false === config('addProtocolToLog')) {
            protocol = '';
        }

        let separator = config('lineNumberSeparator');

        let newStr = text.replaceAll(regex, "$1" + protocol + "$2" + separator + "$3 ($3)");

        newStr = newStr.replaceAll(regexSingleLine, " in " + protocol + "$1" + separator + "$2 on line $2");
        newStr = newStr.replaceAll(regexSingleThrown, " in " + protocol + "$1" + separator + "$2 $2");

        let remoteMap = config('phpLogFilePathRemote');
        let localMap = config('phpLogFilePathLocal');
        if ('' !== localMap && '' !== remoteMap) {
            localMap = localMap.replace(/ /g, `${'\u00A0'}`);

            newStr = newStr.replaceAll(remoteMap, localMap);
        }

        return newStr;//.replace(/ /g, `${'\u00A0'} `);
    }

    extractErrorFileAndLine(text) {

        const words = text.split(" in ");
        text = words.pop();

        let regexSingleThrown = /([\w\\\/\-\.\:\s]+)[#:](\d+)/m;
        let matches = [];

        matches = regexSingleThrown.exec(text);

        if (null === matches) {
            let regexSingleThrown = /([\w\\\/\-\.\:\s]+) on line (\d+)/m;
            matches = [];
            matches = regexSingleThrown.exec(text);
        }

        let errorFilePathLine = matches[1] + ":" + matches[2] + ":0";

        this.file = matches[1];
        this.line = matches[2];

        let remoteMap = config('phpLogFilePathRemote');
        let localMap = config('phpLogFilePathLocal');
        if ('' !== localMap && '' !== remoteMap) {
            errorFilePathLine = errorFilePathLine.replaceAll(remoteMap, localMap);
            this.file = this.file.replaceAll(remoteMap, localMap);
        }

        return errorFilePathLine;
    }

    async clearErrorChannel() {
        this.outputChannel.clear();
    }

    destroy() {
        this.outputChannel.dispose();
        this.clearErrorChannel();
    }
}

module.exports = ErrorLogViewer;