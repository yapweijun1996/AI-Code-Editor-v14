import { DbManager } from './db.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import { GeminiChat } from './gemini_chat.js';

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

// --- Tool Handlers ---

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
    return { content: content };
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
   const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
        throw new Error('Permission to write to the file was denied.');
    }
   const writable = await fileHandle.createWritable();
   await writable.write(cleanContent);
   await writable.close();
   if (Editor.getOpenFiles().has(filename)) {
       Editor.getOpenFiles().get(filename)?.model.setValue(cleanContent);
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
   const file = await fileHandle.getFile();
   const originalContent = await file.text();
   const lines = originalContent.split('\n');
   const insertionPoint = Math.max(0, line_number - 1);
   lines.splice(insertionPoint, 0, cleanContent);
   const newContent = lines.join('\n');
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
    const lines = originalContent.split('\n');

    const before = lines.slice(0, start_line - 1);
    const after = lines.slice(end_line);
    const newLines = cleanNewContent.split('\n');

    const updatedContent = [...before, ...newLines, ...after].join('\n');

    const writable = await fileHandle.createWritable();
    await writable.write(updatedContent);
    await writable.close();

    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(updatedContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();

    return { message: `Lines ${start_line}-${end_line} in '${filename}' were replaced successfully.` };
}

async function _applyDiff({ filename, patch_content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for apply_diff.");
    if (!patch_content) throw new Error("The 'patch_content' parameter is required for apply_diff.");

    const dmp = new diff_match_patch();
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    
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
    const cleanNewContent = stripMarkdownCodeBlock(new_content);

    const LARGE_FILE_THRESHOLD_BYTES = 250000; // 250KB

    let finalContent = cleanNewContent;
    let method = 'diff';

    if (file.size > LARGE_FILE_THRESHOLD_BYTES) {
        method = 'rewrite';
    } else {
        try {
            const dmp = new diff_match_patch();
            const a = dmp.diff_linesToChars_(originalContent, cleanNewContent);
            const lineText1 = a.chars1;
            const lineText2 = a.chars2;
            const lineArray = a.lineArray;
            const diffs = dmp.diff_main(lineText1, lineText2, false);
            dmp.diff_charsToLines_(diffs, lineArray);
            const patches = dmp.patch_make(originalContent, diffs);

            // Check if a valid patch could be created. If not, fall back to rewrite.
            if (patches.length === 0 && originalContent !== cleanNewContent) {
                 console.warn(`Diff generation failed for ${filename}, falling back to rewrite.`);
                 method = 'rewrite';
            } else {
                 const [patchedContent, results] = dmp.patch_apply(patches, originalContent);
                 if (results.some(r => !r)) {
                     console.warn(`Patch application failed for ${filename}, falling back to rewrite.`);
                     method = 'rewrite';
                 } else {
                     finalContent = patchedContent;
                 }
            }
        } catch (error) {
            console.error(`Diff/patch process for ${filename} failed with error: ${error.message}. Falling back to rewrite.`);
            method = 'rewrite';
        }
    }

    const writable = await fileHandle.createWritable();
    await writable.write(finalContent);
    await writable.close();

    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(finalContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `File '${filename}' updated successfully (Method: ${method}).` };
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
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
    const searchResults = [];
    await FileSystem.searchInDirectory(rootHandle, search_term, '', searchResults, ignorePatterns);
    return { results: searchResults };
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
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    const parser = Editor.getPrettierParser(filename);
    const prettierWorker = new Worker('prettier.worker.js');
    prettierWorker.postMessage({ code: originalContent, parser });
    return { message: `Formatting request for '${filename}' sent.` };
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

async function _runTerminalCommand(parameters, rootHandle) {
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

async function _getFileHistory({ filename }, rootHandle) {
    const command = `git log --pretty=format:"%h - %an, %ar : %s" -- ${filename}`;
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
        throw new Error(`Fetching file history failed. This is likely a backend issue with 'git'. Please check the server logs. Raw message: ${terminalResult.message}`);
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
        throw new Error('No text is currently selected.');
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
   if (!selection || selection.isEmpty()) throw new Error('No text is selected to replace.');
   editor.executeEdits('ai-agent', [{ range: selection, text: cleanText }]);
   return { message: 'Replaced the selected text.' };
}


// --- Tool Registry ---

const toolRegistry = {
    // Project-based tools
    get_project_structure: { handler: _getProjectStructure, requiresProject: true, createsCheckpoint: false },
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
    } catch (error) {
        isSuccess = false;
        const errorMessage = `Error executing tool '${toolName}': ${error.message}`;
        resultForModel = { error: errorMessage };
        UI.showError(errorMessage);
        console.error(errorMessage, error);
    }

    if (isSuccess && TOOLS_REQUIRING_SYNTAX_CHECK.includes(toolName)) {
        const filePath = parameters.filename || Editor.getActiveFilePath();
        if (filePath) {
            await new Promise(resolve => setTimeout(resolve, 200));
            const markers = Editor.getModelMarkers(filePath);
            const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error);

            if (errors.length > 0) {
               const errorSignature = errors.map(e => `L${e.startLineNumber}:${e.message}`).join('|');
               GeminiChat.trackError(filePath, errorSignature);
               const attemptCount = GeminiChat.getConsecutiveErrorCount(filePath, errorSignature);
               const MAX_ATTEMPTS = 3;

               if (attemptCount >= MAX_ATTEMPTS) {
                   const circuitBreakerMsg = `The AI has failed to fix the same error in '${filePath}' ${MAX_ATTEMPTS} times. The automatic feedback loop has been stopped to prevent an infinite loop. Please review the errors manually or try a different approach.`;
                   resultForModel = { error: circuitBreakerMsg, feedback: 'STOP' };
                   UI.showError(circuitBreakerMsg, 10000);
                   console.error(circuitBreakerMsg);
                   GeminiChat.resetErrorTracker();
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
               GeminiChat.resetErrorTracker();
            }
        }
    }

    const resultForLog = isSuccess ? { status: 'Success', ...resultForModel } : { status: 'Error', message: resultForModel.error };
    console.log('Result:', resultForLog);
    console.groupEnd();
    UI.updateToolLog(logEntry, isSuccess);
    return { toolResponse: { name: toolName, response: resultForModel } };
}