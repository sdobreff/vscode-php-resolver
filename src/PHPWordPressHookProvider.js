let vscode = require('vscode');
let fs = require('fs');

class PHPWordPressHookProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
        this.outputChannel = null;
    }

    async provideDefinition(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        let lineText = document.lineAt(position.line).text;
        let hookInfo = this.extractHookInfo(lineText, position.character);
        if (!hookInfo) {
            return null;
        }

        await this.definitionIndex.waitUntilReady();

        let hookName = hookInfo.hookName;
        let hookType = hookInfo.hookType;

        // If cursor is on add_action/add_filter, find do_action/apply_filters with this hook name
        // If cursor is on do_action/apply_filters, find add_action/add_filter with this hook name
        let searchPatterns = this.getSearchPatterns(hookType, hookName);
        if (searchPatterns.length === 0) {
            return null;
        }

        let locations = [];

        // Use reverse token index for hook name to narrow files, fallback to all
        let hookToken = hookName.replace(/[^a-zA-Z0-9_]/g, '_');
        let files = this.definitionIndex._getCandidateFiles(hookToken);
        // Also search all files as hook names often aren't indexed tokens
        if (files.length < this.definitionIndex.fileEntries.size) {
            files = [...this.definitionIndex.fileEntries.keys()];
        }

        for (let filePath of files) {
            let text = await this.definitionIndex._readFileCached(filePath);
            if (!text) continue;

            let lineOffsets = this.definitionIndex.computeLineOffsets(text);
            let ignoredRanges = this.definitionIndex.computeIgnoredRanges(text);

            for (let pattern of searchPatterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    if (this.definitionIndex.isOffsetInRanges(match.index, ignoredRanges)) {
                        continue;
                    }

                    let line = this.definitionIndex.offsetToLine(lineOffsets, match.index) - 1;
                    let col = match.index - (lineOffsets[line] || 0);

                    locations.push(new vscode.Location(
                        vscode.Uri.file(filePath),
                        new vscode.Range(
                            new vscode.Position(line, col),
                            new vscode.Position(line, col + match[0].length)
                        )
                    ));
                }
            }
        }

        if (this.outputChannel && locations.length > 0) {
            this.outputChannel.appendLine('[WP Hook] ' + hookType + ' "' + hookName + '" → ' + locations.length + ' results');
        }

        return locations.length > 0 ? locations : null;
    }

    extractHookInfo(lineText, character) {
        // Match: add_action|add_filter|do_action|apply_filters( 'hook_name' or "hook_name"
        let hookRegex = /\b(add_action|add_filter|do_action|do_action_ref_array|apply_filters|apply_filters_ref_array)\s*\(\s*(['"])([^'"]+)\2/g;
        let match;

        while ((match = hookRegex.exec(lineText)) !== null) {
            let start = match.index;
            let end = start + match[0].length;

            if (character >= start && character <= end) {
                return {
                    hookType: match[1],
                    hookName: match[3],
                };
            }
        }

        return null;
    }

    getSearchPatterns(hookType, hookName) {
        let escaped = this.escapeRegex(hookName);
        let patterns = [];

        // Registration functions → search for dispatchers
        if (hookType === 'add_action' || hookType === 'add_filter') {
            patterns.push(new RegExp('\\b(?:do_action|do_action_ref_array)\\s*\\(\\s*[\'"]' + escaped + '[\'"]', 'g'));
            patterns.push(new RegExp('\\b(?:apply_filters|apply_filters_ref_array)\\s*\\(\\s*[\'"]' + escaped + '[\'"]', 'g'));
        }

        // Dispatchers → search for registrations
        if (hookType === 'do_action' || hookType === 'do_action_ref_array') {
            patterns.push(new RegExp('\\badd_action\\s*\\(\\s*[\'"]' + escaped + '[\'"]', 'g'));
        }

        if (hookType === 'apply_filters' || hookType === 'apply_filters_ref_array') {
            patterns.push(new RegExp('\\badd_filter\\s*\\(\\s*[\'"]' + escaped + '[\'"]', 'g'));
        }

        return patterns;
    }

    escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

module.exports = PHPWordPressHookProvider;
