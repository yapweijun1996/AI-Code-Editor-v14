import { GeminiService } from './gemini_service.js';
import { OpenAIService } from './openai_service.js';
import { OllamaService } from './ollama_service.js';

/**
 * Factory class to create LLM service instances.
 */
export class LLMServiceFactory {
    /**
     * Creates and returns an instance of an LLM service.
     * @param {string} provider - The name of the LLM provider (e.g., 'gemini', 'openai').
     * @param {object} settings - The application settings.
     * @returns {BaseLLMService} An instance of the requested LLM service.
     */
    static create(provider, settings) {
        if (!settings) {
            throw new Error("LLM settings are not provided.");
        }
        
        switch (provider) {
            case 'gemini':
                return new GeminiService(settings.apiKeyManager, settings.gemini?.model);
            case 'openai':
                return new OpenAIService(settings.apiKeyManager, settings.openai?.model);
            case 'ollama':
                return new OllamaService(settings.apiKeyManager, settings.ollama?.model, { baseURL: settings.ollama?.baseURL });
            default:
                // Fallback to Gemini if no provider is selected or the provider is unknown
                console.warn(`Unknown or unset LLM provider: '${provider}'. Falling back to Gemini.`);
                return new GeminiService(settings.apiKeyManager, settings.gemini?.model);
        }
    }
}