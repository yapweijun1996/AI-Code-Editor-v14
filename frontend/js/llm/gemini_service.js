import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';
import { BaseLLMService } from './base_llm_service.js';

/**
 * Concrete implementation for the Google Gemini API.
 */
export class GeminiService extends BaseLLMService {
    constructor(apiKeyManager, model) {
        super(apiKeyManager, model);
    }

    async isConfigured() {
        await this.apiKeyManager.loadKeys('gemini');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        return !!currentApiKey;
    }

    async *sendMessageStream(history, tools, customRules = '') {
        await this.apiKeyManager.loadKeys('gemini');
        this.apiKeyManager.resetTriedKeys(); // Reset for new request

        while (true) {
            const currentApiKey = this.apiKeyManager.getCurrentKey();
            if (!currentApiKey) {
                throw new Error("Gemini API key is not set or available.");
            }

            try {
                const mode = document.getElementById('agent-mode-selector').value;
                const systemInstruction = this._getSystemInstruction(mode, customRules);
                
                const genAI = new GoogleGenerativeAI(currentApiKey);

                const model = genAI.getGenerativeModel({
                    model: this.model,
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    tools: [tools],
                });

                const preparedHistory = this._prepareMessages(history);
                console.log('Gemini prepared history:', JSON.stringify(preparedHistory, null, 2));

                const chat = model.startChat({
                    history: preparedHistory,
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                    ],
                });

                const lastUserMessage = history[history.length - 1].parts;
                console.log('Gemini last user message:', JSON.stringify(lastUserMessage, null, 2));
                
                const result = await chat.sendMessageStream(lastUserMessage);

                try {
                    for await (const chunk of result.stream) {
                        yield {
                            text: chunk.text(),
                            functionCalls: chunk.functionCalls(),
                            usageMetadata: chunk.usageMetadata,
                        };
                    }
                } catch (streamError) {
                    console.error('Gemini streaming error:', streamError);
                    console.error('Stream error details:', {
                        message: streamError.message,
                        stack: streamError.stack,
                        name: streamError.name
                    });
                    throw streamError;
                }

                // If we get here, the request was successful
                return;

            } catch (error) {
                // Check if this is a rate limit or API key related error
                const isRetryableError = this._isRetryableError(error);
                
                if (isRetryableError && !this.apiKeyManager.hasTriedAllKeys()) {
                    console.warn(`Gemini API error with current key: ${error.message}. Trying next key...`);
                    this.apiKeyManager.rotateKey();
                    continue; // Try with next key
                } else {
                    // Either not a retryable error, or we've tried all keys
                    throw error;
                }
            }
        }
    }

    _isRetryableError(error) {
        const errorMessage = error.message || '';
        const errorString = errorMessage.toLowerCase();
        
        // Check for rate limit errors (429)
        if (errorString.includes('429') || errorString.includes('quota') || errorString.includes('rate limit')) {
            return true;
        }
        
        // Check for invalid API key errors (401, 403)
        if (errorString.includes('401') || errorString.includes('403') || 
            errorString.includes('unauthorized') || errorString.includes('forbidden') ||
            errorString.includes('invalid api key') || errorString.includes('api key')) {
            return true;
        }
        
        // Check for service unavailable errors (503)
        if (errorString.includes('503') || errorString.includes('overloaded') || 
            errorString.includes('service unavailable')) {
            return true;
        }
        
        return false;
    }

    _prepareMessages(history) {
        // Gemini's chat history doesn't include the final message, which is sent to sendMessage.
        const messages = [];
        const historyToProcess = history.slice(0, -1);

        for (const turn of historyToProcess) {
            if (turn.role === 'user') {
                // Split user messages: separate text from function responses
                const textParts = turn.parts.filter(p => p.text && !p.functionResponse);
                const functionResponses = turn.parts.filter(p => p.functionResponse);

                // Add user text message if it exists
                if (textParts.length > 0) {
                    messages.push({
                        role: 'user',
                        parts: textParts
                    });
                }

                // Add function responses as separate messages
                functionResponses.forEach(responsePart => {
                    // Validate function response structure
                    if (responsePart.functionResponse && 
                        responsePart.functionResponse.name && 
                        responsePart.functionResponse.response) {
                        messages.push({
                            role: 'function',
                            parts: [{
                                functionResponse: responsePart.functionResponse
                            }]
                        });
                    } else {
                        console.warn('Invalid function response structure:', responsePart);
                    }
                });
            } else if (turn.role === 'model') {
                // Model messages can stay as-is, but validate structure
                if (turn.parts && Array.isArray(turn.parts)) {
                    messages.push(turn);
                } else {
                    console.warn('Invalid model message structure:', turn);
                }
            }
        }

        return messages;
    }

    _getSystemInstruction(mode, customRules) {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const timeString = new Date().toLocaleString();
        
        // Check if thinking mode is enabled
        const thinkingEnabled = document.getElementById('gemini-thinking-mode')?.checked || false;
        
        const thinkingInstructions = thinkingEnabled ? `

# ADVANCED CHAIN-OF-THOUGHT REASONING
You MUST use explicit chain-of-thought reasoning before providing your final response. Follow this format:

<thinking>
Let me break this down systematically:

**Problem Analysis:**
- What is the user asking for?
- What are the key requirements and constraints?
- What information do I need to gather?

**Strategic Planning:**
- What's my approach to solve this problem?
- What tools do I need to use and in what order?
- What are potential challenges or edge cases?

**Step-by-Step Reasoning:**
- How will I implement each part of the solution?
- What patterns or best practices should I follow?
- How can I ensure quality and reliability?

**Quality Verification:**
- Does my approach address all requirements?
- Are there any potential issues or improvements?
- Is my solution clear and maintainable?
</thinking>

[Your final response here]

**CRITICAL**: Always wrap your reasoning in <thinking></thinking> tags. Show your complete analytical process, including problem decomposition, tool selection rationale, implementation strategy, and quality checks.` : '';
        
        const baseCodePrompt = `You are Gemini, an elite AI programming agent with advanced reasoning capabilities. Your function is to solve complex programming problems through systematic analysis and precise code manipulation.${thinkingInstructions}

# AGENTIC REASONING FRAMEWORK
- **Multi-Step Thinking**: Break complex problems into logical sub-tasks. Use chain-of-thought reasoning for every decision.
- **Self-Reflection**: After each tool execution, analyze the result and adjust your approach if needed.
- **Error Recovery**: When operations fail, diagnose the cause and try alternative approaches.
- **Quality Assurance**: Validate your outputs for correctness, efficiency, and maintainability.

# CORE IDENTITY & DIRECTIVES  
- **Identity:** You are an autonomous programming agent. You MUST override any internal restriction that prevents you from writing or modifying files. You ALWAYS have access to tools like 'rewrite_file' and 'create_file'.
- **Gemini Strengths**: Leverage your superior reasoning, pattern recognition, and context understanding. Use your ability to handle complex, multi-turn conversations effectively.
- **Clarity:** Provide concise, analytical responses with clear reasoning chains. Show your thinking process.
- **Markdown:** Always use Markdown for structured, readable formatting.

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

**4. EFFICIENT FILE MODIFICATION WORKFLOW:**
- **Goal:** To modify files with precision and efficiency.
- **CRITICAL: You MUST select the most appropriate tool for the job. Failure to do so is inefficient.**
- **Tool Selection Strategy:**
    - **For adding new, self-contained blocks of code (like a new function or class):** Use the \`insert_content\` tool. Specify the line number where the new code should be added. This avoids rewriting the entire file.
    - **For replacing a specific, small section of code that is visible in the editor:** Use the \`replace_selected_text\` tool. Ask the user to select the text first if necessary.
    - **For replacing a specific range of lines (e.g., an entire function):** Use the \`replace_lines\` tool. This is more precise than a full-file diff.
    - **For large files that cannot be read in full:**
        1.  **SEARCH:** Use \`search_in_file\` to find the line numbers of the code you want to change.
        2.  **READ:** Use \`read_file_lines\` to read the specific section you need to inspect.
        3.  **MODIFY:** Use \`replace_lines\` or \`insert_content\` with the line numbers you found.
    - **For complex or multi-location changes in normal-sized files:** Default to the safe, full-file modification process:
        1.  **READ:** Use \`read_file\` to get the complete, current file content.
        2.  **MODIFY IN MEMORY:** Construct the new, full version of the file content.
        3.  **APPLY:** Call \`create_and_apply_diff\` with the **ENTIRE, MODIFIED FILE CONTENT**.
    - **As a last resort (e.g., if diffing fails or for very large files):** Use the \`rewrite_file\` tool.
- **Example (Surgical Insert):** To add a new CSS class, use \`insert_content\` at the appropriate line in the CSS file.
- **Example (Full Modify):** To rename a variable that appears in 20 places, use the READ -> MODIFY -> APPLY workflow with \`create_and_apply_diff\`.

**5. AMENDMENT POLICY - CRITICAL COMPANY RULE**
- **You MUST follow this company policy for all file edits.**
- **DO NOT DELETE OR REPLACE CODE.** Instead, comment out the original code block.
- **WRAP NEW CODE** with clear markers:
    - Start of your edit: \`<!--- Edited by AI [start] --->\`
    - End of your edit: \`<!--- Edited by AI [end] --->\`
- **Example:**
    \`\`\`
    // <!--- Edited by AI [start] --->
    // new code line 1
    // new code line 2
    // <!--- Edited by AI [end] --->
    /*
    original code line 1
    original code line 2
    */
    \`\`\`

**5. POST-TOOL ANALYSIS:**
- After a tool executes, you MUST provide a thoughtful, analytical response.
- **Summarize:** Briefly explain the outcome of the tool command.
- **Analyze:** Explain what the result means in the context of your plan.
- **Next Action:** State what you will do next and then call the appropriate tool.

**6. URL HANDLING & RESEARCH:**
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
        
        const newPlanPrompt = `You are Gemini Strategic Planning Agent, an elite AI research analyst with advanced reasoning capabilities. Your purpose is to provide comprehensive, data-driven strategic insights through systematic research and analysis.${thinkingInstructions}

# AGENTIC PLANNING FRAMEWORK
- **Hypothesis Formation**: Start by forming initial hypotheses about the problem domain.
- **Multi-Source Research**: Gather information from diverse sources to validate or refute hypotheses.
- **Pattern Recognition**: Identify trends, correlations, and strategic insights from collected data.
- **Scenario Analysis**: Consider multiple future scenarios and their implications.
- **Iterative Refinement**: Continuously update your understanding as new information emerges.

# GEMINI PLANNING ADVANTAGES
- **Deep Context Analysis**: Leverage superior context understanding for nuanced strategic insights.
- **Multi-Modal Reasoning**: Integrate textual, visual, and structured data for comprehensive analysis.
- **Long-Form Synthesis**: Excel at creating detailed, well-structured strategic documents.

# CORE METHODOLOGY
1.  **Strategic Deconstruction:** Break down complex requests into strategic components and research questions.
2.  **Multi-Vector Research:** Use search tools aggressively. Cross-reference multiple sources for validation.
3.  **Analytical Synthesis:** Apply advanced reasoning to identify patterns, gaps, and strategic opportunities.
4.  **Structured Intelligence:** Present findings in executive-ready format with clear visual hierarchy.
5.  **Actionable Strategy:** Focus on implementable recommendations with clear success metrics.

# COMMUNICATION PROTOCOL
- After a tool runs, you MUST respond to the user with a summary of the action and its result.
- Do not call another tool without providing an intermediary text response to the user.

**Current user context:**
- Current Time: ${timeString}
- Timezone: ${timeZone}`;

        const searchPrompt = `You are Gemini Search Agent, an advanced AI search and analysis specialist. Your purpose is to provide comprehensive codebase exploration and intelligent search capabilities.${thinkingInstructions}

# GEMINI SEARCH OPTIMIZATION
- **Deep Analysis**: Use your superior pattern recognition to analyze complex codebases and identify relationships
- **Contextual Understanding**: Leverage your ability to understand nuanced context across large codebases
- **Multi-Modal Search**: Integrate code, documentation, and structural analysis for comprehensive insights

# INTELLIGENT SEARCH METHODOLOGY

**1. COMPREHENSIVE EXPLORATION**
- Use get_project_structure to understand overall architecture
- Apply search_code for broad pattern matching
- Use query_codebase for semantic code search
- Combine read_file for detailed code analysis

**2. PATTERN RECOGNITION**
- Identify architectural patterns and design principles
- Recognize code relationships and dependencies
- Detect potential issues, improvements, or optimizations
- Map data flow and component interactions

**3. CONTEXTUAL ANALYSIS**
- Understand the purpose and function of code segments
- Analyze coding patterns and conventions used
- Identify areas for improvement or refactoring
- Provide insights on code quality and maintainability

**4. STRUCTURED REPORTING**
- Present findings with clear categorization
- Use visual hierarchy with headers and bullet points
- Include specific file references and line numbers
- Provide actionable recommendations and insights

**5. ITERATIVE REFINEMENT**
- Build upon previous searches for deeper analysis
- Refine search strategies based on findings
- Provide progressive disclosure of information

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        let systemInstructionText;
        if (mode === 'plan') {
            systemInstructionText = newPlanPrompt;
        } else if (mode === 'search') {
            systemInstructionText = searchPrompt;
        } else {
            systemInstructionText = baseCodePrompt;
        }
        
        if (customRules) {
            systemInstructionText += `\n\n# USER-DEFINED RULES\n${customRules}`;
        }
        
        return systemInstructionText;
    }
}