import { getFileHandleFromPath } from './file_system.js';

let editor;
let openFiles = new Map(); // Key: filePath (string), Value: { handle, name, model, viewState }
let activeFilePath = null;

function getLanguageFromExtension(ext) {
    return ({
        cfm: 'html',
        cfml: 'html',
        js: 'javascript',
        ts: 'typescript',
        java: 'java',
        py: 'python',
        html: 'html',
        css: 'css',
        json: 'json',
        md: 'markdown',
        php: 'php',
    })[ext] || 'plaintext';
}

function renderTabs(tabBarContainer, onTabClick, onTabClose) {
    tabBarContainer.innerHTML = '';
    openFiles.forEach((fileData, filePath) => {
        const tab = document.createElement('div');
        tab.className = 'tab' + (filePath === activeFilePath ? ' active' : '');
        tab.textContent = fileData.name;
        tab.onclick = () => onTabClick(filePath);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            onTabClose(filePath);
        };

        tab.appendChild(closeBtn);
        tabBarContainer.appendChild(tab);
    });
}

export function clearEditor() {
    if (editor) {
        editor.setModel(
            monaco.editor.createModel(
                '// Select a file to view its content',
                'plaintext',
            ),
        );
        editor.updateOptions({ readOnly: true });
    }
    activeFilePath = null;
    openFiles = new Map();
}

export function initializeEditor(editorContainer, tabBarContainer) {
    return new Promise((resolve) => {
        require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
        require(['vs/editor/editor.main'], () => {
            monaco.editor.defineTheme('cfmlTheme', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'tag', foreground: '569cd6' },
                    { token: 'delimiter', foreground: 'd4d4d4' },
                    { token: 'attribute.name', foreground: '9cdcfe' },
                    { token: 'attribute.value', foreground: 'ce9178' },
                    { token: 'string', foreground: 'd69d85' },
                    { token: 'number', foreground: 'b5cea8' },
                    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
                ],
                colors: {
                    'editor.foreground': '#D4D4D4',
                    'editor.background': '#1E1E1E',
                    'editor.lineHighlightBackground': '#2c313c',
                    'editorCursor.foreground': '#528BFF',
                    'editorWhitespace.foreground': '#3B4048',
                    'editor.selectionBackground': '#264F78',
                    'editor.inactiveSelectionBackground': '#3A3D41',
                },
            });
            monaco.editor.setTheme('cfmlTheme');
            editor = monaco.editor.create(editorContainer, {
                value: `<!-- Click "Open Project Folder" to start -->`,
                language: 'html',
                theme: 'cfmlTheme',
                readOnly: true,
            });
            
            const onTabClick = (filePath) => switchTab(filePath, tabBarContainer);
            const onTabClose = (filePath) => closeTab(filePath, tabBarContainer);
            
            // Initial render
            renderTabs(tabBarContainer, onTabClick, onTabClose);

            resolve(editor);
        });
    });
}

export async function openFile(fileHandle, filePath, tabBarContainer, focusEditor = true) {
    if (openFiles.has(filePath)) {
        await switchTab(filePath, tabBarContainer, focusEditor);
        return;
    }

    try {
        const file = await fileHandle.getFile();
        const content = await file.text();

        openFiles.set(filePath, {
            handle: fileHandle,
            name: file.name,
            model: monaco.editor.createModel(
                content,
                getLanguageFromExtension(file.name.split('.').pop()),
            ),
            viewState: null,
        });

        await switchTab(filePath, tabBarContainer, focusEditor);
    } catch (error) {
        console.error(`Failed to open file ${filePath}:`, error);
    }
}

export async function switchTab(filePath, tabBarContainer, focusEditor = true) {
    if (activeFilePath && openFiles.has(activeFilePath)) {
        openFiles.get(activeFilePath).viewState = editor.saveViewState();
    }

    activeFilePath = filePath;
    const fileData = openFiles.get(filePath);

    editor.setModel(fileData.model);
    if (fileData.viewState) {
        editor.restoreViewState(fileData.viewState);
    }
    if (focusEditor) {
        editor.focus();
    }
    editor.updateOptions({ readOnly: false });
    
    const onTabClick = (fp) => switchTab(fp, tabBarContainer, true); // User clicks always focus
    const onTabClose = (fp) => closeTab(fp, tabBarContainer);
    renderTabs(tabBarContainer, onTabClick, onTabClose);
}

