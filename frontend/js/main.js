import { DbManager } from './db.js';
import { ApiKeyManager } from './api_manager.js';
import { GeminiChat } from './gemini_chat.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import * as FileSystem from './file_system.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const fileTreeContainer = document.getElementById('file-tree');
    const editorContainer = document.getElementById('editor');
    const tabBarContainer = document.getElementById('tab-bar');
    const openDirectoryButton = document.getElementById('open-directory-button');
    const forgetFolderButton = document.getElementById('forget-folder-button');
    const reconnectButton = document.getElementById('reconnect-button');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendButton = document.getElementById('chat-send-button');
    const chatCancelButton = document.getElementById('chat-cancel-button');
    const apiKeysTextarea = document.getElementById('api-keys-textarea');
    const saveKeysButton = document.getElementById('save-keys-button');
    const thinkingIndicator = document.getElementById('thinking-indicator');
    const toggleFilesButton = document.getElementById('toggle-files-button');
    const imageUploadButton = document.getElementById('image-upload-button');
    const imageInput = document.getElementById('image-input');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const rateLimitSlider = document.getElementById('rate-limit-slider');
    const rateLimitInput = document.getElementById('rate-limit-input');
    const viewContextButton = document.getElementById('view-context-button');
    const condenseContextButton = document.getElementById('condense-context-button');
    const clearContextButton = document.getElementById('clear-context-button');
    const contextModal = document.getElementById('context-modal');
    const contextDisplay = document.getElementById('context-display');
    const closeModalButton = contextModal.querySelector('.close-button');
    const formatButton = document.getElementById('format-button');
    const themeToggleButton = document.getElementById('theme-toggle-button');
    const viewCheckpointsButton = document.getElementById('view-checkpoints-button');
    const checkpointsModal = document.getElementById('checkpoints-modal');
    const checkpointsList = document.getElementById('checkpoints-list');
    const closeCheckpointsModalButton = checkpointsModal.querySelector('.close-button');
    const createCheckpointButton = document.getElementById('create-checkpoint-button');
    const modelSelector = document.getElementById('model-selector');
    const customRulesButton = document.getElementById('custom-rules-button');
    const customRulesModal = document.getElementById('custom-rules-modal');
    const closeCustomRulesModalButton = customRulesModal.querySelector('.close-button');
    const customRulesTextarea = document.getElementById('custom-rules-textarea');
    const saveCustomRulesButton = document.getElementById('save-custom-rules-button');
    const customRulesModeName = document.getElementById('custom-rules-mode-name');

    // --- State ---
    let rootDirectoryHandle = null;
    let uploadedImage = null;
    let isFileTreeCollapsed = false;

    // --- Initialization ---
    const editor = await Editor.initializeEditor(editorContainer, tabBarContainer);
    UI.initResizablePanels(editor);

    const onFileSelect = async (filePath) => {
        const fileHandle = await FileSystem.getFileHandleFromPath(rootDirectoryHandle, filePath);
        await Editor.openFile(fileHandle, filePath, tabBarContainer);
    };
    
    async function tryRestoreDirectory() {
        const savedHandle = await DbManager.getDirectoryHandle();
        if (!savedHandle) {
            UI.updateDirectoryButtons(false);
            return;
        }

        if ((await savedHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
            rootDirectoryHandle = savedHandle;
            GeminiChat.rootDirectoryHandle = rootDirectoryHandle; // <-- FIX: Pass handle to chat module
            await UI.refreshFileTree(rootDirectoryHandle, onFileSelect);

            const savedState = await DbManager.getSessionState();
            if (savedState) {
                console.log('Restoring previous session...');
                await Editor.restoreEditorState(savedState.editor, rootDirectoryHandle, tabBarContainer);
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

    // CRITICAL: Load API keys before attempting to restore a session that needs them
    await ApiKeyManager.loadKeys(apiKeysTextarea);

    // --- Restore session and initialize chat ---
    await GeminiChat.initialize(); // Load saved model/mode settings
    await tryRestoreDirectory();

    // Start a new chat session if one wasn't restored
    if (!GeminiChat.chatSession) {
        await GeminiChat._startChat();
    }

    async function saveCurrentSession() {
        if (!rootDirectoryHandle) return;

        const editorState = Editor.getEditorState();
        const chatHistory = GeminiChat.chatSession ? await GeminiChat.chatSession.getHistory() : [];

        const sessionState = {
            id: 'lastSession',
            editor: editorState,
            chat: chatHistory,
        };
        await DbManager.saveSessionState(sessionState);
    }

    // --- Event Listeners ---
    window.addEventListener('beforeunload', saveCurrentSession);

    let saveTimeout;
    editorContainer.addEventListener('keyup', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveCurrentSession, 2000);
    });

    tabBarContainer.addEventListener('click', () => {
        setTimeout(saveCurrentSession, 100);
    });

    openDirectoryButton.addEventListener('click', async () => {
        try {
            rootDirectoryHandle = await window.showDirectoryPicker();
            await DbManager.saveDirectoryHandle(rootDirectoryHandle);
            await UI.refreshFileTree(rootDirectoryHandle, onFileSelect);
            GeminiChat.rootDirectoryHandle = rootDirectoryHandle; // Update the handle
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    });

    forgetFolderButton.addEventListener('click', async () => {
        await DbManager.clearDirectoryHandle();
        rootDirectoryHandle = null;
        const treeInstance = $('#file-tree').jstree(true);
        if (treeInstance) treeInstance.destroy();
        fileTreeContainer.innerHTML = '';
        UI.updateDirectoryButtons(false);
        Editor.clearEditor();
    });

    reconnectButton.addEventListener('click', async () => {
        let savedHandle = await DbManager.getDirectoryHandle();
        if (savedHandle) {
            try {
                if ((await savedHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
                    rootDirectoryHandle = savedHandle;
                    await UI.refreshFileTree(rootDirectoryHandle, onFileSelect);
                    GeminiChat.rootDirectoryHandle = rootDirectoryHandle; // Update the handle
                } else {
                    alert('Permission to access the folder was denied.');
                }
            } catch (error) {
                console.error('Error requesting permission:', error);
                alert('There was an error reconnecting to the project folder.');
            }
        }
    });

    saveKeysButton.addEventListener('click', () => ApiKeyManager.saveKeys(apiKeysTextarea));
    chatSendButton.addEventListener('click', () => GeminiChat.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, thinkingIndicator, uploadedImage, clearImagePreview));
    chatCancelButton.addEventListener('click', () => GeminiChat.cancelMessage());

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            GeminiChat.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, thinkingIndicator, uploadedImage, clearImagePreview);
        }
    });

    editorContainer.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            Editor.saveActiveFile();
        }
    });

    rateLimitSlider.addEventListener('input', () => {
        rateLimitInput.value = rateLimitSlider.value;
        GeminiChat.rateLimit = parseInt(rateLimitSlider.value, 10) * 1000;
        localStorage.setItem('rateLimitValue', rateLimitSlider.value);
    });

    rateLimitInput.addEventListener('input', () => {
        rateLimitSlider.value = rateLimitInput.value;
        GeminiChat.rateLimit = parseInt(rateLimitInput.value, 10) * 1000;
        localStorage.setItem('rateLimitValue', rateLimitInput.value);
    });


    viewContextButton.addEventListener('click', async () => {
        contextDisplay.textContent = await GeminiChat.viewHistory();
        contextModal.style.display = 'block';
    });

    condenseContextButton.addEventListener('click', () => GeminiChat.condenseHistory(chatMessages));
    clearContextButton.addEventListener('click', () => GeminiChat.clearHistory(chatMessages));

    closeModalButton.addEventListener('click', () => {
        contextModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target == contextModal) {
            contextModal.style.display = 'none';
        }
        if (event.target == checkpointsModal) {
            checkpointsModal.style.display = 'none';
        }
        if (event.target == customRulesModal) {
            customRulesModal.style.display = 'none';
        }
    });

    viewCheckpointsButton.addEventListener('click', async () => {
        const checkpoints = await DbManager.getCheckpoints();
        UI.renderCheckpoints(checkpointsList, checkpoints);
        checkpointsModal.style.display = 'block';
    });

    closeCheckpointsModalButton.addEventListener('click', () => {
        checkpointsModal.style.display = 'none';
    });

    createCheckpointButton.addEventListener('click', async () => {
        const editorState = Editor.getEditorState();
        if (editorState.openFiles.length === 0) {
            alert('Cannot create a checkpoint with no open files.');
            return;
        }

        const checkpointName = prompt('Enter a name for this checkpoint:', `Checkpoint ${new Date().toLocaleString()}`);
        if (!checkpointName) return; // User cancelled

        const checkpointData = {
            name: checkpointName,
            editorState: editorState,
            timestamp: Date.now(),
        };

        try {
            await DbManager.saveCheckpoint(checkpointData);
            alert(`Checkpoint "${checkpointName}" created successfully.`);
            // Refresh the list
            const checkpoints = await DbManager.getCheckpoints();
            UI.renderCheckpoints(checkpointsList, checkpoints);
        } catch (error) {
            console.error('Failed to create checkpoint:', error);
            alert('Error creating checkpoint. See console for details.');
        }
    });

    checkpointsList.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.classList.contains('restore-checkpoint-button')) {
            const checkpointId = parseInt(target.dataset.id, 10);
            const checkpoint = await DbManager.getCheckpointById(checkpointId);
            if (checkpoint && checkpoint.editorState) {
                await Editor.restoreCheckpointState(checkpoint.editorState, rootDirectoryHandle, tabBarContainer);
                await Editor.saveAllOpenFiles(); // Save all restored files to disk
                await UI.refreshFileTree(rootDirectoryHandle, onFileSelect);
                checkpointsModal.style.display = 'none';
                alert(`Project state restored to checkpoint '${checkpoint.name}'.`);
            }
        } else if (target.classList.contains('delete-checkpoint-button')) {
            const checkpointId = parseInt(target.dataset.id, 10);
            if (confirm('Are you sure you want to delete this checkpoint?')) {
                await DbManager.deleteCheckpoint(checkpointId);
                const checkpoints = await DbManager.getCheckpoints();
                UI.renderCheckpoints(checkpointsList, checkpoints);
            }
        }
    });

    customRulesButton.addEventListener('click', async () => {
        const agentModeSelector = document.getElementById('agent-mode-selector');
        const selectedOption = agentModeSelector.options[agentModeSelector.selectedIndex];
        const mode = selectedOption.value;
        const modeName = selectedOption.text;

        const defaultRules = {
            code: `
- Always write clean, modular, and well-documented code.
- Follow the existing coding style and conventions of the project.
- When modifying a file, first read it carefully to understand the context.
- Provide clear explanations for any code changes you make.
- When you create a file, make sure it is placed in the correct directory.
            `.trim(),
            plan: `
- Always start by creating a clear, step-by-step research plan.
- Cite all sources and provide links in a 'References' section.
- Synthesize information from multiple sources to provide a comprehensive answer.
- Present findings in a structured format, using headings, lists, and Mermaid diagrams where appropriate.
- Distinguish between facts from sources and your own analysis.
            `.trim(),
        };

        customRulesModeName.textContent = modeName;
        let rules = await DbManager.getCustomRule(mode);
        if (rules === null) {
            rules = defaultRules[mode] || '';
        }
        customRulesTextarea.value = rules;
        customRulesModal.style.display = 'block';
    });

    closeCustomRulesModalButton.addEventListener('click', () => {
        customRulesModal.style.display = 'none';
    });

    saveCustomRulesButton.addEventListener('click', async () => {
        const agentModeSelector = document.getElementById('agent-mode-selector');
        const mode = agentModeSelector.value;
        await DbManager.saveCustomRule(mode, customRulesTextarea.value);
        alert('Custom rules saved successfully.');
        customRulesModal.style.display = 'none';
    });

    imageUploadButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImageUpload);

    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedImage = {
                name: file.name,
                type: file.type,
                data: e.target.result.split(',')[1],
            };
            UI.updateImagePreview(imagePreviewContainer, uploadedImage, clearImagePreview);
        };
        reader.readAsDataURL(file);
    }

    function clearImagePreview() {
        uploadedImage = null;
        imageInput.value = '';
        UI.updateImagePreview(imagePreviewContainer, uploadedImage, clearImagePreview);
    }

    toggleFilesButton.addEventListener('click', () => {
        const fileTreePanel = document.getElementById('file-tree-container');
        if (!window.splitInstance || !fileTreePanel) return;

        isFileTreeCollapsed = !isFileTreeCollapsed;

        if (isFileTreeCollapsed) {
            fileTreePanel.classList.add('hidden');
            window.splitInstance.setSizes([0, 70, 30]);
        } else {
            fileTreePanel.classList.remove('hidden');
            window.splitInstance.setSizes([15, 55, 30]);
        }
        setTimeout(() => editor.layout(), 50);
    });

    if (formatButton) {
        formatButton.addEventListener('click', () => {
            const activeFile = Editor.getActiveFile();
            if (!activeFile) {
                alert('Please open a file to format.');
                return;
            }
            const originalContent = activeFile.model.getValue();
            const parser = Editor.getPrettierParser(activeFile.name);
            const prettierWorker = new Worker('prettier.worker.js');

            prettierWorker.onmessage = (event) => {
                if (event.data.success) {
                    activeFile.model.setValue(event.data.formattedCode);
                    console.log(`File '${activeFile.name}' formatted successfully.`);
                } else {
                    console.error('Error formatting file:', event.data.error);
                    alert('An error occurred while formatting the file.');
                }
            };
            prettierWorker.postMessage({ code: originalContent, parser });
        });
    }

    // --- Tab Bar Mouse Wheel Scrolling ---
    tabBarContainer.addEventListener('wheel', (event) => {
        if (event.deltaY !== 0) {
            event.preventDefault();
            tabBarContainer.scrollLeft += event.deltaY;
        }
    });

    // Relayout panels after a short delay to fix initialization issue
    setTimeout(() => UI.relayout(editor), 100);

    // --- Theme Toggling ---
   const applyTheme = (theme) => {
       document.body.setAttribute('data-theme', theme);
       localStorage.setItem('theme', theme);
   };
 
   themeToggleButton.addEventListener('click', () => {
       const currentTheme = localStorage.getItem('theme') || 'dark';
       const newTheme = currentTheme === 'light' ? 'dark' : 'light';
       applyTheme(newTheme);
   });
   // --- Dropdown Logic ---
   const dropdownButton = document.querySelector('.dropdown-button');
   const dropdown = document.querySelector('.dropdown');
 
   dropdownButton.addEventListener('click', (event) => {
       event.stopPropagation();
       dropdown.classList.toggle('active');
   });
 
   window.addEventListener('click', (event) => {
       if (!dropdown.contains(event.target)) {
           dropdown.classList.remove('active');
       }
   });
 
   // Apply saved theme on load - moved to inline script in index.html
});