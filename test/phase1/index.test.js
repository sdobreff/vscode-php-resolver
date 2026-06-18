const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;

function makeVscodeStub() {
    class Position {
        constructor(line, character) {
            this.line = line;
            this.character = character;
        }
    }

    class Range {
        constructor(startOrLine, startCharacter, endLine, endCharacter) {
            if (startOrLine instanceof Position) {
                this.start = startOrLine;
                this.end = startCharacter;
            } else {
                this.start = new Position(startOrLine, startCharacter);
                this.end = new Position(endLine, endCharacter);
            }
        }
    }

    class Location {
        constructor(uri, rangeOrPosition) {
            this.uri = uri;
            if (rangeOrPosition instanceof Position) {
                this.range = new Range(rangeOrPosition, rangeOrPosition);
            } else {
                this.range = rangeOrPosition;
            }
        }
    }

    class SymbolInformation {
        constructor(name, kind, containerName, location) {
            this.name = name;
            this.kind = kind;
            this.containerName = containerName;
            this.location = location;
        }
    }

    class MarkdownString {
        constructor() {
            this.value = '';
        }

        appendCodeblock(text) {
            this.value += String(text || '');
        }

        appendMarkdown(text) {
            this.value += String(text || '');
        }
    }

    class Hover {
        constructor(contents, range) {
            this.contents = contents;
            this.range = range;
        }
    }

    class WorkspaceEdit {
        constructor() {
            this.edits = [];
        }

        replace(uri, range, newText) {
            this.edits.push({ uri, range, newText });
        }
    }

    return {
        Position,
        Range,
        Location,
        SymbolInformation,
        SymbolKind: {
            Class: 4,
            Method: 6,
            Function: 11,
            Variable: 13,
        },
        MarkdownString,
        Hover,
        WorkspaceEdit,
        Uri: {
            file(filePath) {
                return { fsPath: filePath };
            },
        },
        window: {
            createOutputChannel() {
                return {
                    appendLine() {},
                    show() {},
                    dispose() {},
                };
            },
        },
        workspace: {
            getConfiguration() {
                return {
                    get() {
                        return true;
                    },
                };
            },
            getWorkspaceFolder() {
                return null;
            },
            async findFiles() {
                return [];
            },
            createFileSystemWatcher() {
                return {
                    onDidCreate() {},
                    onDidChange() {},
                    onDidDelete() {},
                    dispose() {},
                };
            },
            onDidOpenTextDocument() {},
            onDidChangeTextDocument() {},
        },
        languages: {
            createDiagnosticCollection() {
                return {
                    set() {},
                    clear() {},
                    dispose() {},
                };
            },
            registerCodeActionsProvider() {
                return { dispose() {} };
            },
        },
        CodeActionKind: {
            QuickFix: 'quickfix',
        },
    };
}

Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') {
        return makeVscodeStub();
    }

    return originalLoad(request, parent, isMain);
};

const PHPDefinitionIndex = require('../../src/PHPDefinitionIndex');
const PHPReferenceProvider = require('../../src/PHPReferenceProvider');
const PHPWorkspaceSymbolProvider = require('../../src/PHPWorkspaceSymbolProvider');
const PHPHoverProvider = require('../../src/PHPHoverProvider');
const PHPRenameProvider = require('../../src/PHPRenameProvider');
const PHPImplementationProvider = require('../../src/PHPImplementationProvider');
const PHPMissingUseProvider = require('../../src/PHPMissingUseProvider');
const PHPMissingUseDiagnosticsProvider = require('../../src/PHPMissingUseDiagnosticsProvider');

function fixture(name) {
    return path.join(__dirname, '..', 'fixtures', 'phase1', name);
}

