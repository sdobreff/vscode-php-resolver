let vscode = require('vscode');
let libFS = require('fs');
let { activeEditor, config, showMessage, showErrorMessage } = require('./Helpers');

class FileSize {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);

    async loadFileSize(file = '') {
        if (!file) {
            let editor = activeEditor();
            if (editor === undefined) {
                this.statusBarItem.text = 'Size Unknown';
                this.statusBarItem.show();
                return;
            }
            file = editor.document.uri.path;
        }

        await libFS.stat(file, (error, stats) => {
            if (error) {
                this.statusBarItem.text = this.bytesToSize(0);
            } else {
                this.statusBarItem.text = this.bytesToSize(stats.size);
            }
        });
        this.statusBarItem.show();
    }

    async getFileSizeInBytes(file = '') {

        return new Promise(async (resolve, reject) => {
            if (!file) {
                file = editor.document.uri.path;
            }
            await libFS.stat(file, (error, stats) => {
                if (error) {
                    resolve(0);
                } else {
                    resolve(stats.size);
                }
            });
        });
    }

    truncateFile(file) {
        libFS.truncate(file, 0, function () {
            showMessage('FileSize file content truncated', false);
        });
    }

    getBytesType(bytes) {
        return parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    }

    getHumanSize(bytes, type) {
        return +(Math.round(bytes / Math.pow(1024, type) + "e+2") + "e-2");
    }

    bytesToSize(bytes) {
        var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes == 0) return '0 Byte';
        var i = this.getBytesType(bytes);
        return this.getHumanSize(bytes, i) + ' ' + sizes[i]; //Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
    }
}

module.exports = FileSize;