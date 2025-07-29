import { DbManager } from './db.js';

// =================================================================
// === API Key Manager (Handles DB and Rotation)                 ===
// =================================================================
export const ApiKeyManager = {
    keys: [],
    currentIndex: 0,
    triedKeys: new Set(),
    async loadKeys(provider) {
        const settings = await DbManager.getLLMSettings();
        let keysString = '';

        if (settings && provider) {
            switch (provider) {
                case 'gemini':
                    keysString = (settings.gemini && settings.gemini.apiKey) ? settings.gemini.apiKey : '';
                    break;
                case 'openai':
                    keysString = (settings.openai && settings.openai.apiKey) ? settings.openai.apiKey : '';
                    break;
                // Ollama does not use API keys, so it's omitted here.
            }
        }

        this.keys = keysString.split('\n').filter((k) => k.trim() !== '');
        this.currentIndex = 0;
        this.triedKeys.clear();
        console.log(`ApiKeyManager loaded ${this.keys.length} keys for ${provider}.`);
    },
    // saveKeys is deprecated as the new UI saves all settings at once.
    // The logic is now handled by UI.saveLLMSettings and GeminiChat._initializeLLMService
    getCurrentKey() {
        if (this.keys.length > 0) {
            this.triedKeys.add(this.keys[this.currentIndex]);
            return this.keys[this.currentIndex];
        }
        return null;
    },
    rotateKey() {
        if (this.keys.length > 0) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        }
    },
    hasTriedAllKeys() {
        return this.triedKeys.size >= this.keys.length;
    },
    resetTriedKeys() {
        this.triedKeys.clear();
    },
};