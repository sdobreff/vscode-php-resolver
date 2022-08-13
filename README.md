# PHP Resolver

PHP Resolver can do different things with your PHP source files.

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
        "title": "Expand Class",
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
