import { DbManager } from './db.js';
import { ApiKeyManager } from './api_manager.js';

export const Settings = {
    // Default settings
    defaults: {
        'llm.provider': 'gemini',
        'llm.gemini.model': 'gemini-1.5-flash-latest',
        'llm.openai.model': 'gpt-4o',
        'llm.ollama.model': 'llama3',
        'llm.ollama.baseURL': 'http://localhost:11434',
        'ui.theme': 'dark',
    },

    // In-memory cache for settings
    cache: new Map(),

    /**
     * Initializes the settings module, loading all settings from the database.
     */
    async initialize() {
        const allSettings = await DbManager.getAllSettings();
        for (const key in this.defaults) {
            const storedValue = allSettings.find(s => s.key === key)?.value;
            this.cache.set(key, storedValue ?? this.defaults[key]);
        }
        console.log('Settings initialized and loaded into cache.');
        
        // Ensure the ApiKeyManager is also initialized
        await ApiKeyManager.initialize();
    },

    /**
     * Gets a setting value by key.
     * @param {string} key - The key of the setting to retrieve.
     * @returns {any} The value of the setting.
     */
    get(key) {
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        console.warn(`Setting with key "${key}" not found. Returning default.`);
        return this.defaults[key];
    },

    /**
     * Sets a setting value by key and saves it to the database.
     * @param {string} key - The key of the setting to save.
     * @param {any} value - The value to save.
     */
    async set(key, value) {
        this.cache.set(key, value);
        await DbManager.saveSetting(key, value);
        console.log(`Setting "${key}" updated to "${value}".`);
    },

    /**
     * Gets all settings required to configure an LLM service.
     * This abstracts the underlying storage from the consumers.
     * @returns {object} An object containing all necessary LLM settings.
     */
    getLLMSettings() {
        return {
            provider: this.get('llm.provider'),
            apiKeyManager: ApiKeyManager, // Pass the singleton instance
            gemini: {
                model: this.get('llm.gemini.model'),
            },
            openai: {
                model: this.get('llm.openai.model'),
            },
            ollama: {
                model: this.get('llm.ollama.model'),
                baseURL: this.get('llm.ollama.baseURL'),
            },
        };
    }
};

// Custom event to signal that LLM settings have been updated.
export const dispatchLLMSettingsUpdated = () => {
    document.dispatchEvent(new CustomEvent('llm-settings-updated'));
};