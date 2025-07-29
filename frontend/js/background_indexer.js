// Background Indexer Service - Uses Web Worker for non-blocking codebase indexing
export class BackgroundIndexer {
    constructor() {
        this.worker = null;
        this.messageId = 0;
        this.pendingMessages = new Map();
        this.isReady = false;
        this.initWorker();
    }

    async initWorker() {
        try {
            this.worker = new Worker('js/workers/codebase-indexer.worker.js');
            
            this.worker.onmessage = (e) => {
                const { success, action, data, error, id, ready } = e.data;
                
                if (ready) {
                    this.isReady = true;
                    console.log('Background indexer worker ready');
                    return;
                }
                
                if (id && this.pendingMessages.has(id)) {
                    const { resolve, reject } = this.pendingMessages.get(id);
                    this.pendingMessages.delete(id);
                    
                    if (success) {
                        resolve(data);
                    } else {
                        reject(new Error(error));
                    }
                }
            };
            
            this.worker.onerror = (error) => {
                console.error('Background indexer worker error:', error);
                this.isReady = false;
            };
            
        } catch (error) {
            console.warn('Failed to initialize background indexer worker:', error);
            this.isReady = false;
        }
    }

    async sendMessage(action, data) {
        if (!this.isReady || !this.worker) {
            throw new Error('Background indexer not ready');
        }

        const id = ++this.messageId;
        
        return new Promise((resolve, reject) => {
            this.pendingMessages.set(id, { resolve, reject });
            
            // Set timeout for messages
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    reject(new Error('Background indexer timeout'));
                }
            }, 30000); // 30 second timeout
            
            this.worker.postMessage({ action, data, id });
        });
    }

    /**
     * Perform incremental update of the index
     * @param {Array} changedFiles - Array of {path, content, action} objects
     */
    async incrementalUpdate(changedFiles) {
        try {
            return await this.sendMessage('incrementalUpdate', { changedFiles });
        } catch (error) {
            console.error('Background incremental update failed:', error);
            throw error;
        }
    }

    /**
     * Query the index for search terms
     * @param {string} query - Search query
     */
    async queryIndex(query) {
        try {
            return await this.sendMessage('queryIndex', { query });
        } catch (error) {
            console.error('Background query failed:', error);
            throw error;
        }
    }

    /**
     * Search the index for a term
     * @param {string} searchTerm - The term to search for
     * @param {boolean} caseSensitive - Whether the search is case sensitive
     */
    async searchInIndex(searchTerm, caseSensitive = false) {
        try {
            return await this.sendMessage('searchInIndex', { searchTerm, caseSensitive });
        } catch (error) {
            console.error('Background search failed:', error);
            throw error;
        }
    }

    /**
     * Perform full reindex of all files
     * @param {Array} files - Array of {path, content} objects
     */
    async fullReindex(files) {
        try {
            return await this.sendMessage('fullReindex', { files });
        } catch (error) {
            console.error('Background full reindex failed:', error);
            throw error;
        }
    }

    /**
     * Set the current index (for initialization)
     * @param {Object} index - The index object
     */
    async setIndex(index) {
        try {
            return await this.sendMessage('setIndex', { index });
        } catch (error) {
            console.error('Background set index failed:', error);
            throw error;
        }
    }

    /**
     * Terminate the worker
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
            this.pendingMessages.clear();
        }
    }

    /**
     * Check if the background indexer is available and ready
     */
    isAvailable() {
        return this.isReady && this.worker;
    }
}

// Global instance
export const backgroundIndexer = new BackgroundIndexer();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    backgroundIndexer.terminate();
});