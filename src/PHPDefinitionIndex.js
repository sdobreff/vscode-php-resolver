let vscode = require('vscode');
let fs = require('fs');
let path = require('path');
let crypto = require('crypto');
let { config } = require('./Helpers');

const CACHE_VERSION = 1;
const CACHE_FILE = 'php-definition-index-cache.json';

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

        let sorted = [...records].sort((a, b) => {
            let folderA = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(a.filePath));
            let folderB = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(b.filePath));

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
            let hash = crypto.createHash('sha1').update(text).digest('hex');

            if (existing && existing.hash === hash) {
                existing.mtimeMs = stat.mtimeMs;
                existing.size = stat.size;
                this.fileEntries.set(filePath, existing);
                return;
            }

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
            } else if (symbol.kind === 'function') {
                this.pushIndex(this.functionIndex, symbol.fqfn.toLowerCase(), symbol);
                this.pushIndex(this.shortFunctionIndex, symbol.name.toLowerCase(), symbol);
            } else if (symbol.kind === 'method') {
                this.pushIndex(this.methodIndex, symbol.methodKey.toLowerCase(), symbol);
                this.pushIndex(this.shortMethodIndex, symbol.name.toLowerCase(), symbol);
            }
        }
    }

    removeEntryFromIndexes(entry) {
        for (let symbol of entry.symbols) {
            if (symbol.kind === 'class') {
                this.pullIndex(this.classIndex, symbol.fqcn.toLowerCase(), symbol);
                this.pullIndex(this.shortClassIndex, symbol.name.toLowerCase(), symbol);
            } else if (symbol.kind === 'function') {
                this.pullIndex(this.functionIndex, symbol.fqfn.toLowerCase(), symbol);
                this.pullIndex(this.shortFunctionIndex, symbol.name.toLowerCase(), symbol);
            } else if (symbol.kind === 'method') {
                this.pullIndex(this.methodIndex, symbol.methodKey.toLowerCase(), symbol);
                this.pullIndex(this.shortMethodIndex, symbol.name.toLowerCase(), symbol);
            }
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
            let className = classMatch[2];
            let fqcn = context.namespace ? context.namespace + '\\' + className : className;

            symbols.push({
                kind: 'class',
                name: className,
                fqcn,
                filePath,
                line: this.offsetToLine(lineOffsets, classMatch.index),
            });

            let openBrace = text.indexOf('{', classMatch.index);
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

        const functionRegex = /^\s*(?:public|protected|private|static|final|abstract\s+)*function\s+&?\s*([A-Za-z_\x7f-\xff][A-Za-z0-9_\x7f-\xff]*)\s*\(/gm;
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

    log(message, level = 'INFO') {
        if (this.logger && typeof this.logger.logMessage === 'function') {
            this.logger.logMessage('DefinitionIndex - ' + message, level);
        }
    }
}

module.exports = PHPDefinitionIndex;