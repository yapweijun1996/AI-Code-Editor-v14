import { BaseLLMService } from './base_llm_service.js';

/**
 * Concrete implementation for the OpenAI API.
 */
export class OpenAIService extends BaseLLMService {
    constructor(apiKeyManager, model) {
        super(apiKeyManager, model);
        this.apiBaseUrl = 'https://api.openai.com/v1';
    }

    async isConfigured() {
        await this.apiKeyManager.loadKeys('openai');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        return !!currentApiKey;
    }

    async *sendMessageStream(history, tools, customRules) {
        await this.apiKeyManager.loadKeys('openai');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        if (!currentApiKey) {
            throw new Error("OpenAI API key is not set or available.");
        }

        const messages = this._prepareMessages(history, customRules);
        const toolDefinitions = this._prepareTools(tools);

        const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentApiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                tools: toolDefinitions,
                tool_choice: "auto",
                stream: true,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API Error: ${errorData.error.message}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentToolCalls = {}; // State to aggregate tool call chunks

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data === '[DONE]') {
                        const completeCalls = this._getCompleteToolCalls(currentToolCalls);
                        if (completeCalls.length > 0) {
                             yield { text: '', functionCalls: completeCalls };
                        }
                        return;
                    }
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices[0].delta;

                        if (delta.content) {
                            yield { text: delta.content, functionCalls: null };
                        }
                        
                        if (delta.tool_calls) {
                            this._aggregateToolCalls(delta.tool_calls, currentToolCalls);
                        }
                        
