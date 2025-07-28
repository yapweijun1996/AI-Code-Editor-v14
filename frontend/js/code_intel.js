// =================================================================
// === Codebase Intelligence and Indexing                        ===
// =================================================================
export const CodebaseIndexer = {
    async buildIndex(dirHandle, options = {}) {
        const opts = options || {};
        const { lastIndexTimestamp = 0, ignorePatterns = [] } = opts;
        const existingIndex = opts.existingIndex || { files: {} };
        const stats = { indexedFileCount: 0, skippedFileCount: 0, deletedFileCount: 0 };
        const allFilePathsInProject = new Set();

        await this.traverseAndIndex(dirHandle, '', existingIndex, lastIndexTimestamp, stats, allFilePathsInProject, ignorePatterns);
        
        // Clean up files that were deleted from the project
        for (const filePath in existingIndex.files) {
            if (!allFilePathsInProject.has(filePath)) {
                delete existingIndex.files[filePath];
                stats.deletedFileCount++;
            }
        }

        return { index: existingIndex, stats };
    },

    async traverseAndIndex(dirHandle, currentPath, index, lastIndexTimestamp, stats, allFilePathsInProject, ignorePatterns) {
        for await (const entry of dirHandle.values()) {
            const newPath = currentPath ?
                `${currentPath}/${entry.name}` :
                entry.name;
            if (ignorePatterns.some(pattern => newPath.startsWith(pattern.replace(/\/$/, '')))) {
                continue;
            }

            if (entry.kind === 'file') {
                allFilePathsInProject.add(newPath);

                // Index a wider range of common text-based file types
                if (entry.name.match(/\.(js|jsx|ts|tsx|html|css|scss|md|json|py|java|c|cpp|h|cs|go|rb|php|swift|kt|rs|toml|yaml|sh|txt)$/)) {
                    try {
                        const file = await entry.getFile();
                        // Only skip if the file hasn't been modified since the last full index
                        if (lastIndexTimestamp && file.lastModified <= lastIndexTimestamp && index.files[newPath]) {
                            stats.skippedFileCount++;
                            continue;
                        }
                        const content = await file.text();
                        index.files[newPath] = this.parseFileContent(content, newPath);
                        stats.indexedFileCount++;
                    } catch (e) {
                        console.warn(`Could not index file: ${newPath}`, e);
                    }
                }
            } else if (entry.kind === 'directory') {
                await this.traverseAndIndex(entry, newPath, index, lastIndexTimestamp, stats, allFilePathsInProject, ignorePatterns);
            }
        }
    },

    parseFileContent(content, filePath) {
        const definitions = new Set(); // Use a Set to avoid duplicate entries
        const fileExtension = filePath.split('.').pop();

        // Generic regex for various languages
        const functionRegex = /(?:function|def|func|fn)\s+([a-zA-Z0-9_]+)\s*\(?/g;
        const classRegex = /class\s+([a-zA-Z0-9_]+)/g;
        const variableRegex = /(?:const|let|var|val|final)\s+([a-zA-Z0-9_]+)\s*=/g;
        const todoRegex = /(?:\/\/|\#|\*)\s*TODO[:\s](.*)/g;

        // Language-specific regex
        const arrowFuncRegex = /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async)?\s*\(.*?\)\s*=>/g; // JS/TS
        const pythonMethodRegex = /def\s+([a-zA-Z0-9_]+)\(self/g; // Python

        const addDefinition = (type, name) => {
            if (name) definitions.add(JSON.stringify({ type, name: name.trim() }));
        };
        
        const addContentDefinition = (type, content) => {
            if (content) definitions.add(JSON.stringify({ type, content: content.trim() }));
        };

        let match;
        while ((match = functionRegex.exec(content)) !== null) addDefinition('function', match[1]);
        while ((match = classRegex.exec(content)) !== null) addDefinition('class', match[1]);
        while ((match = variableRegex.exec(content)) !== null) addDefinition('variable', match[1]);
        while ((match = todoRegex.exec(content)) !== null) addContentDefinition('todo', match[1]);

        if (['js', 'ts', 'jsx', 'tsx'].includes(fileExtension)) {
            while ((match = arrowFuncRegex.exec(content)) !== null) addDefinition('function', match[1]);
        }
        if (fileExtension === 'py') {
            while ((match = pythonMethodRegex.exec(content)) !== null) addDefinition('method', match[1]);
        }
        
        // Fallback: add the filename itself as a searchable term
        addDefinition('file', filePath.split('/').pop());

        return Array.from(definitions).map(item => JSON.parse(item));
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