import { DbManager } from './db.js';
import { ApiKeyManager } from './api_manager.js';
import { GeminiChat } from './gemini_chat.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import * as FileSystem from './file_system.js';
import { initializeEventListeners } from './events.js';
import { GitManager } from './git_manager.js';

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
    const rateLimitSlider = document.getElementById('rate-limit-slider');
    const rateLimitInput = document.getElementById('rate-limit-input');

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
        gitManager: null,
    };

    // --- Initialization ---
    appState.editor = await Editor.initializeEditor(editorContainer, tabBarContainer);
    UI.initResizablePanels(appState.editor);

    appState.onFileSelect = async (filePath) => {
        const fileHandle = await FileSystem.getFileHandleFromPath(appState.rootDirectoryHandle, filePath);
        await Editor.openFile(fileHandle, filePath, tabBarContainer);
    };

    async function initializeGit(directoryHandle) {
        appState.gitManager = new GitManager(FileSystem.createFsAdapter(directoryHandle));
        try {
            await appState.gitManager.init();
            console.log('Git repository initialized.');
        } catch (e) {
            // Ignore if it's already a git repository, or other init errors.
            console.warn("Git init failed, could be expected:", e.message);
        }
        window.App.git = appState.gitManager; // For debugging
    }

    async function tryRestoreDirectory() {
        const savedHandle = await DbManager.getDirectoryHandle();
        if (!savedHandle) {
            UI.updateDirectoryButtons(false);
            return;
        }

        if ((await savedHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
            appState.rootDirectoryHandle = savedHandle;
            GeminiChat.rootDirectoryHandle = savedHandle;
            
            await initializeGit(savedHandle);

            await UI.refreshFileTree(savedHandle, appState.onFileSelect);

            const savedState = await DbManager.getSessionState();
            if (savedState) {
                console.log('Restoring previous session...');
                await Editor.restoreEditorState(savedState.editor, savedHandle, tabBarContainer);
                if (savedState.chat && savedState.chat.length > 0) {
                    await GeminiChat._restartSessionWithHistory(savedState.chat);
                    UI.renderChatHistory(chatMessages, savedState.chat);
                }
            }
        } else {
            UI.updateDirectoryButtons(false, true);
        }
    }

    // --- Load settings first ---
    const savedRateLimit = localStorage.getItem('rateLimitValue') || '5';
    rateLimitSlider.value = savedRateLimit;
    rateLimitInput.value = savedRateLimit;
    GeminiChat.rateLimit = parseInt(savedRateLimit, 10) * 1000;

    await ApiKeyManager.loadKeys(apiKeysTextarea);

    // --- Restore session and initialize chat ---
    await GeminiChat.initialize();
    window.App = appState;
    await tryRestoreDirectory();

    if (!GeminiChat.chatSession) {
        await GeminiChat._startChat();
    }

    appState.saveCurrentSession = async () => {
        if (!appState.rootDirectoryHandle) return;

        const editorState = Editor.getEditorState();
        const chatHistory = GeminiChat.chatSession ? await GeminiChat.chatSession.getHistory() : [];

        const sessionState = {
            id: 'lastSession',
            editor: editorState,
            chat: chatHistory,
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
        GeminiChat.resetErrorTracker();
        GeminiChat.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, thinkingIndicator, null, () => {});
    };

    const openDirectoryButton = document.getElementById('open-directory-button');
    openDirectoryButton.addEventListener('click', async () => {
        try {
            const handle = await window.showDirectoryPicker();
            appState.rootDirectoryHandle = handle;
            await DbManager.saveDirectoryHandle(handle);
            await initializeGit(handle);
            await UI.refreshFileTree(handle, appState.onFileSelect);
            GeminiChat.rootDirectoryHandle = handle; // Update the handle
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    });

    initializeEventListeners(appState);

    // Relayout panels after a short delay to fix initialization issue
    setTimeout(() => UI.relayout(appState.editor), 100);
});