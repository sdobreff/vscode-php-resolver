let vscode = require('vscode');
let AdmZip = require('adm-zip');
let ZipContentNode = require('./ZipContentNode');

class ZipContentProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.rootChildren = [];
        this.zipPath = null;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    clear() {
        this.zipPath = null;
        this.rootChildren = [];
        this.refresh();
    }

    loadZip(zipPath) {
        let zip = new AdmZip(zipPath);
        let entries = zip.getEntries();
        let nodeMap = new Map();
        this.rootChildren = [];

        const getOrCreateNode = (key, name, isDirectory) => {
            if (!nodeMap.has(key)) {
                nodeMap.set(key, new ZipContentNode(name, key, isDirectory));
            }
            let existing = nodeMap.get(key);
            if (isDirectory) {
                existing.isDirectory = true;
            }
            return existing;
        };

        for (let entry of entries) {
            let normalizedPath = entry.entryName.replace(/\\/g, '/').replace(/\/$/, '');
            if (!normalizedPath) {
                continue;
            }

            let segments = normalizedPath.split('/').filter(Boolean);
            let currentPath = '';

            for (let i = 0; i < segments.length; i++) {
                let segment = segments[i];
                currentPath = currentPath ? currentPath + '/' + segment : segment;
                let isLast = i === segments.length - 1;
                let isDir = !isLast || entry.isDirectory;
                let node = getOrCreateNode(currentPath, segment, isDir);

                if (isLast && !isDir) {
                    node.size = entry.header && typeof entry.header.size === 'number' ? entry.header.size : 0;
                    node.date = entry.header && entry.header.time ? new Date(entry.header.time) : null;
                }

                if (i === 0) {
                    if (!this.rootChildren.includes(node)) {
                        this.rootChildren.push(node);
                    }
                } else {
                    let parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
                    let parentNode = getOrCreateNode(parentPath, segments[i - 1], true);
                    if (!parentNode.children.includes(node)) {
                        parentNode.children.push(node);
                    }
                }
            }
        }

        this.zipPath = zipPath;
        this.rootChildren = this.sortNodes(this.rootChildren);
        this.refresh();
    }

    sortNodes(nodes) {
        let sorted = [...nodes].sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        for (let node of sorted) {
            if (node.children.length > 0) {
                node.children = this.sortNodes(node.children);
            }
        }

        return sorted;
    }

    getTreeItem(element) {
        let treeItem = new vscode.TreeItem(
            element.name,
            element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        if (element.isDirectory) {
            treeItem.contextValue = 'zipFolder';
            treeItem.iconPath = new vscode.ThemeIcon('folder');
            treeItem.tooltip = element.fullPath;
        } else {
            treeItem.contextValue = 'zipFile';
            treeItem.iconPath = new vscode.ThemeIcon('file');
            treeItem.description = this.formatSize(element.size) + (element.date ? '  ' + this.formatDate(element.date) : '');
            treeItem.tooltip = element.fullPath + '\n' + 'Size: ' + this.formatSize(element.size) + (element.date ? '\nModified: ' + this.formatDate(element.date) : '');
            treeItem.command = {
                command: 'phpResolver.openZipEntry',
                title: 'Open ZIP Entry',
                arguments: [element]
            };
        }

        return treeItem;
    }

    getChildren(element) {
        if (!this.zipPath) {
            return [];
        }

        if (!element) {
            return this.rootChildren;
        }

        return element.children || [];
    }

    formatSize(bytes) {
        if (!bytes || bytes < 1024) {
            return (bytes || 0) + ' B';
        }

        let units = ['KB', 'MB', 'GB', 'TB'];
        let value = bytes / 1024;
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
            value = value / 1024;
            unitIndex++;
        }

        return value.toFixed(1) + ' ' + units[unitIndex];
    }

    formatDate(date) {
        try {
            return date.toLocaleString();
        } catch {
            return '';
        }
    }
}

module.exports = ZipContentProvider;
