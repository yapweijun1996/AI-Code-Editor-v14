/**
 * Precise Code Editor Module
 * Advanced code modification tools that avoid whole-file rewrites
 */

import * as FileSystem from './file_system.js';
import * as Editor from './editor.js';
import { syntaxValidator } from './syntax_validator.js';
import { UndoManager } from './undo_manager.js';

class PreciseEditor {
    constructor() {
        this.modificationHistory = new Map();
        this.astCache = new Map();
    }

    /**
     * Modify a specific function in a file
     */
    async modifyFunction(filePath, functionName, newImplementation, rootHandle) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filePath);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();

            // Track for undo
            UndoManager.push(filePath, originalContent);

            // Parse the file to find the function
            const ast = this.parseJavaScript(originalContent);
            const functionNode = this.findFunctionNode(ast, functionName);

            if (!functionNode) {
                throw new Error(`Function '${functionName}' not found in ${filePath}`);
            }

            // Calculate the exact lines to replace
            const lines = originalContent.split('\n');
            const startLine = functionNode.loc.start.line;
            const endLine = functionNode.loc.end.line;

            // Validate the new implementation
            const testContent = this.replaceLines(originalContent, startLine, endLine, newImplementation);
            const validation = await syntaxValidator.validateSyntax(filePath, testContent);

            if (!validation.valid) {
                throw new Error(`New function implementation has syntax errors: ${validation.errors.map(e => e.message).join(', ')}`);
            }

            // Apply the modification
            const newContent = this.replaceLines(originalContent, startLine, endLine, newImplementation);
            
            // Write the file
            if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
                throw new Error('Permission to write to the file was denied.');
            }

            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();

            // Update editor if file is open
            if (Editor.getOpenFiles().has(filePath)) {
                Editor.getOpenFiles().get(filePath)?.model.setValue(newContent);
            }

            await Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'), false);

            return {
                message: `Function '${functionName}' modified successfully in ${filePath}`,
                linesChanged: `${startLine}-${endLine}`,
                method: 'function_modification'
            };

        } catch (error) {
            throw new Error(`Failed to modify function: ${error.message}`);
        }
    }

    /**
     * Modify a specific class in a file
     */
    async modifyClass(filePath, className, newImplementation, rootHandle) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filePath);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();

            UndoManager.push(filePath, originalContent);

            const ast = this.parseJavaScript(originalContent);
            const classNode = this.findClassNode(ast, className);

            if (!classNode) {
                throw new Error(`Class '${className}' not found in ${filePath}`);
            }

            const startLine = classNode.loc.start.line;
            const endLine = classNode.loc.end.line;

            // Validate new implementation
            const testContent = this.replaceLines(originalContent, startLine, endLine, newImplementation);
            const validation = await syntaxValidator.validateSyntax(filePath, testContent);

            if (!validation.valid) {
                throw new Error(`New class implementation has syntax errors: ${validation.errors.map(e => e.message).join(', ')}`);
            }

            const newContent = this.replaceLines(originalContent, startLine, endLine, newImplementation);
            
            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();

            if (Editor.getOpenFiles().has(filePath)) {
                Editor.getOpenFiles().get(filePath)?.model.setValue(newContent);
            }

            await Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'), false);

            return {
                message: `Class '${className}' modified successfully in ${filePath}`,
                linesChanged: `${startLine}-${endLine}`,
                method: 'class_modification'
            };

        } catch (error) {
            throw new Error(`Failed to modify class: ${error.message}`);
        }
    }

    /**
     * Safely rename a symbol across multiple files
     */
    async renameSymbol(oldName, newName, filePaths, rootHandle) {
        const modifications = [];
        const validationErrors = [];

        // First pass: validate all changes
        for (const filePath of filePaths) {
            try {
                const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filePath);
                const file = await fileHandle.getFile();
                const originalContent = await file.text();

                // Find all occurrences of the symbol
                const occurrences = this.findSymbolOccurrences(originalContent, oldName);
                
                if (occurrences.length > 0) {
                    // Create modified content
                    let newContent = originalContent;
                    
                    // Replace from end to beginning to maintain line numbers
                    for (let i = occurrences.length - 1; i >= 0; i--) {
                        const occurrence = occurrences[i];
                        newContent = this.replaceAtPosition(newContent, occurrence.start, occurrence.end, newName);
                    }

                    // Validate the modified content
                    const validation = await syntaxValidator.validateSyntax(filePath, newContent);
                    
                    if (!validation.valid) {
                        validationErrors.push({
                            file: filePath,
                            errors: validation.errors
                        });
                    } else {
                        modifications.push({
                            filePath,
                            originalContent,
                            newContent,
                            occurrences: occurrences.length
                        });
                    }
                }
            } catch (error) {
                validationErrors.push({
                    file: filePath,
                    errors: [{ message: error.message }]
                });
            }
        }

        if (validationErrors.length > 0) {
            throw new Error(`Validation failed for rename operation:\n${validationErrors.map(e => 
                `${e.file}: ${e.errors.map(err => err.message).join(', ')}`
            ).join('\n')}`);
        }

        // Second pass: apply all changes
        const results = [];
        for (const mod of modifications) {
            try {
                const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, mod.filePath);
                
                // Track for undo
                UndoManager.push(mod.filePath, mod.originalContent);

                if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
                    throw new Error(`Permission denied for ${mod.filePath}`);
                }

                const writable = await fileHandle.createWritable();
                await writable.write(mod.newContent);
                await writable.close();

                // Update editor if open
                if (Editor.getOpenFiles().has(mod.filePath)) {
                    Editor.getOpenFiles().get(mod.filePath)?.model.setValue(mod.newContent);
                }

                results.push({
                    file: mod.filePath,
                    occurrences: mod.occurrences,
                    status: 'success'
                });

            } catch (error) {
                results.push({
                    file: mod.filePath,
                    status: 'error',
                    error: error.message
                });
            }
        }

        const successful = results.filter(r => r.status === 'success');
        const failed = results.filter(r => r.status === 'error');

        return {
            message: `Symbol '${oldName}' renamed to '${newName}' in ${successful.length} files`,
            successful: successful.length,
            failed: failed.length,
            totalOccurrences: successful.reduce((sum, r) => sum + r.occurrences, 0),
            details: results
        };
    }

    /**
     * Add a method to an existing class
     */
    async addMethodToClass(filePath, className, methodName, methodImplementation, rootHandle) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filePath);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();

            UndoManager.push(filePath, originalContent);

            const ast = this.parseJavaScript(originalContent);
            const classNode = this.findClassNode(ast, className);

            if (!classNode) {
                throw new Error(`Class '${className}' not found in ${filePath}`);
            }

            // Find the best insertion point (before the closing brace)
            const lines = originalContent.split('\n');
            const classEndLine = classNode.loc.end.line;
            
            // Find the last method in the class for proper formatting
            let insertionLine = classEndLine - 1;
            const classBody = classNode.body.body;
            
            if (classBody.length > 0) {
                const lastMethod = classBody[classBody.length - 1];
                insertionLine = lastMethod.loc.end.line + 1;
            }

            // Add proper indentation
            const indentation = this.detectIndentation(originalContent);
            const indentedMethod = methodImplementation
                .split('\n')
                .map((line, index) => index === 0 ? `${indentation}${line}` : `${indentation}${line}`)
                .join('\n');

            // Insert the method
            const newContent = this.insertAtLine(originalContent, insertionLine, `\n${indentedMethod}\n`);

            // Validate
            const validation = await syntaxValidator.validateSyntax(filePath, newContent);
            if (!validation.valid) {
                throw new Error(`Method implementation has syntax errors: ${validation.errors.map(e => e.message).join(', ')}`);
            }

            // Write file
            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();

            if (Editor.getOpenFiles().has(filePath)) {
                Editor.getOpenFiles().get(filePath)?.model.setValue(newContent);
            }

            await Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'), false);

            return {
                message: `Method '${methodName}' added to class '${className}' in ${filePath}`,
                insertionLine,
                method: 'method_addition'
            };

        } catch (error) {
            throw new Error(`Failed to add method to class: ${error.message}`);
        }
    }

    /**
     * Replace imports in a file
     */
    async updateImports(filePath, importChanges, rootHandle) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filePath);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();

            UndoManager.push(filePath, originalContent);

            const ast = this.parseJavaScript(originalContent);
            const importNodes = this.findImportNodes(ast);
            
            let newContent = originalContent;
            const lines = originalContent.split('\n');

            // Process import changes
            for (const change of importChanges) {
                switch (change.action) {
                    case 'add':
                        // Add new import at the top
                        const importLine = `import ${change.imports} from '${change.from}';`;
                        newContent = this.insertAtLine(newContent, 1, importLine + '\n');
                        break;
                        
                    case 'remove':
                        // Find and remove the import
                        const importToRemove = importNodes.find(imp => 
                            imp.source.value === change.from
                        );
                        if (importToRemove) {
                            newContent = this.removeLine(newContent, importToRemove.loc.start.line);
                        }
                        break;
                        
                    case 'modify':
                        // Modify existing import
                        const importToModify = importNodes.find(imp => 
                            imp.source.value === change.from
                        );
                        if (importToModify) {
                            const newImportLine = `import ${change.newImports} from '${change.from}';`;
                            newContent = this.replaceLine(newContent, importToModify.loc.start.line, newImportLine);
                        }
                        break;
                }
            }

            // Validate
            const validation = await syntaxValidator.validateSyntax(filePath, newContent);
            if (!validation.valid) {
                throw new Error(`Import modifications have syntax errors: ${validation.errors.map(e => e.message).join(', ')}`);
            }

            // Write file
            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();

            if (Editor.getOpenFiles().has(filePath)) {
                Editor.getOpenFiles().get(filePath)?.model.setValue(newContent);
            }

            await Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'), false);

            return {
                message: `Imports updated in ${filePath}`,
                changes: importChanges.length,
                method: 'import_modification'
            };

        } catch (error) {
            throw new Error(`Failed to update imports: ${error.message}`);
        }
    }

    // Helper methods

    /**
     * Parse JavaScript content into AST
     */
    parseJavaScript(content) {
        try {
            return acorn.parse(content, {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true,
                allowReturnOutsideFunction: true
            });
        } catch (error) {
            throw new Error(`Failed to parse JavaScript: ${error.message}`);
        }
    }

    /**
     * Find a function node in AST
     */
    findFunctionNode(ast, functionName) {
        let foundNode = null;
        
        acorn.walk.simple(ast, {
            FunctionDeclaration(node) {
                if (node.id && node.id.name === functionName) {
                    foundNode = node;
                }
            },
            VariableDeclarator(node) {
                if (node.id.name === functionName && 
                    (node.init?.type === 'FunctionExpression' || node.init?.type === 'ArrowFunctionExpression')) {
                    foundNode = node;
                }
            }
        });

        return foundNode;
    }

    /**
     * Find a class node in AST
     */
    findClassNode(ast, className) {
        let foundNode = null;
        
        acorn.walk.simple(ast, {
            ClassDeclaration(node) {
                if (node.id && node.id.name === className) {
                    foundNode = node;
                }
            }
        });

        return foundNode;
    }

    /**
     * Find import nodes in AST
     */
    findImportNodes(ast) {
        const imports = [];
        
        acorn.walk.simple(ast, {
            ImportDeclaration(node) {
                imports.push(node);
            }
        });

        return imports;
    }

    /**
     * Find all occurrences of a symbol in content
     */
    findSymbolOccurrences(content, symbolName) {
        const occurrences = [];
        const regex = new RegExp(`\\b${symbolName}\\b`, 'g');
        let match;

        while ((match = regex.exec(content)) !== null) {
            occurrences.push({
                start: match.index,
                end: match.index + symbolName.length,
                line: content.substring(0, match.index).split('\n').length
            });
        }

        return occurrences;
    }

    /**
     * Replace content at specific position
     */
    replaceAtPosition(content, start, end, replacement) {
        return content.substring(0, start) + replacement + content.substring(end);
    }

    /**
     * Replace specific lines in content
     */
    replaceLines(content, startLine, endLine, replacement) {
        const lines = content.split('\n');
        const before = lines.slice(0, startLine - 1);
        const after = lines.slice(endLine);
        const newLines = replacement.split('\n');
        
        return [...before, ...newLines, ...after].join('\n');
    }

    /**
     * Insert content at specific line
     */
    insertAtLine(content, lineNumber, insertion) {
        const lines = content.split('\n');
        lines.splice(lineNumber - 1, 0, insertion);
        return lines.join('\n');
    }

    /**
     * Remove a specific line
     */
    removeLine(content, lineNumber) {
        const lines = content.split('\n');
        lines.splice(lineNumber - 1, 1);
        return lines.join('\n');
    }

    /**
     * Replace a specific line
     */
    replaceLine(content, lineNumber, replacement) {
        const lines = content.split('\n');
        lines[lineNumber - 1] = replacement;
        return lines.join('\n');
    }

    /**
     * Detect indentation style in content
     */
    detectIndentation(content) {
        const lines = content.split('\n');
        
        for (const line of lines) {
            if (line.trim() && line.match(/^\s+/)) {
                const indent = line.match(/^\s+/)[0];
                return indent.includes('\t') ? '\t' : '    '; // Default to 4 spaces
            }
        }
        
        return '    '; // Default indentation
    }

    /**
     * Clear caches
     */
    clearCache() {
        this.astCache.clear();
        this.modificationHistory.clear();
    }
}

// Export singleton instance
export const preciseEditor = new PreciseEditor();