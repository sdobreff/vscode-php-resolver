class ZipContentNode {
    constructor(name, fullPath, isDirectory) {
        this.name = name;
        this.fullPath = fullPath;
        this.isDirectory = isDirectory;
        this.children = [];
        this.size = 0;
        this.date = null;
    }
}

module.exports = ZipContentNode;
