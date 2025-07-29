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
                        index.files[newPath] = {
                            definitions: this.parseFileContent(content, newPath),
                            content: content, // Store full content for fast search
                        };
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
        const functionRegex = /(?:function|def|func|fn)\s+([a-zA-Z0-9_<>]+)\s*\(?/g;
        const classRegex = /class\s+([a-zA-Z0-9_<>]+)/g;
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
            const fileData = index.files[filePath];
            let foundInContent = false;

            // First, check definitions for precise matches
            if (fileData.definitions) {
                for (const def of fileData.definitions) {
                    if (
                        (def.name && def.name.toLowerCase().includes(lowerCaseQuery)) ||
                        (def.content && def.content.toLowerCase().includes(lowerCaseQuery))
                    ) {
                        results.push({
                            file: filePath,
                            type: def.type,
                            name: def.name || def.content,
                        });
                        foundInContent = true; // Avoid duplicating results if also found in raw content
                    }
                }
            }

            // If not found in definitions, perform a general search on the file content
        }
        if (results.length === 0) {
            return [{
                file: 'N/A',
                type: 'info',
                name: `No results found for query: "${query}". The index may need to be updated or the term may not exist.`
            }];
        }
        return results;
    },

    async reIndexPaths(dirHandle, pathsToIndex, index, stats, ignorePatterns) {
        for (const path of pathsToIndex) {
            try {
                const entry = await dirHandle.getDirectoryHandle(path, { create: false });
                await this.traverseAndIndex(entry, path, index, 0, stats, new Set(), ignorePatterns);
            } catch (e) {
                // Not a directory, try as a file
                try {
                    const fileHandle = await dirHandle.getFileHandle(path, { create: false });
                    const file = await fileHandle.getFile();
                    const content = await file.text();
                    index.files[path] = {
                        definitions: this.parseFileContent(content, path),
                        content: content, // Store full content for fast search
                    };
                    stats.indexedFileCount++;
                } catch (fileError) {
                    console.warn(`Could not re-index path: ${path}`, fileError);
                }
            }
        }
    },
};