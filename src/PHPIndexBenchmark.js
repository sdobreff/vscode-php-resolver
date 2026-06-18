let vscode = require('vscode');

class PHPIndexBenchmark {
    constructor(definitionIndex, logger) {
        this.definitionIndex = definitionIndex;
        this.logger = logger;
    }

    async runBenchmark() {
        if (!this.definitionIndex) {
            return 'Definition index is not available.';
        }

        await this.definitionIndex.waitUntilReady();

        let lines = [];
        lines.push('PHP Resolver — Performance Benchmark');
        lines.push('=====================================');
        lines.push('');

        // 1. Index size metrics
        let index = this.definitionIndex;
        let fileCount = index.fileEntries ? index.fileEntries.size : 0;
        let classCount = index.classIndex ? this.countIndexEntries(index.classIndex) : 0;
        let functionCount = index.functionIndex ? this.countIndexEntries(index.functionIndex) : 0;
        let methodCount = index.methodIndex ? this.countIndexEntries(index.methodIndex) : 0;
        let totalSymbols = classCount + functionCount + methodCount;

        lines.push('Index Size:');
        lines.push('  Files:     ' + fileCount);
        lines.push('  Classes:   ' + classCount);
        lines.push('  Functions: ' + functionCount);
        lines.push('  Methods:   ' + methodCount);
        lines.push('  Total:     ' + totalSymbols);
        lines.push('');

        // 2. Memory estimate
        let memoryBytes = this.estimateMemoryUsage();
        lines.push('Memory Estimate:');
        lines.push('  Index data:   ~' + this.formatBytes(memoryBytes));
        lines.push('  Per file:     ~' + this.formatBytes(fileCount > 0 ? Math.round(memoryBytes / fileCount) : 0));
        lines.push('  Per symbol:   ~' + this.formatBytes(totalSymbols > 0 ? Math.round(memoryBytes / totalSymbols) : 0));
        lines.push('');

        // 3. Lookup benchmarks
        lines.push('Lookup Performance (average of 100 iterations):');

        // Class lookup
        let classKeys = index.classIndex ? [...index.classIndex.keys()] : [];
        if (classKeys.length > 0) {
            let sampleKey = classKeys[Math.floor(classKeys.length / 2)];
            let classTime = this.benchmarkLookup(() => index.classIndex.get(sampleKey), 100);
            lines.push('  classIndex.get():      ' + classTime.toFixed(4) + ' ms');
        }

        // Short class lookup
        let shortKeys = index.shortClassIndex ? [...index.shortClassIndex.keys()] : [];
        if (shortKeys.length > 0) {
            let sampleKey = shortKeys[Math.floor(shortKeys.length / 2)];
            let shortTime = this.benchmarkLookup(() => index.shortClassIndex.get(sampleKey), 100);
            lines.push('  shortClassIndex.get(): ' + shortTime.toFixed(4) + ' ms');
        }

        // Method lookup
        let methodKeys = index.methodIndex ? [...index.methodIndex.keys()] : [];
        if (methodKeys.length > 0) {
            let sampleKey = methodKeys[Math.floor(methodKeys.length / 2)];
            let methodTime = this.benchmarkLookup(() => index.methodIndex.get(sampleKey), 100);
            lines.push('  methodIndex.get():     ' + methodTime.toFixed(4) + ' ms');
        }

        // Full symbol search
        if (totalSymbols > 0) {
            let searchTime = this.benchmarkLookup(() => {
                index.getAllSymbolRecords();
            }, 10);
            lines.push('  getAllSymbolRecords():  ' + searchTime.toFixed(4) + ' ms');
        }

        // findDerivedClassRecords
        if (classKeys.length > 0) {
            let sampleFqcn = classKeys[Math.floor(classKeys.length / 2)];
            let derivedTime = this.benchmarkLookup(() => {
                index.findDerivedClassRecords(sampleFqcn);
            }, 10);
            lines.push('  findDerivedClasses():  ' + derivedTime.toFixed(4) + ' ms');
        }

        lines.push('');

        // 4. Index map sizes
        lines.push('Map Sizes:');
        lines.push('  classIndex:        ' + (index.classIndex ? index.classIndex.size : 0) + ' keys');
        lines.push('  shortClassIndex:   ' + (index.shortClassIndex ? index.shortClassIndex.size : 0) + ' keys');
        lines.push('  functionIndex:     ' + (index.functionIndex ? index.functionIndex.size : 0) + ' keys');
        lines.push('  shortFunctionIndex:' + (index.shortFunctionIndex ? index.shortFunctionIndex.size : 0) + ' keys');
        lines.push('  methodIndex:       ' + (index.methodIndex ? index.methodIndex.size : 0) + ' keys');
        lines.push('  shortMethodIndex:  ' + (index.shortMethodIndex ? index.shortMethodIndex.size : 0) + ' keys');
        lines.push('');

        // 5. Process memory
        if (typeof process !== 'undefined' && process.memoryUsage) {
            let mem = process.memoryUsage();
            lines.push('Process Memory:');
            lines.push('  RSS:          ' + this.formatBytes(mem.rss));
            lines.push('  Heap used:    ' + this.formatBytes(mem.heapUsed));
            lines.push('  Heap total:   ' + this.formatBytes(mem.heapTotal));
            lines.push('  External:     ' + this.formatBytes(mem.external));
        }

        return lines.join('\n');
    }

    countIndexEntries(indexMap) {
        let count = 0;
        for (let records of indexMap.values()) {
            count += records.length;
        }
        return count;
    }

    estimateMemoryUsage() {
        let index = this.definitionIndex;
        let bytes = 0;

        if (index.fileEntries) {
            for (let entry of index.fileEntries.values()) {
                // Rough estimate: file path + namespace + symbols
                bytes += (entry.filePath || '').length * 2;
                bytes += (entry.namespace || '').length * 2;
                bytes += 64; // overhead per entry

                for (let symbol of (entry.symbols || [])) {
                    bytes += (symbol.name || '').length * 2;
                    bytes += (symbol.fqcn || symbol.fqfn || symbol.methodKey || '').length * 2;
                    bytes += (symbol.filePath || '').length * 2;
                    bytes += 80; // overhead per symbol object
                    if (Array.isArray(symbol.parents)) {
                        bytes += symbol.parents.length * 40;
                    }
                }
            }
        }

        return bytes;
    }

    benchmarkLookup(fn, iterations) {
        let start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            fn();
        }
        let end = process.hrtime.bigint();
        let totalNs = Number(end - start);
        return (totalNs / iterations) / 1e6; // convert to ms
    }

    formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
}

module.exports = PHPIndexBenchmark;
