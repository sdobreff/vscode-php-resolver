let vscode = require('vscode');
// let builtInClasses = require('./classes');
let naturalSort = require('node-natural-sort');
let crypto = require('crypto');
let { activeEditor, config, showMessage, showErrorMessage } = require('./Helpers');

class Resolver {
    regexWordWithNamespace = new RegExp(/[a-zA-Z0-9\_\\]+/);
    regexClassnames = /(class|trait|interface)\s+([a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*)/gms;
    typeHintPrimitives = ['self', 'parent', 'array', 'bool', 'float', 'int', 'string', 'object', 'mixed', '__CLASS__', 'callable'];
    namespace = null;
    importedClasses = [];
    // Stores the current text as hash - checking this, gives us an idea of the current source is changed
    currentPHPFileHash = '';
    currentClass = '';
    currentNameSpace = '';
    classesToExclude = ['self', '__CLASS__',];

    async importCommand(selection) {
        let resolving = this.resolving(selection);
        let selectedClass = resolving;

        if (resolving === undefined) {
            return showErrorMessage(`No class is selected.`);
        }

        let fqcn;
        let replaceClassAfterImport = false;

        if (/\\/.test(resolving)) {
            fqcn = resolving.replace(/^\\?/, '');
            replaceClassAfterImport = true;
        } else {
            resolving = '*' + resolving.replace(/[\_\-]/g, '*');

            let filesPSR = await this.findFiles(resolving);

            resolving = resolving.toLowerCase();
            let filesWP = await this.findFiles(resolving);

            let files = [...filesPSR, ...filesWP];

            let namespaces = '';
            if (files.length > 0) {
                namespaces = await this.findNamespaces(selectedClass, files);
            } else {
                return showErrorMessage(`No files found for ${selectedClass}.`);
            }

            fqcn = await this.pickClass(namespaces);
        }

        if (fqcn !== '') {
            this.importClass(selection, fqcn, replaceClassAfterImport);
        }
    }

    async importAll() {
        let text = activeEditor().document.getText();
        let phpClasses = this.getPhpClasses(text);
        let useStatements = this.getImportedPhpClasses(text);

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Importing classes'
        }, async (progress) => {
            for (let phpClass of phpClasses) {
                if (!useStatements.includes(phpClass)) {
                    progress.report({ message: 'Importing : ' + phpClass, });
                    await this.importCommand(phpClass);
                    progress.report({ increment: 100 / phpClasses.length, message: 'Imported : ' + phpClass, });
                }
            }
        });
    }

    getPhpClasses(text) {
        text = text.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
        text = text.replace(/\?>(.*)<(\?|\%)\=?(php)?/gm, '');

        let className = '';

        if (className = this.regexClassnames.exec(text)) {
            // Extract current class name (if any) and add it to the classToExcluds
            this.classesToExclude.push(className[2]);
        }

        let phpClasses = this.getExtended(text);

        phpClasses = phpClasses.concat(this.getFromFunctionParameters(text));
        phpClasses = phpClasses.concat(this.getInitializedWithNew(text));
        phpClasses = phpClasses.concat(this.getFromStaticCalls(text));
        phpClasses = phpClasses.concat(this.getFromInstanceofOperator(text));

        let temp = [];
        return phpClasses.filter((v, i, a) => {
            //a.indexOf(v) === i
            let _x = typeof v === 'string' ? v.toLowerCase() : v;
            if (temp.indexOf(_x) === -1) {
                temp.push(_x)
                return v;
            }
        });
    }

    getExtended(text) {
        let regex = /extends\s+([A-Z][A-Za-z0-9\-\_]*)/gm;
        let matches = [];
        let phpClasses = [];

        while (matches = regex.exec(text)) {
            phpClasses.push(matches[1]);
        }

        return phpClasses;
    }

    getFromFunctionParameters(text) {
        let funcRegex = /function\s+([a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*)?\s*\((.*?)\)\s*{?/gms;
        let catchRegex = /catch\s+\((.*?)\)\s*{/gms;
        let regexClassnames = /(([a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff\/]*)\s+\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*)/;
        let matches = [];
        let matchesCLassnames = [];

        let phpClasses = [];

        while (matches = funcRegex.exec(text)) {
            if (matches[2] !== undefined) {
                let parameters = matches[2].split(',');

                parameters = parameters.map(element => {
                    if (typeof element === 'string') {
                        return element.trim();
                    }

                    return element;
                });
                for (let s of parameters) {
                    if (matchesCLassnames = regexClassnames.exec(s)) {
                        if (!this.typeHintPrimitives.includes(matchesCLassnames[2])) {
                            phpClasses.push(matchesCLassnames[2]);
                        }
                    }
                }
            }
        }

        while (matches = catchRegex.exec(text)) {
            if (matches[1] !== undefined) {
                let parameters = matches[1].split(',');

                parameters = parameters.map(element => {
                    if (typeof element === 'string') {
                        return element.trim();
                    }

                    return element;
                });
                for (let s of parameters) {
                    if (matchesCLassnames = regexClassnames.exec(s)) {
                        if (!this.typeHintPrimitives.includes(matchesCLassnames[2])) {
                            phpClasses.push(matchesCLassnames[2]);
                        }
                    }
                }
            }
        }

        return phpClasses;
    }

    getInitializedWithNew(text) {
        let regex = /new\s+([a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff\/]*)\s*\(/gm;
        let matches = [];
        let phpClasses = [];

        while (matches = regex.exec(text)) {
            if (!this.classesToExclude.includes(matches[1])) {
                phpClasses.push(matches[1]);
            }
        }

        return phpClasses;
    }

    getFromStaticCalls(text) {
        let regex = /([A-Z][A-Za-z0-9\-\_]*)::/gm;
        let matches = [];
        let phpClasses = [];

        while (matches = regex.exec(text)) {
            if (!this.classesToExclude.includes(matches[1])) {
                phpClasses.push(matches[1]);
            }
        }

        return phpClasses;
    }

    getFromInstanceofOperator(text) {
        let regex = /instanceof\s+([A-Z_][A-Za-z0-9\_]*)/gm;
        let matches = [];
        let phpClasses = [];

        while (matches = regex.exec(text)) {
            if (!this.classesToExclude.includes(matches[1])) {
                phpClasses.push(matches[1]);
            }
        }

        return phpClasses;
    }

    async highlightNotImported() {
        let text = activeEditor().document.getText();
        let phpClasses = this.getPhpClasses(text);
        let importedPhpClasses = this.getImportedPhpClasses(text);

        // Get phpClasses not present in importedPhpClasses
        let notImported = phpClasses.filter(function (phpClass) {
            return !importedPhpClasses.includes(phpClass);
        });

        // Highlight diff
        let matches = [];
        let decorationOptions = [];

        for (let i = 0; i < notImported.length; i++) {
            let regex = new RegExp(notImported[i], 'g');

            while (matches = regex.exec(text)) {
                let startPos = activeEditor().document.positionAt(matches.index);

                // as js does not support regex look behinds we get results
                // where the object name is in the middle of a string
                // we should drop those
                let textLine = activeEditor().document.lineAt(startPos);
                let charBeforeMatch = textLine.text.charAt(startPos.character - 1);

                if (!/\w/.test(charBeforeMatch) && textLine.text.search(/namespace/) == -1) {
                    let endPos = activeEditor().document.positionAt(matches.index + matches[0].length);

                    decorationOptions.push({
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: 'Class is not imported.',
                    });
                }
            }
        }

        // TODO have these in settings
        let decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255,155,0, 0.5)',
            light: {
                borderColor: 'darkblue'
            },
            dark: {
                borderColor: 'lightblue'
            }
        });

        activeEditor().setDecorations(decorationType, decorationOptions);
    }

    async highlightNotUsed() {
        const text = activeEditor().document.getText();
        const phpClasses = this.getPhpClasses(text);
        const importedPhpClasses = this.getImportedPhpClasses(text);

        // Get phpClasses not present in importedPhpClasses
        let notUsed = importedPhpClasses.filter(function (phpClass) {
            return !phpClasses.includes(phpClass);
        });

        // Highlight diff
        let matches = [];
        let decorationOptions = [];

        for (let i = 0; i < notUsed.length; i++) {
            let regex = new RegExp(notUsed[i], 'g');

            while (matches = regex.exec(text)) {
                let startPos = activeEditor().document.positionAt(matches.index);
                let textLine = activeEditor().document.lineAt(startPos);

                if (textLine.text.search(/use/) != -1) {
                    let endPos = activeEditor().document.positionAt(matches.index + matches[0].length);

                    decorationOptions.push({
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: 'Class is not used.',
                    });
                }
            }
        }

        // TODO have these in settings
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255,55,55, 0.5)',
            light: {
                borderColor: 'darkblue'
            },
            dark: {
                borderColor: 'lightblue'
            }
        });

        activeEditor().setDecorations(decorationType, decorationOptions);
    }

    getImportedPhpClasses(text) {
        const regex = /^\s?use\s+(?!function)(?!const)(.*?);/gms;
        let importedPhpClasses = [];

        let m;
        while ((m = regex.exec(text)) !== null) {
            let phpClasses = m[1].split(",");
            for (let i = 0; i < phpClasses.length; i++) {
                let currentClass = phpClasses[i].split('\\').pop();
                currentClass = currentClass.split(/\sas\s|\s*,\s*/).map(n => n.replace(/[\W]+/g, ""));
                importedPhpClasses.push.apply(importedPhpClasses, currentClass);
            }
        }

        this.importedClasses = importedPhpClasses;

        return importedPhpClasses;
    }

    importClass(selection, fqcn, replaceClassAfterImport = false) {
        let useStatements, declarationLines;

        try {
            [useStatements, declarationLines] = this.getDeclarations(fqcn);
        } catch (error) {
            return showErrorMessage(error.message);
        }

        let classBaseName = fqcn.match(/(\w+)/g).pop();

        // is that current class ?
        if (fqcn === this.currentNameSpace + '\\' + this.currentClass) {
            return;
        }

        if (this.hasConflict(classBaseName)) {
            showErrorMessage(`This class / alias ${classBaseName} is imported.`);
        } else if (replaceClassAfterImport) {
            this.importAndReplaceSelectedClass(selection, classBaseName, fqcn, declarationLines);
        } else {
            this.insert(fqcn, declarationLines);
        }
    }

    async insert(fqcn, declarationLines, alias = null) {
        let [prepend, append, insertLine] = this.getInsertLine(declarationLines);
        let classBaseName = fqcn.match(/(\w+)/g).pop();

        let noGlobalsImport = config('dontImportGlobal');
        let parts = fqcn.split('\\');
        let isGlobal = false;
        if (parts.length === 1) {
            isGlobal = true;
        }

        if (null === alias) {
            if (fqcn === this.currentNameSpace + '\\' + this.currentClass) {
                return;
            }

            let fullText = activeEditor().document.getText();
            // 'g' flag is for global search & 'm' flag is for multiline.

            const regex = new RegExp("(?!['|\"])[\\\\]?" + fqcn.replace(/\\/g, '\\\\') + "(?![A-za-z0–9_])(?!['|\"])", 'gm');

            let textReplace = fullText.replace(regex, ((isGlobal && noGlobalsImport) ? '\\' : '') + classBaseName);
            let invalidRange = new vscode.Range(0, 0, activeEditor().document.lineCount, 0);
            let validFullRange = activeEditor().document.validateRange(invalidRange);

            await activeEditor().edit(editBuilder => {
                editBuilder.replace(validFullRange, textReplace);
            }).catch(err => console.log(err));
        }

        await activeEditor().edit(textEdit => {
            if (null === alias) {
                if (isGlobal) {
                    alias = classBaseName;
                }
            }
            if (!isGlobal || (isGlobal && !noGlobalsImport)) {
                textEdit.replace(
                    new vscode.Position((insertLine), 0),
                    (`${prepend}use ${fqcn}`) + (alias !== null ? ` as ${alias}` : '') + (`;${append}`)
                );
            }
        });

        if (config('autoSort')) {
            this.sortImports();
        }

        showMessage(`The class ${classBaseName} is imported.`);
        this.importedClasses = [];
    }

    async insertAsAlias(selection, fqcn, useStatements, declarationLines) {
        let alias = await vscode.window.showInputBox({
            placeHolder: 'Enter an alias or leave it empty to replace'
        });

        if (alias === undefined) {
            return;
        }

        if (this.hasConflict(alias)) {
            showErrorMessage(`This alias (${alias}) is already in use.`);

            this.insertAsAlias(selection, fqcn, useStatements, declarationLines)
        } else if (alias !== '') {
            this.importAndReplaceSelectedClass(selection, alias, fqcn, declarationLines, alias);
        } else if (alias === '') {
            this.replaceUseStatement(fqcn, useStatements);
        }
    }

    async replaceUseStatement(fqcn, useStatements) {
        let useStatement = useStatements.find(use => {
            let className = use.text.match(/(\w+)?;/).pop();

            return fqcn.endsWith(className);
        });

        await activeEditor().edit(textEdit => {
            textEdit.replace(
                new vscode.Range(useStatement.line, 0, useStatement.line, useStatement.text.length),
                `use ${fqcn};`
            );
        });

        if (config('autoSort')) {
            this.sortImports();
        }
    }

    async replaceNamespaceStatement(namespace, line) {
        let realLine = line - 1;
        let text = activeEditor().document.lineAt(realLine).text;
        let newNs = text.replace(/namespace (.+)/, namespace);

        await activeEditor().edit(textEdit => {
            textEdit.replace(
                new vscode.Range(realLine, 0, realLine, text.length),
                newNs.trim()
            );
        });
    }

    async importAndReplaceSelectedClass(selection, replacingClassName, fqcn, declarationLines, alias = null) {
        // await this.changeSelectedClass(selection, replacingClassName, false);

        this.insert(fqcn, declarationLines, alias);
    }

    async expandCommand(selection) {
        let resolving = this.resolving(selection);

        if (resolving === null) {
            return showErrorMessage(`No class is selected.`);
        }

        let selectedClass = resolving;

        resolving = '*' + resolving.replace(/[\_\-]/g, '*');
        let filesPSR = await this.findFiles(resolving);

        resolving = resolving.toLowerCase();
        let filesWP = await this.findFiles(resolving);

        let files = [...filesPSR, ...filesWP];

        let namespaces = '';
        if (files.length > 0) {
            namespaces = await this.findNamespaces(selectedClass, files);
        } else {
            return showErrorMessage(`No files found for ${selectedClass}.`);
        }

        let fqcn = await this.pickClass(namespaces);

        if (fqcn === '') {
            fqcn = selectedClass;
        }

        this.changeSelectedClass(selection, fqcn, true);
    }

    async changeSelectedClass(selection, fqcn, prependBackslash = false) {
        await activeEditor().edit(textEdit => {
            textEdit.replace(
                activeEditor().document.getWordRangeAtPosition(selection.active, this.regexWordWithNamespace),
                (prependBackslash && config('leadingSeparator') ? '\\' : '') + fqcn
            );
        });

        let newPosition = new vscode.Position(selection.active.line, selection.active.character);

        activeEditor().selection = new vscode.Selection(newPosition, newPosition);
    }

    sortCommand() {
        try {
            this.sortImports();
        } catch (error) {
            return showErrorMessage(error.message);
        }

        showMessage('$(check)  Imports are sorted.');
    }

    findFiles(resolving) {
        //return vscode.workspace.findFiles(`**/*wp*helper.php`, config('exclude'));
        return vscode.workspace.findFiles(`**/${resolving}.php`, config('exclude'));
    }

    findNamespaces(resolving, files) {
        return new Promise((resolve, reject) => {
            let textDocuments = this.getTextDocuments(files, resolving);

            Promise.all(textDocuments).then(docs => {
                let parsedNamespaces = this.parseNamespaces(docs, resolving);

                if (parsedNamespaces.length === 0) {
                    return showErrorMessage(`The class ${resolving} is not found.`);
                }

                resolve(parsedNamespaces);
            });
        });
    }

    pickClass(namespaces) {
        return new Promise((resolve, reject) => {
            if (namespaces.length === 1) {
                // Only one namespace found so no need to show picker.
                return resolve(namespaces[0]);
            }

            vscode.window.showQuickPick(namespaces).then(picked => {
                if (picked !== undefined) {
                    resolve(picked);
                } else {
                    resolve('');
                }
            });
        })
    }

    getTextDocuments(files, resolving) {
        let textDocuments = [];

        for (let i = 0; i < files.length; i++) {
            // let fileName = files[i].fsPath.replace(/^.*[\\\/]/, '').split('.')[0];

            // if (fileName !== resolving) {
            //     continue;
            // }

            textDocuments.push(vscode.workspace.openTextDocument(files[i]));
        }

        return textDocuments;
    }

    parseNamespaces(docs, resolving) {
        let parsedNamespaces = [];

        for (let i = 0; i < docs.length; i++) {
            let foundNS = docs[i].getText().match(/(namespace|(<\?php namespace))\s+(.+)?;/);
            // If there is a namespace in the file, lets check the name of the class (if there is one)
            // the name of the file is not enough to be sure that the extracted namespace is correct
            if (foundNS) {
                let m;
                let text = docs[i].getText();
                while ((m = this.regexClassnames.exec(text)) !== null) {
                    // if the class name from the file matches the resolving class name then the namespace is correct
                    if (m[2] === resolving) {
                        let namespace = foundNS.pop();
                        let fqcn = `${namespace}\\${resolving}`;

                        // if (namespace === this.getNamespace()) {
                        //     continue;
                        // }

                        if (!parsedNamespaces.includes(fqcn)) {
                            parsedNamespaces.push(fqcn);
                            // continue;
                        }
                    }
                }
            }
        }

        // for (let i = 0; i < docs.length; i++) {
        //     for (let line = 0; line < docs[i].lineCount; line++) {
        //         let textLine = docs[i].lineAt(line).text;

        //         if (textLine.startsWith('namespace ') || textLine.startsWith('<?php namespace ')) {
        //             let namespace = textLine.match(/^(namespace|(<\?php namespace))\s+(.+)?;/).pop();
        //             let fqcn = `${namespace}\\${resolving}`;

        //             if (namespace === this.getNamespace()) {
        //                 break;
        //             }

        //             if (!parsedNamespaces.includes(fqcn)) {
        //                 parsedNamespaces.push(fqcn);
        //                 break;
        //             }
        //         }
        //     }
        // }

        // If selected text is a built-in php class add that at the beginning.
        // if (builtInClasses.includes(resolving)) {
        //     parsedNamespaces.unshift(resolving);
        // }

        // If namespace can't be parsed but there is a file with the same
        // name of selected text then assuming it's a global class and
        // add that in the parsedNamespaces array as a global class.
        if (parsedNamespaces.length === 0 && docs.length > 0) {
            parsedNamespaces.push(resolving);
        }

        return parsedNamespaces;
    }

    sortImports() {
        let [useStatements,] = this.getDeclarations();

        if (useStatements.length <= 1) {
            throw new Error('Nothing to sort.');
        }

        let sortFunction = (a, b) => {
            if (config('sortAlphabetically')) {
                if (a.text.toLowerCase() < b.text.toLowerCase()) return -1;
                if (a.text.toLowerCase() > b.text.toLowerCase()) return 1;
                return 0;
            } else {
                if (a.text.length == b.text.length) {
                    if (a.text.toLowerCase() < b.text.toLowerCase()) return -1;
                    if (a.text.toLowerCase() > b.text.toLowerCase()) return 1;
                }

                return a.text.length - b.text.length;
            }
        }

        if (config('sortNatural')) {
            let natsort = naturalSort({
                caseSensitive: true,
                order: config('sortAlphabetically') ? 'ASC' : 'DESC'
            });

            sortFunction = (a, b) => {
                return natsort(a.text, b.text);
            };
        }

        let sorted = useStatements.slice().sort(sortFunction);

        activeEditor().edit(textEdit => {
            for (let i = 0; i < sorted.length; i++) {
                textEdit.replace(
                    new vscode.Range(useStatements[i].line, 0, useStatements[i].line, useStatements[i].text.length),
                    sorted[i].text
                );
            }
        });
    }

    hasConflict(resolving) {
        if ('' === this.currentPHPFileHash) {
            this.currentPHPFileHash = crypto.createHash('md5').update(activeEditor().document.getText()).digest('hex');
        }

        if (this.importedClasses.length === 0) {
            this.getImportedPhpClasses(activeEditor().document.getText());
        } else {
            if (this.currentPHPFileHash !== crypto.createHash('md5').update(activeEditor().document.getText()).digest('hex')) {
                // File source is changed - rebuild
                this.getImportedPhpClasses(activeEditor().document.getText());
            }
        }

        if (this.importedClasses.length === 0) {
            return false;
        }

        if (this.importedClasses.includes(resolving)) {
            return true;
        }

        return false;
    }

    getDeclarations(pickedClass = null) {
        let useStatements = [];
        let declarationLines = {
            PHPTag: 0,
            namespace: null,
            useStatement: null,
            class: null,
            classComment: null,
            commentAfterPhpTag: false,
            strictTypes: null,
        };

        let multilineUseStatement = false;
        let phpTagFound = false;

        for (let line = 0; line < activeEditor().document.lineCount; line++) {
            let text = activeEditor().document.lineAt(line).text;

            if (pickedClass !== null && text === `use ${pickedClass};`) {
                throw new Error(`The class ${pickedClass} is already imported.`);
            }

            // break if all declarations were found.
            if (declarationLines.PHPTag && declarationLines.namespace &&
                declarationLines.useStatement && declarationLines.class && declarationLines.strictTypes) {
                break;
            }

            if (!phpTagFound) {

                if ((declarationLines.PHPTag && line === declarationLines.PHPTag)) {
                    if (text.startsWith('/*')) {
                        declarationLines.commentAfterPhpTag = true;
                        if (! /\/\*.*\*\//.test(text)) {
                            declarationLines.PHPTag = line + 1;
                            continue;
                        }
                    }
                    if (text.startsWith('* ') || text.startsWith(' *') || text.startsWith(' */') || text.startsWith('*/')) {
                        declarationLines.PHPTag = line + 1;
                        if (text.startsWith(' */') || text.startsWith('*/')) {
                            declarationLines.PHPTag++;
                            phpTagFound = true;
                        }
                        continue;
                    }
                }
            }

            if ((declarationLines.useStatement && line === declarationLines.useStatement) && multilineUseStatement) {
                if (! /;/.test(text)) {
                    declarationLines.useStatement = line + 1;
                    continue;
                }
                if (/;/.test(text)) {
                    declarationLines.useStatement = line + 1;
                    multilineUseStatement = false;
                    continue;
                }
            }

            let className;

            if (text.startsWith('<?php') && declarationLines.PHPTag === 0) {
                declarationLines.PHPTag = line + 1;
            } else if (/declare\s*\(\s*strict_types/i.test(text)) {
                declarationLines.strictTypes = line + 1;
            } else if (text.startsWith('namespace ') || text.startsWith('<?php namespace')) {
                declarationLines.namespace = line + 1;
                this.currentNameSpace = text.match(/namespace\s+((?:\\{1,2}\w+|\w+\\{0,2})(?:\w+\\{0,2})+)/)[1];
            } else if (/^\s?use\s+(?!function)(?!const)(.*?)/.test(text)) {
                useStatements.push({ text, line });
                declarationLines.useStatement = line + 1;
                if (! /;/.test(text)) {
                    multilineUseStatement = true;
                }
            } else if (className = this.regexClassnames.exec(text)) {
                declarationLines.class = line + 1;
                this.currentClass = className[2];
            }
        }

        return [useStatements, declarationLines];
    }

    getInsertLine(declarationLines) {
        let prepend = declarationLines.PHPTag === 0 ? '' : '\n';
        let append = '\n';
        let insertLine = (null !== declarationLines.strictTypes) ? declarationLines.strictTypes : declarationLines.PHPTag;

        if (prepend === '' && declarationLines.namespace !== null) {
            prepend = '\n';
        }

        if (declarationLines.useStatement !== null) {
            prepend = '';
            insertLine = declarationLines.useStatement;
        } else if (declarationLines.namespace !== null) {
            insertLine = declarationLines.namespace;
        }

        if (declarationLines.class !== null &&
            ((declarationLines.class - declarationLines.useStatement) <= 1 ||
                (declarationLines.class - declarationLines.namespace) <= 1 ||
                (declarationLines.class - declarationLines.PHPTag) <= 1)
        ) {
            append = '\n\n';
        }

        if (declarationLines.useStatement === null) {
            prepend = '';
            append = '\n\n';
            if (declarationLines.namespace !== null) {
                prepend = '\n';
                append = '\n';
            }
        }

        return [prepend, append, insertLine];
    }

    resolving(selection) {
        if ((typeof selection) == 'string') {
            return selection;
        }

        let wordRange = activeEditor().document.getWordRangeAtPosition(selection.active, this.regexWordWithNamespace);

        if (wordRange === undefined) {
            return;
        }

        return activeEditor().document.getText(wordRange);
    }

    async generateNamespace() {
        let currentUri = activeEditor().document.uri;
        let currentFile = currentUri.path;
        let currentPath = currentFile.substring(0, currentFile.lastIndexOf('/'));

        let workspaceFolder = vscode.workspace.getWorkspaceFolder(currentUri);

        if (workspaceFolder === undefined) {
            return showErrorMessage('No folder opened in workspace, cannot find composer.json');
        }

        //try to retrieve composer file by searching recursively into parent folders of the current file

        let composerFile;
        let composerPath = currentFile;

        do {
            composerPath = composerPath.substring(0, composerPath.lastIndexOf('/'));
            composerFile = await vscode.workspace.findFiles(new vscode.RelativePattern(composerPath, 'composer.json'));
        } while (!composerFile.length && composerPath !== workspaceFolder.uri.path)


        if (!composerFile.length) {
            return showErrorMessage('No composer.json file found, automatic namespace generation failed');
        }

        composerFile = composerFile.pop().path;

        vscode.workspace.openTextDocument(composerFile).then((document) => {
            let composerJson = JSON.parse(document.getText());
            let psr4 = (composerJson.autoload || {})['psr-4'];

            let devNS = 'psr-4';

            if (psr4 === undefined) {
                psr4 = (composerJson.autoload || {})['psr-0'];
                devNS = 'psr-0';
            }

            if (psr4 === undefined) {
                return showErrorMessage('Neither psr-4 or psr-0 keys in composer.json autoload object, automatic namespace generation failed');
            }

            let devPsr4 = (composerJson['autoload-dev'] || {})[devNS];

            if (devPsr4 !== undefined) {
                psr4 = { ...psr4, ...devPsr4 };
            }

            let currentRelativePath = currentPath.split(composerPath)[1];

            //this is a way to always match with psr-4 entries
            if (!currentRelativePath.endsWith('/')) {
                currentRelativePath += '/';
            }

            if (currentRelativePath.startsWith('/')) {
                currentRelativePath = currentRelativePath.substring(1);
            }

            // Check is there is an exact match
            let namespaceBase = Object.keys(psr4).find(key => psr4[key] === currentRelativePath);

            if (namespaceBase === undefined) {
                let pathParts = currentRelativePath.split('/');
                while (pathParts.length > 1) {
                    pathParts.pop();
                    let newPathToCheck = pathParts.join('/') + '/';
                    namespaceBase = Object.keys(psr4).find(key => psr4[key] === newPathToCheck);
                    if (namespaceBase !== undefined) {
                        break;
                    }
                }
            }

            if (namespaceBase === undefined) {
                return showErrorMessage('Neither psr-4 or psr-0 keys in composer.json autoload object found that matches ' + currentRelativePath + ', automatic namespace generation failed');
            }

            // let namespaceBase = Object.keys(psr4).filter(function (namespaceBase) {
            //     console.log(psr4[namespaceBase]);
            //     return currentRelativePath.lastIndexOf(psr4[namespaceBase]) !== -1;
            // })[0];

            let baseDir = psr4[namespaceBase];
            namespaceBase = namespaceBase.replace(/\\$/, '');

            currentRelativePath += '/';

            let namespace = currentRelativePath.substring(currentRelativePath.lastIndexOf(baseDir) + baseDir.length);

            if (namespace !== "") {
                namespace = namespace.replace(/\//g, '\\');
                namespace = namespace.replace(/^\\/, '');
                namespace = namespace.replace(/\\$/, '');
                namespace = namespace.replace(/\-/, '_');
                namespace = namespaceBase + '\\' + namespace;
                namespace = namespace.replace(/\\$/, '');

            } else {
                namespace = namespaceBase;
            }

            namespace = 'namespace ' + namespace + ';' + "\n"

            let declarationLines;

            try {
                [, declarationLines] = this.getDeclarations();
            } catch (error) {
                return showErrorMessage(error.message);
            }

            if (declarationLines.namespace !== null) {
                this.replaceNamespaceStatement(namespace, declarationLines.namespace);
            } else {
                activeEditor().edit(textEdit => {
                    if (null !== declarationLines.strictTypes) {
                        textEdit.insert(new vscode.Position(declarationLines.strictTypes, 0), '\n' + namespace);
                    } else {
                        if (declarationLines.commentAfterPhpTag) {
                            textEdit.insert(new vscode.Position(declarationLines.PHPTag - 1, 0), '\n' + namespace);
                        } else {
                            textEdit.insert(new vscode.Position(declarationLines.PHPTag, 0), '\n' + namespace);
                        }
                    }
                });
            }
        });
    }

    getNamespace() {
        if (this.namespace === null) {
            const regex = /^.?namespace\s+(.*?);/gms;
            this.namespace = '';

            let m = regex.exec(activeEditor().document.getText());

            if (m !== null) {
                this.namespace = m[1];
            }
        }
        return this.namespace;
    }
}

module.exports = Resolver;