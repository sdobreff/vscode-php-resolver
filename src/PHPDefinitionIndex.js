let vscode = require('vscode');
let fs = require('fs');
let path = require('path');
let crypto = require('crypto');
let { config } = require('./Helpers');

const CACHE_VERSION = 2;
const CACHE_FILE = 'php-definition-index-cache.json';
const FILE_CONTENT_CACHE_SIZE = 150;

class PHPDefinitionIndex {
    constructor(context, logger = null) {
        this.context = context;
        this.logger = logger;

        this.fileEntries = new Map();
        this.classIndex = new Map();
        this.shortClassIndex = new Map();
        this.functionIndex = new Map();
        this.shortFunctionIndex = new Map();
        this.methodIndex = new Map();
        this.shortMethodIndex = new Map();

        // Performance: reverse token index (tokenName → Set<filePath>)
        this.tokenToFiles = new Map();

        // Performance: persistent inheritance graph (parentFqcn → Set<childFqcn>)
        this.parentToChildren = new Map();

        // Performance: persistent class record set
        this._allClassRecords = [];
        this._allClassRecordsDirty = true;

        // Performance: LRU file content cache
        this._fileContentCache = new Map();

        // Performance: workspace folder cache
        this._workspaceFolderCache = new Map();

        this.watcher = null;
        this.flushTimer = null;
        this.updateTimers = new Map();

        this._initPromise = null;
        this._ready = false;
    }

