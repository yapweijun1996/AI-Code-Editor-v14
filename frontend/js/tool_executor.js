import { DbManager } from './db.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import { ChatService } from './chat_service.js';
import { UndoManager } from './undo_manager.js';
import { ToolLogger } from './tool_logger.js';
import { syntaxValidator } from './syntax_validator.js';
import { codeComprehension } from './code_comprehension.js';
import { preciseEditor } from './precise_editor.js';
import { backgroundIndexer } from './background_indexer.js';

// --- Helper Functions ---

function stripMarkdownCodeBlock(content) {
   if (typeof content !== 'string') {
       return content;
   }
   // Use a regular expression to match the code block format (e.g., ```javascript ... ```)
   const match = content.match(/^```(?:\w+)?\n([\s\S]+)\n```$/);
   // If it matches, return the captured group (the actual code). Otherwise, return the original content.
   return match ? match[1] : content;
}

// Enhanced syntax validation using the new validator
async function validateSyntaxBeforeWrite(filename, content) {
    try {
        const validation = await syntaxValidator.validateSyntax(filename, content);
        
        if (!validation.valid) {
            const errorMessages = validation.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
            
            // Show warnings but don't block
            if (validation.warnings && validation.warnings.length > 0) {
                console.warn('Syntax warnings:', validation.warnings);
            }
            
            // Show suggestions
            if (validation.suggestions && validation.suggestions.length > 0) {
                console.info('Suggestions:', validation.suggestions);
            }
            
            throw new Error(`Syntax validation failed:\n${errorMessages}\n\nSuggestions: ${validation.suggestions?.join(', ') || 'Check syntax manually'}`);
        }
        
        // Log warnings even if validation passes
        if (validation.warnings && validation.warnings.length > 0) {
            console.warn(`Syntax warnings in ${filename}:`, validation.warnings);
        }
        
        return true;
    } catch (error) {
        console.warn('Syntax validation error:', error);
        // Don't block file writing for validation errors, just warn
        return true;
    }
}

// Streaming file processing for large files
async function streamFileUpdate(filename, content, chunkSize = 50000) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    
    let result = '';
    for (let i = 0; i < chunks.length; i++) {
        result += chunks[i];
        
        // Yield control to prevent UI blocking
        if (i % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        // Update progress for large files
        if (chunks.length > 10) {
            const progress = Math.round((i / chunks.length) * 100);
            console.log(`Processing large file: ${progress}%`);
        }
    }
    
    return result;
}

// --- Tool Handlers ---

function unescapeHtmlEntities(text) {
    if (typeof text !== 'string') {
        return text;
    }
    // Use a temporary textarea element to decode entities
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    let decoded = textarea.value;

    // Additionally, handle JavaScript-style hex escapes that might not be covered
    try {
        decoded = decoded.replace(/\\x([0-9A-Fa-f]{2})/g, (match, p1) => {
            return String.fromCharCode(parseInt(p1, 16));
        });
    } catch (e) {
        console.error("Error decoding hex escapes", e);
    }
    
    return decoded;
}

async function _getProjectStructure(params, rootHandle) {
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
    const tree = await FileSystem.buildStructureTree(rootHandle, ignorePatterns);
    const structure = FileSystem.formatTreeToString(tree);
    return { structure };
}

async function _readFile({ filename }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for read_file.");
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();

    const MAX_CONTEXT_BYTES = 256000; // 256KB threshold

    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();

    if (file.size > MAX_CONTEXT_BYTES) {
        return {
            status: "Success",
            message: "File is too large to be returned in full.",
            filename: filename,
            file_size: file.size,
            truncated: true,
            guidance: "The file content was not returned to prevent exceeding the context window. The file has been opened in the editor. Use surgical tools like 'create_and_apply_diff' to modify it based on the visible content."
        };
    }

    const content = await file.text();
    const cleanContent = unescapeHtmlEntities(content);
    // There seems to be an issue with the return value being mutated.
    // Creating a new object explicitly can prevent this.
    const result = { content: cleanContent };
    return result;
}

async function _readFileLines({ filename, start_line, end_line }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (typeof start_line !== 'number' || typeof end_line !== 'number') {
        throw new Error("The 'start_line' and 'end_line' parameters must be numbers.");
    }
    if (start_line > end_line) {
        throw new Error("The 'start_line' must not be after the 'end_line'.");
    }

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    const lines = content.split('\n');
    
    // Clamp the line numbers to the file's bounds
    const clampedStart = Math.max(1, start_line);
    const clampedEnd = Math.min(lines.length, end_line);

    if (clampedStart > clampedEnd) {
        return { content: '' }; // Return empty if the range is invalid after clamping
    }

    const selectedLines = lines.slice(clampedStart - 1, clampedEnd);
    return { content: selectedLines.join('\n') };
}

async function _searchInFile({ filename, pattern, context = 2 }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (!pattern) throw new Error("The 'pattern' (string or regex) parameter is required.");

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    const lines = content.split('\n');
    
    const searchResults = [];
    const regex = new RegExp(pattern, 'g');

    lines.forEach((line, index) => {
        if (line.match(regex)) {
            const start = Math.max(0, index - context);
            const end = Math.min(lines.length, index + context + 1);
            const contextLines = lines.slice(start, end).map((contextLine, contextIndex) => {
                const lineNumber = start + contextIndex + 1;
                return `${lineNumber}: ${contextLine}`;
            });
            
            searchResults.push({
                line_number: index + 1,
                line_content: line,
                context: contextLines.join('\n')
            });
        }
    });

    if (searchResults.length === 0) {
        return { message: "No matches found." };
    }

    return { results: searchResults };
}

async function _readMultipleFiles({ filenames }, rootHandle) {
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        throw new Error("The 'filenames' parameter is required and must be a non-empty array of strings.");
    }

    const MAX_CONTEXT_BYTES = 256000; // 256KB threshold per file
    let combinedContent = '';

    for (const filename of filenames) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
            const file = await fileHandle.getFile();
            
            combinedContent += `--- START OF FILE: ${filename} ---\n`;

            if (file.size > MAX_CONTEXT_BYTES) {
                combinedContent += `File is too large to be included in the context (Size: ${file.size} bytes).\n`;
                combinedContent += `Guidance: The file has been opened in the editor. Use surgical tools to modify it.\n`;
            } else {
                let content = await file.text();
                combinedContent += content + '\n';
            }
            
            combinedContent += `--- END OF FILE: ${filename} ---\n\n`;

            await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
        } catch (error) {
            combinedContent += `--- ERROR READING FILE: ${filename} ---\n`;
            combinedContent += `${error.message}\n`;
            combinedContent += `--- END OF ERROR ---\n\n`;
        }
    }
    
    document.getElementById('chat-input').focus();
    return { combined_content: combinedContent };
}

