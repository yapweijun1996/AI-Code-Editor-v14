// Monaco Model Manager - Prevents memory leaks and optimizes performance
export class MonacoModelManager {
    constructor(maxModels = 20) {
        this.models = new Map(); // filename -> { model, lastAccessed, size }
        this.maxModels = maxModels;
        this.totalMemoryUsage = 0;
        this.maxMemoryUsage = 50 * 1024 * 1024; // 50MB limit
    }

    /**
     * Get or create a Monaco model for a file
     * @param {string} filename - The file path
     * @param {string} content - The file content
     * @param {string} language - The Monaco language identifier
     * @returns {monaco.editor.ITextModel}
     */
    getModel(filename, content, language) {
        // Check if model already exists
        if (this.models.has(filename)) {
            const modelInfo = this.models.get(filename);
            modelInfo.lastAccessed = Date.now();
            
            // Update content if it has changed
            if (modelInfo.model.getValue() !== content) {
                modelInfo.model.setValue(content);
                modelInfo.size = content.length;
                this.updateMemoryUsage();
            }
            
            return modelInfo.model;
        }

        // Check if we need to free up space
        this.ensureCapacity(content.length);

        // Create new model
        const model = monaco.editor.createModel(content, language);
        
        // Store model info
        this.models.set(filename, {
            model,
            lastAccessed: Date.now(),
            size: content.length
        });

        this.totalMemoryUsage += content.length;
        
        console.log(`Created Monaco model for ${filename} (${this.models.size}/${this.maxModels} models, ${Math.round(this.totalMemoryUsage/1024)}KB memory)`);
        
        return model;
    }

    /**
     * Dispose of a specific model
     * @param {string} filename - The file path
     */
    disposeModel(filename) {
        if (this.models.has(filename)) {
            const modelInfo = this.models.get(filename);
            modelInfo.model.dispose();
            this.totalMemoryUsage -= modelInfo.size;
            this.models.delete(filename);
            
            console.log(`Disposed Monaco model for ${filename}`);
        }
    }

    /**
     * Ensure we have capacity for a new model
     * @param {number} newContentSize - Size of the new content
     */
    ensureCapacity(newContentSize) {
        // Check model count limit
        while (this.models.size >= this.maxModels) {
            this.disposeOldestModel();
        }

        // Check memory usage limit
        while (this.totalMemoryUsage + newContentSize > this.maxMemoryUsage && this.models.size > 1) {
            this.disposeOldestModel();
        }
    }

    /**
     * Dispose of the least recently used model
     */
    disposeOldestModel() {
        if (this.models.size === 0) return;

        let oldestFilename = null;
        let oldestTime = Date.now();

        for (const [filename, modelInfo] of this.models) {
            if (modelInfo.lastAccessed < oldestTime) {
                oldestTime = modelInfo.lastAccessed;
                oldestFilename = filename;
            }
        }

        if (oldestFilename) {
            this.disposeModel(oldestFilename);
        }
    }

    /**
     * Update total memory usage calculation
     */
    updateMemoryUsage() {
        this.totalMemoryUsage = 0;
        for (const modelInfo of this.models.values()) {
            this.totalMemoryUsage += modelInfo.size;
        }
    }

    /**
     * Get memory usage statistics
     * @returns {Object} Memory usage stats
     */
    getMemoryStats() {
        return {
            modelCount: this.models.size,
            maxModels: this.maxModels,
            memoryUsage: this.totalMemoryUsage,
            maxMemoryUsage: this.maxMemoryUsage,
            memoryUsageFormatted: `${Math.round(this.totalMemoryUsage / 1024)}KB / ${Math.round(this.maxMemoryUsage / 1024 / 1024)}MB`
        };
    }

    /**
     * Cleanup all models (call when shutting down)
     */
    dispose() {
        for (const [filename] of this.models) {
            this.disposeModel(filename);
        }
        console.log('Monaco Model Manager disposed');
    }

    /**
     * Perform maintenance tasks (call periodically)
     */
    performMaintenance() {
        const now = Date.now();
        const MAX_IDLE_TIME = 10 * 60 * 1000; // 10 minutes
        const modelsToDispose = [];

        // Find models that haven't been accessed recently
        for (const [filename, modelInfo] of this.models) {
            if (now - modelInfo.lastAccessed > MAX_IDLE_TIME) {
                modelsToDispose.push(filename);
            }
        }

        // Dispose of idle models (but keep at least 5 models)
        for (const filename of modelsToDispose) {
            if (this.models.size > 5) {
                this.disposeModel(filename);
            }
        }

        if (modelsToDispose.length > 0) {
            console.log(`Maintenance: Disposed ${modelsToDispose.length} idle Monaco models`);
        }
    }
}

// Global instance
export const monacoModelManager = new MonacoModelManager();

// Perform maintenance every 5 minutes
setInterval(() => {
    monacoModelManager.performMaintenance();
}, 5 * 60 * 1000);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    monacoModelManager.dispose();
});