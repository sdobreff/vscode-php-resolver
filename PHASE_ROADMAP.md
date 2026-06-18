# PHP Resolver Module Roadmap

## Goal
Implement the full feature roadmap in controlled phases with validation after each phase.

## Overall Phases

### Phase 1 - Navigation Core
- [x] References provider
- [x] Workspace symbols provider
- [x] Hover provider
- [x] Add module toggles in settings
- [x] Add references trace command
- [x] Tighten reference matching to reduce false positives
- [x] Add fixture-based tests for references/symbols/hover
- [x] Update README with Phase 1 usage + settings

### Phase 2 - Safe Refactor + Imports
- [x] Rename Symbol (safe scope)
- [x] Auto Import / Fix Missing Use (code actions)
- [x] Go to Implementation
- [x] Add per-module toggles and traces where useful
- [x] Add regression tests for refactor safety

### Phase 3 - Advanced + Domain
- [x] Call Hierarchy Lite
- [x] WordPress Hook Navigator
- [x] Index Health / status module
- [x] Diagnostics module (unresolved symbols, duplicate declarations)
- [x] Performance and memory benchmarks

## Phase 1 Current Implementation (2026-06-18)
- Added files:
  - src/PHPReferenceProvider.js
  - src/PHPWorkspaceSymbolProvider.js
  - src/PHPHoverProvider.js
  - src/PHPRenameProvider.js
  - src/PHPImplementationProvider.js
  - src/PHPMissingUseProvider.js
  - src/PHPMissingUseDiagnosticsProvider.js
- Extended index:
  - src/PHPDefinitionIndex.js
  - Added findReferencesWithTrace, findWorkspaceSymbols, findHover, findImplementationsWithTrace, getRenameContext, buildRenameWorkspaceEdit, canResolveToken, findAvailableClassesNamed and helper methods.
- Wired activation:
  - src/extension.js
  - Registered reference/workspace symbol/hover/rename/implementation/missing-use code action providers using existing definition index.
- New command:
  - phpResolver.showReferencesTrace
  - phpResolver.showImplementationTrace
- New settings:
  - phpResolver.enableReferencesModule
  - phpResolver.enableWorkspaceSymbolsModule
  - phpResolver.enableHoverModule
  - phpResolver.enableRenameModule
  - phpResolver.enableImplementationModule
  - phpResolver.enableMissingUseModule
  - phpResolver.definitionSingleResult
  - phpResolver.definitionDeprioritizeNoopFiles

## Testing Notes
- VS Code Problems check currently reports no errors in modified files.
- Local smoke tests run via `npm test` cover both Phase 1 and Phase 2.
- Phase 2 regression suite (`npm run test:phase2`) covers 73 assertions: identifier validation, word-index positioning, inheritance parsing (extends, implements, aliases, multi-level, traits), derived-class graph traversal, reference regex safety in comments/strings.
- Terminal syntax checks can be noisy in this environment due powerlevel10k gitstatus startup issue.
- Before release, run manual smoke tests inside Extension Development Host:
  - Go to Definition
  - Find All References
  - Go to Implementation (class and method targets)
  - Go to Symbol in Workspace
  - Hover details
  - Rename Symbol (F2) on class/function identifiers
  - Code Actions (Ctrl+.) for missing-use with add use / fully-qualify options
  - Definition/References trace output
  - Cache rebuild command
  - Module toggles + window reload behavior
