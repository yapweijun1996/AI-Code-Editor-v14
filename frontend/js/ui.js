import { buildTree, getIgnorePatterns } from './file_system.js';
import { Settings, dispatchLLMSettingsUpdated } from './settings.js';

export function initResizablePanels(editor) {
    window.splitInstance = Split(['#file-tree-container', '#editor-container', '#chat-panel'], {
        sizes: [15, 55, 30],
        minSize: [0, 150, 540],
        gutterSize: 5,
        cursor: 'col-resize',
        onDragEnd: () => {
            if (editor) {
                editor.layout();
            }
        },
    });
}

export function relayout(editor) {
    if (window.splitInstance) {
        window.splitInstance.setSizes([15, 55, 30]);
    }
    if (editor) {
        editor.layout();
    }
}

export function renderTree(treeData, onFileSelect, appState) {
    $('#file-tree')
        .on('select_node.jstree', (e, data) => {
            if (data.node.type === 'file') {
                onFileSelect(data.node.id);
            }
        })
        .jstree({
            core: {
                data: treeData,
                check_callback: true,
                themes: {
                    name: 'default',
                    responsive: true,
                    icons: true,
                },
            },
            types: {
                default: { icon: 'jstree-icon jstree-file' },
                folder: { icon: 'jstree-icon jstree-folder' },
                file: { icon: 'jstree-icon jstree-file' },
            },
            plugins: ['types', 'contextmenu', 'dnd'],
            contextmenu: {
                show_at_node: false,
                items: function (node, appState) { // Add appState here
                    const tree = $('#file-tree').jstree(true);
                    const isRoot = node.parent === '#';

                    const items = {
                        createFile: {
                            separator_before: false,
                            separator_after: false,
                            label: "New File",
                            action: async function (obj) {
                                const parentNode = tree.get_node(node);
                                const newFileName = prompt("Enter new file name:");
                                if (newFileName) {
                                    await appState.handleCreateFile(parentNode, newFileName);
                                }
                            }
                        },
                        createFolder: {
                            separator_before: false,
                            separator_after: false,
                            label: "New Folder",
                            action: async function (obj) {
                                const parentNode = tree.get_node(node);
                                const newFolderName = prompt("Enter new folder name:");
                                if (newFolderName) {
                                    await appState.handleCreateFolder(parentNode, newFolderName);
                                }
                            }
                        },
                        rename: {
                            separator_before: true,
                            separator_after: false,
                            label: "Rename",
                            action: function (obj) {
                                tree.edit(node);
                            }
                        },
                        "delete": {
                            separator_before: false,
                            separator_after: false,
                            label: "Delete",
                            action: async function (obj) {
                                if (confirm(`Are you sure you want to delete ${node.text}?`)) {
                                    const nodeToDelete = tree.get_node(node);
                                    await appState.handleDeleteEntry(nodeToDelete);
                                }
                            }
                        }
                    };

                    if (node.type === 'file') {
                        delete items.createFile;
                        delete items.createFolder;
                    }
                    if (isRoot) {
                        delete items.rename;
                        delete items.delete;
                    }


                    return items;
                }
            },
            _appState: appState // Pass appState to the contextmenu plugin
        })
        .on('contextmenu', function (e) {
            e.preventDefault();
            const tree = $(this).jstree(true);
            const node = tree.get_node(e.target);
            if (node) {
                // Pass appState to show_contextmenu as well
                tree.show_contextmenu(node, e.pageX, e.pageY, tree.settings._appState);
            }
        })
        .on('rename_node.jstree', async function (e, data) {
            const newPath = data.text;
            const oldPath = data.old;
            if(newPath !== oldPath) {
                await appState.handleRenameEntry(data.node, newPath);
            }
        });
};

export async function refreshFileTree(rootDirectoryHandle, onFileSelect, appState) {
    if (rootDirectoryHandle) {
        const treeInstance = $('#file-tree').jstree(true);
        if (treeInstance) {
            treeInstance.destroy();
        }

        const ignorePatterns = await getIgnorePatterns(rootDirectoryHandle);
        const treeData = await buildTree(rootDirectoryHandle, ignorePatterns);
        renderTree(treeData, onFileSelect, appState);

        updateDirectoryButtons(true);
    }
}