    initialize() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._initializeInternal();
        return this._initPromise;
    }

    async _initializeInternal() {
        await this.loadCache();
        await this.reindexIncremental();
        this.startWatcher();
        this._ready = true;
        this.log('Definition index initialized', 'INFO');
    }

    async waitUntilReady() {
        await this.initialize();
    }

    dispose() {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        for (let timer of this.updateTimers.values()) {
            clearTimeout(timer);
        }
        this.updateTimers.clear();
    }

    async findDefinitionLocations(document, position) {
        let result = await this.findDefinitionWithTrace(document, position);
        return result.locations;
    }

    async findReferencesWithTrace(document, position, includeDeclaration = true) {
        await this.waitUntilReady();

        let trace = [];
        const pushTrace = (message) => {
            trace.push(message);
        };

        let definition = await this.findDefinitionWithTrace(document, position);
        for (let line of definition.trace) {
            pushTrace('definition/' + line);
        }

        if (!definition.locations || definition.locations.length === 0) {
            pushTrace('references/no-definition');
            return { locations: [], trace };
        }

        let primaryRecord = this.findRecordByLocation(definition.locations[0]);
        if (!primaryRecord) {
            pushTrace('references/no-primary-record');
            return { locations: includeDeclaration ? definition.locations : [], trace };
        }

        pushTrace('references/symbol-kind=' + primaryRecord.kind + ' name=' + primaryRecord.name);

        let locations = [];
        if (includeDeclaration) {
            locations = locations.concat(definition.locations);
        }

        let regexes = this.buildReferenceRegexes(primaryRecord);
        pushTrace('references/patterns=' + regexes.length);

        let declarationSet = new Set();
        for (let loc of definition.locations) {
            declarationSet.add(loc.uri.fsPath + ':' + (loc.range.start.line + 1));
        }

        // Use reverse token index to narrow file set
        let files = this._getCandidateFiles(primaryRecord.name);
        pushTrace('references/candidate-files=' + files.length + ' total=' + this.fileEntries.size);

        for (let filePath of files) {
            let text = await this._readFileCached(filePath);
            if (!text) continue;

            let found = this.findRegexLocationsInText(filePath, text, regexes);
            if (!includeDeclaration) {
                found = found.filter((loc) => {
                    let key = loc.uri.fsPath + ':' + (loc.range.start.line + 1);
                    return !declarationSet.has(key);
                });
            }

            locations = locations.concat(found);
        }

        let dedup = this.dedupeLocations(locations);
        pushTrace('references/count=' + dedup.length);

        return { locations: dedup, trace };
    }

    async findImplementationsWithTrace(document, position) {
        await this.waitUntilReady();

        let trace = [];
        const pushTrace = (message) => {
            trace.push(message);
        };

        let definition = await this.findDefinitionWithTrace(document, position);
        for (let line of definition.trace) {
            pushTrace('definition/' + line);
        }

        if (!definition.locations || definition.locations.length === 0) {
            pushTrace('implementation/no-definition');
            return { locations: [], trace };
        }

        let primary = this.findRecordByLocation(definition.locations[0]);
        if (!primary) {
            pushTrace('implementation/no-primary-record');
            return { locations: [], trace };
        }

        pushTrace('implementation/source-kind=' + primary.kind + ' source-name=' + primary.name);

        if (primary.kind === 'class') {
            let targetFqcn = (primary.fqcn || primary.name || '').toLowerCase();
            let implementingClasses = this.findDerivedClassRecords(targetFqcn);
            let rankedClasses = this.rankRecords(implementingClasses, document.uri);
            pushTrace('implementation/class-derived-count=' + rankedClasses.length);
            return { locations: this.toLocations(rankedClasses), trace };
        }

        if (primary.kind === 'method') {
            let targetClass = (primary.classFqcn || '').toLowerCase();
            if (!targetClass) {
                pushTrace('implementation/method-missing-class');
                return { locations: [], trace };
            }

            let implementingClasses = this.findDerivedClassRecords(targetClass);
            let methodRecords = [];

            for (let classRecord of implementingClasses) {
                let methodKey = (classRecord.fqcn + '::' + primary.name).toLowerCase();
                let matches = this.methodIndex.get(methodKey) || [];
                methodRecords = methodRecords.concat(matches);
            }

            let rankedMethods = this.rankRecords(methodRecords, document.uri);
            pushTrace('implementation/method-derived-count=' + rankedMethods.length);
            return { locations: this.toLocations(rankedMethods), trace };
        }

        pushTrace('implementation/unsupported-kind=' + primary.kind);
        return { locations: [], trace };
    }

    async findHover(document, position) {
        await this.waitUntilReady();

        let result = await this.findDefinitionWithTrace(document, position);
        if (!result.locations || result.locations.length === 0) {
            return null;
        }

        let primary = this.findRecordByLocation(result.locations[0]);
        if (!primary) {
            return null;
        }

        let tokenRange = document.getWordRangeAtPosition(position, /[A-Za-z_\\][A-Za-z0-9_\\]*/);
        let markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(this.getRecordDisplayName(primary), 'php');
        markdown.appendMarkdown('\n\nKind: **' + primary.kind + '**');
        markdown.appendMarkdown('\n\nDefined in: `' + path.basename(primary.filePath) + ':' + primary.line + '`');

        let declarationLine = await this.getDeclarationLine(primary.filePath, primary.line);
        if (declarationLine) {
            markdown.appendMarkdown('\n\nDeclaration:');
            markdown.appendCodeblock(declarationLine.trim(), 'php');
        }

        return {
            contents: [markdown],
            range: tokenRange,
        };
    }

    async findWorkspaceSymbols(query) {
        await this.waitUntilReady();

        let search = (query || '').trim().toLowerCase();
        let all = this.getAllSymbolRecords();

        let filtered = all.filter((record) => {
            if (!search) {
                return true;
            }

            let fq = '';
            if (record.kind === 'class') {
                fq = record.fqcn || '';
            } else if (record.kind === 'function') {
                fq = record.fqfn || '';
            } else if (record.kind === 'method') {
                fq = record.methodKey || '';
            }

            return record.name.toLowerCase().includes(search) || fq.toLowerCase().includes(search);
        });

        let max = 2000;
        return filtered.slice(0, max).map((record) => {
            return new vscode.SymbolInformation(
                this.getRecordDisplayName(record),
                this.mapRecordToSymbolKind(record),
                this.getRecordContainerName(record),
                new vscode.Location(
                    vscode.Uri.file(record.filePath),
                    new vscode.Position(Math.max(0, record.line - 1), 0)
                )
            );
        });
    }

    async getRenameContext(document, position) {
        await this.waitUntilReady();

        let definitionResult = await this.findDefinitionWithTrace(document, position);
        if (!definitionResult.locations || definitionResult.locations.length === 0) {
            return null;
        }

        let primary = this.findRecordByLocation(definitionResult.locations[0]);
        if (!primary) {
            return null;
        }

        // Safe scope for Phase 2 start: class/function only.
        if (primary.kind !== 'class' && primary.kind !== 'function') {
            return null;
        }

        let range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        return {
            record: primary,
            range,
            oldName: primary.name,
        };
    }

    async buildRenameWorkspaceEdit(document, position, newName) {
        let renameContext = await this.getRenameContext(document, position);
        if (!renameContext) {
            return null;
        }

        if (!this.isValidPhpIdentifier(newName)) {
            throw new Error('Invalid PHP identifier for rename: ' + newName);
        }

        let referencesResult = await this.findReferencesWithTrace(document, position, true);
        if (!referencesResult.locations || referencesResult.locations.length === 0) {
            return null;
        }

        let edit = new vscode.WorkspaceEdit();
        let seen = new Set();
        let linesCache = new Map();

        for (let location of referencesResult.locations) {
            let filePath = location.uri.fsPath;
            let line = location.range.start.line;
            let hintChar = location.range.start.character;

            if (!linesCache.has(filePath)) {
                let text = await this._readFileCached(filePath);
                linesCache.set(filePath, text ? text.split(/\r?\n/) : []);
            }

            let lines = linesCache.get(filePath);
            if (line < 0 || line >= lines.length) {
                continue;
            }

            let lineText = lines[line];
            let column = this.findClosestWordIndex(lineText, renameContext.oldName, hintChar);
            if (column === -1) {
                continue;
            }

            let key = filePath + ':' + line + ':' + column;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            let range = new vscode.Range(
                new vscode.Position(line, column),
                new vscode.Position(line, column + renameContext.oldName.length)
            );

            edit.replace(vscode.Uri.file(filePath), range, newName);
        }

        if (seen.size === 0) {
            return null;
        }

        return edit;
    }

    findClosestWordIndex(lineText, word, hintChar) {
        if (!lineText || !word) {
            return -1;
        }

        let regex = new RegExp('\\b' + this.escapeRegex(word) + '\\b', 'g');
        let matches = [];
        let match;

        while ((match = regex.exec(lineText)) !== null) {
            matches.push(match.index);
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }

        if (matches.length === 0) {
            return -1;
        }

        let best = matches[0];
        let bestDistance = Math.abs(matches[0] - hintChar);
        for (let candidate of matches) {
            let distance = Math.abs(candidate - hintChar);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }

        return best;
    }

    isValidPhpIdentifier(value) {
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''));
    }

    async findDefinitionWithTrace(document, position) {
        await this.waitUntilReady();

        let trace = [];
        const pushTrace = (message) => {
            trace.push(message);
        };

        let context = this.parseNamespaceAndImports(document.getText());
        let lineText = document.lineAt(position.line).text;
        let character = position.character;
        pushTrace('line=' + (position.line + 1) + ' character=' + position.character);

        let staticContext = this.extractStaticCallContext(lineText, character);
        if (staticContext) {
            pushTrace('static-context class=' + staticContext.className + ' method=' + staticContext.methodName);
            if (staticContext.cursorOnMethod) {
                let classCandidates = this.resolveClassCandidates(staticContext.className, context);
                pushTrace('class-candidates=' + classCandidates.join(', '));
                for (let classFqcn of classCandidates) {
                    let methodKey = (classFqcn + '::' + staticContext.methodName).toLowerCase();
                    let methodRecords = this.methodIndex.get(methodKey) || [];
                    if (methodRecords.length > 0) {
                        let ranked = this.rankRecords(methodRecords, document.uri);
                        pushTrace('resolved-by=methodKey records=' + ranked.length);
                        return { locations: this.toLocations(ranked), trace };
                    }
                }

                let fallbackMethods = this.shortMethodIndex.get(staticContext.methodName.toLowerCase()) || [];
                if (fallbackMethods.length > 0) {
                    let ranked = this.rankRecords(fallbackMethods, document.uri);
                    pushTrace('resolved-by=method-short-name records=' + ranked.length);
                    return { locations: this.toLocations(ranked), trace };
                }
            }

            let classRecords = this.findClassRecords(staticContext.className, context, document.uri);
            if (classRecords.length > 0) {
                pushTrace('resolved-by=class records=' + classRecords.length);
                return { locations: this.toLocations(classRecords), trace };
            }
        }

        let range = document.getWordRangeAtPosition(position, /[A-Za-z_\\][A-Za-z0-9_\\]*/);
        if (!range) {
            pushTrace('no-word-range');
            return { locations: [], trace };
        }

        let token = document.getText(range);
        if (!token) {
            pushTrace('empty-token');
            return { locations: [], trace };
        }
        pushTrace('token=' + token);

        let looksLikeFunctionCall = /\s*\(/.test(lineText.slice(range.start.character + token.length));
        pushTrace('looks-like-function-call=' + looksLikeFunctionCall);

        // For function-call tokens (e.g. add_action, \add_action), resolve as function first
        // and avoid class fallback to prevent incorrect jumps to unrelated symbols.
        if (looksLikeFunctionCall) {
            let functionMatches = this.findFunctionRecords(token, context, lineText, range.start.character, document.uri);
            if (functionMatches.length > 0) {
                pushTrace('resolved-by=function records=' + functionMatches.length);
                return { locations: this.toLocations(functionMatches), trace };
            }

            // If cursor is on a method/function definition line, resolve to the defined symbol
            let textBeforeToken = lineText.slice(0, range.start.character);
            if (/\bfunction\s+&?\s*$/.test(textBeforeToken)) {
                let methodRecords = this.shortMethodIndex.get(token.toLowerCase()) || [];
                if (methodRecords.length > 0) {
                    let sameLocation = methodRecords.filter(r => r.filePath === document.uri.fsPath && r.line === position.line + 1);
                    let records = sameLocation.length > 0 ? sameLocation : methodRecords;
                    let ranked = this.rankRecords(records, document.uri);
                    pushTrace('resolved-by=method-definition records=' + ranked.length);
                    return { locations: this.toLocations(ranked), trace };
                }

                // Also check function index (for functions parsed inside class_exists wrappers)
                let fnRecords = this.shortFunctionIndex.get(token.toLowerCase()) || [];
                if (fnRecords.length > 0) {
                    let sameLocation = fnRecords.filter(r => r.filePath === document.uri.fsPath && r.line === position.line + 1);
                    let records = sameLocation.length > 0 ? sameLocation : fnRecords;
                    let ranked = this.rankRecords(records, document.uri);
                    pushTrace('resolved-by=function-definition records=' + ranked.length);
                    return { locations: this.toLocations(ranked), trace };
                }
            }

            pushTrace('function-call-without-match');
            return { locations: [], trace };
        }

        let classMatches = this.findClassRecords(token, context, document.uri);
        if (classMatches.length > 0) {
            pushTrace('resolved-by=class-token records=' + classMatches.length);
            return { locations: this.toLocations(classMatches), trace };
        }

        pushTrace('no-match');
        return { locations: [], trace };
    }

    async clearCacheAndRebuild() {
        this.fileEntries.clear();
        this.classIndex.clear();
        this.shortClassIndex.clear();
        this.functionIndex.clear();
        this.shortFunctionIndex.clear();
        this.methodIndex.clear();
        this.shortMethodIndex.clear();

        await this.deleteCacheFile();
        await this.reindexIncremental();
        this.log('Definition index cache cleared and rebuilt', 'INFO');
    }

    findClassRecords(token, context, currentUri) {
        let candidates = this.resolveClassCandidates(token, context);

        for (let candidate of candidates) {
            let records = this.classIndex.get(candidate.toLowerCase()) || [];
            if (records.length > 0) {
                return this.rankRecords(records, currentUri);
            }
        }

        let shortKey = token.replace(/^\\+/, '').split('\\').pop().toLowerCase();
        let fallback = this.shortClassIndex.get(shortKey) || [];
        return this.rankRecords(fallback, currentUri);
    }

    findFunctionRecords(token, context, lineText, startCharacter, currentUri) {
        let looksLikeCall = /\s*\(/.test(lineText.slice(startCharacter + token.length));
        if (!looksLikeCall) {
            return [];
        }

        let candidates = this.resolveFunctionCandidates(token, context);
        for (let candidate of candidates) {
            let records = this.functionIndex.get(candidate.toLowerCase()) || [];
            if (records.length > 0) {
                return this.rankRecords(records, currentUri);
            }
        }

        let shortKey = token.replace(/^\\+/, '').split('\\').pop().toLowerCase();
        let fallback = this.shortFunctionIndex.get(shortKey) || [];
        return this.rankRecords(fallback, currentUri);
    }

    resolveClassCandidates(symbol, context) {
        let cleaned = symbol.replace(/^\\+/, '');
        let candidates = [];

        if (cleaned.includes('\\')) {
            let parts = cleaned.split('\\');
            let first = parts[0].toLowerCase();
            if (context.imports[first]) {
                let remainder = parts.slice(1).join('\\');
                candidates.push(remainder ? context.imports[first] + '\\' + remainder : context.imports[first]);
            }

            if (context.namespace) {
                candidates.push(context.namespace + '\\' + cleaned);
            }

            candidates.push(cleaned);
            return this.uniqueStrings(candidates);
        }

        let imported = context.imports[cleaned.toLowerCase()];
        if (imported) {
            candidates.push(imported);
        }

        if (context.namespace) {
            candidates.push(context.namespace + '\\' + cleaned);
        }

        candidates.push(cleaned);
        return this.uniqueStrings(candidates);
    }

    resolveFunctionCandidates(symbol, context) {
        let cleaned = symbol.replace(/^\\+/, '');
        let candidates = [];

        if (cleaned.includes('\\')) {
            if (context.namespace) {
                candidates.push(context.namespace + '\\' + cleaned);
            }
            candidates.push(cleaned);
            return this.uniqueStrings(candidates);
        }

        if (context.namespace) {
            candidates.push(context.namespace + '\\' + cleaned);
        }

        candidates.push(cleaned);
        return this.uniqueStrings(candidates);
    }

    findDerivedClassRecords(targetFqcn) {
        let target = String(targetFqcn || '').replace(/^\\+/, '').toLowerCase();
        if (!target) {
            return [];
        }

        // Rebuild parentToChildren on demand if it appears stale
        // (e.g., fileEntries was replaced externally in tests)
        if (this.parentToChildren.size === 0 && this.fileEntries.size > 0) {
            this._rebuildInheritanceGraph();
        }

        // BFS through parentToChildren graph
        let descendants = new Set();
        let queue = [target];
        while (queue.length > 0) {
            let current = queue.shift();
            let children = this.parentToChildren.get(current);
            if (children) {
                for (let child of children) {
                    if (!descendants.has(child)) {
                        descendants.add(child);
                        queue.push(child);
                    }
                }
            }
        }

        if (descendants.size === 0) {
            return [];
        }

        // Resolve fqcn set to actual class records
        let results = [];
        for (let fqcn of descendants) {
            let records = this.classIndex.get(fqcn);
            if (records) {
                results.push(...records);
            } else {
                // Fallback: search fileEntries directly
                for (let entry of this.fileEntries.values()) {
                    for (let sym of entry.symbols || []) {
                        if (sym.kind === 'class' && (sym.fqcn || '').toLowerCase() === fqcn) {
                            results.push(sym);
                        }
                    }
                }
            }
        }
        return results;
    }

    _rebuildInheritanceGraph() {
        this.parentToChildren.clear();
        for (let entry of this.fileEntries.values()) {
            for (let symbol of entry.symbols || []) {
                if (symbol.kind === 'class' && Array.isArray(symbol.parents)) {
                    for (let parent of symbol.parents) {
                        let parentKey = String(parent || '').replace(/^\\+/, '').toLowerCase();
                        if (parentKey) {
                            if (!this.parentToChildren.has(parentKey)) {
                                this.parentToChildren.set(parentKey, new Set());
                            }
                            this.parentToChildren.get(parentKey).add((symbol.fqcn || '').toLowerCase());
                        }
                    }
                }
            }
        }
    }

    getAllClassRecords() {
        if (this._allClassRecordsDirty) {
            let out = [];
            for (let entry of this.fileEntries.values()) {
                for (let symbol of entry.symbols || []) {
                    if (symbol.kind === 'class') {
                        out.push(symbol);
                    }
                }
            }
            this._allClassRecords = out;
            this._allClassRecordsDirty = false;
        }
        return this._allClassRecords;
    }

    uniqueStrings(values) {
        let out = [];
        let seen = new Set();
        for (let value of values) {
            if (!value) {
                continue;
            }

            let key = value.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                out.push(value);
            }
        }

        return out;
    }

    extractStaticCallContext(lineText, character) {
        const staticRegex = /([A-Za-z_\\][A-Za-z0-9_\\]*)::([A-Za-z_][A-Za-z0-9_]*)/g;
        let match;

        while ((match = staticRegex.exec(lineText)) !== null) {
            let start = match.index;
            let className = match[1];
            let methodName = match[2];
            let separatorStart = start + className.length;
            let methodStart = separatorStart + 2;
            let end = methodStart + methodName.length;

            if (character < start || character > end) {
                continue;
            }

            let cursorOnMethod = character >= methodStart;
            return {
                className,
                methodName,
                cursorOnMethod,
            };
        }

        return null;
    }

    rankRecords(records, currentUri) {
        let currentFolder = vscode.workspace.getWorkspaceFolder(currentUri);
        let deprioritizeNoop = config('definitionDeprioritizeNoopFiles') !== false;

        let getFolder = (filePath) => {
            if (this._workspaceFolderCache.has(filePath)) {
                return this._workspaceFolderCache.get(filePath);
            }
            let folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            this._workspaceFolderCache.set(filePath, folder);
            return folder;
        };

        let sorted = [...records].sort((a, b) => {
            let folderA = getFolder(a.filePath);
            let folderB = getFolder(b.filePath);

            let scoreA = 0;
            let scoreB = 0;

            if (currentFolder && folderA && currentFolder.uri.fsPath === folderA.uri.fsPath) {
                scoreA += 10;
            }
            if (currentFolder && folderB && currentFolder.uri.fsPath === folderB.uri.fsPath) {
                scoreB += 10;
            }

            if (!this.isVendorPath(a.filePath)) {
                scoreA += 2;
            }
            if (!this.isVendorPath(b.filePath)) {
                scoreB += 2;
            }

            if (deprioritizeNoop) {
                if (this.isNoopLikePath(a.filePath)) {
                    scoreA -= 8;
                }
                if (this.isNoopLikePath(b.filePath)) {
                    scoreB -= 8;
                }
            }

            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }

            if (a.filePath === b.filePath) {
                return a.line - b.line;
            }

            return a.filePath.localeCompare(b.filePath);
        });

        let dedup = [];
        let seen = new Set();
        for (let item of sorted) {
            let key = item.filePath + ':' + item.line + ':' + item.kind;
            if (!seen.has(key)) {
                seen.add(key);
                dedup.push(item);
            }
        }

        return dedup;
    }

    toLocations(records) {
        return records.map((record) => {
            return new vscode.Location(
                vscode.Uri.file(record.filePath),
                new vscode.Position(Math.max(0, record.line - 1), 0)
            );
        });
    }

    startWatcher() {
        if (this.watcher) {
            this.watcher.dispose();
        }

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.php');

        this.watcher.onDidCreate((uri) => {
            if (this.shouldTrackFile(uri.fsPath)) {
                this.scheduleFileRefresh(uri.fsPath);
            }
        });

        this.watcher.onDidChange((uri) => {
            if (this.shouldTrackFile(uri.fsPath)) {
                this.scheduleFileRefresh(uri.fsPath);
            }
        });

        this.watcher.onDidDelete((uri) => {
            this.removeFile(uri.fsPath);
            this.scheduleFlushCache();
        });
    }

    scheduleFileRefresh(filePath) {
        let existing = this.updateTimers.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }

        let timer = setTimeout(async () => {
            this.updateTimers.delete(filePath);
            await this.upsertFile(filePath);
            this.scheduleFlushCache();
        }, 250);

        this.updateTimers.set(filePath, timer);
    }

    async reindexIncremental() {
        let uris = await vscode.workspace.findFiles('**/*.php', this.getExcludePattern());
        let filePaths = uris.map((uri) => uri.fsPath).filter((filePath) => this.shouldTrackFile(filePath));
        let currentFilesSet = new Set(filePaths);

        for (let existing of [...this.fileEntries.keys()]) {
            if (!currentFilesSet.has(existing)) {
                this.removeFile(existing);
            }
        }

        const batchSize = 40;
        for (let i = 0; i < filePaths.length; i += batchSize) {
            let batch = filePaths.slice(i, i + batchSize);
            await Promise.all(batch.map((filePath) => this.upsertFile(filePath, true)));
        }

        this.scheduleFlushCache();
    }

    async upsertFile(filePath, skipFlush = false) {
        try {
            let stat = await fs.promises.stat(filePath);
            let existing = this.fileEntries.get(filePath);

            if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
                return;
            }

            let text = await fs.promises.readFile(filePath, 'utf8');

            // Only hash if size matches (mtime changed but content might be same)
            if (existing && existing.size === stat.size) {
                let hash = crypto.createHash('sha1').update(text).digest('hex');
                if (existing.hash === hash) {
                    existing.mtimeMs = stat.mtimeMs;
                    this.fileEntries.set(filePath, existing);
                    return;
                }
            }

            let hash = crypto.createHash('sha1').update(text).digest('hex');
            let parsed = this.parseDocument(filePath, text);
            let nextEntry = {
                filePath,
                mtimeMs: stat.mtimeMs,
                size: stat.size,
                hash,
                namespace: parsed.namespace,
                imports: parsed.imports,
                symbols: parsed.symbols,
            };

            this.removeFile(filePath);
            this.fileEntries.set(filePath, nextEntry);
            this.addEntryToIndexes(nextEntry);

            // Invalidate file content cache for this path
            this._fileContentCache.delete(filePath);

            if (!skipFlush) {
                this.scheduleFlushCache();
            }
        } catch {
            this.removeFile(filePath);
        }
    }

    removeFile(filePath) {
        let existing = this.fileEntries.get(filePath);
        if (!existing) {
            return;
        }

        this.removeEntryFromIndexes(existing);
        this.fileEntries.delete(filePath);
    }

    addEntryToIndexes(entry) {
        for (let symbol of entry.symbols) {
            if (symbol.kind === 'class') {
                this.pushIndex(this.classIndex, symbol.fqcn.toLowerCase(), symbol);
                this.pushIndex(this.shortClassIndex, symbol.name.toLowerCase(), symbol);

                // Reverse token index
                this._addTokenRef(symbol.name, entry.filePath);
                if (symbol.fqcn) this._addTokenRef(symbol.fqcn.split('\\').pop(), entry.filePath);

                // Inheritance graph
                if (Array.isArray(symbol.parents)) {
                    for (let parent of symbol.parents) {
                        let parentKey = String(parent || '').replace(/^\\+/, '').toLowerCase();
                        if (parentKey) {
                            if (!this.parentToChildren.has(parentKey)) {
                                this.parentToChildren.set(parentKey, new Set());
                            }
                            this.parentToChildren.get(parentKey).add(symbol.fqcn.toLowerCase());
                        }
                    }
                }
            } else if (symbol.kind === 'function') {
                this.pushIndex(this.functionIndex, symbol.fqfn.toLowerCase(), symbol);
                this.pushIndex(this.shortFunctionIndex, symbol.name.toLowerCase(), symbol);
                this._addTokenRef(symbol.name, entry.filePath);
            } else if (symbol.kind === 'method') {
                this.pushIndex(this.methodIndex, symbol.methodKey.toLowerCase(), symbol);
                this.pushIndex(this.shortMethodIndex, symbol.name.toLowerCase(), symbol);
                this._addTokenRef(symbol.name, entry.filePath);
            }
        }
        this._allClassRecordsDirty = true;
    }

    removeEntryFromIndexes(entry) {
        for (let symbol of entry.symbols) {
            if (symbol.kind === 'class') {
                this.pullIndex(this.classIndex, symbol.fqcn.toLowerCase(), symbol);
                this.pullIndex(this.shortClassIndex, symbol.name.toLowerCase(), symbol);

                // Remove from inheritance graph
                if (Array.isArray(symbol.parents)) {
                    for (let parent of symbol.parents) {
                        let parentKey = String(parent || '').replace(/^\\+/, '').toLowerCase();
                        if (parentKey && this.parentToChildren.has(parentKey)) {
                            this.parentToChildren.get(parentKey).delete(symbol.fqcn.toLowerCase());
                            if (this.parentToChildren.get(parentKey).size === 0) {
                                this.parentToChildren.delete(parentKey);
                            }
                        }
                    }
                }
            } else if (symbol.kind === 'function') {
                this.pullIndex(this.functionIndex, symbol.fqfn.toLowerCase(), symbol);
                this.pullIndex(this.shortFunctionIndex, symbol.name.toLowerCase(), symbol);
            } else if (symbol.kind === 'method') {
                this.pullIndex(this.methodIndex, symbol.methodKey.toLowerCase(), symbol);
                this.pullIndex(this.shortMethodIndex, symbol.name.toLowerCase(), symbol);
            }
        }

        // Remove file from all token refs
        this._removeFileFromTokenIndex(entry.filePath);
        this._allClassRecordsDirty = true;
    }

    _addTokenRef(tokenName, filePath) {
        let key = tokenName.toLowerCase();
        if (!this.tokenToFiles.has(key)) {
            this.tokenToFiles.set(key, new Set());
        }
        this.tokenToFiles.get(key).add(filePath);
    }

    _removeFileFromTokenIndex(filePath) {
        for (let fileSet of this.tokenToFiles.values()) {
            fileSet.delete(filePath);
        }
    }

    /**
     * Get candidate files that might contain references to the given token name.
     * Falls back to all files if token not in index.
     */
    _getCandidateFiles(tokenName) {
        let key = tokenName.toLowerCase();
        let fileSet = this.tokenToFiles.get(key);
        if (fileSet && fileSet.size > 0) {
            return [...fileSet];
        }
        // Fallback: scan all files (token might appear in strings/comments not indexed)
        return [...this.fileEntries.keys()];
    }

    /**
     * Read file with LRU caching.
     */
    async _readFileCached(filePath) {
        if (this._fileContentCache.has(filePath)) {
            // Move to end (most recently used)
            let content = this._fileContentCache.get(filePath);
            this._fileContentCache.delete(filePath);
            this._fileContentCache.set(filePath, content);
            return content;
        }

        try {
            let text = await fs.promises.readFile(filePath, 'utf8');
            this._fileContentCache.set(filePath, text);

            // Evict oldest if over capacity
            if (this._fileContentCache.size > FILE_CONTENT_CACHE_SIZE) {
                let firstKey = this._fileContentCache.keys().next().value;
                this._fileContentCache.delete(firstKey);
            }

            return text;
        } catch {
            return null;
        }
    }

    pushIndex(index, key, value) {
        if (!index.has(key)) {
            index.set(key, [value]);
            return;
        }

        index.get(key).push(value);
    }

    pullIndex(index, key, value) {
        if (!index.has(key)) {
            return;
        }

        let filtered = index.get(key).filter((item) => {
            return !(item.filePath === value.filePath && item.line === value.line && item.kind === value.kind);
        });

        if (filtered.length === 0) {
            index.delete(key);
            return;
        }

        index.set(key, filtered);
    }

    parseDocument(filePath, text) {
        let lineOffsets = this.computeLineOffsets(text);
        let context = this.parseNamespaceAndImports(text);

        let symbols = [];
        let classBlocks = [];

        const classRegex = /^\s*(?:abstract\s+|final\s+)?(class|interface|trait)\s+([A-Za-z_\x7f-\xff][A-Za-z0-9_\x7f-\xff]*)\b/gm;
        let classMatch;
        while ((classMatch = classRegex.exec(text)) !== null) {
            let classType = classMatch[1];
            let className = classMatch[2];
            let fqcn = context.namespace ? context.namespace + '\\' + className : className;
            let openBrace = text.indexOf('{', classMatch.index);
            let header = openBrace === -1 ? '' : text.slice(classMatch.index, openBrace);
            let parents = this.extractClassParentsFromHeader(header, context);

            symbols.push({
                kind: 'class',
                classType,
                name: className,
                fqcn,
                parents,
                filePath,
                line: this.offsetToLine(lineOffsets, classMatch.index),
            });

            if (openBrace !== -1) {
                let closeBrace = this.findMatchingBrace(text, openBrace);
                if (closeBrace !== -1) {
                    classBlocks.push({
                        fqcn,
                        start: openBrace,
                        end: closeBrace,
                    });
                }
            }
        }

        const functionRegex = /^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_\x7f-\xff][A-Za-z0-9_\x7f-\xff]*)\s*\(/gm;
        let functionMatch;
        while ((functionMatch = functionRegex.exec(text)) !== null) {
            let fnName = functionMatch[1];
            let block = classBlocks.find((item) => functionMatch.index > item.start && functionMatch.index < item.end);

            if (block) {
                symbols.push({
                    kind: 'method',
                    name: fnName,
                    classFqcn: block.fqcn,
                    methodKey: block.fqcn + '::' + fnName,
                    filePath,
                    line: this.offsetToLine(lineOffsets, functionMatch.index),
                });
            } else {
                let fqfn = context.namespace ? context.namespace + '\\' + fnName : fnName;
                symbols.push({
                    kind: 'function',
                    name: fnName,
                    fqfn,
                    filePath,
                    line: this.offsetToLine(lineOffsets, functionMatch.index),
                });
            }
        }

        return {
            namespace: context.namespace,
            imports: context.imports,
            symbols,
        };
    }

    extractClassParentsFromHeader(header, context) {
        if (!header) {
            return [];
        }

        let out = [];

        let extendsMatch = header.match(/\bextends\s+([^\{]+)/i);
        if (extendsMatch && extendsMatch[1]) {
            let extendsPart = extendsMatch[1].split(/\bimplements\b/i)[0];
            let parents = extendsPart.split(',').map((value) => value.trim()).filter(Boolean);
            for (let parent of parents) {
                let candidates = this.resolveClassCandidates(parent, context);
                if (candidates.length > 0) {
                    out.push(candidates[0]);
                }
            }
        }

        let implementsMatch = header.match(/\bimplements\s+([^\{]+)/i);
        if (implementsMatch && implementsMatch[1]) {
            let parents = implementsMatch[1].split(',').map((value) => value.trim()).filter(Boolean);
            for (let parent of parents) {
                let candidates = this.resolveClassCandidates(parent, context);
                if (candidates.length > 0) {
                    out.push(candidates[0]);
                }
            }
        }

        return this.uniqueStrings(out.map((name) => String(name || '').replace(/^\\+/, '')));
    }

    parseNamespaceAndImports(text) {
        let namespace = '';
        let imports = {};

        let namespaceMatch = text.match(/^\s*namespace\s+([^;{]+)\s*[;{]/m);
        if (namespaceMatch && namespaceMatch[1]) {
            namespace = namespaceMatch[1].trim().replace(/^\\+/, '').replace(/\\+$/, '');
        }

        const useRegex = /^\s*use\s+(?!function\b)(?!const\b)([^;]+);/gm;
        let useMatch;

        while ((useMatch = useRegex.exec(text)) !== null) {
            let statement = useMatch[1].trim();
            for (let resolved of this.expandUseStatement(statement)) {
                let fqcn = resolved.fqcn.replace(/^\\+/, '').trim();
                if (!fqcn) {
                    continue;
                }

                let alias = resolved.alias;
                if (!alias) {
                    alias = fqcn.split('\\').pop();
                }

                imports[alias.toLowerCase()] = fqcn;
            }
        }

        return {
            namespace,
            imports,
        };
    }

    expandUseStatement(statement) {
        let out = [];

        if (statement.includes('{') && statement.includes('}')) {
            let braceStart = statement.indexOf('{');
            let braceEnd = statement.indexOf('}', braceStart + 1);
            if (braceStart > -1 && braceEnd > braceStart) {
                let prefix = statement.slice(0, braceStart).trim().replace(/\\+$/, '');
                let inner = statement.slice(braceStart + 1, braceEnd);
                let segments = inner.split(',').map((item) => item.trim()).filter(Boolean);

                for (let segment of segments) {
                    let parsed = this.parseUseSegment(segment);
                    if (parsed) {
                        out.push({
                            fqcn: prefix + '\\' + parsed.fqcn,
                            alias: parsed.alias,
                        });
                    }
                }
            }

            return out;
        }

        let parts = statement.split(',').map((item) => item.trim()).filter(Boolean);
        for (let part of parts) {
            let parsed = this.parseUseSegment(part);
            if (parsed) {
                out.push(parsed);
            }
        }

        return out;
    }

    parseUseSegment(segment) {
        let aliasMatch = segment.match(/^(.*?)\s+as\s+([A-Za-z_\x7f-\xff][A-Za-z0-9_\x7f-\xff]*)$/i);
        if (aliasMatch) {
            return {
                fqcn: aliasMatch[1].trim(),
                alias: aliasMatch[2].trim(),
            };
        }

        return {
            fqcn: segment.trim(),
            alias: null,
        };
    }

    computeLineOffsets(text) {
        let offsets = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
                offsets.push(i + 1);
            }
        }

        return offsets;
    }

    offsetToLine(lineOffsets, offset) {
        let low = 0;
        let high = lineOffsets.length - 1;

        while (low <= high) {
            let mid = (low + high) >> 1;
            if (lineOffsets[mid] <= offset) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return Math.max(1, high + 1);
    }

    findMatchingBrace(text, openIndex) {
        let depth = 0;
        for (let i = openIndex; i < text.length; i++) {
            let ch = text[i];
            if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }

        return -1;
    }

    getAllSymbolRecords() {
        let out = [];
        for (let entry of this.fileEntries.values()) {
            if (!entry || !Array.isArray(entry.symbols)) {
                continue;
            }

            for (let symbol of entry.symbols) {
                out.push(symbol);
            }
        }

        return out;
    }

    findRecordByLocation(location) {
        if (!location || !location.uri || !location.range) {
            return null;
        }

        let filePath = location.uri.fsPath;
        let line = location.range.start.line + 1;
        let entry = this.fileEntries.get(filePath);
        if (!entry || !Array.isArray(entry.symbols)) {
            return null;
        }

        return entry.symbols.find((item) => item.line === line) || null;
    }

    getRecordDisplayName(record) {
        if (record.kind === 'class') {
            return record.fqcn || record.name;
        }

        if (record.kind === 'function') {
            return record.fqfn || record.name;
        }

        if (record.kind === 'method') {
            return (record.classFqcn || '<class>') + '::' + record.name;
        }

        return record.name || '<symbol>';
    }

    getRecordContainerName(record) {
        if (record.kind === 'method') {
            return record.classFqcn || '';
        }

        if (record.kind === 'class' && record.fqcn && record.fqcn.includes('\\')) {
            let parts = record.fqcn.split('\\');
            parts.pop();
            return parts.join('\\');
        }

        if (record.kind === 'function' && record.fqfn && record.fqfn.includes('\\')) {
            let parts = record.fqfn.split('\\');
            parts.pop();
            return parts.join('\\');
        }

        return '';
    }

    mapRecordToSymbolKind(record) {
        if (record.kind === 'class') {
            return vscode.SymbolKind.Class;
        }

        if (record.kind === 'method') {
            return vscode.SymbolKind.Method;
        }

        if (record.kind === 'function') {
            return vscode.SymbolKind.Function;
        }

        return vscode.SymbolKind.Variable;
    }

    async getDeclarationLine(filePath, lineNumber) {
        let text = await this._readFileCached(filePath);
        if (!text) return '';

        let lines = text.split(/\r?\n/);
        let index = Math.max(0, lineNumber - 1);
        if (index >= lines.length) {
            return '';
        }

        return lines[index];
    }

    buildReferenceRegexes(record) {
        let out = [];

        if (record.kind === 'class') {
            let shortName = this.escapeRegex(record.name);
            let fqcn = this.escapeRegex((record.fqcn || '').replace(/^\\+/, ''));

            out.push(new RegExp('\\b' + shortName + '\\b', 'g'));
            if (fqcn) {
                out.push(new RegExp('\\\\' + fqcn + '\\b', 'g'));
            }
            return out;
        }

        if (record.kind === 'function') {
            let name = this.escapeRegex(record.name);
            let fqfn = this.escapeRegex((record.fqfn || '').replace(/^\\+/, ''));

            out.push(new RegExp('\\b' + name + '\\s*\\(', 'g'));
            if (fqfn) {
                out.push(new RegExp('\\\\' + fqfn + '\\s*\\(', 'g'));
            }
            // WordPress hook array callbacks: [..., 'functionName']
            out.push(new RegExp('\\[\\s*[^\\]]*,\\s*[\'"]' + name + '[\'"]\\s*\\]', 'g'));
            // WordPress hook string callbacks: add_action('hook', 'functionName')
            out.push(new RegExp('(?:add_action|add_filter)\\s*\\([^,]+,\\s*[\'"]' + name + '[\'"]', 'g'));
            return out;
        }

        if (record.kind === 'method') {
            let method = this.escapeRegex(record.name);
            out.push(new RegExp('::\\s*' + method + '\\s*\\(', 'g'));
            out.push(new RegExp('->\\s*' + method + '\\s*\\(', 'g'));
            out.push(new RegExp('\\bfunction\\s+&?\\s*' + method + '\\s*\\(', 'g'));
            // WordPress hook array callbacks: add_action/add_filter('...', [..., 'method'])
            out.push(new RegExp('\\[\\s*[^\\]]*,\\s*[\'"]' + method + '[\'"]\\s*\\]', 'g'));
            return out;
        }

        return out;
    }

    findRegexLocationsInText(filePath, text, regexes) {
        if (!regexes || regexes.length === 0) {
            return [];
        }

        let lineOffsets = this.computeLineOffsets(text);
        let ignoredRanges = this.computeIgnoredRanges(text);
        let locations = [];

        for (let regex of regexes) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                let startOffset = match.index;
                let endOffset = match.index + Math.max(1, match[0].length);

                if (this.isOffsetInRanges(startOffset, ignoredRanges)) {
                    if (match.index === regex.lastIndex) {
                        regex.lastIndex++;
                    }
                    continue;
                }

                let start = this.offsetToPosition(lineOffsets, startOffset);
                let end = this.offsetToPosition(lineOffsets, endOffset);

                locations.push(new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Range(start, end)
                ));

                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
            }
        }

        return locations;
    }

    computeIgnoredRanges(text) {
        let ranges = [];
        let i = 0;

        while (i < text.length) {
            let ch = text[i];
            let next = i + 1 < text.length ? text[i + 1] : '';

            if (ch === '/' && next === '/') {
                let start = i;
                i += 2;
                while (i < text.length && text[i] !== '\n') {
                    i++;
                }
                ranges.push([start, i]);
                continue;
            }

            if (ch === '/' && next === '*') {
                let start = i;
                i += 2;
                while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                    i++;
                }
                i = Math.min(text.length, i + 2);
                ranges.push([start, i]);
                continue;
            }

            if (ch === '#' ) {
                let start = i;
                i += 1;
                while (i < text.length && text[i] !== '\n') {
                    i++;
                }
                ranges.push([start, i]);
                continue;
            }

            if (ch === '"' || ch === "'") {
                let quote = ch;
                let start = i;
                i++;
                while (i < text.length) {
                    if (text[i] === '\\') {
                        i += 2;
                        continue;
                    }

                    if (text[i] === quote) {
                        i++;
                        break;
                    }

                    i++;
                }
                ranges.push([start, i]);
                continue;
            }

            i++;
        }

        return ranges;
    }

    isOffsetInRanges(offset, ranges) {
        let low = 0;
        let high = ranges.length - 1;
        while (low <= high) {
            let mid = (low + high) >> 1;
            if (offset < ranges[mid][0]) {
                high = mid - 1;
            } else if (offset >= ranges[mid][1]) {
                low = mid + 1;
            } else {
                return true;
            }
        }
        return false;
    }

    dedupeLocations(locations) {
        let out = [];
        let seen = new Set();

        for (let loc of locations) {
            let key = loc.uri.fsPath + ':' + loc.range.start.line;

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            out.push(loc);
        }

        return out;
    }

    offsetToPosition(lineOffsets, offset) {
        let line = this.offsetToLine(lineOffsets, offset) - 1;
        let lineStart = lineOffsets[Math.max(0, line)] || 0;
        let character = Math.max(0, offset - lineStart);

        return new vscode.Position(line, character);
    }

    escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    shouldTrackFile(filePath) {
        if (!this.shouldIncludeVendor() && this.isVendorPath(filePath)) {
            return false;
        }

        return true;
    }

    shouldIncludeVendor() {
        return config('definitionIncludeVendor') !== false;
    }

    isVendorPath(filePath) {
        return filePath.split(path.sep).includes('vendor');
    }

    isNoopLikePath(filePath) {
        let normalized = String(filePath || '').replace(/\\\\/g, '/').toLowerCase();
        if (!normalized.endsWith('/noop.php') && !normalized.endsWith('noop.php')) {
            return false;
        }

        return normalized.includes('/wp-admin/') || normalized.includes('/wp-includes/');
    }

    getExcludePattern() {
        let exclude = config('exclude');
        if (typeof exclude === 'string' && exclude.trim() !== '') {
            return exclude;
        }

        return '**/node_modules/**';
    }

    shouldPersistCache() {
        return config('definitionUsePersistentCache') !== false;
    }

    getCachePath() {
        if (!this.context || !this.context.globalStorageUri) {
            return null;
        }

        return path.join(this.context.globalStorageUri.fsPath, CACHE_FILE);
    }

    async ensureStorageFolder() {
        if (!this.context || !this.context.globalStorageUri) {
            return;
        }

        await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    }

    async loadCache() {
        if (!this.shouldPersistCache()) {
            return;
        }

        let cachePath = this.getCachePath();
        if (!cachePath) {
            return;
        }

        try {
            let raw = await fs.promises.readFile(cachePath, 'utf8');
            let cache = JSON.parse(raw);

            if (!cache || cache.version !== CACHE_VERSION || !Array.isArray(cache.files)) {
                return;
            }

            this.fileEntries.clear();
            this.classIndex.clear();
            this.shortClassIndex.clear();
            this.functionIndex.clear();
            this.shortFunctionIndex.clear();
            this.methodIndex.clear();
            this.shortMethodIndex.clear();
            this.tokenToFiles.clear();
            this.parentToChildren.clear();
            this._allClassRecordsDirty = true;
            this._fileContentCache.clear();
            this._workspaceFolderCache.clear();

            for (let entry of cache.files) {
                if (!entry || !entry.filePath || !Array.isArray(entry.symbols)) {
                    continue;
                }

                this.fileEntries.set(entry.filePath, entry);
                this.addEntryToIndexes(entry);
            }

            this.log('Loaded definition index cache', 'INFO');
        } catch {
            // Cache is optional; ignore malformed or missing files.
        }
    }

    scheduleFlushCache() {
        if (!this.shouldPersistCache()) {
            return;
        }

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }

        this.flushTimer = setTimeout(async () => {
            this.flushTimer = null;
            await this.saveCache();
        }, 500);
    }

    async saveCache() {
        if (!this.shouldPersistCache()) {
            return;
        }

        let cachePath = this.getCachePath();
        if (!cachePath) {
            return;
        }

        try {
            await this.ensureStorageFolder();

            let files = [...this.fileEntries.values()];
            let payload = {
                version: CACHE_VERSION,
                generatedAt: Date.now(),
                files,
            };

            await fs.promises.writeFile(cachePath, JSON.stringify(payload), 'utf8');
        } catch {
            // Silent failure: cache persistence should never block core functionality.
        }
    }

    async deleteCacheFile() {
        let cachePath = this.getCachePath();
        if (!cachePath) {
            return;
        }

        try {
            await fs.promises.unlink(cachePath);
        } catch {
            // Ignore missing cache files.
        }
    }

    async canResolveToken(document, position, token) {
        await this.waitUntilReady();

        let context = this.parseNamespaceAndImports(document.getText());

        // PHP class resolution rules:
        // 1. If imported via use statement, resolves to the imported FQCN
        // 2. If in a namespace, resolves to namespace\token (same namespace only)
        // 3. If NOT in a namespace, resolves to bare token (global)
        // PHP does NOT fall back to global for unqualified class names in a namespace.

        let imported = context.imports[token.toLowerCase()];
        if (imported) {
            let records = this.classIndex.get(imported.toLowerCase()) || [];
            if (records.length > 0) return true;
        }

        if (context.namespace) {
            let fqcn = context.namespace + '\\' + token;
            let records = this.classIndex.get(fqcn.toLowerCase()) || [];
            if (records.length > 0) return true;
        } else {
            let records = this.classIndex.get(token.toLowerCase()) || [];
            if (records.length > 0) return true;
        }

        return false;
    }

    async findAvailableClassesNamed(className) {
        await this.waitUntilReady();

        let normalized = String(className || '').replace(/^\\+/, '');
        let shortKey = normalized.split('\\').pop().toLowerCase();

        let matches = [];
        let shortMatches = this.shortClassIndex.get(shortKey) || [];

        for (let record of shortMatches) {
            if (record.kind === 'class') {
                matches.push(record);
            }
        }

        return matches.slice(0, 10);
    }

    log(message, level = 'INFO') {
        if (this.logger && typeof this.logger.logMessage === 'function') {
            this.logger.logMessage('DefinitionIndex - ' + message, level);
        }
    }
}

module.exports = PHPDefinitionIndex;