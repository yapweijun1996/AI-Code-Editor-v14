/**
 * Code Comprehension Module
 * Advanced code understanding and analysis for large projects
 */

import * as FileSystem from './file_system.js';

class CodeComprehension {
    constructor() {
        this.symbolCache = new Map();
        this.dependencyGraph = new Map();
        this.contextWindow = [];
        this.maxContextSize = 50; // Maximum files to keep in context
    }

    /**
     * Analyze variable/symbol across the entire codebase
     */
    async analyzeSymbol(symbolName, filePath, rootHandle) {
        const cacheKey = `${symbolName}:${filePath}`;
        if (this.symbolCache.has(cacheKey)) {
            return this.symbolCache.get(cacheKey);
        }

        const analysis = {
            symbol: symbolName,
            definitions: [],
            usages: [],
            type: 'unknown',
            scope: 'unknown',
            relatedFiles: new Set(),
            dataFlow: [],
            documentation: null
        };

        try {
            // Find all definitions
            analysis.definitions = await this.findSymbolDefinitions(symbolName, rootHandle);
            
            // Find all usages
            analysis.usages = await this.findSymbolUsages(symbolName, rootHandle);
            
            // Infer type and scope
            if (analysis.definitions.length > 0) {
                const primaryDef = analysis.definitions[0];
                analysis.type = await this.inferSymbolType(primaryDef);
                analysis.scope = this.determineScope(primaryDef);
            }

            // Build data flow
            analysis.dataFlow = await this.traceDataFlow(symbolName, filePath, rootHandle);

            // Extract documentation
            analysis.documentation = await this.extractDocumentation(symbolName, analysis.definitions);

            // Collect related files
            [...analysis.definitions, ...analysis.usages].forEach(item => {
                analysis.relatedFiles.add(item.file);
            });

            analysis.relatedFiles = Array.from(analysis.relatedFiles);

        } catch (error) {
            console.error('Symbol analysis failed:', error);
            analysis.error = error.message;
        }

        // Cache for 10 minutes
        this.symbolCache.set(cacheKey, analysis);
        setTimeout(() => this.symbolCache.delete(cacheKey), 10 * 60 * 1000);

        return analysis;
    }

    /**
     * Find all definitions of a symbol
     */
    async findSymbolDefinitions(symbolName, rootHandle) {
        const definitions = [];
        const searchResults = [];
        
        // Search patterns for different types of definitions
        const patterns = [
            `function ${symbolName}`,
            `const ${symbolName}`,
            `let ${symbolName}`,
            `var ${symbolName}`,
            `class ${symbolName}`,
            `interface ${symbolName}`,
            `type ${symbolName}`,
            `${symbolName}:`, // Object property
            `"${symbolName}":`, // JSON property
            `'${symbolName}':`, // JSON property
        ];

        for (const pattern of patterns) {
            await FileSystem.searchInDirectory(rootHandle, pattern, '', searchResults, await FileSystem.getIgnorePatterns(rootHandle));
        }

        // Process search results
        for (const result of searchResults) {
            if (result.matches) {
                for (const match of result.matches) {
                    definitions.push({
                        file: result.filePath,
                        line: match.line,
                        content: match.content,
                        context: match.context || [],
                        type: this.classifyDefinition(match.content, symbolName)
                    });
                }
            }
        }

        return this.deduplicateResults(definitions);
    }

    /**
     * Find all usages of a symbol
     */
    async findSymbolUsages(symbolName, rootHandle) {
        const usages = [];
        const searchResults = [];
        
        // Search for the symbol name
        await FileSystem.searchInDirectory(rootHandle, symbolName, '', searchResults, await FileSystem.getIgnorePatterns(rootHandle));

        for (const result of searchResults) {
            if (result.matches) {
                for (const match of result.matches) {
                    // Skip if it's likely a definition (already found above)
                    if (!this.isLikelyDefinition(match.content, symbolName)) {
                        usages.push({
                            file: result.filePath,
                            line: match.line,
                            content: match.content,
                            context: match.context || [],
                            type: this.classifyUsage(match.content, symbolName)
                        });
                    }
                }
            }
        }

        return this.deduplicateResults(usages);
    }