async function _createFile({ filename, content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for create_file.");
    const cleanContent = stripMarkdownCodeBlock(content);
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename, { create: true });
    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }
    
    // Track for undo - save empty content since this is a new file creation
    UndoManager.push(filename, '');
    
    const writable = await fileHandle.createWritable();
    await writable.write(cleanContent);
    await writable.close();
    await new Promise(resolve => setTimeout(resolve, 100)); // Mitigate race condition
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `File '${filename}' created successfully.` };
}

async function _rewriteFile({ filename, content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for rewrite_file.");
    const cleanContent = stripMarkdownCodeBlock(content);
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename, { create: true });
    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }
    
    let originalContent = '';
    try {
        const file = await fileHandle.getFile();
        originalContent = await file.text();
        UndoManager.push(filename, originalContent);
    } catch (e) {
        // File doesn't exist, push empty content for undo
        UndoManager.push(filename, '');
    }

    // Validate syntax before writing
    await validateSyntaxBeforeWrite(filename, cleanContent);

    // Use streaming for large files
    const STREAM_THRESHOLD = 100000; // 100KB
    let processedContent = cleanContent;
    
    if (cleanContent.length > STREAM_THRESHOLD) {
        console.log(`Processing large file ${filename} with streaming...`);
        processedContent = await streamFileUpdate(filename, cleanContent);
    }

    const writable = await fileHandle.createWritable();
    await writable.write(processedContent);
    await writable.close();
    
    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(processedContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `File '${filename}' rewritten successfully.` };
}

async function _deleteFile({ filename }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for delete_file.");
    const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, filename);
    await parentHandle.removeEntry(entryName);
    await new Promise(resolve => setTimeout(resolve, 100)); // Mitigate race condition
    if (Editor.getOpenFiles().has(filename)) {
        Editor.closeTab(filename, document.getElementById('tab-bar'));
    }
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `File '${filename}' deleted successfully.` };
}

async function _renameFile({ old_path, new_path }, rootHandle) {
    if (!old_path || !new_path) throw new Error("The 'old_path' and 'new_path' parameters are required for rename_file.");
    await FileSystem.renameEntry(rootHandle, old_path, new_path);
    await new Promise(resolve => setTimeout(resolve, 100)); // Mitigate race condition
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    if (Editor.getOpenFiles().has(old_path)) {
        Editor.closeTab(old_path, document.getElementById('tab-bar'));
        const newFileHandle = await FileSystem.getFileHandleFromPath(rootHandle, new_path);
        await Editor.openFile(newFileHandle, new_path, document.getElementById('tab-bar'), false);
        document.getElementById('chat-input').focus();
    }
    return { message: `File '${old_path}' renamed to '${new_path}' successfully.` };
}

async function _insertContent({ filename, line_number, content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for insert_content.");
    if (typeof line_number !== 'number') throw new Error("The 'line_number' parameter is required and must be a number for insert_content.");
    const cleanContent = stripMarkdownCodeBlock(content);
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    
    // Check permissions before modifying content
    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }
    
    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);
    const lines = originalContent.split('\n');
    const insertionPoint = Math.max(0, line_number - 1);
    lines.splice(insertionPoint, 0, cleanContent);
    const newContent = lines.join('\n');
    const writable = await fileHandle.createWritable();
     await writable.write(newContent);
     await writable.close();
    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(newContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `Content inserted into '${filename}' at line ${line_number}.` };
}

async function _replaceLines({ filename, start_line, end_line, new_content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (typeof start_line !== 'number' || typeof end_line !== 'number') {
        throw new Error("The 'start_line' and 'end_line' parameters must be numbers.");
    }
    if (start_line > end_line) {
        throw new Error("The 'start_line' must not be after the 'end_line'.");
    }

    const cleanNewContent = stripMarkdownCodeBlock(new_content);
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }

    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);
    const lines = originalContent.split(/\r?\n/); // Handle both \n and \r\n

    // Clamp the line numbers to the file's bounds
    const clampedStart = Math.max(1, Math.min(lines.length, start_line));
    const clampedEnd = Math.max(clampedStart, Math.min(lines.length, end_line));

    // Preserve indentation from the first line being replaced
    const firstLineIndent = lines[clampedStart - 1]?.match(/^(\s*)/)?.[1] || '';
    
    const before = lines.slice(0, clampedStart - 1);
    const after = lines.slice(clampedEnd);
    const newLines = cleanNewContent.split(/\r?\n/);
    
    // Apply consistent indentation to new content if needed
    const indentedNewLines = newLines.map((line, index) => {
        if (index === 0 || line.trim() === '') return line;
        // Only add indentation if the line doesn't already have proper indentation
        return line.startsWith(firstLineIndent) ? line : firstLineIndent + line.trimStart();
    });

    // Preserve original line endings
    const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const updatedContent = [...before, ...indentedNewLines, ...after].join(lineEnding);

    // Validate syntax before applying changes
    await validateSyntaxBeforeWrite(filename, updatedContent);

    const writable = await fileHandle.createWritable();
    await writable.write(updatedContent);
    await writable.close();

    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(updatedContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();

    return { message: `Lines ${clampedStart}-${clampedEnd} in '${filename}' were replaced successfully.` };
}

async function _applyDiff({ filename, patch_content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for apply_diff.");
    if (!patch_content) throw new Error("The 'patch_content' parameter is required for apply_diff.");

    const dmp = new diff_match_patch();
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);
    
    let patchText = patch_content;
    if (typeof patch_content !== 'string') {
        patchText = String(patch_content);
    }
    
    const patches = dmp.patch_fromText(patchText);
    const [newContent, results] = dmp.patch_apply(patches, originalContent);

    if (results.some(r => !r)) {
        throw new Error(`Failed to apply patch to '${filename}'. The patch may not be valid.`);
    }

    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }
    const writable = await fileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();

    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(newContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `Patch applied to '${filename}' successfully.` };
}

