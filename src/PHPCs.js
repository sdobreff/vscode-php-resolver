let vscode = require('vscode');
let spawn = require('cross-spawn');
let Resolver = require('./Resolver');

class PHPCs {
    resolver = new Resolver();

    async fixPHP() {
        let text = this.resolver.activeEditor().document.getText();

        let snifferCommand = this.resolver.config('phpSnifferCommand');

        if ('' === snifferCommand) {
            return this.resolver.showErrorMessage(`$(issue-opened) phpcs executable is not set.`);
        }

        let standards = this.resolver.config('phpStandards');

        let args = ["-q", "-", "--report=json"];

        if ('' !== snifferCommand) {
            standards = "--standard=" + standards;

            args.push(standards);
        }

        const child = spawn(snifferCommand, args, { encoding: 'utf8' });

        child.stdin.write(text);
        child.stdin.end();

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));

        child.on('exit', (exitCode, signalCode) => {
            switch (exitCode) {
                case null: {
                    break;
                }
                case 0: {
                    this.resolver.showMessage('No fixable errors were found');
                    break
                }
                case 1: {
                    this.resolver.showMessage('All fixable errors were resolved');
                    break
                }
                case 2: {
                    this.resolver.showMessage('Failed to fix some of the fixable errors');
                    break
                }
                case 3: {
                    this.resolver.showMessage('Mismatched configuration provided');
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

    async format(child, stdout, stderr) {

        return await new Promise((resolve) => {
            child.on("close", () => {
                if (!stdout) {
                    resolve();
                    return;
                }
                snifferResponse = JSON.parse(stdout);
            });
        });

    }

}

module.exports = PHPCs;