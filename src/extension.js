let vscode = require('vscode');
let Resolver = require('./Resolver');

function activate(context) {
    let resolver = new Resolver;

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.import', async () => {
            let selections = vscode.window.activeTextEditor.selections;

            for (let i = 0; i < selections.length; i++) {
                await resolver.importCommand(selections[i]);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.expand', async () => {
            let selections = vscode.window.activeTextEditor.selections;

            for (let i = 0; i < selections.length; i++) {
                await resolver.expandCommand(selections[i]);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.sort', () => resolver.sortCommand())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.importAll', () => resolver.importAll())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.highlightNotImported', () => resolver.highlightNotImported())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.highlightNotUsed', () => resolver.highlightNotUsed())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.generateNamespace', () => resolver.generateNamespace())
    );

    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
        if (
            event &&
            event.document.languageId === 'php' &&
            vscode.workspace.getConfiguration('phpResolver').get('sortOnSave')
        ) {
            resolver.sortCommand();
        }

        if (
            event &&
            event.document.languageId === 'php' &&
            vscode.workspace.getConfiguration('phpResolver').get('autoImportOnSave')
        ) {
            resolver.importAll();
        }

        if (
            event &&
            event.document.languageId === 'php' &&
            vscode.workspace.getConfiguration('phpResolver').get('highlightOnSave')
        ) {
            resolver.highlightNotImported();
            resolver.highlightNotUsed();
        }
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((event) => {
        if (
            event &&
            event.document.languageId === 'php' &&
            vscode.workspace.getConfiguration('phpResolver').get('highlightOnOpen')
        ) {
            resolver.highlightNotImported();
            resolver.highlightNotUsed();
        }
    }));

    context.subscriptions.push(resolver);

    resolver.loadFileSize();

    var onSave = vscode.workspace.onDidSaveTextDocument(() => {
        resolver.loadFileSize();
    });
    var onActiveEditorChanged = vscode.window.onDidChangeActiveTextEditor(() => {
        resolver.loadFileSize();
    });

    context.subscriptions.push(onSave);
    context.subscriptions.push(onActiveEditorChanged);
}

exports.activate = activate;
