# PHP Resolver

[![Current Version](https://vsmarketplacebadge.apphb.com/version/StoilDobreff.php-resolver.svg)](https://marketplace.visualstudio.com/items?itemName=StoilDobreff.php-resolver.svg)
[![Install Count](https://vsmarketplacebadge.apphb.com/installs/StoilDobreff.php-resolver.svg)](https://marketplace.visualstudio.com/items?itemName=StoilDobreff.php-resolver.svg)
[![Open Issues](https://vsmarketplacebadge.apphb.com/rating/StoilDobreff.php-resolver.svg)](https://marketplace.visualstudio.com/items?itemName=StoilDobreff.php-resolver.svg)

**PHP Resolver** is an extension which is using information from different PHP tools and help you resolve most of the **PHP problems**.
It's purpose is to try to provide all-in-one solution for resolving problems with your **PHP** source files.

- Automatically generates **PHP namespaces** for the given class based on the `composer.json`. Both **psr-4** and **psr-0** are supported.
- After namespaces importing, the classes are automatically collapsed.
- Extension supports **importing classes** not only from PSR4 and PSR0 but also **WordPress** format - `class-<name of the class>`. It automatically **checks for namespace declarations** in the files and extracts data from there.
- **PHP sniffer** - you can set your PHP sniffer and run it against the currently opened PHP file. For that to work you have to have the phpcf installed on your system.
- **PHP beautifier** - extremely powerful PHP tool, which can help you to automatically fix most of the PHP code problems, and keep the code consistent with your team.
- **PHP error log file monitor** - monitoring changes in the given PHP error log file, you can jump directly to the file and line from which the error comes from. On Fatal Errors, automatically switch Output view to the error log in order to grab your attention, OS notification is also fired in case you are alway of the VSCode window.
- Extension adds **file size info** in the status bar, which gives you quick information about the size of the current file.
## Namespace resolving

*Note for **WordPress** users:* there must be **composer.json** in the root of the project dir with either **psr-4** or **pcr-0** section defined, even if you are not following these standards, you can have composer.json file even if you are not using composer at all, but the extension depends on it. It is used for proper namespace generation. If you add one of these sections in your **composer.json** (or the file itself) that wont affect your project.

If there is a class which is part of the same namespace as the current one, it wont be added to the dialog (if there are multiple class candidates - check the `Expand with namespace` below) and it wont be added to the `use` section of the class.

- `Expand with namespace` command will expand the selected class with its **namespace**, if there are more than one class candidate - you have to make a manual selection via VSCode dialog. 
  **Note**: if you close the dialog without making a selection, and `phpResolver.leadingSeparator` is set to true (default), **namespace** wont be added but the class will be prefixed with '\'.
- Currently partial namespaces are not supported. That means that if you have something like:
    ```
    use Namespace\DifferentParsers\Parser;

    ...

    $parser = new Parser\StringWalker($parseroptions);

    ```
    *StringWalker* wont be recognized properly (as it has the following name (with namespace): Namespace\DifferentParsers\Parser\StringWalker). If you use `Import class` command - the extension will import just this - *use Parser\StringWalker*. If you remove *Parser\\* it will be imported properly (if the file with the class is found by the extension) or the import will look like this *use Namespace\DifferentParsers\Parser\StringWalker;*.
    Same applies for the `Import All Classes` command - it wont import classes properly, but it will work if you remove the *Parser\\* part.

## Linter Installation

Before using this plugin, you must ensure that `phpcs` is installed on your system. The preferred method is using [composer](https://getcomposer.org/) for both system-wide and project-wide installations. Another alternative is to install **phpcs** and **phpcbf** is to follow the instructions provided here: [PHP_CodeSniffer](https://github.com/squizlabs/PHP_CodeSniffer)

### PHP sniffer

**PHP sniffer** is extremely powerful tool for quick check your PHP code against given codding standards, which now you can use directly from the extension. For that to work properly, you have to provide the path to the executable (*phpcs*), which the extension can use. The command is `phpResolver.phpSnifferCommand` which expects string with the full path to the executable.
*Example:*
```json
{
    "phpResolver.phpSnifferCommand": "/usr/local/bin/phpcs"
}
```
PHP Resolver could be set as default formatter for PHP files. Use `Format Document With ...` menu (right click within PHP file), and then `Configure Default Formatter` menu.

### PHP beautifier

**PHP beautifier** is another powerful tool for resolving common PHP code problems using provided codding standards, which now you can use directly from the extension. For that to work properly, you have to provide the path to the executable (*phpcbf*), which the extension can use. The command is `phpResolver.phpBeautifierCommand` which expects string with the full path to the executable.
*Example:*
```json
{
    "phpResolver.phpBeautifierCommand": "/usr/local/bin/phpcbf"
}
```
### phpcbf and phpcs codding standards

Using the setting `phpResolver.phpStandards`, you have to provide the codding standards you want to be used with both PHP Beautifier, and PHP codding standards. This setting expects comma separated string values, with the standards you want to be used (they must be installed and visible for the executables - phpcs and phpcbf)
*Example:*
```json
{
    "phpResolver.phpStandards": "WordPress,WordPress-Extra,WordPress-Docs"
}
```
If you project is using custom standards as it is described here: [PHP_CodeSniffer - Using a Default Configuration File](https://github.com/squizlabs/PHP_CodeSniffer/wiki/Advanced-Usage#using-a-default-configuration-file), then you need to provide the full path to these configurations.
*Example:*
```json
{
    "phpResolver.phpStandards": "WordPress,WordPress-Extra,WordPress-Docs,/full-path-to-xml-file/phpcs.xml"
}
```
## PHP Error Log

There is a PHP error log viewer built in the extension. When you provide the path to the **PHP error log** which has to be monitored from the extension (use `phpResolver.phpLogFile` setting for that), the extension will create a new output stream, and will start tailing the error log there. It is called **PHP Resolver - PHP error log**. Every time the PHP generates a **Fatal error**, the focus will be automatically moved to that output stream, so it can grab your attention immediately. The extension also generates a OS notification, which could be extremely helpful you are alway of your VSCode window. Click on the message in the notification, and you will be redirected to the VSCode window, and the file from which the error is originated will be opened for you and also the cursor will be moved to the line responsible for the error generated.
In the output console of the extension, you can click on the files and trace the error (use default VSCode key combinations for that - cmd-click for Mac and alt-click for Windows). When you click on given file, you will be redirected to that file and the cursor will be moved to the line related to the error generated.
In order for that to work properly, you have to manually provide the correct settings (if needed).
- If you working locally - just set `phpResolver.phpLogFile` to point to your error log file (absolute path and file name) and you are good to go. *Example:* **"/Users/your-user/MyProjects/project/log.log"**
- If your application is running remotely (vagrant, docker, etc.) you have to provide additional configurations
  - In that case, extension needs to map your error log paths to the local environment.
  - Use `phpResolver.phpLogFilePathRemote` to point to the root of your remote project directory. *Example:* **"/var/www/html/"**
  - Use `phpResolver.phpLogFilePathLocal`, to point to the root of your local project directory. *Example:* **"/Users/your-user/MyProjects/project/"**

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
        "title": "Generate namespace for this file",
        "command": "phpResolver.generateNamespace"
    },
    {
        "title": "Beautify code (phpcbf)",
        "command": "phpResolver.beautify"
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
    "phpResolver.highlightOnOpen": false,          // Auto highlight not imported and not used when a file is opened
    "phpResolver.autoImportOnSave": false,         // Auto import not imported classes when a file is saved
    "phpResolver.dontImportGlobal": true,          // Do not import global classes as aliases with use statement
    "phpResolver.phpBeautifierCommand": "",        // Full path to the PHP beautifier command
    "phpResolver.phpSnifferCommand": "",           // Full path to the PHP sniffer command
    "phpResolver.phpStandards": "",                // PHP standards (comma separated) which PHP Sniffer and Beautifier commands should use
    "phpResolver.phpLogFile": "",                  // Full path to the PHP error log file - you can set any PHP error log file to be monitored by the extension
    "phpResolver.phpLogFilePathRemote": "",        // If you are developing using remote environment (vagrant, docker, etc) put the path generated in the error log file on the remote, which has to be mapped to the local path in the error log monitor output (so the vscode could recognize the links, and resolves them to your local environment)
    "phpResolver.phpLogFilePathLocal": "",         // Local path which has to be used to replace the remote file path in the error log
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
    },
    {
        "command": "phpResolver.beautify",
        "key": "ctrl+alt+b",
        "when": "editorTextFocus"
    }
]
```

## Author

- [@StoilDobreff](https://github.com/sdobreff/)

Copyright (c) 2022 Stoil Dobreff
