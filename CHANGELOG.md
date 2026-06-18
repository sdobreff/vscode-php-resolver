# Change Log

## 3.0.0

### New Modules
- **Code Lens** — inline reference and implementation counts above declarations.
- **Type Hierarchy** — native VS Code supertypes/subtypes navigation.
- **Dead Code Scanner** — detect unused classes and functions with clickable report.
- **Document Symbol** — enhanced outline view with classes, methods, properties, constants.
- **Inlay Hints** — show parameter names at call sites.
- **Sort & Organize Imports** — group and alphabetize `use` statements.
- **Extract Interface** — code action to generate an interface from a class.
- **Circular Dependency Detection** — find namespace-level import cycles via DFS.
- **Namespace Completion** — autocomplete inside `use` statements.
- **PHPDoc Inheritance** — show inherited documentation on hover.
- **Unused Import Detection** — real-time unused `use` diagnostics with quick-fix removal.

### Performance Optimizations
- Reverse token index (`tokenToFiles`) for O(1) symbol reference lookups.
- Persistent inheritance graph (`parentToChildren`) for instant subtype resolution.
- LRU file content cache (150 files) to reduce disk reads.
- Binary search in offset range checks.
- Lazy class records cache with dirty tracking.
- Workspace folder and configuration caching.
- Incremental index updates — only changed files reparsed on save.

### Improvements
- All new modules are independently toggleable via settings.
- Dead code report opens as an editor document with clickable file paths.
- Framework entry points (controllers, migrations, test classes, etc.) excluded from dead code results.

## 2.3.4
- Bug fix where traits are used in the class files.

## 2.3.3
- Bug fixes and removing phpcs fixer to run on save event.

## 2.3.2
- Bug fixes and further code optimizations.

## 2.3.1
- Code optimizations and fixes.

## 2.3
- UI changes and code fixes, workflow improvements.

## 2.2.1
- Dropped support for the file size of the currently opened file in the status, added support for file size in the default Explorer view on hover. Added resolver (CodeActions), which adds phpcs inline comment to escape current phpcs errors quickly (using phpcs:ignore inline comment, multiple rules are supported as well).

## 2.2
- Added custom standards file support - phpcs.xml - or custom named file - you can set that from settings.

## 2.1.5
- Improved error messages when commands are not found.

## 2.1.4
- Removed file which is auto generated.

## 2.1.3
- The reason for this release is because of some problems with Microsoft servers.

## 2.1.2
- Added option for clearing the error log console.
- Fixed problem with removing the namespace from class when whole classname is needed (in quotes).

## 2.1.1
- Fixed bug with the extension initialization on empty VSCode editor.

## 2.1
- Added support for php-cs-fixer.
- Small bug fixes.

## 2.0.2
- Small fixes with namespace extraction.
- Fixes in the file size calculation.

## 2.0.1
- Small fixes in RE for better PHP error log parsing.
- Excluded PHP reserved words from classes extraction.

## 2.0.0
- Fixed bugs related to the RE and proper namespaces / classnames extraction.
- Introduced phpcf support.
- Introduced phpcbf support.
- Introduced PHP error log reader and notifications.

## 1.1.5
- Fixed bug with missing package.

## 1.1.4
- Small RE fix for extracting classes from functions.

## 1.1.3
- Function parameters classes extraction and exception catch classes parameter extraction improvements.
- Current class name extraction changed.
- Added PHP primitives and classes which should not be extracted / imported.
- Changes namespace extraction logic.

## 1.1.2
- Bug fix in class extraction Regular Expression.
  
## 1.1.1
- Issue with use statement regular expression fixed.
- Added option to add global classes with use statements as aliases.
- Fixed class extraction RE problem.
- Various bug fixes and code improvements.
  
## 1.1.0
- Classes to include are case insensitive.
- Class names RE changed.

## 1.0.9
- Added progress indication for improved classes.

## 1.0.8
- Bug fixes for proper classes extraction from the source.
- Bug fixe for namespace generation.

## 1.0.7
- Namespace collapse for imported classes.
- Better errors.
- Current class / namespace is not imported.

## 1.0.6
- Speed and performance optimizations.
- Namespace resolving logic is improved.
- Now psr-0 is also supported fot the proper namespace generation.
  
## 1.0.5
- `Expand class` command is changed to `Expand with namespace`. Now WordPress classes are also supported.
  
## 1.0.4
- Improved use statements namespace extraction and selection, if class is not in use statements, but it has same namespace, it is not included / shown in the namespace selection dialog.
  
## 1.0.3
- Improved use statements extraction.
  
## 1.0.2
- Improved searching.
- Rewrite importing logic and class name checking.
- Added file-size in status bar as part of the extension.


