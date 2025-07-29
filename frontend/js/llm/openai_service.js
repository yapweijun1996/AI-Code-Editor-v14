import { BaseLLMService } from './base_llm_service.js';

/**
 * Concrete implementation for the OpenAI API.
 */
export class OpenAIService extends BaseLLMService {
    constructor(apiKeyManager, model) {
        super(apiKeyManager, model);
        this.apiBaseUrl = 'https://api.openai.com/v1';
    }

    isConfigured() {
        const currentApiKey = this.apiKeyManager.getCurrentKey('openai');
        return !!currentApiKey;
    }

    async *sendMessageStream(history, tools, customRules) {
        const currentApiKey = this.apiKeyManager.getCurrentKey('openai');
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
        const systemPrompt = `You are an expert AI programmer. ${customRules || ''}`;
        const messages = [{ role: 'system', content: systemPrompt }];

        for (const turn of history) {
            if (turn.role === 'user') {
                const toolResponses = turn.parts.filter(p => p.functionResponse);
                if (toolResponses.length > 0) {
                    toolResponses.forEach(responsePart => {
                        messages.push({
                            role: 'tool',
                            tool_call_id: responsePart.functionResponse.id,
                            name: responsePart.functionResponse.name,
                            content: JSON.stringify(responsePart.functionResponse.response),
                        });
                    });
                } else {
                    const userContent = turn.parts.map(p => p.text).join('\n');
                    messages.push({ role: 'user', content: userContent });
                }
            } else if (turn.role === 'model') {
                const toolCalls = turn.parts
                    .filter(p => p.functionCall)
                    .map(p => ({
                        id: p.functionCall.id,
                        type: 'function',
                        function: {
                            name: p.functionCall.name,
                            arguments: JSON.stringify(p.functionCall.args),
                        },
                    }));

                if (toolCalls.length > 0) {
                    messages.push({
                        role: 'assistant',
                        content: null, // As per OpenAI's spec, content is null when tool_calls is present
                        tool_calls: toolCalls
                    });
                } else {
                    const modelContent = turn.parts.map(p => p.text).join('\n');
                    if (modelContent) {
                        messages.push({ role: 'assistant', content: modelContent });
                    }
                }
            }
        }
        return messages;
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