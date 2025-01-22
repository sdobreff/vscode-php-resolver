const vscode = require('vscode');

/**
 * Create a class that implements the FileDecorationProvider interface.
 * @returns {Promise<FileDecorationProvider>}
 */
async function createDecoratorClass() {
	class FileDecorationProvider {
		constructor() {
			this.disposables = [];
			this._onDidChangeFileDecorations = new vscode.EventEmitter();
            this.disposables.push(this._onDidChangeFileDecorations);
			this.disposables.push(vscode.window.registerFileDecorationProvider(this));
		}

		/**
		 * Creates a FileDecoration with the file size as a tooltip.
		 *
		 * @param {vscode.Uri} uri
		 * @returns vscode.FileDecoration
		 * @memberof FileDecorationProvider
		 **/
		async provideFileDecoration(uri) {
			const fileStats = await vscode.workspace.fs.stat(uri);

			if (fileStats.type === vscode.FileType.File) {
				const fileSize = fileStats.size;
				const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
				let size = fileSize;
				let unitIndex = 0;

				while (size >= 1024 && unitIndex < units.length - 1) {
					size /= 1024;
					unitIndex++;
				}

				const prettySize = `${size.toFixed(1)}${units[unitIndex]}`;
				return {
					tooltip: prettySize
				};
			}
		}

		// Add this new method
        onFileChanged(uri) {
            this._onDidChangeFileDecorations.fire([uri]);
        }

        // Add this getter
        get onDidChangeFileDecorations() {
            return this._onDidChangeFileDecorations.event;
        }

		dispose () {
			this.disposables.forEach((d) => d.dispose());
		}
	}
	return new FileDecorationProvider();
}

module.exports = createDecoratorClass;