import { buildTree } from './file_system.js';

export function initResizablePanels(editor) {
    window.splitInstance = Split(['#file-tree-container', '#editor-container', '#chat-panel'], {
        sizes: [15, 30, 55],
        minSize: [150, 150, 540],
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
        window.splitInstance.setSizes([15, 30, 55]);
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

        const treeData = await buildTree(rootDirectoryHandle);
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
    checkpointsListContainer.innerHTML = '';
    if (!checkpoints || checkpoints.length === 0) {
        checkpointsListContainer.innerHTML = '<p>No checkpoints have been saved yet.</p>';
        return;
    }

    // Sort checkpoints by timestamp, newest first
    checkpoints.sort((a, b) => b.timestamp - a.timestamp);

    checkpoints.forEach(cp => {
        const entry = document.createElement('div');
        entry.className = 'checkpoint-entry';
        entry.innerHTML = `
            <span class="checkpoint-name" title="${cp.name}">${cp.name}</span>
            <span class="checkpoint-file" title="${cp.filePath}">${cp.filePath}</span>
            <span class="checkpoint-timestamp">${new Date(cp.timestamp).toLocaleString()}</span>
            <div>
                <button class="restore-checkpoint-button" data-id="${cp.id}">Restore</button>
                <button class="delete-checkpoint-button" data-id="${cp.id}">Delete</button>
            </div>
        `;
        checkpointsListContainer.appendChild(entry);
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