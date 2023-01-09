let vscode = require('vscode');
let Resolver = require('./Resolver');
let PHPBf = require('./PHPBf');
let PHPCsFixer = require('./PHPCsFixer');
let PHPCs = require('./PHPCs');
let Logger = require('./Logger');
let VersionNotifier = require('./VersionNotifier');
let ErrorLogViewer = require('./ErrorLogViewer');
let FileSize = require('./FileSize');
let { activeEditor, config } = require('./Helpers');

let errorLogger = null;

let phpbf = null;
let phpfixer = null;
let phpcs = null;
let phpBeautyFormatter = null;
let logger = new Logger;
let onSaveSniff = null;
let onChangeSniff = null;
let clearErrorOutput = null;

function updateConfig(context) {

    var configuration = {
        phpLogFile: config('phpLogFile'),
        phpBeautifierCommand: config('phpBeautifierCommand'),
        phpSnifferCommand: config('phpSnifferCommand'),
    }

    if ('' !== config('phpLogFile')) {
        if (null === errorLogger) {
            errorLogger = new ErrorLogViewer;
        }
        errorLogger.watch();
    } else if (null !== errorLogger) {
        errorLogger.destroy();
        delete errorLogger;
        errorLogger = null;
    }

    if ('' !== config('phpLogFile')) {
        if (clearErrorOutput === null) {
            clearErrorOutput = vscode.commands.registerCommand('phpResolver.clearErrorChannel', () => errorLogger.clearErrorChannel());
            context.subscriptions.push(
                clearErrorOutput
            );
            logger.logMessage('Clear output chanel command registered', 'INFO');
        }
    } else if ('' === config('phpLogFile') && clearErrorOutput !== null) {
        clearErrorOutput.dispose();
        clearErrorOutput = null;
        logger.logMessage('Clear output chanel command deregistered', 'INFO');
    }

    if ('' !== config('phpBeautifierCommand')) {
        if (null === phpbf) {
            phpbf = new PHPBf();
            phpbf.setLogger(logger);
        }

        if (null !== phpBeautyFormatter) {
            phpBeautyFormatter.dispose();
            phpBeautyFormatter = null;
            logger.logMessage('Beautifier path is changed - Removing old one', 'INFO');
        }

        // register as document formatter for php
        phpBeautyFormatter = vscode.languages.registerDocumentRangeFormattingEditProvider(
            { scheme: "file", language: "php" },
            {
                provideDocumentRangeFormattingEdits: (document, range) => {
                    return phpbf.registerDocumentFormatter(document, range);
                },
            }
        );
        logger.logMessage('Beautifier path is set - beautifier is registered', 'INFO');
    } else {
        if (null !== phpBeautyFormatter) {
            phpBeautyFormatter.dispose();
            phpBeautyFormatter = null;
            logger.logMessage('Beautifier path is removed - Beautifier is unregistered', 'INFO');
        }
        delete phpbf;
        phpbf = null;
    }

    if ('' !== config('phpCsFixerCommand')) {
        if (null === phpfixer) {
            phpfixer = new PHPCsFixer();
            phpfixer.setLogger(logger);
        }

        logger.logMessage('Fixer path is set - php-cs-fixer is registered', 'INFO');
    } else {
        logger.logMessage('Fixer path is unset - php-cs-fixer is unregistered', 'INFO');
        delete phpfixer;
        phpfixer = null;
    }

    if ('' !== config('phpSnifferCommand')) {
        if (null === phpcs) {
            phpcs = new PHPCs();
            phpcs.setLogger(logger);
        }
        if (null !== onChangeSniff) {
            onChangeSniff.dispose();
            onChangeSniff = null;
            logger.logMessage('Sniffer path is changed - Removing old Sniffer on change', 'INFO');
        }
        if (null !== onSaveSniff) {
            onSaveSniff.dispose();
            onSaveSniff = null;
            logger.logMessage('Sniffer path is removed - Removing old Sniffer on save', 'INFO');
        }

        onChangeSniff = vscode.window.onDidChangeActiveTextEditor((event) => {
            if (
                event &&
                event.document.languageId === 'php'
            ) {
                logger.logMessage('Switched to new file - starting code sniffer', 'INFO');
                phpcs.fixPHP();
            }
        })

        context.subscriptions.push(onChangeSniff);

        onSaveSniff = vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'php') {
                logger.logMessage('Document is saved - starting code sniffer', 'INFO');
                phpcs.fixPHP();
            }
        });
        context.subscriptions.push(onSaveSniff);
    } else {
        logger.logMessage('Sniffer path is not set - sniffer can not check PHP files', 'INFO');
        if (null !== phpcs) {
            phpcs.disposeDiagnosticCollection();
        }
        if (null !== onChangeSniff) {
            onChangeSniff.dispose();
            onChangeSniff = null;
            logger.logMessage('Sniffer path is removed - Sniffer on change is unregistered', 'INFO');
        }
        if (null !== onSaveSniff) {
            onSaveSniff.dispose();
            onSaveSniff = null;
            logger.logMessage('Sniffer path is removed - Sniffer on save is unregistered', 'INFO');
        }
        delete phpcs;
        phpcs = null;
    }

    return configuration;
}

