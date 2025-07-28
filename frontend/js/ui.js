import { buildTree, getIgnorePatterns } from './file_system.js';

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

export function renderTree(treeData, onFileSelect) {
    $('#file-tree')
    .on('select_node.jstree', (e, data) => {
        if (data.node.type === 'file') {
            onFileSelect(data.node.id);
        }
    })
    .jstree({
        core: {
            data: treeData,
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
        plugins: ['types'],
    });
};

export async function refreshFileTree(rootDirectoryHandle, onFileSelect) {
    if (rootDirectoryHandle) {
        const treeInstance = $('#file-tree').jstree(true);
        if (treeInstance) {
            treeInstance.destroy();
        }

        const ignorePatterns = await getIgnorePatterns(rootDirectoryHandle);
        const treeData = await buildTree(rootDirectoryHandle, ignorePatterns);
        renderTree(treeData, onFileSelect);

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
        requestEl.textContent = `Req: ${requestTokens}`;
        responseEl.textContent = `Res: ${responseTokens}`;
        totalEl.textContent = `Total: ${requestTokens + responseTokens}`;
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

export function renderToolLogs(logsListContainer, logs) {
    logsListContainer.innerHTML = '';
    if (!logs || logs.length === 0) {
        logsListContainer.innerHTML = '<p>No tool executions have been logged yet.</p>';
        return;
    }

    // Newest first
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    logs.forEach(log => {
        const entry = document.createElement('details');
        entry.className = 'tool-log-entry-details';

        const summary = document.createElement('summary');
        summary.className = `tool-log-summary ${log.status.toLowerCase()}`;
        summary.innerHTML = `
            <span class="log-status">${log.status === 'Success' ? '✔' : '✖'}</span>
            <strong class="log-tool-name">${log.toolName}</strong>
            <span class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</span>
        `;

        const content = document.createElement('div');
        content.className = 'tool-log-content';
        
        const paramsPre = document.createElement('pre');
        paramsPre.textContent = `Parameters: ${JSON.stringify(log.params, null, 2)}`;
        
        const resultPre = document.createElement('pre');
        resultPre.textContent = `Result: ${JSON.stringify(log.result, null, 2)}`;
        
        content.appendChild(paramsPre);
        content.appendChild(resultPre);

        entry.appendChild(summary);
        entry.appendChild(content);
        logsListContainer.appendChild(entry);
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