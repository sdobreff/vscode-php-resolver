let vscode = require('vscode');

class PHPSortImportsProvider {
    constructor() {}

    /**
     * Sort and organize use statements in the active document.
     * Groups: PHP built-ins, vendor, project.
     * Alphabetizes within each group.
     */
    async sortImports(document) {
        let text = document.getText();
        let lines = text.split(/\r?\n/);

        // Find all use statement lines and their positions
        let useStatements = [];
        let firstUseLine = -1;
        let lastUseLine = -1;

        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();
            // Match: use NamespacePath[\ClassName];
            if (/^use\s+[A-Za-z\\]/.test(trimmed) && trimmed.endsWith(';')) {
                if (firstUseLine === -1) firstUseLine = i;
                lastUseLine = i;
                useStatements.push({
                    line: i,
                    text: trimmed,
                    raw: lines[i]
                });
            }
        }

        if (useStatements.length < 2) {
            return null; // Nothing to sort
        }

        // Group and sort
        let groups = this._groupImports(useStatements);
        let sorted = this._buildSortedBlock(groups);

        // Create edit to replace the use block
        let range = new vscode.Range(
            new vscode.Position(firstUseLine, 0),
            new vscode.Position(lastUseLine, lines[lastUseLine].length)
        );

        let edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, sorted.join('\n'));

        return edit;
    }

    _groupImports(useStatements) {
        let phpBuiltins = [];
        let vendor = [];
        let project = [];

        for (let stmt of useStatements) {
            let namespace = this._extractNamespace(stmt.text);
            if (this._isPhpBuiltin(namespace)) {
                phpBuiltins.push(stmt);
            } else if (this._isVendor(namespace)) {
                vendor.push(stmt);
            } else {
                project.push(stmt);
            }
        }

        // Sort each group alphabetically (case-insensitive)
        let sortFn = (a, b) => a.text.toLowerCase().localeCompare(b.text.toLowerCase());
        phpBuiltins.sort(sortFn);
        vendor.sort(sortFn);
        project.sort(sortFn);

        return { phpBuiltins, vendor, project };
    }

    _buildSortedBlock(groups) {
        let result = [];

        if (groups.phpBuiltins.length > 0) {
            for (let stmt of groups.phpBuiltins) {
                result.push(stmt.text);
            }
        }

        if (groups.vendor.length > 0) {
            if (result.length > 0) result.push('');
            for (let stmt of groups.vendor) {
                result.push(stmt.text);
            }
        }

        if (groups.project.length > 0) {
            if (result.length > 0) result.push('');
            for (let stmt of groups.project) {
                result.push(stmt.text);
            }
        }

        return result;
    }

    _extractNamespace(useText) {
        let match = useText.match(/^use\s+(?:function\s+|const\s+)?([A-Za-z\\]+)/);
        return match ? match[1] : '';
    }

    _isPhpBuiltin(namespace) {
        let phpNamespaces = ['stdClass', 'ArrayObject', 'Iterator', 'Countable', 'Serializable', 'Closure', 'Generator', 'Throwable', 'Exception', 'Error', 'TypeError', 'RuntimeException', 'InvalidArgumentException', 'LogicException', 'OutOfBoundsException', 'DateTime', 'DateTimeInterface', 'DateTimeImmutable', 'SplFileInfo', 'SplObjectStorage', 'JsonSerializable'];
        let first = namespace.split('\\')[0];
        return phpNamespaces.includes(first) || first === 'PHP';
    }

    _isVendor(namespace) {
        // Common vendor prefixes
        let vendorPrefixes = ['Illuminate', 'Symfony', 'Doctrine', 'GuzzleHttp', 'Psr', 'PHPUnit', 'Monolog', 'Carbon', 'Laravel', 'League', 'Ramsey', 'Composer', 'PhpParser', 'Twig', 'Predis', 'Firebase', 'Google', 'Aws', 'Stripe', 'Sentry'];
        let first = namespace.split('\\')[0];
        return vendorPrefixes.includes(first);
    }

    /**
     * Remove duplicate use statements.
     */
    removeDuplicates(document) {
        let text = document.getText();
        let lines = text.split(/\r?\n/);
        let seen = new Set();
        let linesToRemove = [];

        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();
            if (/^use\s+[A-Za-z\\]/.test(trimmed) && trimmed.endsWith(';')) {
                let normalized = trimmed.replace(/\s+/g, ' ');
                if (seen.has(normalized)) {
                    linesToRemove.push(i);
                } else {
                    seen.add(normalized);
                }
            }
        }

        if (linesToRemove.length === 0) return null;

        let edit = new vscode.WorkspaceEdit();
        for (let lineNum of linesToRemove.reverse()) {
            let range = new vscode.Range(
                new vscode.Position(lineNum, 0),
                new vscode.Position(lineNum + 1, 0)
            );
            edit.delete(document.uri, range);
        }

        return edit;
    }
}

module.exports = PHPSortImportsProvider;
