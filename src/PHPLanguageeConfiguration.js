let vscode = require('vscode');

module.exports = {
    wordPattern: /(-?\d*\.\d\w*)|([^\-\`\~\!\@\#\%\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    onEnterRules: [
        {
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            afterText: /^\s*\*\/$/,
            action:
            {
                indentAction: vscode.IndentAction.IndentOutdent,
                appendText: " * "
            }
        },
        {
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            action:
            {
                indentAction: vscode.IndentAction.None,
                appendText: " * "
            }
        },
        {
            beforeText: /^(\t|(\ \ ))*\*(\ ([^\*]|\*(?!\/))*)?$/,
            action:
            {
                indentAction: vscode.IndentAction.None,
                appendText: "* "
            }
        },
        {
            beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
            action:
            {
                indentAction: vscode.IndentAction.None,
                removeText: 1
            }
        }]
}