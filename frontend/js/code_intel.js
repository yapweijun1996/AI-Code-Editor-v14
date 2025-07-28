// =================================================================
// === Codebase Intelligence and Indexing                        ===
// =================================================================
export const CodebaseIndexer = {
    async buildIndex(dirHandle, options = {}) {
        const opts = options || {};
        const { lastIndexTimestamp = 0 } = opts;
        const existingIndex = opts.existingIndex || { files: {} };
        const stats = { indexedFileCount: 0, skippedFileCount: 0, deletedFileCount: 0 };
        const allFilePathsInProject = new Set();

        await this.traverseAndIndex(dirHandle, '', existingIndex, lastIndexTimestamp, stats, allFilePathsInProject);
        
        // Clean up files that were deleted from the project
        for (const filePath in existingIndex.files) {
            if (!allFilePathsInProject.has(filePath)) {
                delete existingIndex.files[filePath];
                stats.deletedFileCount++;
            }
        }

        return { index: existingIndex, stats };
    },

    async traverseAndIndex(dirHandle, currentPath, index, lastIndexTimestamp, stats, allFilePathsInProject) {
        const ignoreDirs = ['.git', 'node_modules', 'dist', 'build'];
        if (ignoreDirs.includes(dirHandle.name)) return;

        for await (const entry of dirHandle.values()) {
            const newPath = currentPath
            ? `${currentPath}/${entry.name}`
            : entry.name;
            
            if (entry.kind === 'file') {
                allFilePathsInProject.add(newPath); // Add file path to the set

                if (entry.name.match(/\.(js|html|css|md|json|py|java|ts)$/)) {
                    try {
                        const file = await entry.getFile();
                        // If lastIndexTimestamp is provided and file is not modified, skip it.
                        if (lastIndexTimestamp && file.lastModified <= lastIndexTimestamp) {
                            stats.skippedFileCount++;
                            continue;
                        }
                        const content = await file.text();
                        index.files[newPath] = this.parseFileContent(content);
                        stats.indexedFileCount++;
                    } catch (e) {
                        console.warn(`Could not index file: ${newPath}`, e);
                    }
                }
            } else if (entry.kind === 'directory') {
                await this.traverseAndIndex(entry, newPath, index, lastIndexTimestamp, stats, allFilePathsInProject);
            }
        }
    },

    parseFileContent(content) {
        const definitions = [];
        const functionRegex1 = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
        const functionRegex2 =
        /const\s+([a-zA-Z0-9_]+)\s*=\s*(\(.*\)|async\s*\(.*\))\s*=>/g;
        const classRegex = /class\s+([a-zA-Z0-9_]+)/g;
        const todoRegex = /\/\/\s*TODO:(.*)/g;

        let match;
        while ((match = functionRegex1.exec(content)) !== null) {
            definitions.push({ type: 'function', name: match[1] });
        }
        while ((match = functionRegex2.exec(content)) !== null) {
            definitions.push({ type: 'function', name: match[1] });
        }
        while ((match = classRegex.exec(content)) !== null) {
            definitions.push({ type: 'class', name: match[1] });
        }
        while ((match = todoRegex.exec(content)) !== null) {
            definitions.push({ type: 'todo', content: match[1].trim() });
        }
        return definitions;
    },

    async queryIndex(index, query) {
        const results = [];
        const lowerCaseQuery = query.toLowerCase();
        for (const filePath in index.files) {
            for (const def of index.files[filePath]) {
                if (
                (def.name && def.name.toLowerCase().includes(lowerCaseQuery)) ||
                (def.content && def.content.toLowerCase().includes(lowerCaseQuery))
                ) {
                    results.push({
                        file: filePath,
                        type: def.type,
                        name: def.name || def.content,
                    });
                }
            }
        }
        return results;
    },
};