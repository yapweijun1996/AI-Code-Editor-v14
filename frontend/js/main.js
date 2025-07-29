import { Settings, dispatchLLMSettingsUpdated } from './settings.js';
import { ChatService } from './chat_service.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import * as FileSystem from './file_system.js';
import { initializeEventListeners } from './events.js';
import { DbManager } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {

    // --- DOM Elements ---
    const editorContainer = document.getElementById('editor');
    const tabBarContainer = document.getElementById('tab-bar');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendButton = document.getElementById('chat-send-button');
    const chatCancelButton = document.getElementById('chat-cancel-button');
    const apiKeysTextarea = document.getElementById('api-keys-textarea');
    const thinkingIndicator = document.getElementById('thinking-indicator');
    const imagePreviewContainer = document.getElementById('image-preview-container');

    // --- App State ---
    const appState = {
        rootDirectoryHandle: null,
        uploadedImage: null,
        isFileTreeCollapsed: false,
        editor: null,
        onFileSelect: null,
        saveCurrentSession: null,
        clearImagePreview: null,
        handleFixErrors: null,
        handleImageUpload: null,
    };

    // --- Initialization ---
    appState.editor = await Editor.initializeEditor(editorContainer, tabBarContainer);
    UI.initResizablePanels(appState.editor);

    appState.onFileSelect = async (filePath) => {
        const fileHandle = await FileSystem.getFileHandleFromPath(appState.rootDirectoryHandle, filePath);
        await Editor.openFile(fileHandle, filePath, tabBarContainer);
    };


    async function tryRestoreDirectory() {
        const savedHandle = await DbManager.getDirectoryHandle();
        if (!savedHandle) {
            UI.updateDirectoryButtons(false);
            return;
        }

        if ((await savedHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
            appState.rootDirectoryHandle = savedHandle;
            appState.rootDirectoryHandle = savedHandle;
            await UI.refreshFileTree(savedHandle, appState.onFileSelect);

            const savedState = await DbManager.getSessionState();
            if (savedState) {
                await Editor.restoreEditorState(savedState.tabs, appState.rootDirectoryHandle, tabBarContainer);
            }
            UI.updateDirectoryButtons(true);
        } else {
            UI.updateDirectoryButtons(false, true);
        }
    }

    // --- Initialization ---
    await Settings.initialize();
    await tryRestoreDirectory();
    
    // Setup one-time UI event listeners
    UI.initializeUI();

    if (appState.rootDirectoryHandle) {
        await ChatService.initialize(appState.rootDirectoryHandle);
    }
    
    // Listen for settings changes to re-initialize the chat service
    document.addEventListener('llm-settings-updated', async () => {
        console.log('LLM settings updated, re-initializing chat service...');
        UI.updateLLMProviderStatus();
        if (appState.rootDirectoryHandle) {
            await ChatService.initialize(appState.rootDirectoryHandle);
        }
    });

    appState.saveCurrentSession = async () => {
        if (!appState.rootDirectoryHandle) return;

        const editorState = Editor.getEditorState();
        const sessionState = {
            id: 'lastSession',
            editor: editorState,
        };
        await DbManager.saveSessionState(sessionState);
    };

    appState.clearImagePreview = () => {
        appState.uploadedImage = null;
        const imageInput = document.getElementById('image-input');
        imageInput.value = '';
        UI.updateImagePreview(imagePreviewContainer, null, appState.clearImagePreview);
    };

    appState.handleImageUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            appState.uploadedImage = {
                name: file.name,
                type: file.type,
                data: e.target.result.split(',')[1],
            };
            UI.updateImagePreview(imagePreviewContainer, appState.uploadedImage, appState.clearImagePreview);
        };
        reader.readAsDataURL(file);
    };

    appState.handleFixErrors = () => {
        const activeFilePath = Editor.getActiveFilePath();
        if (!activeFilePath) {
            UI.showError('Please open a file to fix errors in.');
            return;
        }

        const errorDetails = Editor.getFormattedErrors(activeFilePath);

        if (!errorDetails) {
            UI.showError('No errors found in the current file.');
            return;
        }

        const prompt = `
The following errors have been detected in the file \`${activeFilePath}\`. Please fix them.

**Errors:**
\`\`\`
${errorDetails}
\`\`\`

Analyze the code and provide the necessary changes to resolve these issues.
        `;

        chatInput.value = prompt.trim();
        ChatService.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, thinkingIndicator, null, () => {});
    };

    const openDirectoryButton = document.getElementById('open-directory-button');
    openDirectoryButton.addEventListener('click', async () => {
        try {
            const handle = await window.showDirectoryPicker();
            appState.rootDirectoryHandle = handle;
            await DbManager.saveDirectoryHandle(handle);
            await UI.refreshFileTree(handle, appState.onFileSelect);
            GeminiChat.initialize(handle);
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    });

    initializeEventListeners(appState);

    // Relayout panels after a short delay to fix initialization issue
    setTimeout(() => UI.relayout(appState.editor), 100);
});