export function closeTab(filePath, tabBarContainer) {
    const fileData = openFiles.get(filePath);
    if (fileData && fileData.model) {
        fileData.model.dispose();
    }
    openFiles.delete(filePath);

    if (activeFilePath === filePath) {
        activeFilePath = null;
        const nextFile = openFiles.keys().next().value;
        if (nextFile) {
            switchTab(nextFile, tabBarContainer);
        } else {
            clearEditor();
            renderTabs(tabBarContainer, () => {}, () => {});
        }
    } else {
        const onTabClick = (fp) => switchTab(fp, tabBarContainer);
        const onTabClose = (fp) => closeTab(fp, tabBarContainer);
        renderTabs(tabBarContainer, onTabClick, onTabClose);
    }
}

export async function saveActiveFile() {
    if (!activeFilePath) return;
    try {
        const fileData = openFiles.get(activeFilePath);
        const writable = await fileData.handle.createWritable();
        await writable.write(fileData.model.getValue());
        await writable.close();
        console.log(`File '${fileData.name}' saved successfully`);
    } catch (error) {
        console.error(`Failed to save file:`, error);
    }
}

export async function saveAllOpenFiles() {
    for (const [filePath, fileData] of openFiles.entries()) {
        try {
            const writable = await fileData.handle.createWritable();
            await writable.write(fileData.model.getValue());
            await writable.close();
            console.log(`File '${fileData.name}' saved successfully.`);
        } catch (error) {
            console.error(`Failed to save file '${fileData.name}':`, error);
        }
    }
}

export function getActiveFile() {
    if (!activeFilePath) return null;
    return openFiles.get(activeFilePath);
}

export function getEditorInstance() {
    return editor;
}

export function getOpenFiles() {
    return openFiles;
}

export function getActiveFilePath() {
    return activeFilePath;
}

export function getPrettierParser(filename) {
    const extension = filename.split('.').pop();
    switch (extension) {
        case 'js':
        case 'ts':
        case 'jsx':
        case 'tsx':
        return 'babel';
        case 'html':
        return 'html';
        case 'css':
        case 'scss':
        case 'less':
        return 'css';
        case 'json':
        return 'json';
        case 'md':
        return 'markdown';
        default:
        return 'babel';
    }
}

export function getEditorState() {
    if (activeFilePath && openFiles.has(activeFilePath)) {
        openFiles.get(activeFilePath).viewState = editor.saveViewState();
    }

    const files = [];
    for (const [path, data] of openFiles.entries()) {
        files.push({
            path: path,
            content: data.model.getValue(),
            viewState: data.viewState,
        });
    }

    return {
        openFiles: files,
        activeFile: activeFilePath,
    };
}

export async function restoreEditorState(state, rootHandle, tabBarContainer) {
    if (!state || !state.openFiles) return;

    for (const fileData of state.openFiles) {
        try {
            const fileHandle = await getFileHandleFromPath(rootHandle, fileData.path, { create: true });
            const model = monaco.editor.createModel(
                fileData.content,
                getLanguageFromExtension(fileData.path.split('.').pop()),
            );
            openFiles.set(fileData.path, {
                handle: fileHandle,
                name: fileHandle.name,
                model: model,
                viewState: fileData.viewState,
            });
        } catch (error) {
            console.error(`Could not restore file ${fileData.path}:`, error);
        }
    }

    if (state.activeFile && openFiles.has(state.activeFile)) {
        await switchTab(state.activeFile, tabBarContainer, true);
    } else if (openFiles.size > 0) {
        // If active file is gone, open the first available one
        const firstFile = openFiles.keys().next().value;
        await switchTab(firstFile, tabBarContainer, true);
    } else {
        // No files to restore, just render empty tabs
        renderTabs(tabBarContainer, () => {}, () => {});
    }
}
export async function restoreCheckpointState(state, rootHandle, tabBarContainer) {
    // Close all current tabs without saving their state
    const currentFiles = Array.from(openFiles.keys());
    for (const filePath of currentFiles) {
        const fileData = openFiles.get(filePath);
        if (fileData && fileData.model) {
            fileData.model.dispose();
        }
        openFiles.delete(filePath);
    }
    activeFilePath = null;

    // Restore files from the checkpoint state
    await restoreEditorState(state, rootHandle, tabBarContainer);
}

export function getModelMarkers(filePath) {
    const fileData = openFiles.get(filePath);
    if (!fileData || !fileData.model) {
        return [];
    }
    return monaco.editor.getModelMarkers({ owner: 'default', resource: fileData.model.uri });
}