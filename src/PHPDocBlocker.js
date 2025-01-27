const path = require('path');
let vscode = require('vscode');
let spawn = require('cross-spawn');
let fs = require('fs');
let { activeEditor, config, showMessage, showErrorMessage, USER_CONFIG_FIXER_FILE_NAME, EXTENSION_NAME } = require('./Helpers');

class PHPDocBlocker {

    parseFunction(token, symbols) {
        // Check if the token represents a function identifier
        if (this.grammar.is(token.value, 'function')) {
            symbols.type = SymbolKind.Function;

            this.expectName = true;

            return;
        }

        if (symbols.type === SymbolKind.Function) {
            // Check for an array return type
            if (token.type.label === '[') {
                symbols.return.type += '[]';

                return;
            }

            // Check for a valid function name
            if (this.expectName && this.isName(token.value)) {
                symbols.name = token.value;

                this.expectName = false;

                return;
            }

            // Expect a function return type
            if (token.type.label === ':' && !this.expectParameter) {
                this.expectReturnType = true;

                return;
            }

            // Check for a valid function return type
            if (this.expectReturnType && this.matchesIdentifier(token.value)) {
                this.expectReturnType = false;

                symbols.return.type = token.value;

                return;
            }
        }
    }
}

module.exports = PHPDocBlocker;