let vscode = require('vscode');
let fs = require('fs');

class PHPExtractInterfaceProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    provideCodeActions(document, range, context) {
        let actions = [];

        // Only offer when cursor is on a class declaration line
        let line = document.lineAt(range.start.line).text;
        let classMatch = line.match(/\b(class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (!classMatch) {
            return actions;
        }

        let className = classMatch[2];
        let action = new vscode.CodeAction(
            `Extract interface from ${className}`,
            vscode.CodeActionKind.RefactorExtract
        );
        action.command = {
            command: 'phpResolver.extractInterface',
            title: 'Extract Interface',
            arguments: [document, range.start.line, className]
        };
        actions.push(action);

        return actions;
    }

    async extractInterface(document, lineNumber, className) {
        let text = document.getText();
        let lines = text.split(/\r?\n/);

        // Find public methods in the class
        let publicMethods = this._findPublicMethods(lines, lineNumber);
        if (publicMethods.length === 0) {
            vscode.window.showInformationMessage('No public methods found to extract.');
            return;
        }

        // Detect namespace
        let namespace = '';
        for (let line of lines) {
            let nsMatch = line.match(/^\s*namespace\s+([^;]+);/);
            if (nsMatch) {
                namespace = nsMatch[1];
                break;
            }
        }

        // Build interface name
        let interfaceName = await vscode.window.showInputBox({
            prompt: 'Interface name',
            value: className + 'Interface',
            validateInput: (val) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(val) ? null : 'Invalid PHP identifier'
        });

        if (!interfaceName) return;

        // Build interface content
        let interfaceContent = '<?php\n\n';
        if (namespace) {
            interfaceContent += `namespace ${namespace};\n\n`;
        }
        interfaceContent += `interface ${interfaceName}\n{\n`;

        for (let method of publicMethods) {
            interfaceContent += `    public function ${method.name}(${method.params})${method.returnType};\n\n`;
        }

        interfaceContent += '}\n';

        // Determine file path
        let dir = require('path').dirname(document.uri.fsPath);
        let interfacePath = require('path').join(dir, interfaceName + '.php');

        // Check if file exists
        if (fs.existsSync(interfacePath)) {
            let overwrite = await vscode.window.showWarningMessage(
                `${interfaceName}.php already exists. Overwrite?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') return;
        }

        // Write interface file
        fs.writeFileSync(interfacePath, interfaceContent, 'utf8');

        // Add implements clause to the class
        let classLine = lines[lineNumber];
        let edit = new vscode.WorkspaceEdit();

        if (classLine.includes('implements')) {
            // Append to existing implements
            let updatedLine = classLine.replace(
                /\bimplements\s+/,
                `implements ${interfaceName}, `
            );
            edit.replace(document.uri,
                new vscode.Range(lineNumber, 0, lineNumber, classLine.length),
                updatedLine
            );
        } else {
            // Add implements before {
            let updatedLine = classLine.replace(
                /(\s*)\{?\s*$/,
                ` implements ${interfaceName}$1{`
            );
            if (!updatedLine.includes('{') && classLine.includes('{')) {
                updatedLine = classLine.replace('{', `implements ${interfaceName} {`);
            } else if (!classLine.includes('{')) {
                updatedLine = classLine + ` implements ${interfaceName}`;
            }
            edit.replace(document.uri,
                new vscode.Range(lineNumber, 0, lineNumber, classLine.length),
                updatedLine
            );
        }

        await vscode.workspace.applyEdit(edit);

        // Open the new interface file
        let doc = await vscode.workspace.openTextDocument(interfacePath);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(`Interface ${interfaceName} extracted with ${publicMethods.length} method(s).`);
    }

    _findPublicMethods(lines, classLineNum) {
        let methods = [];
        let braceDepth = 0;
        let inClass = false;

        for (let i = classLineNum; i < lines.length; i++) {
            let line = lines[i];

            if (i === classLineNum) {
                inClass = true;
            }

            for (let ch of line) {
                if (ch === '{') braceDepth++;
                if (ch === '}') braceDepth--;
            }

            if (inClass && braceDepth <= 0 && i > classLineNum) {
                break;
            }

            // Match public function declarations
            let methodMatch = line.match(/^\s*public\s+(?:static\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*:\s*(.+?))?(?:\s*\{|\s*$)/);
            if (methodMatch && inClass) {
                let name = methodMatch[1];
                // Skip constructor and magic methods
                if (name.startsWith('__')) continue;

                methods.push({
                    name: name,
                    params: methodMatch[2] || '',
                    returnType: methodMatch[3] ? ': ' + methodMatch[3].trim() : ''
                });
            }
        }

        return methods;
    }
}

module.exports = PHPExtractInterfaceProvider;
