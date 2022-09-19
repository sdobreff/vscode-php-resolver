let vscode = require('vscode');
let spawn = require('cross-spawn');
let Resolver = require('./Resolver');

class PHPBf {
    resolver = new Resolver();

    async fixPHP() {
        let text = this.resolver.activeEditor().document.getText();

        let beautyCommand = this.resolver.config('phpBeautifierCommand');

        if ('' === beautyCommand) {
            return this.resolver.showErrorMessage(`$(issue-opened) phpcbf executable is not set.`);
        }

        let standards = this.resolver.config('phpStandards');

        let args = ["-q", "-"];

        if ('' !== beautyCommand) {
            standards = "--standard=" + standards;

            args.push(standards);
        }

        const child = spawn(beautyCommand, args, { encoding: 'utf8' });

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

        child.stdin.write(text);
        child.stdin.end();

        await this.format(child);
    }

    async format(child) {

        return await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                if (data) {

                    let invalidRange = new vscode.Range(0, 0, this.resolver.activeEditor().document.lineCount, 0);
                    let validFullRange = this.resolver.activeEditor().document.validateRange(invalidRange);

                    resolve(this.resolver.activeEditor().edit(editBuilder => {
                        editBuilder.replace(validFullRange, data.toString());
                    }).catch(err => console.log(err)));
                }
            });
        });

    }

}

module.exports = PHPBf;