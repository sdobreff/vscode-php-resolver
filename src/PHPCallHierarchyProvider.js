let vscode = require('vscode');
let fs = require('fs');
let path = require('path');

class PHPCallHierarchyProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async prepareCallHierarchy(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        await this.definitionIndex.waitUntilReady();

        let result = await this.definitionIndex.findDefinitionWithTrace(document, position);
        if (!result.locations || result.locations.length === 0) {
            return null;
        }

        let record = this.definitionIndex.findRecordByLocation(result.locations[0]);
        if (!record) {
            return null;
        }

        if (record.kind !== 'function' && record.kind !== 'method') {
            return null;
        }

        return new vscode.CallHierarchyItem(
            record.kind === 'method' ? vscode.SymbolKind.Method : vscode.SymbolKind.Function,
            record.name,
            this.getDetail(record),
            vscode.Uri.file(record.filePath),
            new vscode.Range(
                new vscode.Position(Math.max(0, record.line - 1), 0),
                new vscode.Position(Math.max(0, record.line - 1), 0)
            ),
            new vscode.Range(
                new vscode.Position(Math.max(0, record.line - 1), 0),
                new vscode.Position(Math.max(0, record.line - 1), 0)
            )
        );
    }

    async provideCallHierarchyIncomingCalls(item) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let targetName = item.name;
        let results = [];
        let regexes = this.buildCallRegexes(targetName, item);

        // Use reverse token index to narrow candidate files
        let files = this.definitionIndex._getCandidateFiles(targetName);
        for (let filePath of files) {
            let text = await this.definitionIndex._readFileCached(filePath);
            if (!text) continue;

            let entry = this.definitionIndex.fileEntries.get(filePath);
            if (!entry) {
                continue;
            }

            let lineOffsets = this.definitionIndex.computeLineOffsets(text);
            let ignoredRanges = this.definitionIndex.computeIgnoredRanges(text);

            for (let regex of regexes) {
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    if (this.definitionIndex.isOffsetInRanges(match.index, ignoredRanges)) {
                        continue;
                    }

                    let callLine = this.definitionIndex.offsetToLine(lineOffsets, match.index) - 1;
                    let callCol = match.index - (lineOffsets[callLine] || 0);

                    // Find enclosing function/method
                    let enclosing = this.findEnclosingSymbol(entry.symbols, callLine + 1, text, lineOffsets);
                    if (!enclosing) {
                        continue;
                    }

                    // Skip self-references (same file, same line as declaration)
                    if (enclosing.filePath === item.uri.fsPath && enclosing.line === item.range.start.line + 1) {
                        continue;
                    }

                    let callerItem = new vscode.CallHierarchyItem(
                        enclosing.kind === 'method' ? vscode.SymbolKind.Method : vscode.SymbolKind.Function,
                        enclosing.name,
                        this.getDetail(enclosing),
                        vscode.Uri.file(enclosing.filePath),
                        new vscode.Range(
                            new vscode.Position(Math.max(0, enclosing.line - 1), 0),
                            new vscode.Position(Math.max(0, enclosing.line - 1), 0)
                        ),
                        new vscode.Range(
                            new vscode.Position(Math.max(0, enclosing.line - 1), 0),
                            new vscode.Position(Math.max(0, enclosing.line - 1), 0)
                        )
                    );

                    let fromRange = new vscode.Range(
                        new vscode.Position(callLine, callCol),
                        new vscode.Position(callLine, callCol + targetName.length)
                    );

                    results.push(new vscode.CallHierarchyIncomingCall(callerItem, [fromRange]));
                }
            }
        }

        return this.dedupeIncomingCalls(results);
    }

    async provideCallHierarchyOutgoingCalls(item) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let filePath = item.uri.fsPath;
        let text = await this.definitionIndex._readFileCached(filePath);
        if (!text) {
            return [];
        }

        let entry = this.definitionIndex.fileEntries.get(filePath);
        if (!entry) {
            return [];
        }

        // Find the symbol's body range
        let declarationLine = item.range.start.line + 1;
        let bodyRange = this.findFunctionBodyRange(text, declarationLine);
        if (!bodyRange) {
            return [];
        }

        let bodyText = text.slice(bodyRange.start, bodyRange.end);
        let bodyOffset = bodyRange.start;

        let lineOffsets = this.definitionIndex.computeLineOffsets(text);
        let ignoredRanges = this.definitionIndex.computeIgnoredRanges(text);

        // Find all function/method calls in the body
        let callPattern = /(?:::|\->|\\|\b)([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
        let results = [];
        let match;

        while ((match = callPattern.exec(bodyText)) !== null) {
            let globalOffset = bodyOffset + match.index;

            if (this.definitionIndex.isOffsetInRanges(globalOffset, ignoredRanges)) {
                continue;
            }

            let calledName = match[1];

            // Skip PHP language constructs
            if (this.isLanguageConstruct(calledName)) {
                continue;
            }

            // Try to find the target symbol
            let targetRecords = this.findCallTarget(calledName, entry);
            if (targetRecords.length === 0) {
                continue;
            }

            let target = targetRecords[0];
            let callLine = this.definitionIndex.offsetToLine(lineOffsets, globalOffset + match[0].indexOf(calledName)) - 1;
            let callCol = (globalOffset + match[0].indexOf(calledName)) - (lineOffsets[callLine] || 0);

            let targetItem = new vscode.CallHierarchyItem(
                target.kind === 'method' ? vscode.SymbolKind.Method : vscode.SymbolKind.Function,
                target.name,
                this.getDetail(target),
                vscode.Uri.file(target.filePath),
                new vscode.Range(
                    new vscode.Position(Math.max(0, target.line - 1), 0),
                    new vscode.Position(Math.max(0, target.line - 1), 0)
                ),
                new vscode.Range(
                    new vscode.Position(Math.max(0, target.line - 1), 0),
                    new vscode.Position(Math.max(0, target.line - 1), 0)
                )
            );

            let fromRange = new vscode.Range(
                new vscode.Position(callLine, callCol),
                new vscode.Position(callLine, callCol + calledName.length)
            );

            results.push(new vscode.CallHierarchyOutgoingCall(targetItem, [fromRange]));
        }

        return this.dedupeOutgoingCalls(results);
    }

    buildCallRegexes(name, item) {
        let escaped = this.definitionIndex.escapeRegex(name);
        let regexes = [];

        if (item.kind === vscode.SymbolKind.Method) {
            regexes.push(new RegExp('::\\s*' + escaped + '\\s*\\(', 'g'));
            regexes.push(new RegExp('->\\s*' + escaped + '\\s*\\(', 'g'));
        } else {
            regexes.push(new RegExp('\\b' + escaped + '\\s*\\(', 'g'));
        }

        return regexes;
    }

    findEnclosingSymbol(symbols, line, text, lineOffsets) {
        let candidates = (symbols || []).filter(s => s.kind === 'function' || s.kind === 'method');

        for (let symbol of candidates) {
            let bodyRange = this.findFunctionBodyRange(text, symbol.line);
            if (!bodyRange) {
                continue;
            }

            let startLine = symbol.line;
            let endOffset = bodyRange.end;
            let endLine = this.definitionIndex.offsetToLine(lineOffsets, endOffset);

            if (line >= startLine && line <= endLine) {
                return symbol;
            }
        }

        return null;
    }

    findFunctionBodyRange(text, declarationLine) {
        let lineOffsets = this.definitionIndex.computeLineOffsets(text);
        let lineIndex = Math.max(0, declarationLine - 1);

        if (lineIndex >= lineOffsets.length) {
            return null;
        }

        let searchStart = lineOffsets[lineIndex];
        let openBrace = text.indexOf('{', searchStart);
        if (openBrace === -1) {
            return null;
        }

        let closeBrace = this.definitionIndex.findMatchingBrace(text, openBrace);
        if (closeBrace === -1) {
            return null;
        }

        return { start: openBrace + 1, end: closeBrace };
    }

    findCallTarget(name, entry) {
        let lowerName = name.toLowerCase();

        // Check methods in current file first
        let methods = this.definitionIndex.shortMethodIndex.get(lowerName) || [];
        if (methods.length > 0) {
            return methods;
        }

        // Check functions
        let functions = this.definitionIndex.shortFunctionIndex.get(lowerName) || [];
        if (functions.length > 0) {
            return functions;
        }

        return [];
    }

    isLanguageConstruct(name) {
        let constructs = new Set([
            'if', 'else', 'elseif', 'while', 'for', 'foreach', 'switch',
            'case', 'break', 'continue', 'return', 'echo', 'print',
            'isset', 'unset', 'empty', 'list', 'array', 'die', 'exit',
            'include', 'include_once', 'require', 'require_once',
            'eval', 'catch', 'throw', 'try', 'finally', 'match',
        ]);
        return constructs.has(name.toLowerCase());
    }

    getDetail(record) {
        if (record.kind === 'method') {
            return record.classFqcn || '';
        }
        if (record.kind === 'function') {
            return record.fqfn || '';
        }
        return '';
    }

    dedupeIncomingCalls(calls) {
        let seen = new Map();
        for (let call of calls) {
            let key = call.from.uri.fsPath + ':' + call.from.range.start.line;
            if (!seen.has(key)) {
                seen.set(key, call);
            } else {
                let existing = seen.get(key);
                existing.fromRanges = existing.fromRanges.concat(call.fromRanges);
            }
        }
        return [...seen.values()];
    }

    dedupeOutgoingCalls(calls) {
        let seen = new Map();
        for (let call of calls) {
            let key = call.to.uri.fsPath + ':' + call.to.range.start.line;
            if (!seen.has(key)) {
                seen.set(key, call);
            } else {
                let existing = seen.get(key);
                existing.fromRanges = existing.fromRanges.concat(call.fromRanges);
            }
        }
        return [...seen.values()];
    }
}

module.exports = PHPCallHierarchyProvider;
