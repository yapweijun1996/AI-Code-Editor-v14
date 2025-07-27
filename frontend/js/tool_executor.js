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
    const tree = await FileSystem.buildStructureTree(rootHandle);
    const structure = FileSystem.formatTreeToString(tree);
    return { structure };
}

async function _readFile({ filename }, rootHandle) {
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    let content = await file.text();
    const MAX_LENGTH = 30000;
    if (content.length > MAX_LENGTH) {
        content = `${content.substring(0, MAX_LENGTH)}\n\n... (file content truncated because it was too long)`;
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    
    const language = filename.split('.').pop();
    const markdownContent = `\`\`\`${language}\n${content}\n\`\`\``;
    
    return { content: markdownContent };
}

async function _createFile({ filename, content }, rootHandle) {
   const cleanContent = stripMarkdownCodeBlock(content);
   const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename, { create: true });
   const writable = await fileHandle.createWritable();
   await writable.write(cleanContent);
   await writable.close();
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    return { message: `File '${filename}' created successfully.` };
}

async function _rewriteFile({ filename, content }, rootHandle) {
   const cleanContent = stripMarkdownCodeBlock(content);
   const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
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
    const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, filename);
    await parentHandle.removeEntry(entryName);
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
    await FileSystem.renameEntry(rootHandle, old_path, new_path);
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
   const cleanContent = stripMarkdownCodeBlock(content);
   const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
   const file = await fileHandle.getFile();
   const originalContent = await file.text();
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

async function _createFolder({ folder_path }, rootHandle) {
    await FileSystem.createDirectoryFromPath(rootHandle, folder_path);
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `Folder '${folder_path}' created successfully.` };
}

async function _deleteFolder({ folder_path }, rootHandle) {
    const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, folder_path);
    await parentHandle.removeEntry(entryName, { recursive: true });
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `Folder '${folder_path}' deleted successfully.` };
}

async function _renameFolder({ old_folder_path, new_folder_path }, rootHandle) {
    await FileSystem.renameEntry(rootHandle, old_folder_path, new_folder_path);
    await UI.refreshFileTree(rootHandle, (filePath) => {
        const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
        Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
    });
    return { message: `Folder '${old_folder_path}' renamed to '${new_folder_path}' successfully.` };
}

async function _searchCode({ search_term }, rootHandle) {
    const searchResults = [];
    await FileSystem.searchInDirectory(rootHandle, search_term, '', searchResults);
    return { results: searchResults };
}

async function _buildCodebaseIndex(params, rootHandle) {
    UI.appendMessage(document.getElementById('chat-messages'), 'Building codebase index...', 'ai');
    const index = await CodebaseIndexer.buildIndex(rootHandle);
    await DbManager.saveCodeIndex(index);
    return { message: 'Codebase index built successfully.' };
}

async function _queryCodebase({ query }) {
    const index = await DbManager.getCodeIndex();
    if (!index) throw new Error("No codebase index. Please run 'build_or_update_codebase_index'.");
    const queryResults = await CodebaseIndexer.queryIndex(index, query);
    return { results: queryResults };
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
        throw new Error(terminalResult.message);
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
        throw new Error(terminalResult.message);
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
    
    const language = activeFile.name.split('.').pop();
    const content = activeFile.model.getValue();
    const markdownContent = `\`\`\`${language}\n${content}\n\`\`\``;
    
    return { filename: activeFile.name, content: markdownContent };
}

async function _getSelectedText() {
    const editor = Editor.getEditorInstance();
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) throw new Error('No text is currently selected.');
    return { selected_text: editor.getModel().getValueInRange(selection) };
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
    search_code: { handler: _searchCode, requiresProject: true, createsCheckpoint: false },
    build_or_update_codebase_index: { handler: _buildCodebaseIndex, requiresProject: true, createsCheckpoint: false },
    query_codebase: { handler: _queryCodebase, requiresProject: true, createsCheckpoint: false },
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
    create_folder: { handler: _createFolder, requiresProject: true, createsCheckpoint: true },
    delete_folder: { handler: _deleteFolder, requiresProject: true, createsCheckpoint: true },
    rename_folder: { handler: _renameFolder, requiresProject: true, createsCheckpoint: true },

    // Non-project / Editor tools
    read_url: { handler: _readUrl, requiresProject: false, createsCheckpoint: false },
    duckduckgo_search: { handler: _duckduckgoSearch, requiresProject: false, createsCheckpoint: false },
    get_open_file_content: { handler: _getOpenFileContent, requiresProject: false, createsCheckpoint: false },
    get_selected_text: { handler: _getSelectedText, requiresProject: false, createsCheckpoint: false },
    replace_selected_text: { handler: _replaceSelectedText, requiresProject: false, createsCheckpoint: false },
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

const TOOLS_REQUIRING_SYNTAX_CHECK = ['rewrite_file', 'insert_content', 'replace_selected_text'];

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