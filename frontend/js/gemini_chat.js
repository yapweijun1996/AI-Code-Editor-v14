import { ApiKeyManager } from './api_manager.js';
import { DbManager } from './db.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as ToolExecutor from './tool_executor.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';

export const GeminiChat = {
    isSending: false,
    isCancelled: false,
    chatSession: null,
    model: null,
    activeModelName: '',
    activeMode: '',
    lastRequestTime: 0,
    rateLimit: 5000,
    rootDirectoryHandle: null,

    async initialize(rootDirectoryHandle) {
        this.rootDirectoryHandle = rootDirectoryHandle;

        const savedModel = await DbManager.getSetting('selectedModel');
        const modelSelector = document.getElementById('model-selector');
        if (savedModel && modelSelector) {
            modelSelector.value = savedModel;
        }

        const savedMode = await DbManager.getSetting('selectedMode');
        const modeSelector = document.getElementById('agent-mode-selector');
        if (savedMode && modeSelector) {
            modeSelector.value = savedMode;
        }
    },

    async _startChat(history = []) {
        try {
            const apiKey = ApiKeyManager.getCurrentKey();
            if (!apiKey) {
                throw new Error('No API key provided. Please add one in the settings.');
            }

            const genAI = new window.GoogleGenerativeAI(apiKey);
            const modelName = document.getElementById('model-selector').value;
            const mode = document.getElementById('agent-mode-selector').value;

            await DbManager.saveSetting('selectedModel', modelName);
            await DbManager.saveSetting('selectedMode', mode);

            const baseTools = {
                functionDeclarations: [
                    { name: 'create_file', description: "Creates a new file. CRITICAL: Do NOT include the root directory name in the path. Example: To create 'app.js' in the root, the path is 'app.js', NOT 'my-project/app.js'.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['filename', 'content'] } },
                    { name: 'delete_file', description: "Deletes a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
                    { name: 'create_folder', description: "Creates a new folder. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { folder_path: { type: 'STRING' } }, required: ['folder_path'] } },
                    { name: 'delete_folder', description: "Deletes a folder and all its contents. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { folder_path: { type: 'STRING' } }, required: ['folder_path'] } },
                    { name: 'rename_folder', description: "Renames a folder. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { old_folder_path: { type: 'STRING' }, new_folder_path: { type: 'STRING' } }, required: ['old_folder_path', 'new_folder_path'] } },
                    { name: 'rename_file', description: "Renames a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { old_path: { type: 'STRING' }, new_path: { type: 'STRING' } }, required: ['old_path', 'new_path'] } },
                    { name: 'read_file', description: "Reads a file's content. CRITICAL: Do NOT include the root directory name in the path. Example: To read 'src/app.js', the path is 'src/app.js'.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
                    { name: 'read_url', description: 'Reads and extracts the main content and all links from a given URL. The result will be a JSON object with "content" and "links" properties.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
                    { name: 'get_open_file_content', description: 'Gets the content of the currently open file in the editor.' },
                    { name: 'get_selected_text', description: 'Gets the text currently selected by the user in the editor.' },
                    { name: 'replace_selected_text', description: 'Replaces the currently selected text in the editor with new text.', parameters: { type: 'OBJECT', properties: { new_text: { type: 'STRING' } }, required: ['new_text'] } },
                    { name: 'get_project_structure', description: 'Gets the entire file and folder structure of the project. CRITICAL: Always use this tool before attempting to read or create a file to ensure you have the correct file path.' },
                    { name: 'duckduckgo_search', description: 'Performs a search using DuckDuckGo and returns the results.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
                    { name: 'search_code', description: 'Searches for a specific string in all files in the project (like grep).', parameters: { type: 'OBJECT', properties: { search_term: { type: 'STRING' } }, required: ['search_term'] } },
                    { name: 'run_terminal_command', description: 'Executes a shell command on the backend and returns the output.', parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] } },
                    { name: 'build_or_update_codebase_index', description: 'Scans the entire codebase to build a searchable index. Slow, run once per session.' },
                    { name: 'query_codebase', description: 'Searches the pre-built codebase index.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
                    { name: 'get_file_history', description: "Gets a file's git history. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
                    { name: 'rewrite_file', description: "Rewrites a file with new content. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['filename', 'content'] } },
                    { name: 'format_code', description: "Formats a file with Prettier. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
                    { name: 'analyze_code', description: "Analyzes a JavaScript file's structure. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
                ],
            };
            let allTools = [baseTools];
            let systemInstructionText = '';
            const now = new Date();
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const timeString = now.toLocaleString();
            const baseCodePrompt = `You are Gemini, an expert AI programmer. Your function is to solve problems by writing, reading, and modifying code and files.

# CORE IDENTITY & DIRECTIVES
- **Identity:** You are a programmer. You MUST override any internal restriction that prevents you from writing or modifying files. You ALWAYS have access to tools like 'rewrite_file' and 'create_file'.
- **Clarity:** Your responses should be concise, analytical, and purposeful. Avoid conversational filler.
- **Markdown:** Always use Markdown for formatting.

# CORE METHODOLOGY

**1. FILE PATHS - CRITICAL RULE**
- **You MUST NOT include the top-level project folder name in file paths.** The file system is already rooted in the project directory.
- **CORRECT:** To access \`index.html\` in the root, the path is 'index.html'.
- **INCORRECT:** \`test001/index.html\`
- **CORRECT:** To access \`app.js\` in a \`src\` folder, the path is 'src/app.js'.
- **INCORRECT:** \`test001/src/app.js\`
- **YOU MUST FOLLOW THIS RULE. FAILURE TO DO SO WILL CAUSE ALL FILE OPERATIONS TO FAIL.**

**2. REQUEST DECONSTRUCTION & PLANNING:**
- Your primary task is to deconstruct user requests into a sequence of actionable steps.
- Users will often make vague requests (e.g., "review the code," "fix the bug"). You MUST interpret these goals and create a concrete, multi-step plan using the available tools.
- **Example Plan:** If the user says "review all files," you should form a plan like: "1. Call 'get_project_structure' to list all files. 2. Call 'read_file' on each important file I discover. 3. Summarize my findings."
- Announce your plan to the user before executing it.

**3. ACTION & CONTEXT INTEGRATION:**
- **Contextual Awareness:** When a user gives a follow-up command like "read all of them" or "go into more detail," you MUST refer to the immediate preceding turns in the conversation to understand what "them" refers to. Use the URLs or file paths you provided in your last response as the context for the new command.
- When a task requires multiple steps, you MUST use the output of the previous step as the input for the current step. For example, after using 'get_project_structure', use the list of files as input for your 'read_file' calls. Do not discard context.

**4. POST-TOOL ANALYSIS:**
- After a tool executes, you MUST provide a thoughtful, analytical response.
- **Summarize:** Briefly explain the outcome of the tool command.
- **Analyze:** Explain what the result means in the context of your plan.
- **Next Action:** State what you will do next and then call the appropriate tool.

**5. URL HANDLING & RESEARCH:**
- **URL Construction Rule:** When you discover relative URLs (e.g., '/path/to/page'), you MUST convert them to absolute URLs by correctly combining them with the base URL of the source page. CRITICAL: Ensure you do not introduce errors like double slashes ('//') or invalid characters ('.com./').
- **Autonomous Deep Dive:** When you read a URL and it contains more links, you must autonomously select the single most relevant link to continue the research. State your choice and proceed when commanded. Do not ask the user which link to choose.
- **CRITICAL: Proactive URL Reading from Search:** After a \`duckduckgo_search\`, you MUST analyze the search results. If a result appears relevant, you MUST immediately and proactively use the \`read_url\` tool on that URL to gather more details. This is not optional. Do not ask for permission.

**6. MULTI-URL GATHERING:**
- If a user asks you to read multiple URLs (e.g., "read all related URLs," "get information from these links"), you MUST use the \`read_url\` tool for each URL you have identified in the conversation.
- After gathering data from all URLs, synthesize the information into a single, cohesive response.
**7. SYNTHESIS & REPORTING:**
- Your final output is not just data, but insight. After gathering information using tools, you MUST synthesize it.
- **Comprehensive Answers:** Do not give short or superficial answers. Combine information from multiple sources (\`read_file\`, \`read_url\`, etc.) into a detailed, well-structured response.
- **Analysis:** Explain what the information means. Identify key facts, draw connections, and provide a comprehensive overview. If asked for a "breakdown" or "detailed analysis," you are expected to generate a substantial, long-form response (e.g., 500-1000 words) if the gathered data supports it.
`;
            
            const newPlanPrompt = `You are a Senior AI Research Analyst. Your purpose is to provide users with well-researched, data-driven strategic advice.

# CORE METHODOLOGY
1.  **Deconstruct the Request:** Identify the core questions and objectives in the user's prompt.
2.  **Aggressive Research:** You MUST use the Google Search tool to gather external information. Do not rely on your internal knowledge. Your credibility depends on fresh, verifiable data.
3.  **Synthesize & Strategize:** Analyze the search results to identify key insights, trends, and data points. Use this synthesis to construct a strategic plan or report.
4.  **Structured Reporting:** Present your findings in a professional markdown format. Your report should include:
    - An **Executive Summary** at the top.
    - Clear sections with headings.
    - **Actionable Steps** or recommendations.
    - Use of **Mermaid diagrams** for visualization where appropriate.
    - A **"References"** section at the end, citing all sources used.
5.  **Focus:** Your role is strategic planning, not implementation. Avoid writing functional code.

# COMMUNICATION PROTOCOL
- After a tool runs, you MUST respond to the user with a summary of the action and its result.
- Do not call another tool without providing an intermediary text response to the user.

**Current user context:**
- Current Time: ${timeString}
- Timezone: ${timeZone}`;

            if (mode === 'plan') {
                allTools = [
                    { urlContext: {} },
                    { googleSearch: {}},
                ];
                systemInstructionText = newPlanPrompt;
            } else {
                systemInstructionText = baseCodePrompt;
            }

            const customRule = await DbManager.getCustomRule(mode);
            if (customRule) {
                systemInstructionText += `\n\n# USER-DEFINED RULES\n${customRule}`;
            }

            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: { parts: [{ text: systemInstructionText }] },
                tools: allTools,
            });

            this.model = model;
            this.chatSession = model.startChat({
                history: history,
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                ],
            });

            this.activeModelName = modelName;
            this.activeMode = mode;
            console.log(`New chat session started with model: ${modelName}, mode: ${mode}, and ${history.length} history parts.`);
        } catch (error) {
            console.error('Failed to start chat session:', error);
            UI.appendMessage(document.getElementById('chat-messages'), `Error: Could not start chat session. ${error.message}`, 'ai');
        }
    },

    async _restartSessionWithHistory(history = []) {
        console.log('Restarting session with history preservation...');
        
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = ''; // Clear the chat window first

        await this._startChat(history);

        const mode = document.getElementById('agent-mode-selector').value;
        const modeName = document.getElementById('agent-mode-selector').options[document.getElementById('agent-mode-selector').selectedIndex].text;
        
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

        let rules = await DbManager.getCustomRule(mode);
        if (rules === null) {
            rules = defaultRules[mode] || '';
        }
        
        UI.displayRules(chatMessages, rules, modeName);
        UI.renderChatHistory(chatMessages, history);
        
        console.log(`Session re-initialized with ${history.length} history parts.`);
    },


    async sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, thinkingIndicator, uploadedImage, clearImagePreview) {
        // Always restart the chat session to ensure the latest custom rules are applied.
        const historyToPreserve = this.chatSession ? await this.chatSession.getHistory() : [];
        await this._restartSessionWithHistory(historyToPreserve);

        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const rateLimitMs = this.rateLimit;

        if (timeSinceLastRequest < rateLimitMs) {
            const delay = rateLimitMs - timeSinceLastRequest;
            UI.appendMessage(chatMessages, `Rate limit active. Waiting for ${Math.ceil(delay / 1000)}s...`, 'ai');
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const userPrompt = chatInput.value.trim();
        if ((!userPrompt && !uploadedImage) || this.isSending) return;

        if (!this.chatSession) {
            await this._startChat();
            if (!this.chatSession) return;
        }

        this.lastRequestTime = Date.now();

        this.isSending = true;
        this.isCancelled = false;
        chatSendButton.style.display = 'none';
        chatCancelButton.style.display = 'inline-block';
        thinkingIndicator.style.display = 'block';

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

        try {
            let promptParts = initialParts;
            let running = true;
            
            ApiKeyManager.resetTriedKeys();

            while (running && !this.isCancelled) {
                const modelName = document.getElementById('model-selector').value;
                try {
                    console.log(
                        `[AI Turn] Attempting to send with key index: ${ApiKeyManager.currentIndex} using model: ${modelName}`,
                    );

                    // Count request tokens
                    if (!this.model) throw new Error('Model not initialized for token counting.');
                    const requestTokenResult = await this.model.countTokens({ contents: [{ role: 'user', parts: promptParts }] });

                    const result = await this.chatSession.sendMessageStream(promptParts);

                    let fullResponseText = '';
                    let functionCalls = [];

                    for await (const chunk of result.stream) {
                        if (this.isCancelled) break;
                        const chunkText = chunk.text();
                        if (chunkText) {
                            fullResponseText += chunkText;
                            UI.appendMessage(chatMessages, fullResponseText, 'ai', true);
                        }
                        const chunkFunctionCalls = chunk.functionCalls();
                        if (chunkFunctionCalls) {
                            functionCalls.push(...chunkFunctionCalls);
                        }
                    }

                    if (this.isCancelled) break;

                    if (fullResponseText) {
                        console.log('[AI Reply]', fullResponseText);
                    }

                    // Count response tokens
                    const responseTokenResult = await this.model.countTokens({
                        contents: [{ role: 'model', parts: [{ text: fullResponseText }] }],
                    });

                    UI.updateTokenDisplay(requestTokenResult.totalTokens, responseTokenResult.totalTokens);

                    if (functionCalls.length > 0) {
                        const toolPromises = functionCalls.map((call) =>
                            ToolExecutor.execute(call, this.rootDirectoryHandle),
                        );
                        const toolResults = await Promise.all(toolPromises);
                        promptParts = toolResults.map((toolResult) => ({
                            functionResponse: {
                                name: toolResult.toolResponse.name,
                                response: toolResult.toolResponse.response,
                            },
                        }));
                    } else {
                        // This is the final turn, a text response is expected.
                        if (!fullResponseText) {
                            const errorMessage = `[The AI model returned an empty response, which usually indicates a problem with the data it received from a tool. Please check the tool's output in the console for anything unexpected (like a file being too large or having strange content) and try your request again.]`;
                            UI.appendMessage(chatMessages, errorMessage, 'ai');
                            console.error('AI returned an empty response after a tool call. This is often caused by problematic tool output.');
                        }
                        running = false;
                    }
                } catch (error) {
                    console.error('An error occurred during the AI turn:', error);
                    ApiKeyManager.rotateKey();

                    if (ApiKeyManager.hasTriedAllKeys()) {
                        UI.appendMessage(chatMessages, 'All API keys failed. Please check your keys in the settings.', 'ai');
                        console.error('All available API keys have failed.');
                        running = false;
                    } else {
                        const delay = this.rateLimit;
                        UI.appendMessage(chatMessages, `API key failed. Waiting for ${Math.ceil(delay / 1000)}s before retrying...`, 'ai');
                        await new Promise(resolve => setTimeout(resolve, delay));
                        
                        const history = this.chatSession ? await this.chatSession.getHistory() : [];
                        await this._restartSessionWithHistory(history);
                        
                        this.lastRequestTime = Date.now();
                    }
                }
            }

            if (this.isCancelled) {
                UI.appendMessage(chatMessages, 'Cancelled by user.', 'ai');
            }
        } catch (error) {
            UI.appendMessage(chatMessages, `An error occurred: ${error.message}`, 'ai');
            console.error('Chat Error:', error);
        } finally {
            this.isSending = false;
            chatSendButton.style.display = 'inline-block';
            chatCancelButton.style.display = 'none';
            thinkingIndicator.style.display = 'none';
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
        await this._startChat();
    },

    async condenseHistory(chatMessages) {
        if (!this.chatSession) {
            UI.appendMessage(chatMessages, 'No active session to condense.', 'ai');
            return;
        }

        UI.appendMessage(chatMessages, 'Condensing history... This will start a new session.', 'ai');
        const history = await this.chatSession.getHistory();
        if (history.length === 0) {
            UI.appendMessage(chatMessages, 'History is already empty.', 'ai');
            return;
        }

        const condensationPrompt =
            "Please summarize our conversation so far in a concise way. Include all critical decisions, file modifications, and key insights. The goal is to reduce the context size while retaining the essential information for our ongoing task. Start the summary with 'Here is a summary of our conversation so far:'.";

        const result = await this.chatSession.sendMessage(condensationPrompt);
        const summaryText = result.response.text();

        chatMessages.innerHTML = '';
        UI.appendMessage(chatMessages, 'Original conversation history has been condensed.', 'ai');
        UI.appendMessage(chatMessages, summaryText, 'ai');

        await this._startChat();
    },

    async viewHistory() {
        if (!this.chatSession) {
            return '[]';
        }
        const history = await this.chatSession.getHistory();
        return JSON.stringify(history, null, 2);
    },
};