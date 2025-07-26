import { DbManager } from './db.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';

async function executeTool(toolCall, rootDirectoryHandle) {
    const toolName = toolCall.name;
    const parameters = toolCall.args;
    
    if (!rootDirectoryHandle &&
        [
            'create_file', 'read_file', 'search_code', 'get_project_structure',
            'delete_file', 'build_or_update_codebase_index', 'query_codebase',
            'create_folder', 'delete_folder', 'rename_folder', 'rewrite_file',
            'format_code', 'analyze_code', 'rename_file', 'insert_content'
        ].includes(toolName)
    ) {
        return { error: "No project folder is open. Please ask the user to open a folder before using this tool." };
    }
    // --- Automatic Checkpoint Interception ---
    if (['create_file', 'delete_file', 'rewrite_file', 'rename_file', 'create_folder', 'delete_folder', 'rename_folder', 'insert_content'].includes(toolName)) {
        try {
            const editorState = Editor.getEditorState();
            if (editorState.openFiles.length > 0) {
                const checkpointData = {
                    name: `Auto-Checkpoint @ ${new Date().toLocaleString()}`,
                    editorState: editorState,
                    timestamp: Date.now(),
                };
                await DbManager.saveCheckpoint(checkpointData);
                // We won't notify the user for automatic checkpoints to keep the chat clean
            }
        } catch (error) {
            console.error('Failed to create automatic checkpoint:', error);
        }
    }

    switch (toolName) {
        case 'get_project_structure': {
            const tree = await FileSystem.buildStructureTree(rootDirectoryHandle);
            const structure = FileSystem.formatTreeToString(tree);
            return { structure: structure };
        }
        case 'read_file': {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, parameters.filename);
            const file = await fileHandle.getFile();
            let content = await file.text();
            const MAX_LENGTH = 30000; // Set a character limit for file reads
            if (content.length > MAX_LENGTH) {
                content = content.substring(0, MAX_LENGTH) + `\n\n... (file content truncated because it was too long)`;
            }
            await Editor.openFile(fileHandle, parameters.filename, document.getElementById('tab-bar'), false);
            document.getElementById('chat-input').focus();
            return { content: content };
        }
        case 'read_url': {
            const response = await fetch('/api/read-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: parameters.url }),
            });
            const urlResult = await response.json();
            if (response.ok) {
                return urlResult;
            } else {
                throw new Error(urlResult.message || 'Failed to read URL');
            }
        }
        case 'create_file': {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, parameters.filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(parameters.content);
            await writable.close();
            await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
            });
            await Editor.openFile(fileHandle, parameters.filename, document.getElementById('tab-bar'), false);
            document.getElementById('chat-input').focus();
            return { message: `File '${parameters.filename}' created successfully.` };
        }
        case 'delete_file': {
            const { parentHandle, entryName: fileNameToDelete } = await FileSystem.getParentDirectoryHandle(rootDirectoryHandle, parameters.filename);
            await parentHandle.removeEntry(fileNameToDelete);
            if (Editor.getOpenFiles().has(parameters.filename)) Editor.closeTab(parameters.filename, document.getElementById('tab-bar'));
            await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
            });
            return { message: `File '${parameters.filename}' deleted successfully.` };
        }
        case 'delete_folder': {
            const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootDirectoryHandle, parameters.folder_path);
            await parentHandle.removeEntry(entryName, { recursive: true });
            await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
            });
            return { message: `Folder '${parameters.folder_path}' deleted successfully.` };
        }
        case 'rename_folder': {
            await FileSystem.renameEntry(rootDirectoryHandle, parameters.old_folder_path, parameters.new_folder_path);
            await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
            });
            return { message: `Folder '${parameters.old_folder_path}' renamed to '${parameters.new_folder_path}' successfully.` };
        }
        case 'rename_file': {
            await FileSystem.renameEntry(rootDirectoryHandle, parameters.old_path, parameters.new_path);
            await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
            });
            if (Editor.getOpenFiles().has(parameters.old_path)) {
                Editor.closeTab(parameters.old_path, document.getElementById('tab-bar'));
                const newFileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, parameters.new_path);
                await Editor.openFile(newFileHandle, parameters.new_path, document.getElementById('tab-bar'), false);
                document.getElementById('chat-input').focus();
            }
            return { message: `File '${parameters.old_path}' renamed to '${parameters.new_path}' successfully.` };
        }
        case 'create_folder': {
            await FileSystem.createDirectoryFromPath(rootDirectoryHandle, parameters.folder_path);
            await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
            });
            return { message: `Folder '${parameters.folder_path}' created successfully.` };
        }
        case 'duckduckgo_search': {
            const response = await fetch('/api/duckduckgo-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: parameters.query }),
            });
            const searchResult = await response.json();
            if (response.ok) {
                return searchResult;
            } else {
                throw new Error(searchResult.message || 'Failed to perform search');
            }
        }
        case 'search_code': {
            const searchResults = [];
            await FileSystem.searchInDirectory(rootDirectoryHandle, parameters.search_term, '', searchResults);
            return { results: searchResults };
        }
        case 'get_open_file_content': {
            const activeFile = Editor.getActiveFile();
            if (!activeFile) throw new Error('No file is currently open in the editor.');
            return { filename: activeFile.name, content: activeFile.model.getValue() };
        }
        case 'get_selected_text': {
            const editor = Editor.getEditorInstance();
            const selection = editor.getSelection();
            if (!selection || selection.isEmpty()) throw new Error('No text is currently selected.');
            return { selected_text: editor.getModel().getValueInRange(selection) };
        }
        case 'replace_selected_text': {
            const editor = Editor.getEditorInstance();
            const selection = editor.getSelection();
            if (!selection || selection.isEmpty()) throw new Error('No text is selected to replace.');
            editor.executeEdits('ai-agent', [{ range: selection, text: parameters.new_text }]);
            return { message: 'Replaced the selected text.' };
        }
        case 'run_terminal_command': {
            const response = await fetch('/api/execute-tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'run_terminal_command', parameters: parameters }),
            });
            const terminalResult = await response.json();
            if (terminalResult.status === 'Success') {
                await UI.refreshFileTree(rootDirectoryHandle, (filePath) => {
                    const fileHandle = FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
                    Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
                });
                return { output: terminalResult.output };
            } else {
                throw new Error(terminalResult.message);
            }
        }
        case 'build_or_update_codebase_index': {
            UI.appendMessage(document.getElementById('chat-messages'), 'Building codebase index...', 'ai');
            const index = await CodebaseIndexer.buildIndex(rootDirectoryHandle);
            await DbManager.saveCodeIndex(index);
            return { message: 'Codebase index built successfully.' };
        }
        case 'query_codebase': {
            const index = await DbManager.getCodeIndex();
            if (!index) throw new Error("No codebase index. Please run 'build_or_update_codebase_index'.");
            const queryResults = await CodebaseIndexer.queryIndex(index, parameters.query);
            return { results: queryResults };
        }
        case 'get_file_history': {
            const command = `git log --pretty=format:"%h - %an, %ar : %s" -- ${parameters.filename}`;
            const response = await fetch('/api/execute-tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'run_terminal_command', parameters: { command } }),
            });
            const terminalResult = await response.json();
            if (terminalResult.status === 'Success') {
                return { history: terminalResult.output };
            } else {
                throw new Error(terminalResult.message);
            }
        }
        case 'rewrite_file': {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, parameters.filename);
            const writable = await fileHandle.createWritable();
            await writable.write(parameters.content);
            await writable.close();
            if (Editor.getOpenFiles().has(parameters.filename)) {
                const fileData = Editor.getOpenFiles().get(parameters.filename);
                if (fileData) fileData.model.setValue(parameters.content);
            }
            await Editor.openFile(fileHandle, parameters.filename, document.getElementById('tab-bar'), false);
            document.getElementById('chat-input').focus();
            return { message: `File '${parameters.filename}' rewritten successfully.` };
        }
        case 'format_code': {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, parameters.filename);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();
            const parser = Editor.getPrettierParser(parameters.filename);
            const prettierWorker = new Worker('prettier.worker.js');
            prettierWorker.postMessage({ code: originalContent, parser });
            return { message: `Formatting request for '${parameters.filename}' sent.` };
        }
        case 'analyze_code': {
            if (!parameters.filename.endsWith('.js')) {
                throw new Error('This tool can only analyze .js files. Use read_file for others.');
            }
            const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, parameters.filename);
            const file = await fileHandle.getFile();
            const content = await file.text();
            const ast = acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
            const analysis = { functions: [], classes: [], imports: [] };
            acorn.walk.simple(ast, {
                FunctionDeclaration(node) { analysis.functions.push({ name: node.id.name, start: node.loc.start.line, end: node.loc.end.line }); },
                ClassDeclaration(node) { analysis.classes.push({ name: node.id.name, start: node.loc.start.line, end: node.loc.end.line }); },
                ImportDeclaration(node) { analysis.imports.push({ source: node.source.value, specifiers: node.specifiers.map((s) => s.local.name) }); },
            });
            return { analysis: analysis };
        }
       case 'insert_content': {
           const { filename, line_number, content } = parameters;
           const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, filename);
           const file = await fileHandle.getFile();
           const originalContent = await file.text();
           const lines = originalContent.split('\\n');
           
           // Line numbers are 1-based for the model, convert to 0-based for array
           const insertionPoint = Math.max(0, line_number - 1);
           lines.splice(insertionPoint, 0, content);
           
           const newContent = lines.join('\\n');
           
           const writable = await fileHandle.createWritable();
           await writable.write(newContent);
           await writable.close();
           
           if (Editor.getOpenFiles().has(filename)) {
               const fileData = Editor.getOpenFiles().get(filename);
               if (fileData) fileData.model.setValue(newContent);
           }
           
           await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
           document.getElementById('chat-input').focus();
           
           return { message: `Content inserted into '${filename}' at line ${line_number}.` };
       }
        default:
            throw new Error(`Unknown tool '${toolName}'.`);
    }
}


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
        console.error(errorMessage, error);
    }
    
    // --- Automatic Error Checking ---
    if (isSuccess && ['rewrite_file', 'insert_content', 'replace_selected_text'].includes(toolName)) {
        const filePath = parameters.filename || Editor.getActiveFilePath();
        if (filePath) {
            // Give the editor a moment to process the changes
            await new Promise(resolve => setTimeout(resolve, 200));
            const markers = Editor.getModelMarkers(filePath);
            const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error);

            if (errors.length > 0) {
                const errorMessages = errors.map(e => `L${e.startLineNumber}: ${e.message}`).join('\\n');
                resultForModel.message = (resultForModel.message || '') + `\\n\\n**Warning**: The file was modified, but syntax errors were detected:\\n${errorMessages}`;
            }
        }
    }

    const resultForLog = isSuccess ? { status: 'Success', ...resultForModel } : { status: 'Error', message: resultForModel.error };
    console.log('Result:', resultForLog);
    console.groupEnd();
    UI.updateToolLog(logEntry, isSuccess);
    return { toolResponse: { name: toolName, response: resultForModel } };
}