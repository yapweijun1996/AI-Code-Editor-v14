import { LLMServiceFactory } from './llm/service_factory.js';
import { Settings } from './settings.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as ToolExecutor from './tool_executor.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';

export const ChatService = {
    isSending: false,
    isCancelled: false,
    llmService: null,
    rootDirectoryHandle: null,
    errorTracker: {
        filePath: null,
        errorSignature: null,
        count: 0,
    },

    async initialize(rootDirectoryHandle) {
        this.rootDirectoryHandle = rootDirectoryHandle;
        await this._initializeLLMService();

        const chatHistory = await Settings.getChatHistory();
        if (chatHistory.length > 0) {
            console.log(`[Chat History] Found ${chatHistory.length} messages.`);
            const chatMessages = document.getElementById('chat-messages');
            UI.renderChatHistory(chatMessages, chatHistory);
        }
    },

    async _initializeLLMService() {
        const llmSettings = Settings.getLLMSettings();
        this.llmService = LLMServiceFactory.create(llmSettings.provider, llmSettings);
        console.log(`LLM Service initialized with provider: ${llmSettings.provider}`);
    },

    async _startChat(history = []) {
        // This method will now be simpler. The complex setup (prompts, tools)
        // will be handled by the specific LLMService implementation.
        // For now, we just ensure the service is ready.
        if (!this.llmService || !this.llmService.isConfigured()) {
            console.warn("LLM service not configured. Chat will not start. Please configure settings.");
            return;
        }

        try {
            // The actual chat session object might be managed within the LLMService
            // or we can still store it here. For now, we'll assume the service
            // manages its own state and this method just signals readiness.
            const mode = document.getElementById('agent-mode-selector').value;
            await DbManager.saveSetting('selectedMode', mode);
            this.activeMode = mode;
            console.log(`Chat ready to start with provider: ${this.llmService.constructor.name}, mode: ${mode}`);
        } catch (error) {
            console.error('Failed to start chat:', error);
            UI.showError(`Error: Could not start chat. ${error.message}`);
        }
    },



    _updateUiState(isSending) {
        const chatSendButton = document.getElementById('chat-send-button');
        const chatCancelButton = document.getElementById('chat-cancel-button');
        const thinkingIndicator = document.getElementById('thinking-indicator');

        chatSendButton.style.display = isSending ? 'none' : 'inline-block';
        chatCancelButton.style.display = isSending ? 'inline-block' : 'none';
        thinkingIndicator.style.display = isSending ? 'block' : 'none';
    },

    async _handleRateLimiting(chatMessages) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const rateLimitMs = this.rateLimit;

        if (timeSinceLastRequest < rateLimitMs) {
            const delay = rateLimitMs - timeSinceLastRequest;
            UI.appendMessage(chatMessages, `Rate limit active. Waiting for ${Math.ceil(delay / 1000)}s...`, 'ai');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
    },

    _prepareAndRenderUserMessage(chatInput, chatMessages, uploadedImage, clearImagePreview) {
        const userPrompt = chatInput.value.trim();
        let displayMessage = userPrompt;
        const initialParts = [];

        if (userPrompt) initialParts.push({ text: userPrompt });

        if (uploadedImage) {
            displayMessage += `\n📷 Attached: ${uploadedImage.name}`;
            initialParts.push({
                inlineData: {
                    mimeType: uploadedImage.type,
                    data: uploadedImage.data,
                },
            });
        }

        UI.appendMessage(chatMessages, displayMessage.trim(), 'user');
        chatInput.value = '';
        clearImagePreview();
        console.log(`[User Query] ${userPrompt}`);

        return initialParts;
    },

    async _performApiCall(initialParts, chatMessages) {
        if (!this.llmService) {
            UI.showError("LLM Service is not initialized. Please check your settings.");
            return;
        }

        const history = await Settings.getChatHistory();
        history.push({ role: 'user', parts: initialParts });

        let functionCalls;
        do {
            try {
                const mode = document.getElementById('agent-mode-selector').value;
                const customRules = Settings.get(`custom.${mode}.rules`);
                const tools = ToolExecutor.getToolDefinitions();
                const stream = this.llmService.sendMessageStream(history, tools, customRules);

                let modelResponseText = '';
                functionCalls = []; // Reset for this iteration

                for await (const chunk of stream) {
                    if (this.isCancelled) return;

                    if (chunk.text) {
                        modelResponseText += chunk.text;
                        UI.appendMessage(chatMessages, modelResponseText, 'ai', true);
                    }
                    if (chunk.functionCalls) {
                        functionCalls.push(...chunk.functionCalls);
                    }
                }

                const modelResponseParts = [];
                if (modelResponseText) modelResponseParts.push({ text: modelResponseText });
                if (functionCalls.length > 0) {
                    functionCalls.forEach(fc => modelResponseParts.push({ functionCall: fc }));
                }

                if (modelResponseParts.length > 0) {
                    history.push({ role: 'model', parts: modelResponseParts });
                }

                if (functionCalls.length > 0) {
                    const toolResults = [];
                    for (const call of functionCalls) {
                        if (this.isCancelled) return;
                        const result = await ToolExecutor.execute(call, this.rootDirectoryHandle);
                        toolResults.push({
                            id: call.id,
                            name: result.toolResponse.name,
                            response: result.toolResponse.response,
                        });
                    }
                    history.push({ role: 'user', parts: toolResults.map(functionResponse => ({ functionResponse })) });
                }

            } catch (error) {
                console.error(`Error during API call with ${this.llmService.constructor.name}:`, error);
                console.error(`Error stack:`, error.stack); // Log the stack trace
                UI.showError(`An error occurred during AI communication: ${error.message}. Please check your API key and network connection.`);
                functionCalls = [];
            }
        } while (functionCalls.length > 0 && !this.isCancelled);

        await Settings.saveChatHistory(history);
    },

    async sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, thinkingIndicator, uploadedImage, clearImagePreview) {
        console.log("Attempting to send message...");
        const userPrompt = chatInput.value.trim();
        if ((!userPrompt && !uploadedImage) || this.isSending) return;

       // If this is a new, user-initiated prompt, reset the error tracker.
       this.resetErrorTracker();

        if (!this.llmService) {
            UI.showError("LLM Service is not configured. Please check your settings.");
            return;
        }

        this.isSending = true;
        this.isCancelled = false;
        this._updateUiState(true);

        try {
            await this._handleRateLimiting(chatMessages);

            const initialParts = this._prepareAndRenderUserMessage(chatInput, chatMessages, uploadedImage, clearImagePreview);

            await this._performApiCall(initialParts, chatMessages);

            if (this.isCancelled) {
                UI.appendMessage(chatMessages, 'Cancelled by user.', 'ai');
            }
        } catch (error) {
            UI.showError(`An error occurred: ${error.message}`);
            console.error('Chat Error:', error);
        } finally {
            this.isSending = false;
            this._updateUiState(false);
        }
    },

    cancelMessage() {
        if (this.isSending) {
            this.isCancelled = true;
        }
    },

    async clearHistory(chatMessages) {
        chatMessages.innerHTML = '';
        UI.appendMessage(chatMessages, 'Conversation history cleared.', 'ai');
        await Settings.clearChatHistory();
        await this._initializeLLMService();
    },

    async condenseHistory(chatMessages) {
        UI.appendMessage(chatMessages, 'Condensing history... This will start a new session.', 'ai');
        const history = await Settings.getChatHistory();
        if (history.length === 0) {
            UI.appendMessage(chatMessages, 'History is already empty.', 'ai');
            return;
        }

        const condensationPrompt =
            "Please summarize our conversation so far in a concise way. Include all critical decisions, file modifications, and key insights. The goal is to reduce the context size while retaining the essential information for our ongoing task. Start the summary with 'Here is a summary of our conversation so far:'.";
        
        // This needs to be a one-off call, not part of the main loop
        const condensationHistory = history.concat([{ role: 'user', parts: [{ text: condensationPrompt }] }]);
        const stream = this.llmService.sendMessageStream(condensationHistory, [], ''); // No tools, no custom rules for summary
        let summaryText = '';
        for await (const chunk of stream) {
            if (chunk.text) {
                summaryText += chunk.text;
            }
        }
        
        chatMessages.innerHTML = '';
        UI.appendMessage(chatMessages, 'Original conversation history has been condensed.', 'ai');
        UI.appendMessage(chatMessages, summaryText, 'ai');

        await this._startChat();
    },

    async viewHistory() {
        const history = await Settings.getChatHistory();
        return JSON.stringify(history, null, 2);
    },

   trackError(filePath, errorSignature) {
       if (this.errorTracker.filePath === filePath && this.errorTracker.errorSignature === errorSignature) {
           this.errorTracker.count++;
       } else {
           this.errorTracker.filePath = filePath;
           this.errorTracker.errorSignature = errorSignature;
           this.errorTracker.count = 1;
       }
       console.log(`Error tracked:`, this.errorTracker);
   },

   getConsecutiveErrorCount(filePath, errorSignature) {
       if (this.errorTracker.filePath === filePath && this.errorTracker.errorSignature === errorSignature) {
           return this.errorTracker.count;
       }
       return 0;
   },

   resetErrorTracker() {
       this.errorTracker.filePath = null;
       this.errorTracker.errorSignature = null;
       this.errorTracker.count = 0;
       console.log('Error tracker reset.');
   },

   async runToolDirectly(toolName, params) {
       if (this.isSending) {
           UI.showError("Please wait for the current AI operation to complete.");
           return;
       }

       const toolCall = { name: toolName, args: params };
       const chatMessages = document.getElementById('chat-messages');
       UI.appendMessage(chatMessages, `Running tool: ${toolName}...`, 'ai');

       try {
           const result = await ToolExecutor.execute(toolCall, this.rootDirectoryHandle);
           let resultMessage = `Tool '${toolName}' executed successfully.`;
           if (result.toolResponse && result.toolResponse.response && result.toolResponse.response.message) {
                resultMessage = result.toolResponse.response.message;
           } else if (result.toolResponse && result.toolResponse.response && result.toolResponse.response.error) {
                throw new Error(result.toolResponse.response.error);
           }
            UI.appendMessage(chatMessages, resultMessage, 'ai');
       } catch (error) {
           const errorMessage = `Error running tool '${toolName}': ${error.message}`;
           UI.showError(errorMessage);
           UI.appendMessage(chatMessages, errorMessage, 'ai');
           console.error(errorMessage, error);
       }
   }
};