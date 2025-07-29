// Web Worker for background codebase indexing
// This prevents the main thread from blocking during heavy indexing operations

class WorkerCodebaseIndexer {
    constructor() {
        this.currentIndex = { files: {} };
    }

    parseFileContent(content, filePath) {
        const definitions = new Set();
        const fileExtension = filePath.split('.').pop();

        // Generic regex for various languages
        const functionRegex = /(?:function|def|func|fn)\s+([a-zA-Z0-9_<>]+)\s*\(?/g;
        const classRegex = /class\s+([a-zA-Z0-9_<>]+)/g;
        const variableRegex = /(?:const|let|var|val|final)\s+([a-zA-Z0-9_]+)\s*=/g;
        const todoRegex = /(?:\/\/|\#|\*)\s*TODO[:\s](.*)/g;

        // Language-specific regex
        const arrowFuncRegex = /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async)?\s*\(.*?\)\s*=>/g;
        const pythonMethodRegex = /def\s+([a-zA-Z0-9_]+)\(self/g;

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
        
        // Add filename as searchable term
        addDefinition('file', filePath.split('/').pop());

        return Array.from(definitions).map(item => JSON.parse(item));
    }

    incrementalUpdate(changedFiles) {
        const stats = { indexedFileCount: 0, skippedFileCount: 0, deletedFileCount: 0 };
        
        for (const fileData of changedFiles) {
            const { path, content, action } = fileData;
            
            if (action === 'delete') {
                delete this.currentIndex.files[path];
                stats.deletedFileCount++;
            } else if (action === 'update') {
                // Check if file should be indexed
                if (path.match(/\.(js|jsx|ts|tsx|html|css|scss|md|json|py|java|c|cpp|h|cs|go|rb|php|swift|kt|rs|toml|yaml|sh|txt)$/)) {
                    try {
                        this.currentIndex.files[path] = {
                            definitions: this.parseFileContent(content, path),
                            content: content, // Store full content
                            lastModified: Date.now()
                        };
                        stats.indexedFileCount++;
                    } catch (error) {
                        console.warn(`Worker: Could not index file: ${path}`, error);
                        stats.skippedFileCount++;
                    }
                } else {
                    stats.skippedFileCount++;
                }
            }
        }

        return { index: this.currentIndex, stats };
    }

    queryIndex(query) {
        const results = [];
        const searchTerm = query.toLowerCase();

        for (const [filePath, fileData] of Object.entries(this.currentIndex.files)) {
            const matches = [];
            
            for (const definition of fileData.definitions) {
                let score = 0;
                let matchType = '';
                
                // Exact matches get highest score
                if (definition.name && definition.name.toLowerCase() === searchTerm) {
                    score = 100;
                    matchType = 'exact';
                } else if (definition.content && definition.content.toLowerCase() === searchTerm) {
                    score = 100;
                    matchType = 'exact';
                }
                // Partial matches get lower score
                else if (definition.name && definition.name.toLowerCase().includes(searchTerm)) {
                    score = 80;
                    matchType = 'partial';
                } else if (definition.content && definition.content.toLowerCase().includes(searchTerm)) {
                    score = 70;
                    matchType = 'partial';
                }
                
                if (score > 0) {
                    matches.push({
                        type: definition.type,
                        name: definition.name || definition.content,
                        score: score,
                        matchType: matchType
                    });
                }
            }

            if (matches.length > 0) {
                // Sort matches by score descending
                matches.sort((a, b) => b.score - a.score);
                
                results.push({
                    file: filePath,
                    matches: matches.slice(0, 5), // Limit to top 5 matches per file
                    totalScore: matches.reduce((sum, match) => sum + match.score, 0)
                });
            }
        }

        // Sort results by total score descending
        results.sort((a, b) => b.totalScore - a.totalScore);
        
        return results.slice(0, 50); // Limit to top 50 results
    }

    searchInIndex({ searchTerm, caseSensitive = false }) {
        const results = [];
        const term = caseSensitive ? searchTerm : searchTerm.toLowerCase();

        for (const [filePath, fileData] of Object.entries(this.currentIndex.files)) {
            if (fileData.content) {
                const content = caseSensitive ? fileData.content : fileData.content.toLowerCase();
                if (content.includes(term)) {
                    // Simple search for now, can be expanded to return line numbers etc.
                    results.push({
                        file: filePath,
                        matches: true // Simplified result
                    });
                }
            }
        }
        return results;
    }

    fullReindex(fileData) {
        this.currentIndex = { files: {} };
        const stats = { indexedFileCount: 0, skippedFileCount: 0, deletedFileCount: 0 };

        for (const file of fileData) {
            const { path, content } = file;
            
            if (path.match(/\.(js|jsx|ts|tsx|html|css|scss|md|json|py|java|c|cpp|h|cs|go|rb|php|swift|kt|rs|toml|yaml|sh|txt)$/)) {
                try {
                    this.currentIndex.files[path] = {
                        definitions: this.parseFileContent(content, path),
                        content: content, // Store full content
                        lastModified: Date.now()
                    };
                    stats.indexedFileCount++;
                } catch (error) {
                    console.warn(`Worker: Could not index file: ${path}`, error);
                    stats.skippedFileCount++;
                }
            } else {
                stats.skippedFileCount++;
            }
        }

        return { index: this.currentIndex, stats };
    }
}

// Worker instance
const indexer = new WorkerCodebaseIndexer();

// Message handler
self.onmessage = function(e) {
    const { action, data, id } = e.data;
    
    try {
        let result;
        
        switch (action) {
            case 'incrementalUpdate':
                result = indexer.incrementalUpdate(data.changedFiles);
                break;
                
            case 'queryIndex':
                result = indexer.queryIndex(data.query);
                break;
                
            case 'fullReindex':
                result = indexer.fullReindex(data.files);
                break;
                
            case 'setIndex':
                indexer.currentIndex = data.index;
                result = { success: true };
                break;

            case 'searchInIndex':
                result = indexer.searchInIndex(data);
                break;
                
            default:
                throw new Error(`Unknown action: ${action}`);
        }
        
        // Send successful result back
        self.postMessage({
            success: true,
            action: action,
            data: result,
            id: id
        });
        
    } catch (error) {
        // Send error back
        self.postMessage({
            success: false,
            action: action,
            error: error.message,
            id: id
        });
    }
};

// Send ready signal
self.postMessage({ ready: true });