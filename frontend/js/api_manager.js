import { Settings } from './settings.js';

// =================================================================
// === API Key Manager (Handles DB and Rotation)                 ===
// =================================================================
export const ApiKeyManager = {
    keys: [],
    currentIndex: 0,
    triedKeys: new Set(),
    async loadKeys(provider) {
        let keysString = '';

        if (provider) {
            switch (provider) {
                case 'gemini':
                    keysString = Settings.get('llm.gemini.apiKey') || '';
                    break;
                case 'openai':
                    keysString = Settings.get('llm.openai.apiKey') || '';
                    break;
                // Ollama does not use API keys, so it's omitted here.
            }
        }

        this.keys = keysString.split('\n').map(k => k.trim()).filter(Boolean);
        this.currentIndex = 0;
        this.triedKeys.clear();
        console.log(`ApiKeyManager loaded ${this.keys.length} keys for ${provider}.`);
    },
    // The ApiKeyManager no longer saves keys directly.
    // Saving is handled by the Settings module, triggered by the UI.
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