async function _createDiff({ original_content, new_content }) {
    if (original_content === undefined) throw new Error("The 'original_content' parameter is required for create_diff.");
    if (new_content === undefined) throw new Error("The 'new_content' parameter is required for create_diff.");

    const dmp = new diff_match_patch();
    const a = dmp.diff_linesToChars_(original_content, new_content);
    const lineText1 = a.chars1;
    const lineText2 = a.chars2;
    const lineArray = a.lineArray;
    const diffs = dmp.diff_main(lineText1, lineText2, false);
    dmp.diff_charsToLines_(diffs, lineArray);
    const patches = dmp.patch_make(original_content, diffs);
    const patchText = dmp.patch_toText(patches);

    return { patch_content: patchText };
}

async function _createAndApplyDiff({ filename, new_content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for create_and_apply_diff.");
    if (new_content === undefined) throw new Error("The 'new_content' parameter is required for create_and_apply_diff.");

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }

    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);
    const cleanNewContent = stripMarkdownCodeBlock(new_content);

    // Smart thresholds based on file size and content complexity
    const PROGRESSIVE_DIFF_THRESHOLD = 1000000; // 1MB - use streaming
    const LINE_DIFF_THRESHOLD = 100000; // 100KB - use line-based diff
    const SIMPLE_DIFF_THRESHOLD = 50000; // 50KB - use standard diff

    let finalContent = cleanNewContent;
    let method = 'rewrite';

    // Validate syntax before processing
    await validateSyntaxBeforeWrite(filename, cleanNewContent);

    if (file.size > PROGRESSIVE_DIFF_THRESHOLD) {
        // For very large files, use streaming with chunked processing
        console.log(`Using streaming diff for large file: ${filename}`);
        finalContent = await streamFileUpdate(filename, cleanNewContent);
        method = 'stream';
    } else if (file.size > LINE_DIFF_THRESHOLD) {
        // For moderately large files, use optimized line-based diff
        method = await performOptimizedLineDiff(originalContent, cleanNewContent, filename);
        finalContent = method.success ? method.content : cleanNewContent;
        method = method.success ? 'line-diff' : 'rewrite';
    } else if (file.size > SIMPLE_DIFF_THRESHOLD) {
        // For smaller files, use standard diff but with better error handling
        method = await performStandardDiff(originalContent, cleanNewContent, filename);
        finalContent = method.success ? method.content : cleanNewContent;
        method = method.success ? 'diff' : 'rewrite';
    }
    // For very small files, just rewrite (it's faster than diffing)

    const writable = await fileHandle.createWritable();
    await writable.write(finalContent);
    await writable.close();

    if (Editor.getOpenFiles().has(filename)) {
        const openFile = Editor.getOpenFiles().get(filename);
        if (openFile?.model) {
            // Use batch operations for large content updates
            if (finalContent.length > 100000) {
                openFile.model.pushEditOperations([], [{
                    range: openFile.model.getFullModelRange(),
                    text: finalContent
                }], () => null);
            } else {
                openFile.model.setValue(finalContent);
            }
        }
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `File '${filename}' updated successfully (Method: ${method}).` };
}

// Optimized line-based diff for moderately large files
async function performOptimizedLineDiff(originalContent, newContent, filename) {
    try {
        const dmp = new diff_match_patch();
        dmp.Diff_Timeout = 2; // 2 second timeout
        
        const a = dmp.diff_linesToChars_(originalContent, newContent);
        const lineText1 = a.chars1;
        const lineText2 = a.chars2;
        const lineArray = a.lineArray;
        
        const diffs = dmp.diff_main(lineText1, lineText2, false);
        dmp.diff_charsToLines_(diffs, lineArray);
        dmp.diff_cleanupSemantic(diffs);
        
        const patches = dmp.patch_make(originalContent, diffs);
        
        if (patches.length === 0 && originalContent !== newContent) {
            return { success: false };
        }
        
        const [patchedContent, results] = dmp.patch_apply(patches, originalContent);
        
        if (results.some(r => !r)) {
            return { success: false };
        }
        
        return { success: true, content: patchedContent };
    } catch (error) {
        console.warn(`Optimized line diff failed for ${filename}:`, error.message);
        return { success: false };
    }
}

// Standard diff with improved error handling
async function performStandardDiff(originalContent, newContent, filename) {
    try {
        const dmp = new diff_match_patch();
        dmp.Diff_Timeout = 1; // 1 second timeout for smaller files
        
        const diffs = dmp.diff_main(originalContent, newContent);
        dmp.diff_cleanupSemantic(diffs);
        
        const patches = dmp.patch_make(originalContent, diffs);
        
        if (patches.length === 0 && originalContent !== newContent) {
            return { success: false };
        }
        
        const [patchedContent, results] = dmp.patch_apply(patches, originalContent);
        
        if (results.some(r => !r)) {
            return { success: false };
        }
        
        return { success: true, content: patchedContent };
    } catch (error) {
        console.warn(`Standard diff failed for ${filename}:`, error.message);
        return { success: false };
    }
}

async function _createFolder({ folder_path }, rootHandle) {
    if (!folder_path) throw new Error("The 'folder_path' parameter is required for create_folder.");
    await FileSystem.createDirectoryFromPath(rootHandle, folder_path);
    await new Promise(resolve => setTimeout(resolve, 100)); // Mitigate race condition
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `Folder '${folder_path}' created successfully.` };
}

async function _deleteFolder({ folder_path }, rootHandle) {
    if (!folder_path) throw new Error("The 'folder_path' parameter is required for delete_folder.");
    const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, folder_path);
    await parentHandle.removeEntry(entryName, { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 100)); // Mitigate race condition
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `Folder '${folder_path}' deleted successfully.` };
}

async function _renameFolder({ old_folder_path, new_folder_path }, rootHandle) {
    if (!old_folder_path || !new_folder_path) throw new Error("The 'old_folder_path' and 'new_folder_path' parameters are required for rename_folder.");
    await FileSystem.renameEntry(rootHandle, old_folder_path, new_folder_path);
    await new Promise(resolve => setTimeout(resolve, 100)); // Mitigate race condition
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `Folder '${old_folder_path}' renamed to '${new_folder_path}' successfully.` };
}

async function _searchCode({ search_term }, rootHandle) {
    if (!backgroundIndexer.isAvailable()) {
        throw new Error("The background indexer is not ready. Please wait a moment and try again.");
    }
    const searchResults = await backgroundIndexer.searchInIndex(search_term);
   
   const successfulResults = searchResults.filter(r => r.matches);
   const erroredFiles = searchResults.filter(r => r.error);

   let summary = `Search complete. Found ${successfulResults.length} files with matches.`;
   if (erroredFiles.length > 0) {
       summary += ` Failed to search ${erroredFiles.length} files.`;
   }

    return {
       summary: summary,
       results: successfulResults,
       errors: erroredFiles
   };
}

