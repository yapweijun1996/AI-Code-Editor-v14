import { DbManager } from './db.js';

// =================================================================
// === API Key Manager (Handles DB and Rotation)                 ===
// =================================================================
export const ApiKeyManager = {
    keys: [],
    currentIndex: 0,
    triedKeys: new Set(),
    async loadKeys(apiKeysTextarea) {
        const keysString = await DbManager.getKeys();
        this.keys = keysString.split('\n').filter((k) => k.trim() !== '');
        if (apiKeysTextarea) {
            apiKeysTextarea.value = keysString;
        }
        this.currentIndex = 0;
        this.triedKeys.clear();
    },
    async saveKeys(apiKeysTextarea) {
        await DbManager.saveKeys(apiKeysTextarea.value);
        await this.loadKeys(apiKeysTextarea);
        alert(`Saved ${this.keys.length} API key(s) to IndexedDB.`);
    },
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