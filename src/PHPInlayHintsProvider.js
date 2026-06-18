let vscode = require('vscode');
let fs = require('fs');

class PHPInlayHintsProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async provideInlayHints(document, range) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let text = document.getText(range);
        let offset = document.offsetAt(range.start);
        let hints = [];

        // Match function/method calls: name( args )  or  ->name( args )  or  ::name( args )
        let callRegex = /(?:->|::|\\|\b)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
        let match;

        while ((match = callRegex.exec(text)) !== null) {
            let funcName = match[1];
            let argsStr = match[2].trim();

            if (!argsStr || this._isLanguageConstruct(funcName)) {
                continue;
            }

            // Find the function/method definition to get parameter names
            let params = this._findParams(funcName);
            if (!params || params.length === 0) {
                continue;
            }

            // Parse the arguments
            let args = this._splitArguments(argsStr);
            let argsOffset = offset + match.index + match[0].indexOf('(') + 1;

            // Position each hint at the start of each argument
            let currentOffset = 0;
            for (let i = 0; i < Math.min(args.length, params.length); i++) {
                let arg = args[i];
                let argStart = argsStr.indexOf(arg, currentOffset);
                if (argStart === -1) continue;

                let argTrimmed = arg.trim();
                // Skip if the argument already contains the param name (named argument)
                if (argTrimmed.startsWith(params[i] + ':') || argTrimmed.startsWith('$')) {
                    currentOffset = argStart + arg.length;
                    continue;
                }

                // Skip very simple/obvious args
                if (argTrimmed === 'null' || argTrimmed === 'true' || argTrimmed === 'false' || argTrimmed === '[]') {
                    currentOffset = argStart + arg.length;
                    continue;
                }

                let hintPosition = document.positionAt(argsOffset + argStart);
                let hint = new vscode.InlayHint(
                    hintPosition,
                    params[i] + ':',
                    vscode.InlayHintKind.Parameter
                );
                hint.paddingRight = true;
                hints.push(hint);

                currentOffset = argStart + arg.length;
            }
        }

        return hints;
    }

    _findParams(funcName) {
        // Try method index first
        let shortKey = funcName.toLowerCase();
        let methodRecords = this.definitionIndex.shortMethodIndex.get(shortKey);
        if (methodRecords && methodRecords.length > 0) {
            return this._extractParamsFromRecord(methodRecords[0]);
        }

        // Try function index
        let funcRecords = this.definitionIndex.shortFunctionIndex.get(shortKey);
        if (funcRecords && funcRecords.length > 0) {
            return this._extractParamsFromRecord(funcRecords[0]);
        }

        return null;
    }

    _extractParamsFromRecord(record) {
        if (record.params && Array.isArray(record.params)) {
            return record.params.map(p => p.name || p);
        }

        // Fall back to reading the file and parsing the signature
        if (!record.filePath || !record.line) return null;

        try {
            let text = fs.readFileSync(record.filePath, 'utf8');
            let lines = text.split(/\r?\n/);
            let lineIdx = Math.max(0, record.line - 1);

            // Collect function signature (may span multiple lines)
            let sig = '';
            for (let i = lineIdx; i < Math.min(lineIdx + 10, lines.length); i++) {
                sig += lines[i];
                if (sig.includes('{') || sig.includes(';')) break;
            }

            // Extract parameter names from signature
            let paramMatch = sig.match(/\(([^)]*)\)/);
            if (!paramMatch) return null;

            let paramStr = paramMatch[1];
            let params = [];
            let paramRegex = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
            let m;
            while ((m = paramRegex.exec(paramStr)) !== null) {
                params.push('$' + m[1]);
            }

            return params.length > 0 ? params : null;
        } catch {
            return null;
        }
    }

    _splitArguments(argsStr) {
        let args = [];
        let depth = 0;
        let current = '';

        for (let i = 0; i < argsStr.length; i++) {
            let ch = argsStr[i];
            if (ch === '(' || ch === '[' || ch === '{') {
                depth++;
                current += ch;
            } else if (ch === ')' || ch === ']' || ch === '}') {
                depth--;
                current += ch;
            } else if (ch === ',' && depth === 0) {
                args.push(current);
                current = '';
            } else {
                current += ch;
            }
        }

        if (current.trim()) {
            args.push(current);
        }

        return args;
    }

    _isLanguageConstruct(name) {
        let constructs = new Set([
            'if', 'else', 'elseif', 'while', 'for', 'foreach', 'switch', 'case',
            'return', 'echo', 'print', 'die', 'exit', 'isset', 'unset', 'empty',
            'include', 'include_once', 'require', 'require_once', 'list', 'array',
            'new', 'throw', 'catch', 'finally', 'try', 'class', 'function',
            'define', 'defined', 'compact', 'extract'
        ]);
        return constructs.has(name.toLowerCase());
    }
}

module.exports = PHPInlayHintsProvider;
