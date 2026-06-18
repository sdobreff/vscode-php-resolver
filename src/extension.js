let vscode = require('vscode');
let fs = require('fs');
let path = require('path');
let os = require('os');
let AdmZip = require('adm-zip');
let Resolver = require('./Resolver');
let ZipContentProvider = require('./ZipContentProvider');
let PHPDefinitionIndex = require('./PHPDefinitionIndex');
let PHPDefinitionProvider = require('./PHPDefinitionProvider');
let PHPBf = require('./PHPBf');
let PHPCsFixer = require('./PHPCsFixer');
let PHPCs = require('./PHPCs');
let Logger = require('./Logger');
let VersionNotifier = require('./VersionNotifier');
let ErrorLogViewer = require('./ErrorLogViewer');
// let FileSize = require('./FileSize');
let { activeEditor, config, EXTENSION_NAME } = require('./Helpers');
let createDecoratorClass = require('./ExplorerDecorator');
let codeActions = require("./CodeActions");

let languageConfiguration = require('./PHPLanguageeConfiguration');
let docBlockTags = require('./PHPDocBlockTags');
let DocBuilder = require('./PHPBlockParser');

let errorLogger = null;

let phpbf = null;
let phpfixer = null;
let phpcs = null;
let phpBeautyFormatter = null;
let logger = new Logger;
let definitionIndex = null;
let onChangeActiveDocument = null;
// let onSave = null;
let onDidChange = null;
let clearErrorOutput = null;

function getDocBlockTags() {
    let tags = docBlockTags.map((tag) => ({
        tag: tag.tag,
        snippet: tag.snippet
    }));

    let author = config('author');
    if (author && typeof author === 'object') {
        tags = tags.map((tag) => {
            if (tag.tag !== '@author') {
                return tag;
            }

            let snippet = tag.snippet;
            let name = typeof author.name === 'string' ? author.name : 'Name';
            let email = typeof author.email === 'string' ? author.email : 'email@email.com';

            snippet = snippet.replace('{{name}}', name);
            snippet = snippet.replace('{{email}}', email);

            return {
                tag: tag.tag,
                snippet: snippet
            };
        });
    }

    return tags;
}

async function updateConfig(context) {

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

        if (null === onChangeActiveDocument) {

            onChangeActiveDocument = vscode.window.onDidChangeActiveTextEditor((event) => {
                if (
                    event &&
                    event.document.languageId === 'php'
                ) {
                    logger.logMessage('Switched to new file - starting code sniffer', 'INFO');
                    phpcs.fixPHP();
                }
            })

            context.subscriptions.push(onChangeActiveDocument);
        }

        // if (null === onSave) {
        //     onSave = await vscode.workspace.onDidSaveTextDocument((document) => {
        //         if (document.languageId === 'php' && phpcs) {

        //             const fileName = document.fileName;

        //             const timer = saveTimers.get(fileName);
        //             if (timer) {
        //                 clearTimeout(timer);
        //             }

        //             saveTimers.set(fileName, setTimeout(() => {
        //                 saveTimers.delete(fileName);
        //                 logger.logMessage('Document is saved - starting code sniffer', 'INFO');
        //                 phpcs.fixPHP();
        //             }, 1000));

        //         }
        //     });

        //     context.subscriptions.push(onSave);
        // }

        if (null === onDidChange) {
            onDidChange = await vscode.workspace.onDidChangeTextDocument((event) => {
                if (
                    event &&
                    event.document.languageId === 'php' &&
                    phpcs
                ) {
                    if (event.contentChanges.length > 0) {
                        const fileName = event.document.fileName;

                        const timer = saveTimers.get(fileName);
                        if (timer) {
                            clearTimeout(timer);
                        }

                        saveTimers.set(fileName, setTimeout(() => {
                            saveTimers.delete(fileName);
                            logger.logMessage('Document is changed - starting diagnostic', 'INFO');
                            phpcs.fixPHP();
                        }, 1000));
                    }

                }
            });

            context.subscriptions.push(onDidChange);
        }


        // if (null !== onChangeActiveDocument) {
        //     onChangeActiveDocument.dispose();
        //     onChangeActiveDocument = null;
        //     logger.logMessage('Sniffer path is changed - Removing old Sniffer on change', 'INFO');
        // }
        // if (null !== onSaveSniff) {
        //     onSaveSniff.dispose();
        //     onSaveSniff = null;
        //     logger.logMessage('Sniffer path is removed - Removing old Sniffer on save', 'INFO');
        // }

        // onChangeActiveDocument = vscode.window.onDidChangeActiveTextEditor((event) => {
        //     if (
        //         event &&
        //         event.document.languageId === 'php'
        //     ) {
        //         logger.logMessage('Switched to new file - starting code sniffer', 'INFO');
        //         phpcs.fixPHP();
        //     }
        // })

        // context.subscriptions.push(onChangeActiveDocument);

        // onSaveSniff = vscode.workspace.onDidSaveTextDocument((document) => {
        //     if (document.languageId === 'php') {
        //         logger.logMessage('Document is saved - starting code sniffer', 'INFO');
        //         phpcs.fixPHP();
        //     }
        // });
        // context.subscriptions.push(onSaveSniff);
    } else {
        logger.logMessage('Sniffer path is not set - sniffer can not check PHP files', 'INFO');
        if (null !== phpcs) {
            phpcs.disposeDiagnosticCollection();
        }
        if (null !== onChangeActiveDocument) {
            onChangeActiveDocument.dispose();
            onChangeActiveDocument = null;
            logger.logMessage('Sniffer path is removed - Sniffer on change active document is unregistered', 'INFO');
        }
        // if (null !== onSave) {
        //     onSave.dispose();
        //     onSave = null;
        //     logger.logMessage('Sniffer path is removed - Sniffer on save is unregistered', 'INFO');
        // }
        if (null !== onDidChange) {
            onDidChange.dispose();
            onDidChange = null;
            logger.logMessage('Sniffer path is removed - Sniffer on change is unregistered', 'INFO');
        }
        delete phpcs;
        phpcs = null;
    }

    return configuration;
}