async function _buildCodebaseIndex(params, rootHandle) {
    const startTime = Date.now();
    UI.appendMessage(document.getElementById('chat-messages'), 'Checking for updates and building codebase index...', 'ai');

    const lastIndexTimestamp = await DbManager.getLastIndexTimestamp() || 0;
    const existingIndex = await DbManager.getCodeIndex();
    
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
    const { index: newIndex, stats } = await CodebaseIndexer.buildIndex(rootHandle, { lastIndexTimestamp, existingIndex, ignorePatterns });
    
    await DbManager.saveCodeIndex(newIndex);
    await DbManager.saveLastIndexTimestamp(startTime);

    const message = `Codebase index updated. ${stats.indexedFileCount} files indexed, ${stats.skippedFileCount} files skipped (unchanged), ${stats.deletedFileCount} files removed.`;
    return { message };
}

async function _queryCodebase({ query }) {
    const index = await DbManager.getCodeIndex();
    if (!index) throw new Error("No codebase index. Please run 'build_or_update_codebase_index'.");
    const queryResults = await CodebaseIndexer.queryIndex(index, query);
    return { results: queryResults };
}

async function _reindexCodebasePaths({ paths }, rootHandle) {
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        throw new Error("The 'paths' parameter is required and must be a non-empty array.");
    }

    UI.appendMessage(document.getElementById('chat-messages'), `Re-indexing ${paths.length} specific paths...`, 'ai');
    
    const index = await DbManager.getCodeIndex();
    if (!index) {
        throw new Error("No codebase index found. Please run 'build_or_update_codebase_index' first.");
    }
    const stats = { indexedFileCount: 0, skippedFileCount: 0, deletedFileCount: 0 };
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);

    await CodebaseIndexer.reIndexPaths(rootHandle, paths, index, stats, ignorePatterns);

    await DbManager.saveCodeIndex(index);
    
    const message = `Re-indexing complete for specified paths. ${stats.indexedFileCount} files were updated.`;
    return { message };
}

async function _formatCode({ filename }, rootHandle) {
    return new Promise(async (resolve, reject) => {
        if (!filename) {
            return reject(new Error("The 'filename' parameter is required."));
        }

        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();
            UndoManager.push(filename, originalContent);
            const parser = Editor.getPrettierParser(filename);
            
            if (!parser) {
                return reject(new Error(`Could not determine Prettier parser for file: ${filename}`));
            }

            const prettierWorker = new Worker('prettier.worker.js');

            prettierWorker.onmessage = async (event) => {
                if (event.data.success) {
                    const formattedCode = event.data.formattedCode;
                    
                    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
                        return reject(new Error('Permission to write to the file was denied.'));
                    }
                    
                    const writable = await fileHandle.createWritable();
                    await writable.write(formattedCode);
                    await writable.close();

                    if (Editor.getOpenFiles().has(filename)) {
                        Editor.getOpenFiles().get(filename)?.model.setValue(formattedCode);
                    }
                    
                    resolve({ message: `File '${filename}' formatted successfully.` });
                } else {
                    console.error('Error formatting file from worker:', event.data.error);
                    reject(new Error(`An error occurred while formatting the file: ${event.data.error}`));
                }
                prettierWorker.terminate();
            };
            
            prettierWorker.onerror = (error) => {
                reject(new Error(`Prettier worker error: ${error.message}`));
                prettierWorker.terminate();
            };

            prettierWorker.postMessage({ code: originalContent, parser });

        } catch (error) {
            reject(new Error(`Failed to format code: ${error.message}`));
        }
    });
}

async function _analyzeCode({ filename }, rootHandle) {
    if (!filename.endsWith('.js')) {
        throw new Error('This tool can only analyze .js files. Use read_file for others.');
    }
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    const ast = acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const analysis = { functions: [], classes: [], imports: [] };
    acorn.walk.simple(ast, {
        FunctionDeclaration(node) { analysis.functions.push({ name: node.id.name, start: node.loc.start.line, end: node.loc.end.line }); },
        ClassDeclaration(node) { analysis.classes.push({ name: node.id.name, start: node.loc.start.line, end: node.loc.end.line }); },
        ImportDeclaration(node) { analysis.imports.push({ source: node.source.value, specifiers: node.specifiers.map((s) => s.local.name) }); },
    });
    return { analysis };
}

// Helper function to validate terminal commands for safety
function validateTerminalCommand(command) {
    if (!command || typeof command !== 'string') {
        throw new Error('Command must be a non-empty string');
    }
    
    // List of dangerous commands that should be blocked
    const dangerousCommands = [
        'rm -rf',
        'rm -r',
        'sudo rm',
        'format',
        'del /s',
        'rd /s',
        'mkfs',
        'dd if=',
        'fdisk',
        'shutdown',
        'reboot',
        'halt',
        'init 0',
        'killall',
        'kill -9',
        'chmod 777',
        'chown -R',
        '> /dev/',
        'curl.*|.*sh',
        'wget.*|.*sh',
    ];
    
    const lowerCommand = command.toLowerCase();
    for (const dangerous of dangerousCommands) {
        if (lowerCommand.includes(dangerous.toLowerCase())) {
            throw new Error(`Command contains potentially dangerous operation: ${dangerous}`);
        }
    }
    
    // Block commands with suspicious patterns
    if (lowerCommand.match(/rm\s+.*-r/) || 
        lowerCommand.match(/>\s*\/dev\//) ||
        lowerCommand.match(/\|\s*sh/) ||
        lowerCommand.match(/\|\s*bash/)) {
        throw new Error('Command contains potentially dangerous patterns');
    }
    
    return true;
}

async function _runTerminalCommand(parameters, rootHandle) {
    if (!parameters.command) {
        throw new Error("The 'command' parameter is required for run_terminal_command.");
    }
    
    // Validate command for security
    validateTerminalCommand(parameters.command);
    
    const updatedParameters = { ...parameters, cwd: rootHandle.name };
    const response = await fetch('/api/execute-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'run_terminal_command', parameters: updatedParameters }),
    });
    const terminalResult = await response.json();
    if (terminalResult.status === 'Success') {
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        return { output: terminalResult.output };
    } else {
        throw new Error(`Command failed. This is likely a backend issue. Please check the server logs. Raw message: ${terminalResult.message}`);
    }
}