    /**
     * Trace data flow for a symbol
     */
    async traceDataFlow(symbolName, startFile, rootHandle) {
        const dataFlow = [];
        const visited = new Set();
        const queue = [{ file: startFile, symbol: symbolName, depth: 0 }];

        while (queue.length > 0 && dataFlow.length < 20) { // Limit to prevent infinite loops
            const { file, symbol, depth } = queue.shift();
            
            if (visited.has(`${file}:${symbol}`) || depth > 5) continue;
            visited.add(`${file}:${symbol}`);

            try {
                const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file);
                const fileContent = await fileHandle.getFile();
                const content = await fileContent.text();

                // Analyze assignments and function calls
                const flows = this.analyzeDataFlowInFile(content, symbol);
                
                flows.forEach(flow => {
                    dataFlow.push({
                        file,
                        line: flow.line,
                        type: flow.type,
                        from: flow.from,
                        to: flow.to,
                        context: flow.context
                    });

                    // Add related symbols to queue
                    if (flow.relatedSymbols) {
                        flow.relatedSymbols.forEach(relatedSymbol => {
                            queue.push({ file, symbol: relatedSymbol, depth: depth + 1 });
                        });
                    }
                });

            } catch (error) {
                console.warn(`Failed to analyze data flow in ${file}:`, error);
            }
        }