async function activate(context) {
    let resolver = new Resolver;
    definitionIndex = new PHPDefinitionIndex(context, logger);
    definitionIndex.initialize().catch(() => {
        logger.logMessage('Definition index initialization failed', 'WARN');
    });

    let definitionProvider = new PHPDefinitionProvider(definitionIndex);
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
        [{ scheme: 'file', language: 'php' }, { scheme: 'file', language: 'hack' }],
        definitionProvider
    ));
    context.subscriptions.push({
        dispose: () => {
            definitionProvider.dispose();
        }
    });
    context.subscriptions.push({
        dispose: () => {
            if (definitionIndex) {
                definitionIndex.dispose();
            }
        }
    });

    let zipContentProvider = new ZipContentProvider();
    let zipContentView = vscode.window.createTreeView('phpResolverZipContents', {
        treeDataProvider: zipContentProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(zipContentView);

    const resolveZipPath = async (uri) => {
        if (uri && uri.fsPath) {
            return uri.fsPath;
        }

        if (activeEditor() && activeEditor().document && activeEditor().document.uri) {
            let candidate = activeEditor().document.uri.fsPath;
            if (candidate.toLowerCase().endsWith('.zip')) {
                return candidate;
            }
        }

        let pickedZip = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'Select ZIP Archive',
            filters: {
                'ZIP Archives': ['zip']
            }
        });

        if (!pickedZip || pickedZip.length === 0) {
            return null;
        }

        return pickedZip[0].fsPath;
    };

    const openZipContents = async (uri, silent) => {
        let zipPath = await resolveZipPath(uri);
        if (!zipPath) {
            return;
        }

        if (!zipPath.toLowerCase().endsWith('.zip') || !fs.existsSync(zipPath)) {
            if (!silent) {
                vscode.window.showWarningMessage('Selected file is not a valid ZIP archive.');
            }
            return;
        }

        try {
            zipContentProvider.loadZip(zipPath);
            await vscode.commands.executeCommand('setContext', 'phpResolver.zipViewHasData', true);
            if (!silent) {
                await vscode.commands.executeCommand('phpResolverZipContents.focus');
            }
            if (!silent) {
                vscode.window.showInformationMessage('ZIP contents loaded: ' + path.basename(zipPath));
            }
        } catch (error) {
            if (!silent) {
                vscode.window.showErrorMessage('Failed to read ZIP archive: ' + error.message);
            }
        }
    };

    const sanitizeZipEntryPath = (entryPath) => {
        if (!entryPath || typeof entryPath !== 'string') {
            return '';
        }

        let normalized = path.posix.normalize(entryPath).replace(/^\/+/, '');
        if (normalized.startsWith('..')) {
            return '';
        }

        return normalized;
    };

    const getActivePathFromTab = () => {
        try {
            if (!vscode.window.tabGroups || !vscode.window.tabGroups.activeTabGroup) {
                return null;
            }

            let activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (!activeTab || !activeTab.input) {
                return null;
            }

            let input = activeTab.input;
            if (vscode.TabInputText && input instanceof vscode.TabInputText) {
                return input.uri ? input.uri.fsPath : null;
            }

            if (vscode.TabInputBinary && input instanceof vscode.TabInputBinary) {
                return input.uri ? input.uri.fsPath : null;
            }

            if (vscode.TabInputTextDiff && input instanceof vscode.TabInputTextDiff) {
                return input.modified ? input.modified.fsPath : null;
            }
        } catch {
            return null;
        }

        return null;
    };

    const syncZipContentsWithActiveFile = async () => {
        let activePath = null;

        if (activeEditor() && activeEditor().document && activeEditor().document.uri) {
            activePath = activeEditor().document.uri.fsPath;
        } else {
            activePath = getActivePathFromTab();
        }

        if (activePath && activePath.toLowerCase().endsWith('.zip') && fs.existsSync(activePath)) {
            await openZipContents(vscode.Uri.file(activePath), true);
            return;
        }

        if (zipContentProvider.zipPath !== null || zipContentProvider.rootChildren.length > 0) {
            zipContentProvider.clear();
        }
        await vscode.commands.executeCommand('setContext', 'phpResolver.zipViewHasData', false);
    };
    //let fileSize = new FileSize;

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

    // context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((event) => {
    // fileSize.loadFileSize();
    // }));

    var saveTimers = new Map(); // Keyed by file name.

    if ('' !== config('phpSnifferCommand')) {
        phpcs = new PHPCs;
        phpcs.setLogger(logger);

        if (activeEditor() && activeEditor().document.languageId === 'php') {
            logger.logMessage('Starting fixer on currently open file', 'INFO');
            phpcs.fixPHP();
        }

        onChangeActiveDocument = await vscode.window.onDidChangeActiveTextEditor((event) => {
            if (
                event &&
                event.document.languageId === 'php'
            ) {
                logger.logMessage('Switched to new file - starting code sniffer', 'INFO');
                phpcs.fixPHP();
            }
        })

        context.subscriptions.push(onChangeActiveDocument);

        // onSave = await vscode.workspace.onDidSaveTextDocument((document) => {
        //     if (document.languageId === 'php' && phpcs) {

        //         const fileName = document.fileName;

        //         const timer = saveTimers.get(fileName);
        //         if (timer) {
        //             clearTimeout(timer);
        //         }

        //         saveTimers.set(fileName, setTimeout(() => {
        //             saveTimers.delete(fileName);
        //             logger.logMessage('Document is saved - starting code sniffer', 'INFO');
        //             phpcs.fixPHP();
        //         }, 1000));

        //     }
        // });

        // context.subscriptions.push(onSave);

        onDidChange = await vscode.workspace.onDidChangeTextDocument((event) => {
            if (
                event &&
                event.document.languageId === 'php' &&
                phpcs
            ) {
                if (event.contentChanges.length > 0) {
                    const fileName = event.document.fileName;

                    const timer = saveTimers.get(fileName);
                    if (timer) {
                        clearTimeout(timer);
                    }

                    saveTimers.set(fileName, setTimeout(() => {
                        saveTimers.delete(fileName);
                        logger.logMessage('Document is changed - starting diagnostic', 'INFO');
                        phpcs.fixPHP();
                    }, 1000));
                }

            }
        });

        context.subscriptions.push(onDidChange);
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

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.clearDefinitionCache', async () => {
            if (!definitionIndex) {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'PHP Resolver: rebuilding definition index'
            }, async () => {
                await definitionIndex.clearCacheAndRebuild();
            });

            vscode.window.showInformationMessage('PHP Resolver definition cache cleared and rebuilt.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.showDefinitionTrace', () => {
            definitionProvider.showTraceOutput();
        })
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

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.createZip', async (uri) => {
            let targetPath = null;

            if (uri && uri.fsPath) {
                targetPath = uri.fsPath;
            } else if (activeEditor() && activeEditor().document && activeEditor().document.uri) {
                targetPath = activeEditor().document.uri.fsPath;
            }

            if (!targetPath || !fs.existsSync(targetPath)) {
                vscode.window.showWarningMessage('Select a file or folder to create a ZIP archive.');
                return;
            }

            let stats = fs.statSync(targetPath);
            let sourceName = path.basename(targetPath);
            let defaultZipName = (stats.isDirectory() ? sourceName : path.parse(sourceName).name) + '.zip';
            let defaultZipPath = path.join(path.dirname(targetPath), defaultZipName);

            let destinationUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultZipPath),
                filters: {
                    'ZIP Archives': ['zip']
                },
                saveLabel: 'Create ZIP'
            });

            if (!destinationUri) {
                return;
            }

            try {
                let zip = new AdmZip();
                if (stats.isDirectory()) {
                    zip.addLocalFolder(targetPath);
                } else {
                    zip.addLocalFile(targetPath);
                }

                zip.writeZip(destinationUri.fsPath);
                vscode.window.showInformationMessage('ZIP archive created: ' + path.basename(destinationUri.fsPath));
            } catch (error) {
                vscode.window.showErrorMessage('Failed to create ZIP archive: ' + error.message);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.openZipContents', async (uri) => {
            await openZipContents(uri, false);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.openZipEntry', async (node) => {
            if (!node || node.isDirectory) {
                return;
            }

            if (!zipContentProvider.zipPath || !fs.existsSync(zipContentProvider.zipPath)) {
                vscode.window.showWarningMessage('No ZIP archive loaded.');
                return;
            }

            let entryPath = sanitizeZipEntryPath(node.fullPath);
            if (!entryPath) {
                vscode.window.showWarningMessage('Invalid ZIP entry path.');
                return;
            }

            try {
                let zip = new AdmZip(zipContentProvider.zipPath);
                let entry = zip.getEntry(entryPath);

                if (!entry || entry.isDirectory) {
                    vscode.window.showWarningMessage('Selected ZIP entry is not a file.');
                    return;
                }

                let zipName = path.basename(zipContentProvider.zipPath, '.zip').replace(/[^A-Za-z0-9._-]/g, '_');
                let previewRoot = path.join(os.tmpdir(), 'php-resolver-zip-preview', zipName);
                let outputPath = path.normalize(path.join(previewRoot, entryPath));
                let normalizedRoot = path.normalize(previewRoot + path.sep);

                if (!outputPath.startsWith(normalizedRoot)) {
                    vscode.window.showWarningMessage('Unsafe ZIP entry path blocked.');
                    return;
                }

                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                fs.writeFileSync(outputPath, entry.getData());

                if (entry.header && entry.header.time) {
                    try {
                        fs.utimesSync(outputPath, new Date(), new Date(entry.header.time));
                    } catch {
                        // Ignore timestamp update failures on temp previews.
                    }
                }

                let doc = await vscode.workspace.openTextDocument(vscode.Uri.file(outputPath));
                await vscode.window.showTextDocument(doc, { preview: true });
            } catch (error) {
                vscode.window.showErrorMessage('Failed to open ZIP entry: ' + error.message);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.refreshZipContents', async () => {
            if (zipContentProvider.zipPath && fs.existsSync(zipContentProvider.zipPath)) {
                try {
                    zipContentProvider.loadZip(zipContentProvider.zipPath);
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to refresh ZIP contents: ' + error.message);
                }
            } else {
                zipContentProvider.clear();
                await vscode.commands.executeCommand('setContext', 'phpResolver.zipViewHasData', false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpResolver.extractZip', async (uri) => {
            let zipPath = null;

            if (uri && uri.fsPath) {
                zipPath = uri.fsPath;
            } else if (activeEditor() && activeEditor().document && activeEditor().document.uri) {
                let editorPath = activeEditor().document.uri.fsPath;
                if (editorPath.toLowerCase().endsWith('.zip')) {
                    zipPath = editorPath;
                }
            }

            if (!zipPath) {
                let pickedZip = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    canSelectFiles: true,
                    canSelectFolders: false,
                    openLabel: 'Select ZIP Archive',
                    filters: {
                        'ZIP Archives': ['zip']
                    }
                });

                if (!pickedZip || pickedZip.length === 0) {
                    return;
                }

                zipPath = pickedZip[0].fsPath;
            }

            if (!zipPath.toLowerCase().endsWith('.zip') || !fs.existsSync(zipPath)) {
                vscode.window.showWarningMessage('Selected file is not a valid ZIP archive.');
                return;
            }

            let archiveBaseName = path.basename(zipPath, '.zip');
            let defaultExtractDir = path.join(path.dirname(zipPath), archiveBaseName);

            let destinationChoice = await vscode.window.showQuickPick([
                {
                    label: 'Extract to new folder',
                    description: defaultExtractDir,
                    value: 'default'
                },
                {
                    label: 'Choose destination folder',
                    description: 'Select a custom folder',
                    value: 'custom'
                }
            ], {
                title: 'Choose extraction destination'
            });

            if (!destinationChoice) {
                return;
            }

            let destinationDir = defaultExtractDir;
            if (destinationChoice.value === 'custom') {
                let selectedFolder = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    canSelectFiles: false,
                    canSelectFolders: true,
                    openLabel: 'Extract Here'
                });

                if (!selectedFolder || selectedFolder.length === 0) {
                    return;
                }

                destinationDir = selectedFolder[0].fsPath;
            }

            try {
                fs.mkdirSync(destinationDir, { recursive: true });
                let zip = new AdmZip(zipPath);
                zip.extractAllTo(destinationDir, true);
                vscode.window.showInformationMessage('ZIP extracted to: ' + destinationDir);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to extract ZIP archive: ' + error.message);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('phpResolver.docblockTrigger', (editor) => {
            editor.selection = new vscode.Selection(editor.selection.start, editor.selection.start);

            let selectionRange = new vscode.Range(editor.selection.start, editor.selection.end);
            let snippet = new DocBuilder(selectionRange, editor).autoDocument();

            editor.insertSnippet(snippet);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('phpResolver.syncParams', (editor) => {
            let document = editor.document;
            let cursorLine = editor.selection.start.line;

            function findNearestDocBlockAndFunction() {
                for (let i = cursorLine; i >= 0; i--) {
                    if (!document.lineAt(i).text.includes('*/')) {
                        continue;
                    }

                    let endLine = i;
                    let startLine = -1;
                    for (let j = endLine; j >= 0; j--) {
                        let text = document.lineAt(j).text;
                        if (text.includes('/**')) {
                            startLine = j;
                            break;
                        }
                        if (text.includes('*/') && j !== endLine) {
                            break;
                        }
                    }

                    if (startLine === -1) {
                        continue;
                    }

                    let functionLine = -1;
                    let signatureText = '';
                    let signatureEndLine = -1;

                    for (let k = endLine + 1; k < Math.min(endLine + 40, document.lineCount); k++) {
                        let lineText = document.lineAt(k).text;
                        if (!/\bfunction\b/.test(lineText)) {
                            continue;
                        }

                        functionLine = k;
                        signatureText = lineText;
                        signatureEndLine = k;

                        while (!signatureText.includes(')') && signatureEndLine < document.lineCount - 1) {
                            signatureEndLine++;
                            signatureText += ' ' + document.lineAt(signatureEndLine).text.trim();
                        }
                        break;
                    }

                    if (functionLine === -1) {
                        continue;
                    }

                    return {
                        startLine,
                        endLine,
                        functionLine,
                        signatureEndLine,
                        signatureText,
                    };
                }

                return null;
            }

            function parseDocblockParamEntries(docText) {
                let entries = [];
                let lines = docText.split('\n');
                for (let idx = 0; idx < lines.length; idx++) {
                    let line = lines[idx];
                    let match = line.match(/@param\s+(?:[^$\s]+\s+)?(\$[A-Za-z_][A-Za-z0-9_]*)/);
                    if (match) {
                        entries.push({ lineIndex: idx, name: match[1] });
                    }
                }
                return entries;
            }

            function parseFunctionParamNames(signatureText) {
                let match = signatureText.match(/\((.*)\)/);
                if (!match) {
                    return [];
                }
                let raw = match[1].trim();
                if (raw === '') {
                    return [];
                }

                let params = [];
                let buffer = '';
                let depth = 0;
                for (let i = 0; i < raw.length; i++) {
                    let ch = raw[i];
                    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
                        depth++;
                    } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
                        depth = Math.max(0, depth - 1);
                    }

                    if (ch === ',' && depth === 0) {
                        if (buffer.trim() !== '') {
                            params.push(buffer.trim());
                        }
                        buffer = '';
                        continue;
                    }

                    buffer += ch;
                }

                if (buffer.trim() !== '') {
                    params.push(buffer.trim());
                }

                return params
                    .map((part) => {
                        let m = part.match(/(\$[A-Za-z_][A-Za-z0-9_]*)/);
                        return m ? m[1] : null;
                    })
                    .filter((v) => v !== null);
            }

            let found = findNearestDocBlockAndFunction();
            if (!found) {
                vscode.window.showWarningMessage('No docblock + function pair found near cursor.');
                return;
            }

            let docBlockRange = new vscode.Range(found.startLine, 0, found.endLine, document.lineAt(found.endLine).text.length);
            let docBlockText = document.getText(docBlockRange);
            let docEntries = parseDocblockParamEntries(docBlockText);
            let docNames = docEntries.map((e) => e.name);
            let functionNames = parseFunctionParamNames(found.signatureText);

            if (docNames.length === 0 && functionNames.length === 0) {
                vscode.window.showInformationMessage('No parameters to sync.');
                return;
            }

            if (JSON.stringify(docNames) === JSON.stringify(functionNames)) {
                vscode.window.showInformationMessage('✓ Parameter names are already in sync!');
                return;
            }

            let docToFuncPreview = [];
            let funcToDocPreview = [];
            let limit = Math.max(docNames.length, functionNames.length);

            for (let i = 0; i < limit; i++) {
                let docName = docNames[i] || '(removed)';
                let funcName = functionNames[i] || '(removed)';
                if (i < docNames.length && i < functionNames.length && docNames[i] !== functionNames[i]) {
                    docToFuncPreview.push(docNames[i] + ' → ' + functionNames[i]);
                    funcToDocPreview.push(functionNames[i] + ' → ' + docNames[i]);
                }
            }

            vscode.window.showQuickPick([
                {
                    label: 'Sync Docblock → Function',
                    description: 'Update function params to match docblock',
                    detail: docToFuncPreview.length > 0 ? 'Changes: ' + docToFuncPreview.join(', ') : '(no changes needed)',
                    value: 'doc-to-func'
                },
                {
                    label: 'Sync Function → Docblock',
                    description: 'Update docblock params to match function',
                    detail: funcToDocPreview.length > 0 ? 'Changes: ' + funcToDocPreview.join(', ') : '(no changes needed)',
                    value: 'func-to-doc'
                }
            ]).then((selection) => {
                if (!selection) {
                    return;
                }

                if (selection.value === 'doc-to-func') {
                    let paramSectionMatch = found.signatureText.match(/\((.*)\)/);
                    if (!paramSectionMatch) {
                        vscode.window.showWarningMessage('Could not parse function signature parameters.');
                        return;
                    }

                    let originalParams = paramSectionMatch[1];
                    let parts = [];
                    let buffer = '';
                    let depth = 0;
                    for (let i = 0; i < originalParams.length; i++) {
                        let ch = originalParams[i];
                        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
                            depth++;
                        } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
                            depth = Math.max(0, depth - 1);
                        }
                        if (ch === ',' && depth === 0) {
                            parts.push(buffer);
                            buffer = '';
                            continue;
                        }
                        buffer += ch;
                    }
                    parts.push(buffer);

                    let limit = Math.min(parts.length, docNames.length);
                    for (let i = 0; i < limit; i++) {
                        parts[i] = parts[i].replace(/\$[A-Za-z_][A-Za-z0-9_]*/, docNames[i]);
                    }

                    let newParamSection = parts.join(',');
                    let newSignatureText = found.signatureText.replace(/\((.*)\)/, '(' + newParamSection + ')');

                    let signatureRange = new vscode.Range(
                        found.functionLine,
                        0,
                        found.signatureEndLine,
                        document.lineAt(found.signatureEndLine).text.length
                    );

                    editor.edit((eb) => {
                        eb.replace(signatureRange, newSignatureText);
                    }).then(() => {
                        vscode.window.showInformationMessage('✓ Function signature updated from docblock');
                    });
                    return;
                }

                if (selection.value === 'func-to-doc') {
                    let docLines = docBlockText.split('\n');
                    let limit = Math.min(docEntries.length, functionNames.length);

                    for (let i = 0; i < limit; i++) {
                        let entry = docEntries[i];
                        docLines[entry.lineIndex] = docLines[entry.lineIndex].replace(entry.name, functionNames[i]);
                    }

                    let newDocBlock = docLines.join('\n');
                    editor.edit((eb) => {
                        eb.replace(docBlockRange, newDocBlock);
                    }).then(() => {
                        vscode.window.showInformationMessage('✓ Docblock updated from function signature');
                    });
                }
            });
        })
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

    // logger.logMessage('Starting file size', 'INFO');
    //fileSize.loadFileSize();

    // var onOpen = vscode.workspace.onDidOpenTextDocument((document) => {
    //     if (document.languageId === 'php') {
    //         logger.logMessage('Document is opened - starting code sniffer', 'INFO');
    //         phpcs.fixPHP();
    //     }
    // });
    // context.subscriptions.push(onOpen);

    //onSaveSniff = vscode.workspace.onDidSaveTextDocument((document) => {
    // logger.logMessage('Document is saved - loading file size', 'INFO');
    //fileSize.loadFileSize();
    // if (document.languageId === 'php') {
    //     logger.logMessage('Document is saved - starting code sniffer', 'INFO');
    //     phpcs.fixPHP();
    // }
    // });

    if (config('fileSizeOnHover')) {
        let decorator = await createDecoratorClass();

        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        watcher.onDidChange(uri => decorator.onFileChanged(uri));
    }

    let provider = {
        provideCodeActions: function (document, range, context, token) {
            let diagnostics = context.diagnostics;
            let actions = [];
            for (let diagnostic of diagnostics) {
                const action = (0, codeActions.createQuickFix)(diagnostic, document, range);
                if (action !== undefined) {
                    actions.push(action);
                }
            }
            return actions;
        }
    };
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: 'file', language: 'php' }, provider, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }));

    const providerSnippet = vscode.languages.registerCompletionItemProvider(
        ['php', 'hack'],
        {
            provideCompletionItems(document, position) {
                let a = [],
                    i;
                if ((i = document.getWordRangeAtPosition(position, /\/\*\*/)) !== void 0) {
                    let s = new DocBuilder(i, activeEditor()),
                        c = new vscode.CompletionItem("/**", vscode.CompletionItemKind.Snippet);
                    c.detail = EXTENSION_NAME, c.documentation = "Generate a PHP DocBlock from the code snippet below.";
                    let g = document.getWordRangeAtPosition(position, /\/\*\* \*\//);
                    return c.range = g, c.insertText = s.autoDocument(), a.push(c), a;
                }
                if ((i = document.getWordRangeAtPosition(position, /\@[a-z]*/)) === void 0) return a;
                let l = document.getText(i);
                return getDocBlockTags().filter(s => s.tag.match(l) !== null).forEach(s => {
                    let c = new vscode.CompletionItem(s.tag, vscode.CompletionItemKind.Snippet);
                    c.range = i, c.insertText = new vscode.SnippetString(s.snippet), a.push(c);
                    c.detail = EXTENSION_NAME, c.documentation = "Generate a PHP Block Tag from the code snippet below.";
                }), a;
                // const linePrefix = document.lineAt(position).text.substr(0, position.character);
                // if (!linePrefix.endsWith('/***')) {
                //     return undefined;
                // }

                // const snippetCompletion = new vscode.CompletionItem('My Snippet');
                // snippetCompletion.insertText = new vscode.SnippetString('console.log(${1:value});');
                // snippetCompletion.documentation = new vscode.MarkdownString('Log to console');

                // return [snippetCompletion];
            }
        },
        "*", "@"
    );

    context.subscriptions.push(providerSnippet);

    vscode.languages.setLanguageConfiguration('php', languageConfiguration);
    vscode.languages.setLanguageConfiguration('hack', languageConfiguration);

    var onChangeConfig = await vscode.workspace.onDidChangeConfiguration(() => {
        updateConfig(context);

        if (definitionIndex) {
            definitionIndex.reindexIncremental().catch(() => {
                logger.logMessage('Definition index reindex failed after config change', 'WARN');
            });
        }
    });

    context.subscriptions.push(onChangeConfig);

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async () => {
        await syncZipContentsWithActiveFile();
    }));

    if (vscode.window.tabGroups && vscode.window.tabGroups.onDidChangeTabs) {
        context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(async () => {
            await syncZipContentsWithActiveFile();
        }));
    }

    await syncZipContentsWithActiveFile();
}

exports.activate = activate;
