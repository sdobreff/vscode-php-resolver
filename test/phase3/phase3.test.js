/**
 * Phase 3 tests — Call Hierarchy, WordPress Hooks, Index Health.
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;

function makeVscodeStub() {
    class Position {
        constructor(line, character) { this.line = line; this.character = character; }
    }
    class Range {
        constructor(a, b, c, d) {
            if (a instanceof Position) { this.start = a; this.end = b; }
            else { this.start = new Position(a, b); this.end = new Position(c, d); }
        }
    }
    class Location {
        constructor(uri, rangeOrPos) {
            this.uri = uri;
            this.range = rangeOrPos instanceof Position
                ? new Range(rangeOrPos, rangeOrPos) : rangeOrPos;
        }
    }
    class SymbolInformation {
        constructor(name, kind, containerName, location) {
            this.name = name; this.kind = kind;
            this.containerName = containerName; this.location = location;
        }
    }
    class MarkdownString {
        constructor() { this.value = ''; }
        appendCodeblock(t) { this.value += String(t || ''); }
        appendMarkdown(t) { this.value += String(t || ''); }
    }
    class Hover { constructor(c, r) { this.contents = c; this.range = r; } }
    class WorkspaceEdit {
        constructor() { this.edits = []; }
        replace(uri, range, text) { this.edits.push({ uri, range, text }); }
        insert(uri, pos, text) { this.edits.push({ uri, pos, text }); }
    }
    class CallHierarchyItem {
        constructor(kind, name, detail, uri, range, selectionRange) {
            this.kind = kind; this.name = name; this.detail = detail;
            this.uri = uri; this.range = range; this.selectionRange = selectionRange;
        }
    }
    class CallHierarchyIncomingCall {
        constructor(from, fromRanges) { this.from = from; this.fromRanges = fromRanges; }
    }
    class CallHierarchyOutgoingCall {
        constructor(to, fromRanges) { this.to = to; this.fromRanges = fromRanges; }
    }
    class Diagnostic {
        constructor(range, message, severity) {
            this.range = range; this.message = message; this.severity = severity;
            this.source = '';
        }
    }
    return {
        Position, Range, Location, SymbolInformation,
        SymbolKind: { Class: 4, Method: 6, Function: 11, Variable: 13 },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        MarkdownString, Hover, WorkspaceEdit,
        CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall,
        Diagnostic,
        StatusBarAlignment: { Left: 1, Right: 2 },
        Uri: { file(fp) { return { fsPath: fp }; } },
        window: {
            createOutputChannel() { return { appendLine() {}, show() {}, clear() {}, dispose() {} }; },
            createStatusBarItem() {
                return { text: '', tooltip: '', command: '', show() {}, hide() {}, dispose() {} };
            },
            get visibleTextEditors() { return []; },
            onDidChangeActiveTextEditor() { return { dispose() {} }; },
        },
        workspace: {
            getConfiguration() { return { get() { return true; } }; },
            getWorkspaceFolder() { return null; },
            async findFiles() { return []; },
            createFileSystemWatcher() {
                return { onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} };
            },
            onDidOpenTextDocument() { return { dispose() {} }; },
            onDidChangeTextDocument() { return { dispose() {} }; },
            onDidSaveTextDocument() { return { dispose() {} }; },
        },
        languages: {
            createDiagnosticCollection() { return { set() {}, clear() {}, dispose() {} }; },
            registerCodeActionsProvider() { return { dispose() {} }; },
            registerCallHierarchyProvider() { return { dispose() {} }; },
            registerDefinitionProvider() { return { dispose() {} }; },
        },
        CodeActionKind: { QuickFix: 'quickfix' },
    };
}

Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return makeVscodeStub();
    return originalLoad(request, parent, isMain);
};

const PHPDefinitionIndex = require('../../src/PHPDefinitionIndex');
const PHPWordPressHookProvider = require('../../src/PHPWordPressHookProvider');
const PHPIndexHealthProvider = require('../../src/PHPIndexHealthProvider');
const PHPCallHierarchyProvider = require('../../src/PHPCallHierarchyProvider');
const PHPWorkspaceDiagnosticsProvider = require('../../src/PHPWorkspaceDiagnosticsProvider');
const PHPIndexBenchmark = require('../../src/PHPIndexBenchmark');

let passed = 0;
let failed = 0;
function ok(condition, label) {
    if (condition) { passed++; }
    else { failed++; console.error('FAIL: ' + label); }
}
function eq(actual, expected, label) {
    if (actual === expected) { passed++; }
    else { failed++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')'); }
}

async function run() {
    const index = new PHPDefinitionIndex({}, null);

    // =========================================================
    // 1. WordPress Hook extractHookInfo
    // =========================================================
    {
        let wp = new PHPWordPressHookProvider(index);

        let info1 = wp.extractHookInfo("add_action( 'init', 'my_func' );", 15);
        ok(info1 !== null, 'extractHookInfo detects add_action');
        eq(info1.hookType, 'add_action', 'hookType is add_action');
        eq(info1.hookName, 'init', 'hookName is init');

        let info2 = wp.extractHookInfo('apply_filters( "the_content", $content );', 20);
        ok(info2 !== null, 'extractHookInfo detects apply_filters');
        eq(info2.hookType, 'apply_filters', 'hookType is apply_filters');
        eq(info2.hookName, 'the_content', 'hookName is the_content');

        let info3 = wp.extractHookInfo("do_action( 'wp_head' );", 10);
        ok(info3 !== null, 'extractHookInfo detects do_action');
        eq(info3.hookType, 'do_action', 'hookType is do_action');
        eq(info3.hookName, 'wp_head', 'hookName is wp_head');

        let info4 = wp.extractHookInfo("add_filter( 'the_title', 'my_title' );", 15);
        ok(info4 !== null, 'extractHookInfo detects add_filter');
        eq(info4.hookType, 'add_filter', 'hookType is add_filter');
        eq(info4.hookName, 'the_title', 'hookName is the_title');

        // cursor outside hook call
        let info5 = wp.extractHookInfo("$x = 42; add_action( 'init', 'f' );", 3);
        ok(info5 === null, 'extractHookInfo returns null when cursor is outside');

        // No hook on line
        let info6 = wp.extractHookInfo("echo 'hello';", 5);
        ok(info6 === null, 'extractHookInfo returns null for non-hook lines');
    }

    // =========================================================
    // 2. WordPress Hook getSearchPatterns
    // =========================================================
    {
        let wp = new PHPWordPressHookProvider(index);

        let p1 = wp.getSearchPatterns('add_action', 'init');
        ok(p1.length > 0, 'getSearchPatterns for add_action returns patterns');
        ok(p1.some(r => r.source.includes('do_action')), 'add_action pattern searches for do_action');

        let p2 = wp.getSearchPatterns('do_action', 'wp_head');
        ok(p2.length > 0, 'getSearchPatterns for do_action returns patterns');
        ok(p2.some(r => r.source.includes('add_action')), 'do_action pattern searches for add_action');

        let p3 = wp.getSearchPatterns('add_filter', 'the_title');
        ok(p3.some(r => r.source.includes('apply_filters')), 'add_filter pattern searches for apply_filters');

        let p4 = wp.getSearchPatterns('apply_filters', 'the_content');
        ok(p4.some(r => r.source.includes('add_filter')), 'apply_filters pattern searches for add_filter');
    }

    // =========================================================
    // 3. Index Health getStats
    // =========================================================
    {
        let health = new PHPIndexHealthProvider(index, null);

        // Empty index
        let stats0 = health.getStats();
        eq(stats0.files, 0, 'empty index has 0 files');
        eq(stats0.classes, 0, 'empty index has 0 classes');
        eq(stats0.functions, 0, 'empty index has 0 functions');
        eq(stats0.methods, 0, 'empty index has 0 methods');

        // Inject some data
        index.fileEntries = new Map();
        index.fileEntries.set('/fake/A.php', {
            namespace: 'App',
            symbols: [
                { kind: 'class', classType: 'class', name: 'A', fqcn: 'App\\A' },
                { kind: 'method', name: 'run', classFqcn: 'App\\A', methodKey: 'App\\A::run' },
            ],
        });
        index.fileEntries.set('/fake/B.php', {
            namespace: 'App',
            symbols: [
                { kind: 'class', classType: 'interface', name: 'B', fqcn: 'App\\B' },
                { kind: 'function', name: 'helper', fqfn: 'App\\helper' },
            ],
        });
        index.fileEntries.set('/fake/C.php', {
            namespace: 'App',
            symbols: [
                { kind: 'class', classType: 'trait', name: 'C', fqcn: 'App\\C' },
            ],
        });

        let stats1 = health.getStats();
        eq(stats1.files, 3, 'injected index has 3 files');
        eq(stats1.classes, 3, 'injected index has 3 classes');
        eq(stats1.interfaces, 1, 'injected index has 1 interface');
        eq(stats1.traits, 1, 'injected index has 1 trait');
        eq(stats1.functions, 1, 'injected index has 1 function');
        eq(stats1.methods, 1, 'injected index has 1 method');
    }

    // =========================================================
    // 4. Index Health showHealthReport
    // =========================================================
    {
        let health = new PHPIndexHealthProvider(index, null);
        let report = health.showHealthReport();

        ok(typeof report === 'string', 'showHealthReport returns a string');
        ok(report.includes('Files indexed'), 'report includes file count');
        ok(report.includes('Classes'), 'report includes class count');
        ok(report.includes('Methods'), 'report includes method count');
        ok(report.includes('Top namespaces'), 'report includes top namespaces');
    }

    // =========================================================
    // 5. Call Hierarchy — isLanguageConstruct
    // =========================================================
    {
        let ch = new PHPCallHierarchyProvider(index);

        ok(ch.isLanguageConstruct('if'), 'if is language construct');
        ok(ch.isLanguageConstruct('foreach'), 'foreach is language construct');
        ok(ch.isLanguageConstruct('echo'), 'echo is language construct');
        ok(ch.isLanguageConstruct('isset'), 'isset is language construct');
        ok(ch.isLanguageConstruct('require_once'), 'require_once is language construct');
        ok(!ch.isLanguageConstruct('myFunction'), 'myFunction is not language construct');
        ok(!ch.isLanguageConstruct('addAction'), 'addAction is not language construct');
    }

    // =========================================================
    // 6. Call Hierarchy — buildCallRegexes
    // =========================================================
    {
        let ch = new PHPCallHierarchyProvider(index);
        let vscode = makeVscodeStub();

        let methodItem = { kind: vscode.SymbolKind.Method, name: 'process' };
        let methodRegexes = ch.buildCallRegexes('process', methodItem);
        ok(methodRegexes.length === 2, 'method call regexes has 2 patterns (:: and ->)');
        ok(methodRegexes[0].test('Foo::process('), ':: pattern matches');
        ok(methodRegexes[1].test('$obj->process('), '-> pattern matches');

        let funcItem = { kind: vscode.SymbolKind.Function, name: 'helper' };
        let funcRegexes = ch.buildCallRegexes('helper', funcItem);
        ok(funcRegexes.length === 1, 'function call regexes has 1 pattern');
        ok(funcRegexes[0].test('helper('), 'function pattern matches');
    }

    // =========================================================
    // 7. Call Hierarchy — deduplication
    // =========================================================
    {
        let ch = new PHPCallHierarchyProvider(index);
        let vscode = makeVscodeStub();

        let item1 = new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function, 'foo', '', vscode.Uri.file('/a.php'),
            new vscode.Range(0, 0, 0, 0), new vscode.Range(0, 0, 0, 0)
        );
        let item2 = new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function, 'foo', '', vscode.Uri.file('/a.php'),
            new vscode.Range(0, 0, 0, 0), new vscode.Range(0, 0, 0, 0)
        );
        let range1 = new vscode.Range(5, 0, 5, 3);
        let range2 = new vscode.Range(10, 0, 10, 3);

        let calls = [
            new vscode.CallHierarchyIncomingCall(item1, [range1]),
            new vscode.CallHierarchyIncomingCall(item2, [range2]),
        ];

        let deduped = ch.dedupeIncomingCalls(calls);
        eq(deduped.length, 1, 'duplicate incoming calls deduped to 1');
        eq(deduped[0].fromRanges.length, 2, 'merged fromRanges has 2 entries');
    }

    // =========================================================
    // 8. Workspace Diagnostics — duplicate class detection
    // =========================================================
    {
        let diagIndex = new PHPDefinitionIndex({}, null);
        diagIndex._initPromise = Promise.resolve();
        diagIndex._ready = true;
        diagIndex.fileEntries = new Map();
        diagIndex.classIndex = new Map();
        diagIndex.shortClassIndex = new Map();
        diagIndex.functionIndex = new Map();
        diagIndex.shortFunctionIndex = new Map();
        diagIndex.methodIndex = new Map();
        diagIndex.shortMethodIndex = new Map();

        // Two classes with same FQCN in different non-vendor files
        let rec1 = { kind: 'class', name: 'User', fqcn: 'App\\User', filePath: '/src/User.php', line: 5 };
        let rec2 = { kind: 'class', name: 'User', fqcn: 'App\\User', filePath: '/src/Models/User.php', line: 10 };
        diagIndex.classIndex.set('app\\user', [rec1, rec2]);

        diagIndex.fileEntries.set('/src/User.php', {
            symbols: [rec1],
        });
        diagIndex.fileEntries.set('/src/Models/User.php', {
            symbols: [rec2],
        });

        let wp = new PHPWorkspaceDiagnosticsProvider(diagIndex, null);
        let count = await wp.runFullScan();

        ok(count >= 2, 'duplicate class scan found at least 2 diagnostics');
        wp.dispose();
    }

    // =========================================================
    // 9. Workspace Diagnostics — unresolved parent detection
    // =========================================================
    {
        let diagIndex = new PHPDefinitionIndex({}, null);
        diagIndex._initPromise = Promise.resolve();
        diagIndex._ready = true;
        diagIndex.fileEntries = new Map();
        diagIndex.classIndex = new Map();
        diagIndex.shortClassIndex = new Map();
        diagIndex.functionIndex = new Map();
        diagIndex.shortFunctionIndex = new Map();
        diagIndex.methodIndex = new Map();
        diagIndex.shortMethodIndex = new Map();

        let child = { kind: 'class', name: 'Child', fqcn: 'App\\Child', filePath: '/src/Child.php', line: 3, parents: ['App\\NonExistent'] };
        diagIndex.classIndex.set('app\\child', [child]);
        diagIndex.fileEntries.set('/src/Child.php', { symbols: [child] });

        let wp = new PHPWorkspaceDiagnosticsProvider(diagIndex, null);
        let count = await wp.runFullScan();

        ok(count >= 1, 'unresolved parent scan found at least 1 diagnostic');
        wp.dispose();
    }

    // =========================================================
    // 10. Workspace Diagnostics — no false positives on vendor
    // =========================================================
    {
        let diagIndex = new PHPDefinitionIndex({}, null);
        diagIndex._initPromise = Promise.resolve();
        diagIndex._ready = true;
        diagIndex.fileEntries = new Map();
        diagIndex.classIndex = new Map();
        diagIndex.shortClassIndex = new Map();
        diagIndex.functionIndex = new Map();
        diagIndex.shortFunctionIndex = new Map();
        diagIndex.methodIndex = new Map();
        diagIndex.shortMethodIndex = new Map();

        // Duplicate in vendor should not trigger
        let rec1 = { kind: 'class', name: 'Logger', fqcn: 'Monolog\\Logger', filePath: '/vendor/monolog/Logger.php', line: 5 };
        let rec2 = { kind: 'class', name: 'Logger', fqcn: 'Monolog\\Logger', filePath: '/src/Logger.php', line: 10 };
        diagIndex.classIndex.set('monolog\\logger', [rec1, rec2]);

        diagIndex.fileEntries.set('/vendor/monolog/Logger.php', { symbols: [rec1] });
        diagIndex.fileEntries.set('/src/Logger.php', { symbols: [rec2] });

        let wp = new PHPWorkspaceDiagnosticsProvider(diagIndex, null);
        let count = await wp.runFullScan();

        eq(count, 0, 'no duplicate warnings when one copy is in vendor');
        wp.dispose();
    }

    // =========================================================
    // 11. Benchmark — formatBytes
    // =========================================================
    {
        let bench = new PHPIndexBenchmark(index, null);

        eq(bench.formatBytes(500), '500 B', 'formatBytes for small values');
        eq(bench.formatBytes(2048), '2.0 KB', 'formatBytes for KB');
        eq(bench.formatBytes(1048576), '1.0 MB', 'formatBytes for MB');
        eq(bench.formatBytes(5242880), '5.0 MB', 'formatBytes for 5MB');
    }

    // =========================================================
    // 12. Benchmark — estimateMemoryUsage
    // =========================================================
    {
        let bench = new PHPIndexBenchmark(index, null);
        let mem = bench.estimateMemoryUsage();

        ok(typeof mem === 'number', 'estimateMemoryUsage returns a number');
        ok(mem > 0, 'estimateMemoryUsage is positive for non-empty index');
    }

    // =========================================================
    // 13. Benchmark — countIndexEntries
    // =========================================================
    {
        let bench = new PHPIndexBenchmark(index, null);
        let fakeIndex = new Map();
        fakeIndex.set('a', [{ name: '1' }, { name: '2' }]);
        fakeIndex.set('b', [{ name: '3' }]);

        eq(bench.countIndexEntries(fakeIndex), 3, 'countIndexEntries counts all records');
    }

    // =========================================================
    // Summary
    // =========================================================
    console.log('');
    console.log('Phase 3 tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) {
        process.exit(1);
    }
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
