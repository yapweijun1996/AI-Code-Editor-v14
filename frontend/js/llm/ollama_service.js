import { BaseLLMService } from './base_llm_service.js';

/**
 * Concrete implementation for a local Ollama instance.
 */
export class OllamaService extends BaseLLMService {
    constructor(apiKeyManager, model, customConfig = {}) {
        super(null, model);
        this.customConfig = customConfig;
    }

    async isConfigured() {
        return !!this.customConfig.baseURL && !!this.model;
    }

    async *sendMessageStream(history, tools, customRules) {
        if (!(await this.isConfigured())) {
            throw new Error("Ollama base URL and model name are not set.");
        }

        const messages = this._prepareMessages(history, customRules);
        
        const response = await fetch(`${this.customConfig.baseURL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                stream: true,
                // Note: Ollama's native tool support is still developing.
                // This implementation will focus on text generation for now.
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Ollama API Error: ${errorData.error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            try {
                const json = JSON.parse(chunk);
                if (json.done) {
                    return;
                }
                yield {
                    text: json.message.content,
                    functionCalls: null // No function calling support in this basic implementation
                };
            } catch (e) {
                console.error('Error parsing Ollama stream chunk:', e);
            }
        }
    }

    _prepareMessages(history, customRules) {
        const systemPrompt = `You are an expert AI programmer. ${customRules || ''}`;
        const messages = [{ role: 'system', content: systemPrompt }];

        history.forEach(turn => {
            const role = turn.role === 'model' ? 'assistant' : 'user';
            const content = turn.parts.map(p => p.text).join('\n');
            if (content) {
                messages.push({ role, content });
            }
        });
        return messages;
    }
}