"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQuickFix = void 0;
const vscode = require("vscode");
/// Creates a new quickFix action.
function createQuickFix(diagnostic, document, range) {

        if (!diagnostic.information || 'php-resolver' !== diagnostic.information.provider) {
            return;
        }
        let action = new vscode.CodeAction('Escape ' + diagnostic.information.source + 'inline', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.edit = new vscode.WorkspaceEdit();
        action.isPreferred = true;
        //let line = document.lineAt(diagnostic.range.start.line);
        //let expressionRange = getExpressionRange(line, diagnostic);
        //if (!expressionRange) {
            // The expression could not be found in the line
        //    return;
        //}
        // let diagnosticText = document.getText(diagnostic.range);
        // let expressionText = document.getText(expressionRange);
        // let newText = `${diagnosticText} != null ? ${expressionText} : null`;
        let lineReplaceRange = document.lineAt(range.start.line).range;
        action.edit.replace(document.uri, lineReplaceRange, diagnosticCreateQuickFix( document.lineAt(range.start.line).text, diagnostic) );

        return action;
}
exports.createQuickFix = createQuickFix;

function diagnosticCreateQuickFix(text, diagnostic) {
    let extraText = '';

    if (text.includes('?>')) {
        const typeRegexPHPTag = /(.+)\?\>(.*)/;
        const matchPHPTag = text.match(typeRegexPHPTag);

        text = matchPHPTag[1];
        extraText = '?>'+matchPHPTag[2];
    }

    const typeRegex = /(.+)(([\/]{2,})\s?(phpcs\:ignore)?([\w\,\.\s]{0,}))/;
    const match = text.match(typeRegex);
    if (match) {
        if (match[4] && 'phpcs:ignore' === match[4]) {
            if (match[5]) {
                text = match[1] + '// ' + match[4] + match[5] + ', ' + diagnostic.information.source;
            } else {
                text = match[1] + '// ' + match[4] + diagnostic.information.source;
            }
        } else {
            text = match[1] + '// phpcs:ignore ' + diagnostic.information.source
        }
    } else {
        text += ' // phpcs:ignore ' + diagnostic.information.source
    }

    return text+extraText;
}

function isNullableError(diagnostic) {
    if (typeof diagnostic.code === 'object' && (diagnostic.code.value === 'argument_type_not_assignable' || diagnostic.code.value === 'invalid_assignment')) {
        const types = extractTypes(diagnostic.message);
        return types[0].includes(types[1]);
    }
    return false;
}
function getExpressionRange(line, diagnostic) {
    const diagnosticArg = line.text.slice(diagnostic.range.start.character, diagnostic.range.end.character);
    const match = line.text.match(new RegExp(`(\\b[\\w\\d_]+(?:\\.\\w+)?\\(${diagnosticArg}\\))|(\\b[\\w\\d_]+\\[${diagnosticArg}\\])`));
    if (match) {
        const matchStart = line.text.indexOf(match[0]);
        const matchEnd = matchStart + match[0].length;
        return new vscode.Range(line.range.start.line, matchStart, line.range.start.line, matchEnd);
    }
    return null;
}