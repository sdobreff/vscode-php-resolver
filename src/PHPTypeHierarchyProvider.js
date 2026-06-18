let vscode = require('vscode');

class PHPTypeHierarchyProvider {
    constructor(definitionIndex) {
        this.definitionIndex = definitionIndex;
    }

    async prepareTypeHierarchy(document, position) {
        if (!this.definitionIndex) {
            return null;
        }

        await this.definitionIndex.waitUntilReady();

        let result = await this.definitionIndex.findDefinitionWithTrace(document, position);
        if (!result.locations || result.locations.length === 0) {
            return null;
        }

        let record = this.definitionIndex.findRecordByLocation(result.locations[0]);
        if (!record || record.kind !== 'class') {
            return null;
        }

        return new vscode.TypeHierarchyItem(
            this._symbolKind(record),
            record.name,
            record.fqcn || record.name,
            vscode.Uri.file(record.filePath),
            new vscode.Range(
                new vscode.Position(Math.max(0, record.line - 1), 0),
                new vscode.Position(Math.max(0, record.line - 1), 0)
            ),
            new vscode.Range(
                new vscode.Position(Math.max(0, record.line - 1), 0),
                new vscode.Position(Math.max(0, record.line - 1), 0)
            )
        );
    }

    async provideTypeHierarchySupertypes(item) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        // Find the record for this item
        let fqcn = item.detail || item.name;
        let record = this._findClassRecord(fqcn);
        if (!record || !Array.isArray(record.parents) || record.parents.length === 0) {
            return [];
        }

        let results = [];
        for (let parentFqcn of record.parents) {
            let parentKey = String(parentFqcn || '').replace(/^\\+/, '').toLowerCase();
            let parentRecords = this.definitionIndex.classIndex.get(parentKey);
            if (parentRecords && parentRecords.length > 0) {
                let parent = parentRecords[0];
                results.push(new vscode.TypeHierarchyItem(
                    this._symbolKind(parent),
                    parent.name,
                    parent.fqcn || parent.name,
                    vscode.Uri.file(parent.filePath),
                    new vscode.Range(
                        new vscode.Position(Math.max(0, parent.line - 1), 0),
                        new vscode.Position(Math.max(0, parent.line - 1), 0)
                    ),
                    new vscode.Range(
                        new vscode.Position(Math.max(0, parent.line - 1), 0),
                        new vscode.Position(Math.max(0, parent.line - 1), 0)
                    )
                ));
            }
        }

        return results;
    }

    async provideTypeHierarchySubtypes(item) {
        if (!this.definitionIndex) {
            return [];
        }

        await this.definitionIndex.waitUntilReady();

        let fqcn = item.detail || item.name;
        let target = fqcn.replace(/^\\+/, '').toLowerCase();

        // Get direct children only (not transitive)
        let children = this.definitionIndex.parentToChildren.get(target);
        if (!children || children.size === 0) {
            // Try rebuild if empty
            if (this.definitionIndex.parentToChildren.size === 0 && this.definitionIndex.fileEntries.size > 0) {
                this.definitionIndex._rebuildInheritanceGraph();
                children = this.definitionIndex.parentToChildren.get(target);
            }
            if (!children || children.size === 0) {
                return [];
            }
        }

        let results = [];
        for (let childFqcn of children) {
            let childRecords = this.definitionIndex.classIndex.get(childFqcn);
            if (childRecords && childRecords.length > 0) {
                let child = childRecords[0];
                results.push(new vscode.TypeHierarchyItem(
                    this._symbolKind(child),
                    child.name,
                    child.fqcn || child.name,
                    vscode.Uri.file(child.filePath),
                    new vscode.Range(
                        new vscode.Position(Math.max(0, child.line - 1), 0),
                        new vscode.Position(Math.max(0, child.line - 1), 0)
                    ),
                    new vscode.Range(
                        new vscode.Position(Math.max(0, child.line - 1), 0),
                        new vscode.Position(Math.max(0, child.line - 1), 0)
                    )
                ));
            }
        }

        return results;
    }

    _findClassRecord(fqcn) {
        let key = String(fqcn || '').replace(/^\\+/, '').toLowerCase();
        let records = this.definitionIndex.classIndex.get(key);
        if (records && records.length > 0) {
            return records[0];
        }

        // Try short name
        let shortKey = fqcn.split('\\').pop().toLowerCase();
        let shortRecords = this.definitionIndex.shortClassIndex.get(shortKey);
        if (shortRecords && shortRecords.length > 0) {
            return shortRecords[0];
        }

        return null;
    }

    _symbolKind(record) {
        if (record.classType === 'interface') {
            return vscode.SymbolKind.Interface;
        }
        if (record.classType === 'trait') {
            return vscode.SymbolKind.Struct;
        }
        return vscode.SymbolKind.Class;
    }
}

module.exports = PHPTypeHierarchyProvider;
