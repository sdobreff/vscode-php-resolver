# Change Log

## 2.1.5
- Improved error messages when commands are not found

## 2.1.4
- Removed file which is auto generated

## 2.1.3
- The reason for this release is because of some problems with Microsoft servers

## 2.1.2
- Added option for clearing the error log console
- Fixed problem with removing the namespace from class when whole classname is needed (in quotes)

## 2.1.1
- Fixed bug with the extension initialization on empty VSCode editor

## 2.1
- Added support for php-cs-fixer
- Small bug fixes

## 2.0.2
- Small fixes with namespace extraction
- Fixes in the file size calculation

## 2.0.1
- Small fixes in RE for better PHP error log parsing
- Excluded PHP reserved words from classes extraction

## 2.0.0
- Fixed bugs related to the RE and proper namespaces / classnames extraction
- Introduced phpcf support
- Introduced phpcbf support
- Introduced PHP error log reader and notifications

## 1.1.5
- Fixed bug with missing package

## 1.1.4
- Small RE fix for extracting classes from functions

## 1.1.3
- Function parameters classes extraction and exception catch classes parameter extraction improvements
- Current class name extraction changed
- Added PHP primitives and classes which should not be extracted / imported
- Changes namespace extraction logic

## 1.1.2
- Bug fix in class extraction Regular Expression
  
## 1.1.1
- Issue with use statement regular expression fixed
- Added option to add global classes with use statements as aliases
- Fixed class extraction RE problem
- Various bug fixes and code improvements
  
## 1.1.0
- Classes to include are case insensitive
- Class names RE changed

## 1.0.9
- Added progress indication for improved classes

## 1.0.8
- Bug fixes for proper classes extraction from the source
- Bug fixe for namespace generation

## 1.0.7
- Namespace collapse for imported classes
- Better errors
- Current class / namespace is not imported

## 1.0.6
- Speed and performance optimizations.
- Namespace resolving logic is improved
- Now psr-0 is also supported fot the proper namespace generation
  
## 1.0.5
- `Expand class` command is changed to `Expand with namespace`. Now WordPress classes are also supported.
  
## 1.0.4
- Improved use statements namespace extraction and selection, if class is not in use statements, but it has same namespace, it is not included / shown in the namespace selection dialog.
  
## 1.0.3
- Improved use statements extraction
  
## 1.0.2
- Improved searching
- Rewrite importing logic and class name checking
- Added file-size in status bar as part of the extension