function activate(context) {
    let resolver = new Resolver;
    let fileSize = new FileSize;

    if ('' !== config('phpLogFile')) {
        errorLogger = new ErrorLogViewer;
        errorLogger.watch();
    }

    let versionNotifier = new VersionNotifier();
    versionNotifier.setProperVersion();
    versionNotifier = null;
    delete versionNotifier;

    logger.logMessage('Starting initialization', 'INFO');

    if ('' !== config('phpBeautifierCommand')) {
        phpbf = new PHPBf();
        phpbf.setLogger(logger);

        // register as document formatter for php
        phpBeautyFormatter = vscode.languages.registerDocumentRangeFormattingEditProvider(
            { scheme: "file", language: "php" },
            {
                provideDocumentRangeFormattingEdits: (document, range) => {
                    return phpbf.registerDocumentFormatter(document, range);
                },
            }
        );
    } else {
        logger.logMessage('Beautifier path is not set - beautifier is not registered', 'INFO');
    }

    if ('' !== config('phpCsFixerCommand')) {
        phpfixer = new PHPCsFixer();
        phpfixer.setLogger(logger);
    } else {
        logger.logMessage('PHP CS fixer path is not set - fixer is not registered', 'INFO');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.beautify', () => phpbf.fixPHP())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.fixer', () => phpfixer.fixPHP())
    );

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((event) => {
        fileSize.loadFileSize();
    }));

    if ('' !== config('phpSnifferCommand')) {
        phpcs = new PHPCs;
        phpcs.setLogger(logger);

        if (activeEditor() && activeEditor().document.languageId === 'php') {
            logger.logMessage('Starting fixer on currently open file', 'INFO');
            phpcs.fixPHP();
        }

        onChangeSniff = vscode.window.onDidChangeActiveTextEditor((event) => {
            if (
                event &&
                event.document.languageId === 'php'
            ) {
                logger.logMessage('Switched to new file - starting code sniffer', 'INFO');
                phpcs.fixPHP();
            }
        })

        context.subscriptions.push(onChangeSniff);

        var onSave = vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'php') {
                logger.logMessage('Document is saved - starting code sniffer', 'INFO');
                phpcs.fixPHP();
            }
        });
    } else {
        logger.logMessage('Sniffer path is not set - sniffer can not check the current file', 'INFO');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.import', async () => {
            let selections = activeEditor().selections;

            for (let i = 0; i < selections.length; i++) {
                await resolver.importCommand(selections[i]);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.expand', async () => {
            let selections = activeEditor().selections;

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

    // context.subscriptions.push(
    //     vscode.commands.registerCommand('phpResolver.highlightNotImported', () => resolver.highlightNotImported())
    // );

    // context.subscriptions.push(
    //     vscode.commands.registerCommand('phpResolver.highlightNotUsed', () => resolver.highlightNotUsed())
    // );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.generateNamespace', () => resolver.generateNamespace())
    );

    if ('' !== config('phpLogFile')) {
        if (clearErrorOutput === null) {
            clearErrorOutput = vscode.commands.registerCommand('phpResolver.clearErrorChannel', () => errorLogger.clearErrorChannel());
            context.subscriptions.push(
                clearErrorOutput
            );
            logger.logMessage('Clear output chanel command registered', 'INFO');
        }
    }

    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
        if (
            event &&
            event.document.languageId === 'php' &&
            config('sortOnSave')
        ) {
            logger.logMessage('Auto sort is set - starting', 'INFO');
            resolver.sortCommand();
        }

        if (
            event &&
            event.document.languageId === 'php' &&
            config('autoImportOnSave')
        ) {
            logger.logMessage('Auto import is set - starting', 'INFO');
            resolver.importAll();
        }

        if (
            event &&
            event.document.languageId === 'php' &&
            config('highlightOnSave')
        ) {
            logger.logMessage('Highlight is set - starting', 'INFO');
            resolver.highlightNotImported();
            resolver.highlightNotUsed();
        }
    }));

    // context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((event) => {
    //     fileSize.loadFileSize();

    //     // if (
    //     //     event &&
    //     //     event.document.languageId === 'php' &&
    //     //     config('highlightOnOpen')
    //     // ) {
    //     //     logger.logMessage('Switched to new file - highlighting start', 'INFO');
    //     //     resolver.highlightNotImported();
    //     //     resolver.highlightNotUsed();
    //     // }

    //     if (
    //         event &&
    //         event.document.languageId === 'php'
    //     ) {
    //         logger.logMessage('Switched to new file - starting code sniffer', 'INFO');
    //         phpcs.fixPHP();
    //     }
    // }));

    // context.subscriptions.push(resolver);
    // context.subscriptions.push(phpbf);
    // context.subscriptions.push(phpcs);
    // context.subscriptions.push(logger);

    logger.logMessage('Starting file size', 'INFO');
    fileSize.loadFileSize();

    // var onOpen = vscode.workspace.onDidOpenTextDocument((document) => {
    //     if (document.languageId === 'php') {
    //         logger.logMessage('Document is opened - starting code sniffer', 'INFO');
    //         phpcs.fixPHP();
    //     }
    // });

    onSaveSniff = vscode.workspace.onDidSaveTextDocument((document) => {
        logger.logMessage('Document is saved - loading file size', 'INFO');
        fileSize.loadFileSize();
        // if (document.languageId === 'php') {
        //     logger.logMessage('Document is saved - starting code sniffer', 'INFO');
        //     phpcs.fixPHP();
        // }
    });

    var onChangeConfig = vscode.workspace.onDidChangeConfiguration(() => {
        updateConfig(context);
    });

    // context.subscriptions.push(onOpen);
    context.subscriptions.push(onSave);
    context.subscriptions.push(onChangeConfig);
}

exports.activate = activate;
