/**
 * Phase 2 regression tests — rename safety + implementation edge-cases.
 *
 * Covers:
 *   - isValidPhpIdentifier edge-cases
 *   - findClosestWordIndex positioning
 *   - Rename scope restriction (method blocked, class/function allowed)
 *   - parseDocument inheritance parsing (extends, implements, use aliases)
 *   - extractClassParentsFromHeader with aliased imports
 *   - findDerivedClassRecords: direct, multi-level, interface chains
 *   - findDerivedClassRecords: unrelated classes excluded
 *   - findDerivedClassRecords with aliased parent
 *   - Reference regex safety inside comments/strings
 */

const assert = require('assert');
const fs = require('fs');
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
    }
    return {
        Position, Range, Location, SymbolInformation,
        SymbolKind: { Class: 4, Method: 6, Function: 11, Variable: 13 },
        MarkdownString, Hover, WorkspaceEdit,
        Uri: { file(fp) { return { fsPath: fp }; } },
        window: { createOutputChannel() { return { appendLine() {}, show() {}, dispose() {} }; } },
        workspace: {
            getConfiguration() { return { get() { return true; } }; },
            getWorkspaceFolder() { return null; },
            async findFiles() { return []; },
            createFileSystemWatcher() {
                return { onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} };
            },
            onDidOpenTextDocument() {},
            onDidChangeTextDocument() {},
        },
        languages: {
            createDiagnosticCollection() { return { set() {}, clear() {}, dispose() {} }; },
            registerCodeActionsProvider() { return { dispose() {} }; },
        },
        CodeActionKind: { QuickFix: 'quickfix' },
    };
}

Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return makeVscodeStub();
    return originalLoad(request, parent, isMain);
};

const PHPDefinitionIndex = require('../../src/PHPDefinitionIndex');

function fixture(name) {
    return path.join(__dirname, '..', 'fixtures', 'phase2', name);
}

let passed = 0;
let failed = 0;
function ok(condition, label) {
    if (condition) { passed++; }
    else { failed++; console.error('FAIL: ' + label); }
}
function eq(actual, expected, label) {
    if (actual === expected) { passed++; }
    else { failed++; console.error('FAIL: ' + label + ' (got ' + actual + ', expected ' + expected + ')'); }
}