// Helper function to safely escape shell arguments
function escapeShellArg(arg) {
    if (typeof arg !== 'string') {
        throw new Error('Shell argument must be a string');
    }
    // Replace any single quotes with '\'' (close quote, escaped quote, open quote)
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function _getFileHistory({ filename }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for get_file_history.");
    
    // Safely escape the filename to prevent command injection
    const escapedFilename = escapeShellArg(filename);
    const command = `git log --pretty=format:"%h - %an, %ar : %s" -- ${escapedFilename}`;
    const updatedParameters = { command, cwd: rootHandle.name };
    const response = await fetch('/api/execute-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'run_terminal_command', parameters: updatedParameters }),
    });
    const terminalResult = await response.json();
    if (terminalResult.status === 'Success') {
        return { history: terminalResult.output };
    } else {
        throw new Error(terminalResult.message || `Fetching file history failed. This is likely a backend issue with 'git'.`);
    }
}

// --- Non-Project Tools ---

async function _readUrl({ url }) {
    const response = await fetch('/api/read-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const urlResult = await response.json();
    if (response.ok) {
        return urlResult;
    } else {
        throw new Error(urlResult.message || 'Failed to read URL');
    }
}

async function _duckduckgoSearch({ query }) {
    const response = await fetch('/api/duckduckgo-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const searchResult = await response.json();
    if (response.ok) {
        return searchResult;
    } else {
        throw new Error(searchResult.message || 'Failed to perform search');
    }
}

async function _getOpenFileContent() {
    const activeFile = Editor.getActiveFile();
    if (!activeFile) throw new Error('No file is currently open in the editor.');
    
    const content = activeFile.model.getValue();
    return { filename: activeFile.name, content: content };
}

async function _getSelectedText() {
    const editor = Editor.getEditorInstance();
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
        throw new Error('Error: No text is currently selected in the editor. Please select the text you want to get.');
    }
    const selectedText = editor.getModel().getValueInRange(selection);
    return {
        selected_text: selectedText,
        start_line: selection.startLineNumber,
        start_column: selection.startColumn,
        end_line: selection.endLineNumber,
        end_column: selection.endColumn,
        details: `Selection from L${selection.startLineNumber}:C${selection.startColumn} to L${selection.endLineNumber}:C${selection.endColumn}`
    };
}

async function _setSelectedText({ start_line, start_column, end_line, end_column }) {
    if (start_line === undefined || start_column === undefined || end_line === undefined || end_column === undefined) {
        throw new Error("Parameters 'start_line', 'start_column', 'end_line', and 'end_column' are required.");
    }
    const editor = Editor.getEditorInstance();
    const range = new monaco.Range(start_line, start_column, end_line, end_column);
    editor.setSelection(range);
    editor.revealRange(range, monaco.editor.ScrollType.Smooth); // Scroll to the selection
    editor.focus();
    return { message: `Selection set to L${start_line}:C${start_column} to L${end_line}:C${end_column}.` };
}

async function _replaceSelectedText({ new_text }) {
   const cleanText = stripMarkdownCodeBlock(new_text);
   const editor = Editor.getEditorInstance();
   const selection = editor.getSelection();
   if (!selection || selection.isEmpty()) throw new Error('Error: No text is selected in the editor. Please select the text you want to replace.');
   editor.executeEdits('ai-agent', [{ range: selection, text: cleanText }]);
   return { message: 'Replaced the selected text.' };
}

// =================================================================
// === Backend Indexing Tools                                    ===
// =================================================================

async function build_backend_index(params, rootHandle) {
   const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
   const response = await fetch('/api/build-codebase-index', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ ignorePatterns }),
   });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to build backend index: ${error.message}`);
  }
  const result = await response.json();
  return `Backend index built successfully. Indexed ${result.indexedFiles} files and found ${result.totalSymbols} symbols.`;
}

async function query_backend_index({ query, page = 1, limit = 20 }) {
  const params = new URLSearchParams({ query, page, limit });
  const response = await fetch(`/api/query-codebase?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to query backend index: ${error.message}`);
  }
  const result = await response.json();
  return result;
}


async function _undoLastChange(params, rootHandle) {
   const lastState = UndoManager.pop();
   if (!lastState) {
       return { message: "No file modifications to undo." };
   }

   const { filename, content } = lastState;
   await _rewriteFile({ filename, content }, rootHandle);
   
   // After undoing, we don't want the user to "redo" the undo, so don't push to stack again.
   // The rewriteFile call inside this function will have pushed the state *before* the undo.
   // We need to pop that off to prevent a confusing redo state.
   UndoManager.pop();


   return { message: `Undid the last change to '${filename}'.` };
}

async function _listTools() {
   const toolNames = Object.keys(toolRegistry);
   return { tools: toolNames };
}

// --- Enhanced Code Comprehension Tools ---

async function _analyzeSymbol({ symbol_name, file_path }, rootHandle) {
    if (!symbol_name) throw new Error("The 'symbol_name' parameter is required.");
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const analysis = await codeComprehension.analyzeSymbol(symbol_name, file_path, rootHandle);
    return { analysis };
}

async function _explainCodeSection({ file_path, start_line, end_line }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    if (typeof start_line !== 'number') throw new Error("The 'start_line' parameter is required and must be a number.");
    if (typeof end_line !== 'number') throw new Error("The 'end_line' parameter is required and must be a number.");
    
    const explanation = await codeComprehension.explainCodeSection(file_path, start_line, end_line, rootHandle);
    return { explanation };
}

async function _traceVariableFlow({ variable_name, file_path }, rootHandle) {
    if (!variable_name) throw new Error("The 'variable_name' parameter is required.");
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const analysis = await codeComprehension.analyzeSymbol(variable_name, file_path, rootHandle);
    return {
        variable: variable_name,
        definitions: analysis.definitions,
        usages: analysis.usages,
        dataFlow: analysis.dataFlow,
        relatedFiles: analysis.relatedFiles
    };
}

// --- Precise Code Modification Tools ---

async function _modifyFunction({ file_path, function_name, new_implementation }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    if (!function_name) throw new Error("The 'function_name' parameter is required.");
    if (!new_implementation) throw new Error("The 'new_implementation' parameter is required.");
    
    const cleanImplementation = stripMarkdownCodeBlock(new_implementation);
    const result = await preciseEditor.modifyFunction(file_path, function_name, cleanImplementation, rootHandle);
    
    await Editor.openFile(await FileSystem.getFileHandleFromPath(rootHandle, file_path), file_path, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    
    return result;
}

async function _modifyClass({ file_path, class_name, new_implementation }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    if (!class_name) throw new Error("The 'class_name' parameter is required.");
    if (!new_implementation) throw new Error("The 'new_implementation' parameter is required.");
    
    const cleanImplementation = stripMarkdownCodeBlock(new_implementation);
    const result = await preciseEditor.modifyClass(file_path, class_name, cleanImplementation, rootHandle);
    
    await Editor.openFile(await FileSystem.getFileHandleFromPath(rootHandle, file_path), file_path, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    
    return result;
}

async function _renameSymbol({ old_name, new_name, file_paths }, rootHandle) {
    if (!old_name) throw new Error("The 'old_name' parameter is required.");
    if (!new_name) throw new Error("The 'new_name' parameter is required.");
    if (!file_paths || !Array.isArray(file_paths)) throw new Error("The 'file_paths' parameter is required and must be an array.");
    
    const result = await preciseEditor.renameSymbol(old_name, new_name, file_paths, rootHandle);
    
    // Open the first modified file
    if (result.successful > 0) {
        const firstSuccessful = result.details.find(d => d.status === 'success');
        if (firstSuccessful) {
            await Editor.openFile(await FileSystem.getFileHandleFromPath(rootHandle, firstSuccessful.file), firstSuccessful.file, document.getElementById('tab-bar'), false);
        }
    }
    
    document.getElementById('chat-input').focus();
    return result;
}

async function _addMethodToClass({ file_path, class_name, method_name, method_implementation }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    if (!class_name) throw new Error("The 'class_name' parameter is required.");
    if (!method_name) throw new Error("The 'method_name' parameter is required.");
    if (!method_implementation) throw new Error("The 'method_implementation' parameter is required.");
    
    const cleanImplementation = stripMarkdownCodeBlock(method_implementation);
    const result = await preciseEditor.addMethodToClass(file_path, class_name, method_name, cleanImplementation, rootHandle);
    
    await Editor.openFile(await FileSystem.getFileHandleFromPath(rootHandle, file_path), file_path, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    
    return result;
}

async function _updateImports({ file_path, import_changes }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    if (!import_changes || !Array.isArray(import_changes)) throw new Error("The 'import_changes' parameter is required and must be an array.");
    
    const result = await preciseEditor.updateImports(file_path, import_changes, rootHandle);
    
    await Editor.openFile(await FileSystem.getFileHandleFromPath(rootHandle, file_path), file_path, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    
    return result;
}

// --- Enhanced Analysis Tools ---

async function _validateSyntax({ file_path }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    const validation = await syntaxValidator.validateSyntax(file_path, content);
    
    return {
        file: file_path,
        valid: validation.valid,
        language: validation.language,
        errors: validation.errors || [],
        warnings: validation.warnings || [],
        suggestions: validation.suggestions || []
    };
}

// --- Tool Registry ---

const toolRegistry = {
   list_tools: { handler: _listTools, requiresProject: false, createsCheckpoint: false },
    // Project-based tools
    get_project_structure: { handler: _getProjectStructure, requiresProject: true, createsCheckpoint: false },
    
    // Enhanced code comprehension tools
    analyze_symbol: { handler: _analyzeSymbol, requiresProject: true, createsCheckpoint: false },
    explain_code_section: { handler: _explainCodeSection, requiresProject: true, createsCheckpoint: false },
    trace_variable_flow: { handler: _traceVariableFlow, requiresProject: true, createsCheckpoint: false },
    validate_syntax: { handler: _validateSyntax, requiresProject: true, createsCheckpoint: false },
    
    // Precise code modification tools
    modify_function: { handler: _modifyFunction, requiresProject: true, createsCheckpoint: true },
    modify_class: { handler: _modifyClass, requiresProject: true, createsCheckpoint: true },
    rename_symbol: { handler: _renameSymbol, requiresProject: true, createsCheckpoint: true },
    add_method_to_class: { handler: _addMethodToClass, requiresProject: true, createsCheckpoint: true },
    update_imports: { handler: _updateImports, requiresProject: true, createsCheckpoint: true },
    read_file: { handler: _readFile, requiresProject: true, createsCheckpoint: false },
    read_file_lines: { handler: _readFileLines, requiresProject: true, createsCheckpoint: false },
    search_in_file: { handler: _searchInFile, requiresProject: true, createsCheckpoint: false },
    read_multiple_files: { handler: _readMultipleFiles, requiresProject: true, createsCheckpoint: false },
    search_code: { handler: _searchCode, requiresProject: true, createsCheckpoint: false },
    build_or_update_codebase_index: { handler: _buildCodebaseIndex, requiresProject: true, createsCheckpoint: false },
    query_codebase: { handler: _queryCodebase, requiresProject: true, createsCheckpoint: false },
    reindex_codebase_paths: { handler: _reindexCodebasePaths, requiresProject: true, createsCheckpoint: false },
    format_code: { handler: _formatCode, requiresProject: true, createsCheckpoint: false },
    analyze_code: { handler: _analyzeCode, requiresProject: true, createsCheckpoint: false },
    get_file_history: { handler: _getFileHistory, requiresProject: true, createsCheckpoint: false },
    run_terminal_command: { handler: _runTerminalCommand, requiresProject: true, createsCheckpoint: false },

    // New backend indexer tools
    build_backend_index: { handler: build_backend_index, requiresProject: true, createsCheckpoint: false },
    query_backend_index: { handler: query_backend_index, requiresProject: true, createsCheckpoint: false },

    // Filesystem modification tools
    create_file: { handler: _createFile, requiresProject: true, createsCheckpoint: true },
    rewrite_file: { handler: _rewriteFile, requiresProject: true, createsCheckpoint: true },
    delete_file: { handler: _deleteFile, requiresProject: true, createsCheckpoint: true },
    rename_file: { handler: _renameFile, requiresProject: true, createsCheckpoint: true },
    insert_content: { handler: _insertContent, requiresProject: true, createsCheckpoint: true },
    apply_diff: { handler: _applyDiff, requiresProject: true, createsCheckpoint: true },
    replace_lines: { handler: _replaceLines, requiresProject: true, createsCheckpoint: true },
    create_and_apply_diff: { handler: _createAndApplyDiff, requiresProject: true, createsCheckpoint: true },
    create_folder: { handler: _createFolder, requiresProject: true, createsCheckpoint: true },
    delete_folder: { handler: _deleteFolder, requiresProject: true, createsCheckpoint: true },
    rename_folder: { handler: _renameFolder, requiresProject: true, createsCheckpoint: true },

    // Non-project / Editor tools
    read_url: { handler: _readUrl, requiresProject: false, createsCheckpoint: false },
    duckduckgo_search: { handler: _duckduckgoSearch, requiresProject: false, createsCheckpoint: false },
    get_open_file_content: { handler: _getOpenFileContent, requiresProject: false, createsCheckpoint: false },
    get_selected_text: { handler: _getSelectedText, requiresProject: false, createsCheckpoint: false },
    replace_selected_text: { handler: _replaceSelectedText, requiresProject: false, createsCheckpoint: false },
    set_selected_text: { handler: _setSelectedText, requiresProject: false, createsCheckpoint: false },
    create_diff: { handler: _createDiff, requiresProject: false, createsCheckpoint: false },
    undo_last_change: { handler: _undoLastChange, requiresProject: true, createsCheckpoint: false },
};

// --- Core Execution Logic ---

async function createAutomaticCheckpoint() {
    try {
        const editorState = Editor.getEditorState();
        if (editorState.openFiles.length > 0) {
            const checkpointData = {
                name: `Auto-Checkpoint @ ${new Date().toLocaleString()}`,
                editorState: editorState,
                timestamp: Date.now(),
            };
            await DbManager.saveCheckpoint(checkpointData);
        }
    } catch (error) {
        console.error('Failed to create automatic checkpoint:', error);
    }
}

async function executeTool(toolCall, rootDirectoryHandle) {
    const { name: toolName, args: parameters } = toolCall;
    const tool = toolRegistry[toolName];

    if (!tool) {
        throw new Error(`Unknown tool '${toolName}'.`);
    }

    if (tool.requiresProject && !rootDirectoryHandle) {
        return { error: "No project folder is open. Please ask the user to open a folder before using this tool." };
    }

    if (tool.createsCheckpoint) {
        await createAutomaticCheckpoint();
    }

    return tool.handler(parameters, rootDirectoryHandle);
}

const TOOLS_REQUIRING_SYNTAX_CHECK = ['rewrite_file', 'insert_content', 'replace_selected_text', 'apply_diff', 'replace_lines'];

export async function execute(toolCall, rootDirectoryHandle) {
    const toolName = toolCall.name;
    const parameters = toolCall.args;
    const groupTitle = `AI Tool Call: ${toolName}`;
    const groupContent = parameters && Object.keys(parameters).length > 0 ? parameters : 'No parameters';
    console.group(groupTitle, groupContent);
    const logEntry = UI.appendToolLog(document.getElementById('chat-messages'), toolName, parameters);

    let resultForModel;
    let isSuccess = true;

    try {
        resultForModel = await executeTool(toolCall, rootDirectoryHandle);
        ToolLogger.log(toolName, parameters, 'Success', resultForModel);
    } catch (error) {
        isSuccess = false;
        const errorMessage = `Error executing tool '${toolName}': ${error.message}`;
        resultForModel = { error: errorMessage };
        UI.showError(errorMessage);
        console.error(errorMessage, error);
        ToolLogger.log(toolName, parameters, 'Error', { message: error.message, stack: error.stack });
    }

    if (isSuccess && TOOLS_REQUIRING_SYNTAX_CHECK.includes(toolName)) {
        const filePath = parameters.filename || Editor.getActiveFilePath();
        if (filePath) {
            await new Promise(resolve => setTimeout(resolve, 200));
            const markers = Editor.getModelMarkers(filePath);
            const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error);

            if (errors.length > 0) {
               const errorSignature = errors.map(e => `L${e.startLineNumber}:${e.message}`).join('|');
               ChatService.trackError(filePath, errorSignature);
               const attemptCount = ChatService.getConsecutiveErrorCount(filePath, errorSignature);
               const MAX_ATTEMPTS = 3;

               if (attemptCount >= MAX_ATTEMPTS) {
                   const circuitBreakerMsg = `The AI has failed to fix the same error in '${filePath}' ${MAX_ATTEMPTS} times. The automatic feedback loop has been stopped to prevent an infinite loop. Please review the errors manually or try a different approach.`;
                   resultForModel = { error: circuitBreakerMsg, feedback: 'STOP' };
                   UI.showError(circuitBreakerMsg, 10000);
                   console.error(circuitBreakerMsg);
               } else {
                   isSuccess = false;
                   const errorMessages = errors.map(e => `L${e.startLineNumber}: ${e.message}`).join('\n');
                   const attemptMessage = `This is attempt #${attemptCount} to fix this issue. The previous attempt failed. Please analyze the problem differently.`;
                   const errorMessage = `The tool '${toolName}' ran, but the code now has syntax errors. ${attemptCount > 1 ? attemptMessage : ''}\n\nFile: ${filePath}\nErrors:\n${errorMessages}`;
                   resultForModel = { error: errorMessage };
                   UI.showError(`Syntax errors detected in ${filePath}. Attempting to fix... (${attemptCount}/${MAX_ATTEMPTS})`);
                   console.error(errorMessage);
               }
            } else {
            }
        }
    }

    const resultForLog = isSuccess ? { status: 'Success', ...resultForModel } : { status: 'Error', message: resultForModel.error };
    console.log('Result:', resultForLog);
    console.groupEnd();
    UI.updateToolLog(logEntry, isSuccess);
    return { toolResponse: { name: toolName, response: resultForModel } };
}