        return dataFlow;
    }

    /**
     * Analyze data flow within a single file
     */
    analyzeDataFlowInFile(content, symbolName) {
        const flows = [];
        const lines = content.split('\n');

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Assignment patterns
            if (trimmed.includes(`${symbolName} =`)) {
                const rightSide = trimmed.split('=')[1]?.trim();
                flows.push({
                    line: index + 1,
                    type: 'assignment',
                    from: rightSide,
                    to: symbolName,
                    context: line,
                    relatedSymbols: this.extractSymbolsFromExpression(rightSide)
                });
            }

            // Function call patterns
            if (trimmed.includes(`${symbolName}(`)) {
                flows.push({
                    line: index + 1,
                    type: 'function_call',
                    from: symbolName,
                    to: 'result',
                    context: line
                });
            }

            // Property access patterns
            if (trimmed.includes(`${symbolName}.`)) {
                const property = trimmed.match(new RegExp(`${symbolName}\\.([a-zA-Z_$][a-zA-Z0-9_$]*)`));
                if (property) {
                    flows.push({
                        line: index + 1,
                        type: 'property_access',
                        from: symbolName,
                        to: property[1],
                        context: line
                    });
                }
            }
        });

        return flows;
    }

    /**
     * Extract symbols from an expression
     */
    extractSymbolsFromExpression(expression) {
        if (!expression) return [];
        
        // Simple regex to find identifiers (can be improved)
        const identifiers = expression.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
        return identifiers.filter(id => !['true', 'false', 'null', 'undefined'].includes(id));
    }

    /**
     * Infer the type of a symbol from its definition
     */
    async inferSymbolType(definition) {
        const content = definition.content.toLowerCase();
        
        if (content.includes('function')) return 'function';
        if (content.includes('class')) return 'class';
        if (content.includes('interface')) return 'interface';
        if (content.includes('type')) return 'type';
        if (content.includes('const')) return 'constant';
        if (content.includes('let') || content.includes('var')) return 'variable';
        if (content.includes(':') && content.includes('{')) return 'object';
        if (content.includes('[') || content.includes('array')) return 'array';
        
        return 'unknown';
    }

    /**
     * Determine the scope of a symbol
     */
    determineScope(definition) {
        const content = definition.content;
        
        if (content.includes('export')) return 'exported';
        if (content.includes('import')) return 'imported';
        if (content.includes('global')) return 'global';
        if (definition.file.includes('node_modules')) return 'external';
        
        return 'local';
    }

    /**
     * Classify a definition type
     */
    classifyDefinition(content, symbolName) {
        const lower = content.toLowerCase();
        
        if (lower.includes(`function ${symbolName.toLowerCase()}`)) return 'function_declaration';
        if (lower.includes(`class ${symbolName.toLowerCase()}`)) return 'class_declaration';
        if (lower.includes(`const ${symbolName.toLowerCase()}`)) return 'const_declaration';
        if (lower.includes(`let ${symbolName.toLowerCase()}`)) return 'let_declaration';
        if (lower.includes(`var ${symbolName.toLowerCase()}`)) return 'var_declaration';
        if (lower.includes(`${symbolName.toLowerCase()}:`)) return 'property_definition';
        
        return 'unknown_definition';
    }

    /**
     * Classify a usage type
     */
    classifyUsage(content, symbolName) {
        const lower = content.toLowerCase();
        
        if (lower.includes(`${symbolName.toLowerCase()}(`)) return 'function_call';
        if (lower.includes(`${symbolName.toLowerCase()}.`)) return 'property_access';
        if (lower.includes(`= ${symbolName.toLowerCase()}`)) return 'assignment_source';
        if (lower.includes(`${symbolName.toLowerCase()} =`)) return 'assignment_target';
        
        return 'reference';
    }

    /**
     * Check if a line is likely a definition
     */
    isLikelyDefinition(content, symbolName) {
        const definitionPatterns = [
            `function ${symbolName}`,
            `const ${symbolName}`,
            `let ${symbolName}`,
            `var ${symbolName}`,
            `class ${symbolName}`,
            `${symbolName}:`
        ];

        return definitionPatterns.some(pattern => 
            content.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Extract documentation from symbol definitions
     */
    async extractDocumentation(symbolName, definitions) {
        if (definitions.length === 0) return null;

        const primaryDef = definitions[0];
        
        // Look for JSDoc comments above the definition
        const documentation = {
            description: null,
            params: [],
            returns: null,
            examples: []
        };

        // Simple JSDoc extraction (can be enhanced)
        if (primaryDef.context && primaryDef.context.length > 0) {
            const contextLines = primaryDef.context;
            let docLines = [];
            
            // Find comment block before definition
            for (let i = contextLines.length - 1; i >= 0; i--) {
                const line = contextLines[i].trim();
                if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')) {
                    docLines.unshift(line);
                } else if (docLines.length > 0) {
                    break;
                }
            }

            if (docLines.length > 0) {
                documentation.description = docLines
                    .map(line => line.replace(/^\/?\*+\/?/, '').trim())
                    .filter(line => line.length > 0)
                    .join(' ');
            }
        }

        return documentation.description ? documentation : null;
    }

    /**
     * Remove duplicate results
     */
    deduplicateResults(results) {
        const seen = new Set();
        return results.filter(result => {
            const key = `${result.file}:${result.line}:${result.content}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Explain a complex code section
     */
    async explainCodeSection(filePath, startLine, endLine, rootHandle) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filePath);
            const file = await fileHandle.getFile();
            const content = await file.text();
            const lines = content.split('\n');
            
            const sectionLines = lines.slice(startLine - 1, endLine);
            const sectionCode = sectionLines.join('\n');

            const explanation = {
                file: filePath,
                lines: `${startLine}-${endLine}`,
                code: sectionCode,
                analysis: {
                    complexity: this.analyzeComplexity(sectionCode),
                    symbols: this.extractSymbols(sectionCode),
                    controlFlow: this.analyzeControlFlow(sectionCode),
                    dependencies: await this.findSectionDependencies(sectionCode, rootHandle)
                },
                summary: this.generateSummary(sectionCode)
            };

            return explanation;
        } catch (error) {
            throw new Error(`Failed to explain code section: ${error.message}`);
        }
    }

    /**
     * Analyze code complexity
     */
    analyzeComplexity(code) {
        const complexity = {
            cyclomatic: 1, // Base complexity
            lines: code.split('\n').length,
            nested_levels: 0,
            functions: 0,
            loops: 0,
            conditions: 0
        };

        // Count control flow statements
        const controlFlowPatterns = [
            /\bif\s*\(/g,
            /\belse\s+if\s*\(/g,
            /\bwhile\s*\(/g,
            /\bfor\s*\(/g,
            /\bswitch\s*\(/g,
            /\bcase\s+/g,
            /\bcatch\s*\(/g
        ];

        controlFlowPatterns.forEach(pattern => {
            const matches = code.match(pattern) || [];
            complexity.cyclomatic += matches.length;
            
            if (pattern.source.includes('if')) complexity.conditions += matches.length;
            if (pattern.source.includes('while') || pattern.source.includes('for')) complexity.loops += matches.length;
        });

        // Count functions
        const functionMatches = code.match(/function\s+\w+|=>\s*{|\bfunction\s*\(/g) || [];
        complexity.functions = functionMatches.length;

        // Estimate nesting levels
        let maxNesting = 0;
        let currentNesting = 0;
        
        for (const char of code) {
            if (char === '{') currentNesting++;
            if (char === '}') currentNesting--;
            maxNesting = Math.max(maxNesting, currentNesting);
        }
        
        complexity.nested_levels = maxNesting;

        return complexity;
    }

    /**
     * Extract all symbols from code
     */
    extractSymbols(code) {
        const symbols = new Set();
        
        // Simple identifier extraction
        const identifiers = code.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
        
        identifiers.forEach(id => {
            if (!this.isReservedWord(id)) {
                symbols.add(id);
            }
        });

        return Array.from(symbols);
    }

    /**
     * Analyze control flow
     */
    analyzeControlFlow(code) {
        const flow = {
            entry_points: [],
            exit_points: [],
            branches: [],
            loops: []
        };

        const lines = code.split('\n');
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            if (trimmed.includes('function') || trimmed.includes('=>')) {
                flow.entry_points.push(index + 1);
            }
            
            if (trimmed.includes('return') || trimmed.includes('throw')) {
                flow.exit_points.push(index + 1);
            }
            
            if (trimmed.includes('if') || trimmed.includes('switch')) {
                flow.branches.push(index + 1);
            }
            
            if (trimmed.includes('for') || trimmed.includes('while')) {
                flow.loops.push(index + 1);
            }
        });

        return flow;
    }

    /**
     * Find dependencies for a code section
     */
    async findSectionDependencies(code, rootHandle) {
        const dependencies = {
            imports: [],
            external_calls: [],
            variables: []
        };

        // Extract import statements
        const importMatches = code.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) || [];
        dependencies.imports = importMatches.map(match => {
            const moduleMatch = match.match(/from\s+['"]([^'"]+)['"]/);
            return moduleMatch ? moduleMatch[1] : null;
        }).filter(Boolean);

        // Extract external function calls (simplified)
        const symbols = this.extractSymbols(code);
        for (const symbol of symbols) {
            if (symbol.length > 1 && !this.isBuiltinFunction(symbol)) {
                dependencies.variables.push(symbol);
            }
        }

        return dependencies;
    }

    /**
     * Generate a summary of code
     */
    generateSummary(code) {
        const summary = [];
        
        if (code.includes('function')) {
            summary.push('Contains function definitions');
        }
        
        if (code.includes('class')) {
            summary.push('Contains class definitions');
        }
        
        if (code.includes('if') || code.includes('switch')) {
            summary.push('Contains conditional logic');
        }
        
        if (code.includes('for') || code.includes('while')) {
            summary.push('Contains loops');
        }
        
        if (code.includes('async') || code.includes('await')) {
            summary.push('Contains asynchronous operations');
        }
        
        if (code.includes('try') || code.includes('catch')) {
            summary.push('Contains error handling');
        }

        return summary.length > 0 ? summary.join('; ') : 'Simple code block';
    }

    /**
     * Check if a word is reserved
     */
    isReservedWord(word) {
        const reserved = [
            'const', 'let', 'var', 'function', 'class', 'if', 'else', 'for', 'while',
            'do', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw',
            'return', 'break', 'continue', 'true', 'false', 'null', 'undefined',
            'typeof', 'instanceof', 'new', 'this', 'super', 'import', 'export',
            'async', 'await', 'yield'
        ];
        
        return reserved.includes(word.toLowerCase());
    }

    /**
     * Check if a function is built-in
     */
    isBuiltinFunction(name) {
        const builtins = [
            'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI',
            'decodeURI', 'encodeURIComponent', 'decodeURIComponent', 'eval',
            'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'
        ];
        
        return builtins.includes(name);
    }

    /**
     * Clear all caches
     */
    clearCache() {
        this.symbolCache.clear();
        this.dependencyGraph.clear();
        this.contextWindow = [];
    }
}

// Export singleton instance
export const codeComprehension = new CodeComprehension();