async function run() {
    const index = new PHPDefinitionIndex({}, null);

    const sampleRefsPath = fixture('SampleReferences.php');
    const sampleRefsText = fs.readFileSync(sampleRefsPath, 'utf8');

    const regexes = index.buildReferenceRegexes({
        kind: 'function',
        name: 'foo',
        fqfn: 'foo',
    });

    const refLocations = index.findRegexLocationsInText(sampleRefsPath, sampleRefsText, regexes);
    assert.strictEqual(refLocations.length, 2, 'References should include only declaration + real call');

    const sampleSymbolsPath = fixture('SampleSymbols.php');
    const sampleSymbolsText = fs.readFileSync(sampleSymbolsPath, 'utf8');
    const parsed = index.parseDocument(sampleSymbolsPath, sampleSymbolsText);

    assert.ok(parsed.symbols.some((s) => s.kind === 'class' && s.name === 'Alpha'), 'Class Alpha should be parsed');
    assert.ok(parsed.symbols.some((s) => s.kind === 'function' && s.name === 'helper_function'), 'Function helper_function should be parsed');
    assert.ok(parsed.symbols.some((s) => s.kind === 'method' && s.name === 'run'), 'Method run should be parsed');

    const inheritanceParsed = index.parseDocument(
        fixture('SampleSymbols.php'),
        [
            '<?php',
            'namespace Demo;',
            'interface Contract {}',
            'class BaseClass {}',
            'class ChildClass extends BaseClass implements Contract {}',
            ''
        ].join('\n')
    );
    const childClass = inheritanceParsed.symbols.find((s) => s.kind === 'class' && s.name === 'ChildClass');
    assert.ok(childClass, 'ChildClass should be parsed');
    assert.ok(Array.isArray(childClass.parents), 'Parsed class should include parents list');
    assert.ok(childClass.parents.includes('Demo\\BaseClass'), 'Parents should include resolved base class');
    assert.ok(childClass.parents.includes('Demo\\Contract'), 'Parents should include resolved interface');

    const fakeIndexForProviders = {
        async findReferencesWithTrace() {
            return { locations: [{ id: 'r1' }], trace: ['ok'] };
        },
        async findWorkspaceSymbols() {
            return [{ id: 's1' }];
        },
        async findHover() {
            return {
                contents: ['hover'],
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            };
        },
        async getRenameContext() {
            return {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 3 },
                },
            };
        },
        async buildRenameWorkspaceEdit() {
            return { edits: [{ file: 'a.php', from: 'old', to: 'new' }] };
        },
        async findImplementationsWithTrace() {
            return { locations: [{ id: 'i1' }], trace: ['ok'] };
        },
        async findAvailableClassesNamed() {
            return [{ fqcn: 'Vendor\\Package\\ClassName', kind: 'class', name: 'ClassName' }];
        },
        async canResolveToken() {
            return true;
        },
    };

    const referenceProvider = new PHPReferenceProvider(fakeIndexForProviders);
    const refs = await referenceProvider.provideReferences({ uri: { fsPath: sampleRefsPath } }, { line: 0 }, { includeDeclaration: true });
    assert.strictEqual(refs.length, 1, 'Reference provider should delegate to index');

    const workspaceProvider = new PHPWorkspaceSymbolProvider(fakeIndexForProviders);
    const symbols = await workspaceProvider.provideWorkspaceSymbols('anything');
    assert.strictEqual(symbols.length, 1, 'Workspace symbol provider should delegate to index');

    const hoverProvider = new PHPHoverProvider(fakeIndexForProviders);
    const hover = await hoverProvider.provideHover({}, {});
    assert.ok(hover, 'Hover provider should return hover object');

    const renameProvider = new PHPRenameProvider(fakeIndexForProviders);
    const renameRange = await renameProvider.prepareRename({}, {});
    assert.ok(renameRange, 'Rename provider should return a prepareRename range');
    const renameEdits = await renameProvider.provideRenameEdits({}, {}, 'renamed_symbol');
    assert.ok(renameEdits, 'Rename provider should return rename edits');

    const implementationProvider = new PHPImplementationProvider(fakeIndexForProviders);
    const impls = await implementationProvider.provideImplementation({ uri: { fsPath: sampleRefsPath } }, { line: 0, character: 0 });
    assert.strictEqual(impls.length, 1, 'Implementation provider should delegate to index');

    const missingUseProvider = new PHPMissingUseProvider(fakeIndexForProviders);
    const codeActions = await missingUseProvider.provideCodeActions(
        { uri: { fsPath: 'test.php' }, getText: () => 'new SomeClass();', lineCount: 1, getWordRangeAtPosition: () => null, positionAt: () => ({ line: 0 }) },
        {},
        { diagnostics: [] }
    );
    assert.ok(Array.isArray(codeActions), 'Missing use provider should return code actions array');

    const missingUseDiagnosticsProvider = new PHPMissingUseDiagnosticsProvider(fakeIndexForProviders);
    assert.ok(missingUseDiagnosticsProvider, 'Missing use diagnostics provider should be instantiated');

    console.log('Phase 1/2 tests passed');
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