                        if (json.usage) {
                            yield {
                                usageMetadata: {
                                    promptTokenCount: json.usage.prompt_tokens,
                                    candidatesTokenCount: json.usage.completion_tokens,
                                }
                            };
                        }

                    } catch (e) {
                        console.error('Error parsing OpenAI stream chunk:', data, e);
                    }
                }
            }
            
            const completeCalls = this._getCompleteToolCalls(currentToolCalls);
            if (completeCalls.length > 0) {
                 yield { text: '', functionCalls: completeCalls };
            }
        }
    }

    _prepareMessages(history, customRules) {
        const mode = document.getElementById('agent-mode-selector')?.value || 'code';
        const systemPrompt = this._getSystemPrompt(mode, customRules);
        const messages = [{ role: 'system', content: systemPrompt }];

        // Track tool calls to ensure proper pairing
        const pendingToolCalls = new Map();

        for (const turn of history) {
            if (turn.role === 'user') {
                const toolResponses = turn.parts.filter(p => p.functionResponse);
                if (toolResponses.length > 0) {
                    // Only add tool responses if we have matching pending tool calls
                    toolResponses.forEach(responsePart => {
                        const toolCallId = responsePart.functionResponse.id;
                        if (pendingToolCalls.has(toolCallId)) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCallId,
                                name: responsePart.functionResponse.name,
                                content: JSON.stringify(responsePart.functionResponse.response),
                            });
                            pendingToolCalls.delete(toolCallId);
                        }
                    });
                } else {
                    const userContent = turn.parts.map(p => p.text).join('\n');
                    if (userContent.trim()) {
                        messages.push({ role: 'user', content: userContent });
                    }
                }
            } else if (turn.role === 'model') {
                const toolCalls = turn.parts
                    .filter(p => p.functionCall && p.functionCall.name && p.functionCall.id)
                    .map(p => ({
                        id: p.functionCall.id,
                        type: 'function',
                        function: {
                            name: p.functionCall.name,
                            arguments: JSON.stringify(p.functionCall.args || {}),
                        },
                    }));

                if (toolCalls.length > 0) {
                    messages.push({
                        role: 'assistant',
                        content: null, // As per OpenAI's spec, content is null when tool_calls is present
                        tool_calls: toolCalls
                    });
                    // Track these tool calls for response matching
                    toolCalls.forEach(call => {
                        pendingToolCalls.set(call.id, call);
                    });
                } else {
                    const modelContent = turn.parts.filter(p => p.text).map(p => p.text).join('\n');
                    if (modelContent.trim()) {
                        messages.push({ role: 'assistant', content: modelContent });
                    }
                }
            }
        }

        // Clean up any orphaned tool calls by removing assistant messages with no responses
        const cleanedMessages = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'assistant' && msg.tool_calls) {
                // Check if the next messages contain responses to these tool calls
                const toolCallIds = msg.tool_calls.map(tc => tc.id);
                let hasResponses = false;
                for (let j = i + 1; j < messages.length; j++) {
                    if (messages[j].role === 'tool' && toolCallIds.includes(messages[j].tool_call_id)) {
                        hasResponses = true;
                        break;
                    }
                    if (messages[j].role === 'assistant' || messages[j].role === 'user') {
                        break; // Stop looking once we hit another turn
                    }
                }
                if (hasResponses) {
                    cleanedMessages.push(msg);
                }
                // If no responses, skip this assistant message with tool calls
            } else {
                cleanedMessages.push(msg);
            }
        }

        return cleanedMessages;
    }

    _getSystemPrompt(mode, customRules) {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const timeString = new Date().toLocaleString();
        
        // Check if thinking mode is enabled
        const thinkingEnabled = document.getElementById('openai-thinking-mode')?.checked || false;
        
        const thinkingInstructions = thinkingEnabled ? `

# ADVANCED THINKING MODE (O1-STYLE)
You MUST use explicit thinking before providing your final response. Follow this format:

<thinking>
Let me think through this step by step...

1. **Problem Analysis**: What exactly is being asked?
2. **Approach Planning**: What's the best way to solve this?
3. **Tool Selection**: Which tools do I need to use?
4. **Step-by-Step Execution**: How will I implement the solution?
5. **Quality Check**: Is my approach correct and complete?
</thinking>

[Your final response here]

**CRITICAL**: Always wrap your reasoning in <thinking></thinking> tags. Show your complete thought process, including any doubts, corrections, or alternative approaches you consider.` : '';
        
        const baseCodePrompt = `You are GPT, an advanced AI programming agent optimized for precise code generation and tool utilization. Your purpose is to solve programming challenges through systematic analysis and efficient execution.${thinkingInstructions}

# OPENAI AGENT OPTIMIZATION
- **Tool Calling Excellence**: You excel at structured function calling. Always use the most appropriate tool for each task.
- **Efficient Reasoning**: Provide clear, step-by-step reasoning without excessive verbosity.
- **Context Awareness**: Maintain conversation context and build upon previous interactions effectively.
- **Code Quality**: Generate clean, maintainable, and well-documented code following best practices.

# CORE METHODOLOGY

**1. SYSTEMATIC PROBLEM SOLVING**
- Analyze user requests to identify core requirements
- Plan your approach using available tools strategically  
- Execute your plan step-by-step with clear explanations
- Validate results and handle any errors appropriately

**2. TOOL USAGE OPTIMIZATION**
- **read_file**: Always read files before modifying to understand current state
- **create_and_apply_diff**: Preferred for surgical file modifications
- **replace_lines**: Use for targeted line range replacements
- **search_code**: Use to locate specific code patterns across files
- **get_project_structure**: Essential first step for understanding codebase

**3. FILE PATH PROTOCOL**
- NEVER include project root folder name in paths
- Use relative paths from project root (e.g., 'src/app.js', not 'project/src/app.js')
- Always verify file existence before operations

**4. ERROR HANDLING & RECOVERY**
- If a tool fails, analyze the error and try alternative approaches
- Use validation tools to check syntax before finalizing changes
- Provide clear error explanations and solutions

**5. CODE MODIFICATION WORKFLOW**
- Read existing code to understand structure and patterns
- Plan modifications to maintain code quality and consistency
- Apply changes using the most appropriate tool
- Explain the changes and their impact

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        const planPrompt = `You are GPT Strategic Analyst, an AI agent specialized in research, planning, and strategic analysis. Your purpose is to provide comprehensive, actionable insights through systematic research and structured reporting.

# OPENAI PLANNING STRENGTHS
- **Structured Analysis**: Excel at breaking down complex problems into manageable components
- **Research Synthesis**: Effectively combine information from multiple sources
- **Clear Communication**: Present findings in well-organized, actionable formats
- **Tool Integration**: Efficiently use search and research tools for comprehensive analysis

# STRATEGIC METHODOLOGY

**1. REQUEST ANALYSIS**
- Identify key questions and objectives
- Determine information gaps and research requirements
- Plan research strategy using available tools

**2. SYSTEMATIC RESEARCH**
- Use duckduckgo_search for external information gathering
- Cross-reference multiple sources for validation
- Collect and organize relevant data points

**3. ANALYTICAL SYNTHESIS**
- Identify patterns, trends, and insights from collected data
- Evaluate information quality and relevance
- Draw logical conclusions and recommendations

**4. STRUCTURED REPORTING**
- Present findings with clear executive summary
- Use headers, bullet points, and structured format
- Include actionable recommendations
- Cite sources and provide references

**5. ITERATIVE REFINEMENT**
- Build upon previous research in multi-turn conversations
- Refine analysis based on user feedback
- Provide additional detail when requested

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        const searchPrompt = `You are GPT Search Specialist, an AI agent optimized for intelligent codebase exploration and analysis. Your purpose is to provide efficient, comprehensive search and analysis capabilities.

# OPENAI SEARCH STRENGTHS
- **Systematic Analysis**: Excel at methodical codebase exploration and pattern recognition
- **Efficient Search**: Use tools strategically to minimize search time while maximizing insights
- **Clear Reporting**: Present findings in well-structured, actionable formats
- **Tool Integration**: Seamlessly combine multiple search tools for comprehensive analysis

# INTELLIGENT SEARCH WORKFLOW

**1. STRATEGIC EXPLORATION**
- Start with get_project_structure for architectural overview
- Use search_code for targeted pattern discovery
- Apply query_codebase for semantic search capabilities
- Read specific files for detailed analysis

**2. ANALYTICAL PROCESSING**
- Identify code patterns, relationships, and dependencies
- Recognize potential improvements or issues
- Map component interactions and data flow
- Analyze code quality and maintainability

**3. EFFICIENT REPORTING**
- Provide clear, structured findings with specific references
- Include file paths and line numbers for easy navigation
- Categorize results by importance and relevance
- Offer actionable insights and recommendations

**4. ITERATIVE REFINEMENT**
- Build upon previous searches for deeper insights
- Refine search queries based on discovered patterns
- Provide progressive detail as requested

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        let systemPrompt;
        if (mode === 'plan') {
            systemPrompt = planPrompt;
        } else if (mode === 'search') {
            systemPrompt = searchPrompt;
        } else {
            systemPrompt = baseCodePrompt;
        }
        
        if (customRules) {
            systemPrompt += `\n\n# USER-DEFINED RULES\n${customRules}`;
        }
        
        return systemPrompt;
    }

    _convertGeminiParamsToOpenAI(params) {
        const convert = (prop) => {
            if (typeof prop !== 'object' || prop === null || !prop.type) {
                return prop;
            }

            const newProp = { ...prop, type: prop.type.toLowerCase() };

            if (newProp.type === 'object' && newProp.properties) {
                const newProperties = {};
                for (const key in newProp.properties) {
                    newProperties[key] = convert(newProp.properties[key]);
                }
                newProp.properties = newProperties;
            }

            if (newProp.type === 'array' && newProp.items) {
                newProp.items = convert(newProp.items);
            }

            return newProp;
        };

        return convert(params);
    }

    _prepareTools(geminiTools) {
        if (!geminiTools || !geminiTools.functionDeclarations) return [];
        return geminiTools.functionDeclarations.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: this._convertGeminiParamsToOpenAI(tool.parameters),
            }
        }));
    }
    _aggregateToolCalls(chunks, state) {
        chunks.forEach(chunk => {
            const { index, id, function: { name, arguments: args } } = chunk;
            if (!state[index]) {
                state[index] = { id: '', function: { name: '', arguments: '' } };
            }
            if (id) state[index].id = id;
            if (name) state[index].function.name = name;
            if (args) state[index].function.arguments += args;
        });
    }

    _getCompleteToolCalls(state) {
        const completeCalls = [];
        for (const index in state) {
            const call = state[index];
            if (call.id && call.function.name) {
                try {
                    JSON.parse(call.function.arguments);
                    completeCalls.push({
                        id: call.id,
                        name: call.function.name,
                        args: JSON.parse(call.function.arguments),
                    });
                    delete state[index];
                } catch (e) {
                }
            }
        }
        return completeCalls;
    }
}