async function run() {
    const index = new PHPDefinitionIndex({}, null);

    // =========================================================
    // 1. isValidPhpIdentifier edge-cases
    // =========================================================
    ok(index.isValidPhpIdentifier('Foo'), 'simple class name is valid');
    ok(index.isValidPhpIdentifier('_private'), 'leading underscore is valid');
    ok(index.isValidPhpIdentifier('a1'), 'alphanumeric is valid');
    ok(!index.isValidPhpIdentifier('123abc'), 'leading digit is invalid');
    ok(!index.isValidPhpIdentifier('foo-bar'), 'hyphen is invalid');
    ok(!index.isValidPhpIdentifier(''), 'empty string is invalid');
    ok(!index.isValidPhpIdentifier(null), 'null is invalid');
    ok(!index.isValidPhpIdentifier('class name'), 'space is invalid');
    ok(!index.isValidPhpIdentifier('foo.bar'), 'dot is invalid');

    // =========================================================
    // 2. findClosestWordIndex positioning
    // =========================================================
    eq(index.findClosestWordIndex('$a = new Foo(); Foo::bar();', 'Foo', 9), 9,
        'findClosestWordIndex picks nearest occurrence (first)');
    eq(index.findClosestWordIndex('$a = new Foo(); Foo::bar();', 'Foo', 16), 16,
        'findClosestWordIndex picks nearest occurrence (second)');
    eq(index.findClosestWordIndex('function helper() {}', 'helper', 9), 9,
        'findClosestWordIndex finds function name');
    eq(index.findClosestWordIndex('no match here', 'xyz', 0), -1,
        'findClosestWordIndex returns -1 for no match');
    eq(index.findClosestWordIndex('', 'foo', 0), -1,
        'findClosestWordIndex handles empty line');
    eq(index.findClosestWordIndex(null, 'foo', 0), -1,
        'findClosestWordIndex handles null line');

    // =========================================================
    // 3. Parsing inheritance — extends + implements
    // =========================================================
    const interfacesText = fs.readFileSync(fixture('Interfaces.php'), 'utf8');
    const interfacesParsed = index.parseDocument(fixture('Interfaces.php'), interfacesText);
    ok(interfacesParsed.symbols.some(s => s.kind === 'class' && s.name === 'Loggable' && s.classType === 'interface'),
        'Loggable parsed as interface');
    ok(interfacesParsed.symbols.some(s => s.kind === 'class' && s.name === 'Serializable' && s.classType === 'interface'),
        'Serializable parsed as interface');

    const abstractText = fs.readFileSync(fixture('AbstractHandler.php'), 'utf8');
    const abstractParsed = index.parseDocument(fixture('AbstractHandler.php'), abstractText);
    const abstractHandler = abstractParsed.symbols.find(s => s.name === 'AbstractHandler');
    ok(abstractHandler, 'AbstractHandler parsed');
    ok(Array.isArray(abstractHandler.parents), 'AbstractHandler has parents array');
    ok(abstractHandler.parents.some(p => p.includes('Loggable')),
        'AbstractHandler parents include Loggable via use-alias import');

    const handlersText = fs.readFileSync(fixture('Handlers.php'), 'utf8');
    const handlersParsed = index.parseDocument(fixture('Handlers.php'), handlersText);
    const concreteHandler = handlersParsed.symbols.find(s => s.name === 'ConcreteHandler');
    ok(concreteHandler, 'ConcreteHandler parsed');
    ok(concreteHandler.parents.some(p => p.includes('AbstractHandler')),
        'ConcreteHandler extends AbstractHandler (via import)');
    ok(concreteHandler.parents.some(p => p.includes('Serializable')),
        'ConcreteHandler implements Serializable (via import)');

    const specialHandler = handlersParsed.symbols.find(s => s.name === 'SpecialHandler');
    ok(specialHandler, 'SpecialHandler parsed');
    ok(specialHandler.parents.some(p => p.includes('ConcreteHandler')),
        'SpecialHandler extends ConcreteHandler');

    const unrelated = handlersParsed.symbols.find(s => s.name === 'UnrelatedClass');
    ok(unrelated, 'UnrelatedClass parsed');
    eq(unrelated.parents.length, 0, 'UnrelatedClass has no parents');

    // =========================================================
    // 4. Parsing aliased import (use ... as ...)
    // =========================================================
    const aliasedText = fs.readFileSync(fixture('AliasedChild.php'), 'utf8');
    const aliasedParsed = index.parseDocument(fixture('AliasedChild.php'), aliasedText);
    const aliasedChild = aliasedParsed.symbols.find(s => s.name === 'AliasedChild');
    ok(aliasedChild, 'AliasedChild parsed');
    ok(aliasedChild.parents.some(p => p.includes('AbstractHandler')),
        'AliasedChild parent resolves through "use ... as Handler" alias to AbstractHandler');

    // =========================================================
    // 5. findDerivedClassRecords — build graph manually
    // =========================================================
    // Simulate indexed file entries for the inheritance hierarchy:
    //   Loggable (interface)
    //     └─ AbstractHandler (abstract class, implements Loggable)
    //          ├─ ConcreteHandler (extends AbstractHandler, implements Serializable)
    //          │    └─ SpecialHandler (extends ConcreteHandler)
    //          └─ AliasedChild (extends AbstractHandler via alias)
    //   UnrelatedClass (no parent)

    const fakeEntries = new Map();
    fakeEntries.set('/fake/Interfaces.php', {
        filePath: '/fake/Interfaces.php', symbols: [
            { kind: 'class', classType: 'interface', name: 'Loggable', fqcn: 'App\\Contracts\\Loggable', parents: [], filePath: '/fake/Interfaces.php', line: 5 },
            { kind: 'class', classType: 'interface', name: 'Serializable', fqcn: 'App\\Contracts\\Serializable', parents: [], filePath: '/fake/Interfaces.php', line: 9 },
        ]
    });
    fakeEntries.set('/fake/AbstractHandler.php', {
        filePath: '/fake/AbstractHandler.php', symbols: [
            { kind: 'class', classType: 'class', name: 'AbstractHandler', fqcn: 'App\\Base\\AbstractHandler', parents: ['App\\Contracts\\Loggable'], filePath: '/fake/AbstractHandler.php', line: 7 },
        ]
    });
    fakeEntries.set('/fake/Handlers.php', {
        filePath: '/fake/Handlers.php', symbols: [
            { kind: 'class', classType: 'class', name: 'ConcreteHandler', fqcn: 'App\\Handlers\\ConcreteHandler', parents: ['App\\Base\\AbstractHandler', 'App\\Contracts\\Serializable'], filePath: '/fake/Handlers.php', line: 8 },
            { kind: 'class', classType: 'class', name: 'SpecialHandler', fqcn: 'App\\Handlers\\SpecialHandler', parents: ['App\\Handlers\\ConcreteHandler'], filePath: '/fake/Handlers.php', line: 18 },
            { kind: 'class', classType: 'class', name: 'UnrelatedClass', fqcn: 'App\\Handlers\\UnrelatedClass', parents: [], filePath: '/fake/Handlers.php', line: 24 },
        ]
    });
    fakeEntries.set('/fake/AliasedChild.php', {
        filePath: '/fake/AliasedChild.php', symbols: [
            { kind: 'class', classType: 'class', name: 'AliasedChild', fqcn: 'App\\Aliases\\AliasedChild', parents: ['App\\Base\\AbstractHandler'], filePath: '/fake/AliasedChild.php', line: 7 },
        ]
    });

    // Inject into index
    const origEntries = index.fileEntries;
    index.fileEntries = fakeEntries;

    // 5a. Direct children of Loggable
    const loggableChildren = index.findDerivedClassRecords('App\\Contracts\\Loggable');
    ok(loggableChildren.some(r => r.name === 'AbstractHandler'),
        'Loggable direct child: AbstractHandler');
    ok(loggableChildren.some(r => r.name === 'ConcreteHandler'),
        'Loggable transitive child: ConcreteHandler (via AbstractHandler)');
    ok(loggableChildren.some(r => r.name === 'SpecialHandler'),
        'Loggable transitive child: SpecialHandler (via ConcreteHandler → AbstractHandler)');
    ok(loggableChildren.some(r => r.name === 'AliasedChild'),
        'Loggable transitive child: AliasedChild (via AbstractHandler alias)');
    ok(!loggableChildren.some(r => r.name === 'UnrelatedClass'),
        'UnrelatedClass is NOT a child of Loggable');

    // 5b. Direct children of AbstractHandler
    const abstractChildren = index.findDerivedClassRecords('App\\Base\\AbstractHandler');
    ok(abstractChildren.some(r => r.name === 'ConcreteHandler'),
        'AbstractHandler direct child: ConcreteHandler');
    ok(abstractChildren.some(r => r.name === 'AliasedChild'),
        'AbstractHandler direct child: AliasedChild (aliased import)');
    ok(abstractChildren.some(r => r.name === 'SpecialHandler'),
        'AbstractHandler transitive child: SpecialHandler');
    ok(!abstractChildren.some(r => r.name === 'UnrelatedClass'),
        'UnrelatedClass is NOT a child of AbstractHandler');
    ok(!abstractChildren.some(r => r.name === 'Loggable'),
        'Loggable is NOT a child of AbstractHandler');

    // 5c. Direct children of ConcreteHandler
    const concreteChildren = index.findDerivedClassRecords('App\\Handlers\\ConcreteHandler');
    eq(concreteChildren.length, 1, 'ConcreteHandler has exactly 1 child');
    eq(concreteChildren[0].name, 'SpecialHandler', 'ConcreteHandler child is SpecialHandler');

    // 5d. Leaf class has no children
    const specialChildren = index.findDerivedClassRecords('App\\Handlers\\SpecialHandler');
    eq(specialChildren.length, 0, 'SpecialHandler has no children (leaf)');

    // 5e. Unrelated class has no children
    const unrelatedChildren = index.findDerivedClassRecords('App\\Handlers\\UnrelatedClass');
    eq(unrelatedChildren.length, 0, 'UnrelatedClass has no children');

    // 5f. Children of Serializable interface
    const serializableChildren = index.findDerivedClassRecords('App\\Contracts\\Serializable');
    ok(serializableChildren.some(r => r.name === 'ConcreteHandler'),
        'Serializable direct implementor: ConcreteHandler');
    ok(serializableChildren.some(r => r.name === 'SpecialHandler'),
        'Serializable transitive implementor: SpecialHandler');
    ok(!serializableChildren.some(r => r.name === 'AbstractHandler'),
        'AbstractHandler does NOT implement Serializable');

    // 5g. Non-existent class returns empty
    const ghostChildren = index.findDerivedClassRecords('Does\\Not\\Exist');
    eq(ghostChildren.length, 0, 'Non-existent class has no children');

    // Restore
    index.fileEntries = origEntries;

    // =========================================================
    // 6. Reference regex — rename safety inside strings/comments
    // =========================================================
    const renameText = fs.readFileSync(fixture('RenameTarget.php'), 'utf8');
    const renameParsed = index.parseDocument(fixture('RenameTarget.php'), renameText);
    ok(renameParsed.symbols.some(s => s.kind === 'class' && s.name === 'RenameTarget'),
        'RenameTarget class parsed');
    ok(renameParsed.symbols.some(s => s.kind === 'function' && s.name === 'rename_target_function'),
        'rename_target_function parsed');

    const classRegexes = index.buildReferenceRegexes({
        kind: 'class', name: 'RenameTarget', fqcn: 'App\\Rename\\RenameTarget',
    });
    const classRefs = index.findRegexLocationsInText(fixture('RenameTarget.php'), renameText, classRegexes);
    // Should match: class declaration line, new RenameTarget() x2, RenameTarget::create()
    ok(classRefs.length >= 4, 'RenameTarget class references found (' + classRefs.length + ' >= 4)');

    const fnRegexes = index.buildReferenceRegexes({
        kind: 'function', name: 'rename_target_function', fqfn: 'App\\Rename\\rename_target_function',
    });
    const fnRefs = index.findRegexLocationsInText(fixture('RenameTarget.php'), renameText, fnRegexes);
    eq(fnRefs.length, 1, 'rename_target_function has 1 ref (declaration only, no call in file)');

    // Reference inside string should be ignored
    const stringTestText = [
        '<?php',
        '$x = "RenameTarget is just a string";',
        '// RenameTarget in a comment',
        '$y = new RenameTarget();',
    ].join('\n');
    const stringTestRefs = index.findRegexLocationsInText('/fake/test.php', stringTestText, classRegexes);
    // Only the `new RenameTarget()` on line 4 should match; string and comment should be skipped
    eq(stringTestRefs.length, 1, 'Reference in string/comment excluded, only real usage found');

    // =========================================================
    // 7. extractClassParentsFromHeader edge-cases
    // =========================================================
    const emptyCtx = { namespace: '', imports: {} };

    const noParents = index.extractClassParentsFromHeader('class Foo ', emptyCtx);
    eq(noParents.length, 0, 'Class with no extends/implements has empty parents');

    const extendsOnly = index.extractClassParentsFromHeader('class Child extends ParentClass ', emptyCtx);
    ok(extendsOnly.includes('ParentClass'), 'extends-only: ParentClass found');
    eq(extendsOnly.length, 1, 'extends-only: exactly 1 parent');

    const implementsOnly = index.extractClassParentsFromHeader('class Impl implements InterfaceA, InterfaceB ', emptyCtx);
    ok(implementsOnly.includes('InterfaceA'), 'implements-only: InterfaceA found');
    ok(implementsOnly.includes('InterfaceB'), 'implements-only: InterfaceB found');
    eq(implementsOnly.length, 2, 'implements-only: exactly 2 parents');

    const both = index.extractClassParentsFromHeader('class Both extends Base implements IA, IB ', emptyCtx);
    ok(both.includes('Base'), 'extends+implements: Base found');
    ok(both.includes('IA'), 'extends+implements: IA found');
    ok(both.includes('IB'), 'extends+implements: IB found');
    eq(both.length, 3, 'extends+implements: exactly 3 parents');

    // With namespace context
    const nsCtx = { namespace: 'App\\Models', imports: { 'base': 'Vendor\\Lib\\Base' } };
    const nsParents = index.extractClassParentsFromHeader('class Model extends Base ', nsCtx);
    ok(nsParents.some(p => p === 'Vendor\\Lib\\Base'),
        'Aliased import resolved: "Base" → "Vendor\\Lib\\Base"');

    // Empty header
    const emptyHeader = index.extractClassParentsFromHeader('', emptyCtx);
    eq(emptyHeader.length, 0, 'Empty header returns no parents');

    const nullHeader = index.extractClassParentsFromHeader(null, emptyCtx);
    eq(nullHeader.length, 0, 'Null header returns no parents');

    // =========================================================
    // 8. Multi-level parseDocument with inline source
    // =========================================================
    const multiLevelSrc = [
        '<?php',
        'namespace Deep;',
        'interface IA {}',
        'interface IB extends IA {}',
        'abstract class Mid implements IB {}',
        'class Leaf extends Mid {}',
    ].join('\n');
    const multiParsed = index.parseDocument('/fake/multi.php', multiLevelSrc);
    const ia = multiParsed.symbols.find(s => s.name === 'IA');
    const ib = multiParsed.symbols.find(s => s.name === 'IB');
    const mid = multiParsed.symbols.find(s => s.name === 'Mid');
    const leaf = multiParsed.symbols.find(s => s.name === 'Leaf');

    ok(ia && ia.classType === 'interface', 'IA parsed as interface');
    ok(ib && ib.classType === 'interface', 'IB parsed as interface');
    ok(ib.parents.includes('Deep\\IA'), 'IB extends Deep\\IA');
    ok(mid.parents.includes('Deep\\IB'), 'Mid implements Deep\\IB');
    ok(leaf.parents.includes('Deep\\Mid'), 'Leaf extends Deep\\Mid');

    // =========================================================
    // 9. Trait parsing
    // =========================================================
    const traitSrc = [
        '<?php',
        'namespace Traits;',
        'trait Cacheable {}',
        'class CachedModel {',
        '    public function save() {}',
        '}',
    ].join('\n');
    const traitParsed = index.parseDocument('/fake/trait.php', traitSrc);
    ok(traitParsed.symbols.some(s => s.name === 'Cacheable' && s.classType === 'trait'),
        'Trait Cacheable parsed with classType=trait');
    ok(traitParsed.symbols.some(s => s.name === 'CachedModel' && s.classType === 'class'),
        'CachedModel parsed as regular class');
    ok(traitParsed.symbols.some(s => s.kind === 'method' && s.name === 'save'),
        'Method save inside CachedModel parsed');

    // =========================================================
    // 10. canResolveToken — must NOT fall back to shortClassIndex
    // =========================================================
    {
        // Inject a class App\Models\User into the index
        let fakeEntries = new Map();
        fakeEntries.set('/fake/User.php', {
            symbols: [{ kind: 'class', name: 'User', fqcn: 'App\\Models\\User' }],
            hash: 'can-resolve-test',
        });
        index.fileEntries = fakeEntries;
        index.classIndex = new Map();
        index.shortClassIndex = new Map();
        index.classIndex.set('app\\models\\user', [{ kind: 'class', name: 'User', fqcn: 'App\\Models\\User', file: '/fake/User.php' }]);
        index.shortClassIndex.set('user', [{ kind: 'class', name: 'User', fqcn: 'App\\Models\\User', file: '/fake/User.php' }]);
        index._ready = true;
        index._initPromise = Promise.resolve();

        // Document WITHOUT a use statement for User
        let docNoImport = {
            getText() {
                return '<?php\nnamespace App\\Controllers;\n\nclass HomeController {\n    public function index() {\n        $u = new User();\n    }\n}\n';
            },
            positionAt(offset) {
                let text = this.getText();
                let line = 0, ch = 0;
                for (let i = 0; i < offset; i++) {
                    if (text[i] === '\n') { line++; ch = 0; } else { ch++; }
                }
                return { line, character: ch };
            },
            getWordRangeAtPosition() { return { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }; },
        };
        let canResolveNoImport = await index.canResolveToken(docNoImport, { line: 5, character: 20 }, 'User');
        ok(!canResolveNoImport, 'canResolveToken returns false when class exists but is not imported');

        // Document WITH a use statement for User
        let docWithImport = {
            getText() {
                return '<?php\nnamespace App\\Controllers;\n\nuse App\\Models\\User;\n\nclass HomeController {\n    public function index() {\n        $u = new User();\n    }\n}\n';
            },
            positionAt(offset) {
                let text = this.getText();
                let line = 0, ch = 0;
                for (let i = 0; i < offset; i++) {
                    if (text[i] === '\n') { line++; ch = 0; } else { ch++; }
                }
                return { line, character: ch };
            },
            getWordRangeAtPosition() { return { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }; },
        };
        let canResolveWithImport = await index.canResolveToken(docWithImport, { line: 7, character: 20 }, 'User');
        ok(canResolveWithImport, 'canResolveToken returns true when class is imported');
    }

    // =========================================================
    // Summary
    // =========================================================
    console.log('');
    console.log('Phase 2 regression tests: ' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) {
        process.exit(1);
    }
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
