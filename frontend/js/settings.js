import { DbManager } from './db.js';
import { ApiKeyManager } from './api_manager.js';

export const Settings = {
    // Default settings
    defaults: {
        'llm.provider': 'gemini',
        'llm.gemini.model': 'gemini-2.5-flash',
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
        // 1. Load all default settings into the cache first.
        for (const key in this.defaults) {
            this.cache.set(key, this.defaults[key]);
        }

        // 2. Fetch all stored settings from the database.
        const allSettings = await DbManager.getAllFromStore(DbManager.stores.settings);

        // 3. Overwrite the defaults with any stored values.
        for (const setting of allSettings) {
            this.cache.set(setting.id, setting.value);
        }
        console.log('Settings initialized and loaded into cache.');
        
        // ApiKeyManager is now loaded on-demand, no explicit initialization needed.
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
        const valueToSave = typeof value === 'string' ? value.trim() : value;
        this.cache.set(key, valueToSave);
        await DbManager.saveSetting(key, valueToSave);
        if (key.includes('apiKey')) {
            console.log(`Setting "${key}" updated to "[REDACTED]".`);
        } else {
            console.log(`Setting "${key}" updated to "${value}".`);
        }
    },

    async setMultiple(settings) {
        const settingsToSave = [];
        for (const key in settings) {
            const value = settings[key];
            const valueToSave = typeof value === 'string' ? value.trim() : value;
            this.cache.set(key, valueToSave);
            settingsToSave.push({ id: key, value: valueToSave });
            if (key.includes('apiKey')) {
                console.log(`Setting "${key}" updated to "[REDACTED]".`);
            } else {
                console.log(`Setting "${key}" updated to "${value}".`);
            }
        }
        await DbManager.saveMultipleSettings(settingsToSave);
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