export function updateDirectoryButtons(isConnected, needsReconnect = false) {
    const openDirBtn = document.getElementById('open-directory-button');
    const forgetBtn = document.getElementById('forget-folder-button');
    const reconnectBtn = document.getElementById('reconnect-button');

    if (!openDirBtn || !forgetBtn || !reconnectBtn) {
        console.warn('Directory control buttons not found in the DOM.');
        return;
    }

    if (isConnected) {
        openDirBtn.style.display = 'none';
        forgetBtn.style.display = 'block';
        reconnectBtn.style.display = 'none';
    } else if (needsReconnect) {
        openDirBtn.style.display = 'none';
        forgetBtn.style.display = 'block';
        reconnectBtn.style.display = 'block';
    } else {
        openDirBtn.style.display = 'block';
        forgetBtn.style.display = 'none';
        reconnectBtn.style.display = 'none';
    }
}

export function appendMessage(chatMessages, text, sender, isStreaming = false) {
    let messageDiv;
    if (isStreaming) {
        const lastMessage = chatMessages.lastElementChild;
        if (lastMessage && lastMessage.classList.contains('ai-streaming')) {
            messageDiv = lastMessage;
        }
    }

    if (!messageDiv) {
        messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;
        if (isStreaming) {
            messageDiv.classList.add('ai-streaming');
        }
        chatMessages.appendChild(messageDiv);
    }

    if (sender === 'ai') {
        messageDiv.innerHTML = DOMPurify.sanitize(marked.parse(text));
        
        const mermaidBlocks = messageDiv.querySelectorAll('pre code.language-mermaid');
        mermaidBlocks.forEach(block => {
            const preElement = block.parentElement;
            const mermaidContent = block.textContent;
            
            const mermaidContainer = document.createElement('div');
            mermaidContainer.className = 'mermaid';
            mermaidContainer.textContent = mermaidContent;
            
            preElement.parentNode.replaceChild(mermaidContainer, preElement);
        });

        mermaid.init(undefined, messageDiv.querySelectorAll('.mermaid'));
    } else {
        messageDiv.textContent = text;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function appendThinkingMessage(chatMessages, text, isStreaming = false) {
    let thinkingDiv;
    if (isStreaming) {
        const lastMessage = chatMessages.lastElementChild;
        if (lastMessage && lastMessage.classList.contains('thinking-message')) {
            thinkingDiv = lastMessage;
        }
    }

    if (!thinkingDiv) {
        thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'chat-message thinking-message active';
        thinkingDiv.setAttribute('role', 'region');
        thinkingDiv.setAttribute('aria-label', 'AI thinking process');
        
        // Create header with enhanced elements
        const header = document.createElement('div');
        header.className = 'thinking-header';
        
        const statusDiv = document.createElement('div');
        statusDiv.className = 'thinking-status';
        
        const icon = document.createElement('span');
        icon.className = 'thinking-icon spinning';
        icon.textContent = '🧠';
        icon.setAttribute('aria-hidden', 'true');
        
        const statusText = document.createElement('span');
        statusText.innerHTML = '<strong>AI is thinking...</strong>';
        
        statusDiv.appendChild(icon);
        statusDiv.appendChild(statusText);
        
        // Create meta information section
        const metaDiv = document.createElement('div');
        metaDiv.className = 'thinking-meta';
        
        const timer = document.createElement('div');
        timer.className = 'thinking-timer';
        timer.innerHTML = '⏱️ <span class="timer-value">0s</span>';
        
        const wordCount = document.createElement('div');
        wordCount.className = 'thinking-word-count';
        wordCount.textContent = '0 words';
        
        const toggle = document.createElement('button');
        toggle.className = 'thinking-toggle';
        toggle.textContent = 'Show reasoning';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'thinking-content-' + Date.now());
        
        metaDiv.appendChild(timer);
        metaDiv.appendChild(wordCount);
        metaDiv.appendChild(toggle);
        
        header.appendChild(statusDiv);
        header.appendChild(metaDiv);
        
        // Create content area
        const content = document.createElement('div');
        content.className = 'thinking-content collapsed';
        content.id = toggle.getAttribute('aria-controls');
        content.setAttribute('aria-hidden', 'true');
        
        // Enhanced toggle functionality with animations
        toggle.onclick = () => {
            const isCollapsed = content.classList.contains('collapsed');
            
            if (isCollapsed) {
                content.classList.remove('collapsed');
                content.classList.add('expanding');
                content.setAttribute('aria-hidden', 'false');
                toggle.textContent = 'Hide reasoning';
                toggle.classList.add('expanded');
                toggle.setAttribute('aria-expanded', 'true');
                
                setTimeout(() => {
                    content.classList.remove('expanding');
                }, 300);
            } else {
                content.classList.add('collapsing');
                toggle.textContent = 'Show reasoning';
                toggle.classList.remove('expanded');
                toggle.setAttribute('aria-expanded', 'false');
                
                setTimeout(() => {
                    content.classList.remove('collapsing');
                    content.classList.add('collapsed');
                    content.setAttribute('aria-hidden', 'true');
                }, 300);
            }
        };
        
        // Add progress indicator
        const progress = document.createElement('div');
        progress.className = 'thinking-progress';
        progress.style.width = '0%';
        
        thinkingDiv.appendChild(header);
        thinkingDiv.appendChild(content);
        thinkingDiv.appendChild(progress);
        
        // Start timer
        const startTime = Date.now();
        const timerInterval = setInterval(() => {
            if (!thinkingDiv.classList.contains('active')) {
                clearInterval(timerInterval);
                return;
            }
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const timerValue = timer.querySelector('.timer-value');
            if (timerValue) {
                timerValue.textContent = elapsed + 's';
            }
        }, 1000);
        
        // Store timer reference for cleanup
        thinkingDiv._timerInterval = timerInterval;
        
        chatMessages.appendChild(thinkingDiv);
    }

    const content = thinkingDiv.querySelector('.thinking-content');
    const wordCount = thinkingDiv.querySelector('.thinking-word-count');
    const progress = thinkingDiv.querySelector('.thinking-progress');
    
    if (content && text) {
        content.innerHTML = DOMPurify.sanitize(marked.parse(text || ''));
        
        // Update word count
        if (wordCount) {
            const words = text.trim().split(/\s+/).length;
            wordCount.textContent = words + ' words';
        }
        
        // Update progress (simulate based on content length)
        if (progress) {
            const maxLength = 2000; // Estimated max thinking length
            const currentLength = text.length;
            const progressPercent = Math.min(100, (currentLength / maxLength) * 100);
            progress.style.width = progressPercent + '%';
        }
    }
    
    thinkingDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    
    return thinkingDiv;
}

export function finalizeThinkingMessage(thinkingDiv) {
    if (thinkingDiv && thinkingDiv.classList.contains('thinking-message')) {
        // Clear timer
        if (thinkingDiv._timerInterval) {
            clearInterval(thinkingDiv._timerInterval);
        }
        
        // Update status
        const statusDiv = thinkingDiv.querySelector('.thinking-status');
        const icon = thinkingDiv.querySelector('.thinking-icon');
        const progress = thinkingDiv.querySelector('.thinking-progress');
        
        if (statusDiv) {
            statusDiv.innerHTML = `
                <span class="thinking-icon">💡</span>
                <span><strong>AI reasoning complete</strong></span>
            `;
        }
        
        if (icon) {
            icon.classList.remove('spinning');
        }
        
        if (progress) {
            progress.style.width = '100%';
        }
        
        // Add completion styling
        thinkingDiv.classList.remove('active');
        thinkingDiv.classList.add('thinking-complete');
        
        // Update accessibility
        thinkingDiv.setAttribute('aria-label', 'AI reasoning complete');
        
        // Add a subtle completion animation
        setTimeout(() => {
            thinkingDiv.style.transform = 'scale(1.02)';
            setTimeout(() => {
                thinkingDiv.style.transform = 'scale(1)';
            }, 200);
        }, 100);
    }
}


export function appendToolLog(chatMessages, toolName, params) {
    const logEntry = document.createElement('div');
    logEntry.className = 'chat-message tool-log';

    const header = document.createElement('div');
    header.className = 'tool-log-entry-header';
    header.innerHTML = `
        <div class="status-icon loader"></div>
        <span class="tool-name">${toolName}</span>
    `;

    const paramsPre = document.createElement('pre');
    paramsPre.className = 'tool-log-params';
    const paramsText = (params && Object.keys(params).length > 0)
        ? JSON.stringify(params, null, 2)
        : 'No parameters';
    paramsPre.textContent = paramsText;

    logEntry.appendChild(header);
    logEntry.appendChild(paramsPre);

    chatMessages.appendChild(logEntry);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return logEntry;
}

export function updateToolLog(logEntry, isSuccess) {
    const statusIcon = logEntry.querySelector('.status-icon');
    statusIcon.classList.remove('loader');
    statusIcon.classList.add(isSuccess ? 'completed' : 'failed');
    statusIcon.textContent = isSuccess ? '✔' : '✖';
}

export function updateImagePreview(imagePreviewContainer, uploadedImage, clearImagePreview) {
    imagePreviewContainer.innerHTML = '';
    if (uploadedImage) {
        const img = document.createElement('img');
        img.src = `data:${uploadedImage.type};base64,${uploadedImage.data}`;

        const clearButton = document.createElement('button');
        clearButton.id = 'image-preview-clear';
        clearButton.innerHTML = '&times;';
        clearButton.onclick = clearImagePreview;

        imagePreviewContainer.appendChild(img);
        imagePreviewContainer.appendChild(clearButton);
        imagePreviewContainer.style.display = 'block';
    } else {
        imagePreviewContainer.style.display = 'none';
    }
}

export function renderCheckpoints(checkpointsListContainer, checkpoints) {
    const tbody = checkpointsListContainer.querySelector('#checkpoints-list');
    tbody.innerHTML = '';

    if (!checkpoints || checkpoints.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="text-align:center;">No checkpoints have been saved yet.</td>`;
        tbody.appendChild(tr);
        return;
    }

    // Sort checkpoints by timestamp, newest first
    checkpoints.sort((a, b) => b.timestamp - a.timestamp);

    checkpoints.forEach(cp => {
        const tr = document.createElement('tr');
        tr.className = 'checkpoint-entry';
        tr.innerHTML = `
            <td><input type="checkbox" class="checkpoint-checkbox" data-id="${cp.id}"></td>
            <td class="checkpoint-name" title="${cp.name}">${cp.name}</td>
            <td class="checkpoint-file" title="${cp.filePath || 'N/A'}">${cp.filePath || 'N/A'}</td>
            <td class="checkpoint-timestamp">${new Date(cp.timestamp).toLocaleString()}</td>
            <td>
                <button class="restore-checkpoint-button" data-id="${cp.id}">Restore</button>
                <button class="delete-checkpoint-button" data-id="${cp.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

export function renderChatHistory(chatMessagesContainer, history) {
    chatMessagesContainer.innerHTML = '';
    history.forEach(message => {
        const sender = message.role === 'user' ? 'user' : 'ai';
        let fullText = '';
        message.parts.forEach(part => {
            if (part.text) {
                fullText += part.text;
            }
        });

        if (fullText.trim()) {
            appendMessage(chatMessagesContainer, fullText, sender);
        }
    });
}
export function updateTokenDisplay(requestTokens, responseTokens) {
    const display = document.getElementById('token-usage-display');
    const requestEl = document.getElementById('token-request');
    const responseEl = document.getElementById('token-response');
    const totalEl = document.getElementById('token-total');

    if (display && requestEl && responseEl && totalEl) {
        const reqTokens = parseInt(requestTokens, 10) || 0;
        const resTokens = parseInt(responseTokens, 10) || 0;

        requestEl.textContent = `Req: ${reqTokens}`;
        responseEl.textContent = `Res: ${resTokens}`;
        totalEl.textContent = `Total: ${reqTokens + resTokens}`;
        display.style.display = 'flex';
    }
}

export function displayRules(chatMessagesContainer, rules, modeName) {
    const rulesDiv = document.createElement('div');
    rulesDiv.className = 'chat-message system-rules';
    
    const title = document.createElement('h4');
    title.textContent = `Active Rules for ${modeName} Mode`;
    
    const rulesContent = document.createElement('pre');
    rulesContent.textContent = rules;
    
    rulesDiv.appendChild(title);
    rulesDiv.appendChild(rulesContent);
    
    chatMessagesContainer.appendChild(rulesDiv);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

export function showError(message, duration = 5000) {
    const container = document.getElementById('error-container');
    if (!container) {
        console.error('Error container not found!');
        return;
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.onclick = () => {
        errorDiv.classList.add('hide');
        setTimeout(() => errorDiv.remove(), 500);
    };

    errorDiv.appendChild(closeButton);
    container.appendChild(errorDiv);

    setTimeout(() => {
        if (errorDiv.parentElement) {
            closeButton.onclick();
        }
    }, duration);
}

export function renderToolLogs(logsListContainer, logs, filterText = '') {
    logsListContainer.innerHTML = '';
    if (!logs || logs.length === 0) {
        logsListContainer.innerHTML = '<p>No tool executions have been logged yet.</p>';
        return;
    }

    // Newest first
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const filteredLogs = logs.filter(log => 
        log.toolName && log.toolName.toLowerCase().includes(filterText.toLowerCase())
    );

    if (filteredLogs.length === 0) {
        logsListContainer.innerHTML = '<p>No matching tool logs found.</p>';
        return;
    }

    filteredLogs.forEach(log => {
        const card = document.createElement('div');
        card.className = `tool-log-card ${(log.status || 'unknown').toLowerCase()}`;

        const header = document.createElement('div');
        header.className = 'tool-log-card-header';
        header.innerHTML = `
            <div class="tool-log-card-title">
                <span class="log-status-badge ${(log.status || 'unknown').toLowerCase()}">${log.status || 'Unknown'}</span>
                <strong class="log-tool-name">${log.toolName || 'Unknown Tool'}</strong>
            </div>
            <span class="log-timestamp">${new Date(log.timestamp || Date.now()).toLocaleString()}</span>
        `;
        header.addEventListener('click', () => {
            card.classList.toggle('expanded');
        });


        const content = document.createElement('div');
        content.className = 'tool-log-card-content';
        
        const paramsPre = document.createElement('pre');
        paramsPre.textContent = `Parameters: ${JSON.stringify(log.params || {}, null, 2)}`;
        
        const resultPre = document.createElement('pre');
        resultPre.textContent = `Result: ${JSON.stringify(log.result || {}, null, 2)}`;
        
        content.appendChild(paramsPre);
        content.appendChild(resultPre);

        card.appendChild(header);
        card.appendChild(content);
        logsListContainer.appendChild(card);
    });
}
export async function updateIndexedDBUsage() {
  const usageElement = document.getElementById('indexeddb-usage');
  if (!usageElement) return;

  if (!('storage' in navigator && 'estimate' in navigator.storage)) {
    usageElement.textContent = "Storage usage info unavailable.";
    return;
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const percent = quota ? ((usage / quota) * 100).toFixed(2) : '?';
    const toMB = b => (b / (1024 * 1024)).toFixed(2) + " MB";
    usageElement.textContent =
      `Storage usage: ${toMB(usage)} of ${toMB(quota)} (${percent}%)`;
  } catch (e) {
    usageElement.textContent = "Could not retrieve storage usage.";
    console.error("Error estimating storage:", e);
  }
}

export async function saveLLMSettings() {
    const provider = document.querySelector('.settings-tabs .tab-link.active').dataset.tab.replace('-settings', '');

    const settingsToSave = {
        'llm.provider': provider,
        'llm.gemini.apiKey': document.getElementById('gemini-api-keys').value,
        'llm.gemini.model': document.getElementById('gemini-model-selector').value,
        'llm.gemini.thinkingMode': document.getElementById('gemini-thinking-mode').checked,
        'llm.gemini.showThinking': document.getElementById('gemini-show-thinking').checked,
        'llm.openai.apiKey': document.getElementById('openai-api-key').value,
        'llm.openai.model': document.getElementById('openai-model-selector').value,
        'llm.openai.thinkingMode': document.getElementById('openai-thinking-mode').checked,
        'llm.openai.showThinking': document.getElementById('openai-show-thinking').checked,
        'llm.ollama.baseURL': document.getElementById('ollama-base-url').value,
        'llm.ollama.model': document.getElementById('ollama-model-name').value,
    };

    await Settings.setMultiple(settingsToSave);

    dispatchLLMSettingsUpdated();
    showToast('Settings saved successfully!');
}

export function loadLLMSettings() {
    // Populate UI from cached settings
    document.getElementById('gemini-api-keys').value = Settings.get('llm.gemini.apiKey') || '';
    document.getElementById('gemini-model-selector').value = Settings.get('llm.gemini.model');
    document.getElementById('gemini-thinking-mode').checked = Settings.get('llm.gemini.thinkingMode') || false;
    document.getElementById('gemini-show-thinking').checked = Settings.get('llm.gemini.showThinking') !== false;
    document.getElementById('openai-api-key').value = Settings.get('llm.openai.apiKey') || '';
    document.getElementById('openai-model-selector').value = Settings.get('llm.openai.model');
    document.getElementById('openai-thinking-mode').checked = Settings.get('llm.openai.thinkingMode') || false;
    document.getElementById('openai-show-thinking').checked = Settings.get('llm.openai.showThinking') !== false;
    document.getElementById('ollama-base-url').value = Settings.get('llm.ollama.baseURL');
    document.getElementById('ollama-model-name').value = Settings.get('llm.ollama.model');
    
    const provider = Settings.get('llm.provider');
    document.querySelectorAll('.settings-tabs .tab-link').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === `${provider}-settings`);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${provider}-settings`);
    });
}

export function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    // Animate out and remove
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, duration);
}

const sunIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-sun"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
const moonIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

let uiInitialized = false;

function updateThemeIcon(theme) {
    const themeToggleButton = document.getElementById('theme-toggle-button');
    if (themeToggleButton) {
        themeToggleButton.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
    }
}

export function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

export function updateLLMProviderStatus() {
    const providerStatus = document.getElementById('llm-provider-status');
    if (providerStatus) {
        const provider = Settings.get('llm.provider') || 'N/A';
        providerStatus.textContent = provider;
    }
}

export function initializeUI() {
    if (uiInitialized) {
        return;
    }
    // Theme toggle
    const themeToggleButton = document.getElementById('theme-toggle-button');
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', toggleTheme);
        const savedTheme = Settings.get('ui.theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    }
    
    // LLM Provider Status Display & Settings Toggle
    updateLLMProviderStatus();
    const llmStatusContainer = document.getElementById('llm-status-container');
    const settingsToggleButton = document.getElementById('settings-toggle-button');
    const llmSettingsPanel = document.getElementById('llm-settings-panel');
    const saveSettingsButton = document.getElementById('save-llm-settings-button');

    if (settingsToggleButton && llmSettingsPanel) {
        const togglePanel = () => {
            llmSettingsPanel.classList.toggle('visible');
            if (llmSettingsPanel.classList.contains('visible')) {
                loadLLMSettings();
            }
        };
        settingsToggleButton.addEventListener('click', togglePanel);
        if (llmStatusContainer) {
            llmStatusContainer.addEventListener('click', togglePanel);
        }
    }

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener('click', async () => {
            await saveLLMSettings();
             if (llmSettingsPanel.classList.contains('visible')) {
                llmSettingsPanel.classList.remove('visible');
             }
        });
    }

    // Tab switching logic
    const tabLinks = document.querySelectorAll('.settings-tabs .tab-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tab = link.dataset.tab;
            tabLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === tab);
            });
        });
    });

    // API key visibility toggle
    const toggleButtons = document.querySelectorAll('.toggle-visibility-button');
    toggleButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const wrapper = e.target.closest('.api-key-wrapper');
            if (!wrapper) return;

            const input = wrapper.querySelector('input, textarea');
            if (!input) return;

            if (input.type === 'password' || (input.tagName === 'TEXTAREA' && input.dataset.obscured === 'true')) {
                input.type = 'text';
                if(input.tagName === 'TEXTAREA') {
                    input.dataset.obscured = 'false';
                    // This is a simplified visibility toggle for textarea.
                    // A more robust solution might involve replacing content or using a different element.
                    // For now, we just change the styling which we'll assume is handled via CSS.
                }
                e.target.textContent = '🙈';
            } else {
                if(input.tagName === 'TEXTAREA') {
                    input.type = 'textarea'; // Not a real type, but helps with logic
                    input.dataset.obscured = 'true';
                } else {
                    input.type = 'password';
                }
                e.target.textContent = '👁️';
            }
        });
    });
    uiInitialized = true;
}