export function getToolDefinitions() {
    return {
        functionDeclarations: [
            { name: 'create_file', description: "Creates a new file. CRITICAL: Do NOT include the root directory name in the path. Example: To create 'app.js' in the root, the path is 'app.js', NOT 'my-project/app.js'.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING', description: 'The raw text content of the file. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['filename', 'content'] } },
            { name: 'delete_file', description: "Deletes a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'create_folder', description: "Creates a new folder. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { folder_path: { type: 'STRING' } }, required: ['folder_path'] } },
            { name: 'delete_folder', description: "Deletes a folder and all its contents. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { folder_path: { type: 'STRING' } }, required: ['folder_path'] } },
            { name: 'rename_folder', description: "Renames a folder. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { old_folder_path: { type: 'STRING' }, new_folder_path: { type: 'STRING' } }, required: ['old_folder_path', 'new_folder_path'] } },
            { name: 'rename_file', description: "Renames a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { old_path: { type: 'STRING' }, new_path: { type: 'STRING' } }, required: ['old_path', 'new_path'] } },
            { name: 'read_file', description: "Reads a file's content. CRITICAL: Do NOT include the root directory name in the path. Example: To read 'src/app.js', the path is 'src/app.js'.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'read_multiple_files', description: "Reads and concatenates the content of multiple files. Essential for multi-file context tasks.", parameters: { type: 'OBJECT', properties: { filenames: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['filenames'] } },
            { name: 'read_file_lines', description: 'Reads a specific range of lines from a file. Use this for large files.', parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, start_line: { type: 'NUMBER' }, end_line: { type: 'NUMBER' } }, required: ['filename', 'start_line', 'end_line'] } },
            { name: 'search_in_file', description: 'Searches for a pattern in a file and returns matching lines. Use this for large files.', parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, pattern: { type: 'STRING' }, context: { type: 'NUMBER' } }, required: ['filename', 'pattern'] } },
            { name: 'read_url', description: 'Reads and extracts the main content and all links from a given URL. The result will be a JSON object with "content" and "links" properties.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
            { name: 'get_open_file_content', description: 'Gets the content of the currently open file in the editor.' },
            { name: 'get_selected_text', description: 'Gets the text currently selected by the user in the editor.' },
            { name: 'replace_selected_text', description: 'Replaces the currently selected text in the editor with new text.', parameters: { type: 'OBJECT', properties: { new_text: { type: 'STRING', description: 'The raw text to replace the selection with. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['new_text'] } },
            { name: 'get_project_structure', description: 'Gets the entire file and folder structure of the project. CRITICAL: Always use this tool before attempting to read or create a file to ensure you have the correct file path.' },
            { name: 'duckduckgo_search', description: 'Performs a search using DuckDuckGo and returns the results.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
            { name: 'search_code', description: 'Searches for a specific string in all files in the project (like grep).', parameters: { type: 'OBJECT', properties: { search_term: { type: 'STRING' } }, required: ['search_term'] } },
            { name: 'run_terminal_command', description: 'Executes a shell command on the backend and returns the output.', parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] } },
            { name: 'build_or_update_codebase_index', description: 'Scans the entire codebase to build a searchable index. Slow, run once per session.' },
            { name: 'query_codebase', description: 'Searches the pre-built codebase index.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
            { name: 'get_file_history', description: "Gets a file's git history. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'insert_content', description: "Inserts content at a specific line number in a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, line_number: { type: 'NUMBER' }, content: { type: 'STRING', description: 'The raw text content to insert. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['filename', 'line_number', 'content'] } },
            { name: 'create_and_apply_diff', description: "Efficiently modifies a file by generating and applying a diff in a single step.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, new_content: { type: 'STRING', description: 'The new, raw text content of the file. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['filename', 'new_content'] } },
            { name: 'replace_lines', description: "Replaces a specific range of lines in a file. Use this for targeted, multi-line edits like refactoring a function.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, start_line: { type: 'NUMBER' }, end_line: { type: 'NUMBER' }, new_content: { type: 'STRING', description: 'The raw text to insert. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['filename', 'start_line', 'end_line', 'new_content'] } },
            { name: 'format_code', description: "Formats a file with Prettier. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'analyze_code', description: "Analyzes a JavaScript file's structure. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'rewrite_file', description: "Rewrites a file with new content. Use this as a last resort when other tools fail. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING', description: 'The new, raw text content of the file. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['filename', 'content'] } },
            
            // Enhanced code comprehension tools
            { name: 'analyze_symbol', description: 'Analyzes a symbol (variable, function, class) across the entire codebase to understand its usage, definition, and relationships.', parameters: { type: 'OBJECT', properties: { symbol_name: { type: 'STRING', description: 'The name of the symbol to analyze' }, file_path: { type: 'STRING', description: 'The file path where the symbol is used or defined' } }, required: ['symbol_name', 'file_path'] } },
            { name: 'explain_code_section', description: 'Provides detailed explanation of a complex code section including complexity analysis, symbols, and control flow.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' }, start_line: { type: 'NUMBER' }, end_line: { type: 'NUMBER' } }, required: ['file_path', 'start_line', 'end_line'] } },
            { name: 'trace_variable_flow', description: 'Traces the data flow of a variable through the codebase to understand how data moves and transforms.', parameters: { type: 'OBJECT', properties: { variable_name: { type: 'STRING' }, file_path: { type: 'STRING' } }, required: ['variable_name', 'file_path'] } },
            { name: 'validate_syntax', description: 'Validates the syntax of a file and provides detailed errors, warnings, and suggestions.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' } }, required: ['file_path'] } },
            
            // Precise code modification tools (safer alternatives to rewrite_file)
            { name: 'modify_function', description: 'Modifies a specific function in a file without rewriting the entire file. Much safer than rewrite_file.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' }, function_name: { type: 'STRING' }, new_implementation: { type: 'STRING', description: 'The new function implementation' } }, required: ['file_path', 'function_name', 'new_implementation'] } },
            { name: 'modify_class', description: 'Modifies a specific class in a file without rewriting the entire file. Much safer than rewrite_file.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' }, class_name: { type: 'STRING' }, new_implementation: { type: 'STRING', description: 'The new class implementation' } }, required: ['file_path', 'class_name', 'new_implementation'] } },
            { name: 'rename_symbol', description: 'Safely renames a symbol (variable, function, class) across multiple files with validation.', parameters: { type: 'OBJECT', properties: { old_name: { type: 'STRING' }, new_name: { type: 'STRING' }, file_paths: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Array of file paths to search and replace in' } }, required: ['old_name', 'new_name', 'file_paths'] } },
            { name: 'add_method_to_class', description: 'Adds a new method to an existing class without rewriting the entire file.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' }, class_name: { type: 'STRING' }, method_name: { type: 'STRING' }, method_implementation: { type: 'STRING' } }, required: ['file_path', 'class_name', 'method_name', 'method_implementation'] } },
            { name: 'update_imports', description: 'Updates import statements in a file (add, remove, or modify imports).', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' }, import_changes: { type: 'ARRAY', items: { type: 'OBJECT' }, description: 'Array of import changes with action (add/remove/modify), from, imports, newImports properties' } }, required: ['file_path', 'import_changes'] } },
        ],
    };
}