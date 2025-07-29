/**
 * @abstract
 * An abstract base class defining the interface for all LLM services.
 */
export class BaseLLMService {
    /**
     * @param {string} apiKey - The API key for the service.
     */
    constructor(apiKeyManager, model) {
        if (this.constructor === BaseLLMService) {
            throw new Error("Abstract classes can't be instantiated.");
        }
        this.apiKeyManager = apiKeyManager;
        this.model = model;
    }

    /**
     * Sends a message to the LLM and streams the response.
     * @abstract
     * @param {Array<Object>} history - The chat history.
     * @param {Object} toolDefinition - The definition of tools available.
     * @param {AbortSignal} abortSignal - The signal to abort the request.
     * @returns {AsyncGenerator<Object, void, unknown>} A stream of response parts.
     */
    async *sendMessageStream(history, toolDefinition, abortSignal) {
        throw new Error("Method 'sendMessageStream()' must be implemented.");
    }

    /**
     * Prepares the message history for the specific LLM provider's API format.
     * @protected
     * @abstract
     * @param {Array<Object>} history - The chat history.
     * @returns {Array<Object>} The formatted messages.
     */
    _prepareMessages(history) {
        throw new Error("Method '_prepareMessages()' must be implemented.");
    }

    /**
     * Checks if the service is configured and ready to be used.
     * @abstract
     * @returns {Promise<boolean>} True if the service is configured, false otherwise.
     */
    async isConfigured() {
        throw new Error("Method 'isConfigured()' must be implemented.");
    }
}