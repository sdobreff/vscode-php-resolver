# PHP Resolver

PHP Resolver can do different things with your PHP source files.

- Automatically generates **PHP namespaces** for the given class based on the `composer.json`. Both **psr-4** and **psr-0** are supported.
- After namespaces importing, the classes are automatically collapsed.
- Extension supports **importing classes** not only from PSR4 and PSR0 but also **WordPress** format - `class-<name of the class>`. It automatically **checks for namespace declarations** in the files and extracts data from there.
- Extension adds **file size info** in the status bar
- `Expand with namespace` command will expand the selected class with its **namespace**, if there are more than one class candidate - you have to make a manual selection. 
  **Note**: if you have to make a manual selection but you close the dialog without making a selection, and `phpResolver.leadingSeparator` is set to true (default), **namespace** wont be added but the class will be prefixed with '\'.

*Note for **WordPress** users:* there must be **composer.json** in the root of the project dir with either **psr-4** or **pcr-0** section defined, even if you are not following these standard. These are used for proper namespace generation. If you add one of these sections in your **composer.json** that wont affect your project.

If there is a class which is part of the same namespace as the current one, it wont be added to the dialog (if there are multiple class candidates - check the `Expand with namespace` above) and it wont be added to the `use` section of the class.

## Commands

Search these commands by the title on command palette.

```javascript
[
    {
        "title": "Import Class",
        "command": "phpResolver.import"
    },
    {
        "title": "Import All Classes",
        "command": "phpResolver.importAll"
    },
    {
        "title": "Expand with namespace",
        "command": "phpResolver.expand"
    },
    {
        "title": "Sort Imports",
        "command": "phpResolver.sort"
    },
    {
        "title": "Highlight Not Imported Classes",
        "command": "phpResolver.highlightNotImported"
    },
    {
        "title": "Highlight Not Used Classes",
        "command": "phpResolver.highlightNotUsed"
    },
    {
        "title": "Generate namespace for this file",
        "command": "phpResolver.generateNamespace"
    }
]
```

## Settings

You can override these default settings according to your needs.

```javascript
{
    "phpResolver.exclude": "**/node_modules/**",  // Exclude glob pattern while finding files
    "phpResolver.showMessageOnStatusBar": false,  // Show message on status bar instead of notification box
    "phpResolver.autoSort": true,                 // Auto sort after imports
    "phpResolver.sortOnSave": false,              // Auto sort when a file is saved
    "phpResolver.sortAlphabetically": false,      // Sort imports in alphabetical order instead of line length
    "phpResolver.sortNatural": false,             // Sort imports using a 'natural order' algorithm
    "phpResolver.leadingSeparator": true,         // Expand class with leading namespace separator
    "phpResolver.highlightOnSave": false,         // Auto highlight not imported and not used when a file is saved
    "phpResolver.highlightOnOpen": false          // Auto highlight not imported and not used when a file is opened
    "phpResolver.autoImportOnSave": false         // Auto import not imported classes when a file is saved
    "phpResolver.dontImportGlobal": true          // Do not import global classes as aliases with use statement
}
```

## Keybindings

You can override these default keybindings on your `keybindings.json`.

```javascript
[
    {
        "command": "phpResolver.import",
        "key": "ctrl+alt+i",
        "when": "editorTextFocus"
    },
    {
        "command": "phpResolver.importAll",
        "key": "ctrl+alt+a",
        "when": "editorTextFocus"
    },
    {
        "command": "phpResolver.expand",
        "key": "ctrl+alt+e",
        "when": "editorTextFocus"
    },
    {
        "command": "phpResolver.sort",
        "key": "ctrl+alt+s",
        "when": "editorTextFocus"
    },
    {
        "command": "phpResolver.highlightNotImported",
        "key": "ctrl+alt+n",
        "when": "editorTextFocus"
    },
    {
        "command": "phpResolver.highlightNotUsed",
        "key": "ctrl+alt+u",
        "when": "editorTextFocus"
    },
    {
        "command": "phpResolver.generateNamespace",
        "key": "ctrl+alt+g",
        "when": "editorTextFocus"
    }
]
```

## Author

- [@StoilDobreff](https://github.com/sdobreff/)

Copyright (c) 2022 Stoil Dobreff
