/**
 * Performance Optimization Module
 * Handles large files, memory management, and CPU-intensive operations
 */

class PerformanceOptimizer {
    constructor() {
        this.memoryThreshold = 100 * 1024 * 1024; // 100MB
        this.largeFileThreshold = 1024 * 1024; // 1MB
        this.chunkSize = 64 * 1024; // 64KB chunks
        this.processingQueue = [];
        this.isProcessing = false;
        this.performanceMetrics = new Map();
        
        // Initialize memory monitoring
        this.startMemoryMonitoring();
    }

    /**
     * Memory monitoring and garbage collection
     */
    startMemoryMonitoring() {
        setInterval(() => {
            this.checkMemoryUsage();
        }, 30000); // Check every 30 seconds
    }

    async checkMemoryUsage() {
        if ('memory' in performance) {
            const memInfo = performance.memory;
            const usedMemory = memInfo.usedJSHeapSize;
            
            if (usedMemory > this.memoryThreshold) {
                console.warn(`High memory usage detected: ${Math.round(usedMemory / 1024 / 1024)}MB`);
                await this.performGarbageCollection();
            }
        }
    }

    async performGarbageCollection() {
        // Clear caches
        this.clearAllCaches();
        
        // Force garbage collection if available
        if (window.gc) {
            window.gc();
        }
        
        // Yield to browser to process cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log('Memory cleanup performed');
    }

    clearAllCaches() {
        // Clear syntax validator cache
        if (window.syntaxValidator) {
            window.syntaxValidator.clearCache();
        }
        
        // Clear code comprehension cache
        if (window.codeComprehension) {
            window.codeComprehension.clearCache();
        }
        
        // Clear precise editor cache
        if (window.preciseEditor) {
            window.preciseEditor.clearCache();
        }
    }

    /**
     * Chunked file processing for large files
     */
    async processLargeFile(content, processor, options = {}) {
        const {
            chunkSize = this.chunkSize,
            progressCallback = null,
            yieldInterval = 10 // Yield every 10 chunks
        } = options;

        if (content.length <= this.largeFileThreshold) {
            return await processor(content);
        }

        console.log(`Processing large content (${Math.round(content.length / 1024)}KB) in chunks...`);
        
        const chunks = this.createChunks(content, chunkSize);
        const results = [];
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            
            try {
                const result = await processor(chunk, i);
                results.push(result);
                
                // Progress callback
                if (progressCallback) {
                    progressCallback(i + 1, chunks.length);
                }
                
                // Yield control periodically
                if (i % yieldInterval === 0) {
                    await this.yieldToUI();
                }
                
            } catch (error) {
                console.error(`Error processing chunk ${i}:`, error);
                results.push({ error: error.message, chunkIndex: i });
            }
        }
        
        return this.mergeChunkResults(results);
    }

    /**
     * Create overlapping chunks for better context preservation
     */
    createChunks(content, chunkSize) {
        const chunks = [];
        const overlap = Math.floor(chunkSize * 0.1); // 10% overlap
        
        for (let i = 0; i < content.length; i += chunkSize - overlap) {
            const end = Math.min(i + chunkSize, content.length);
            chunks.push({
                content: content.slice(i, end),
                start: i,
                end: end,
                index: chunks.length
            });
            
            if (end >= content.length) break;
        }
        
        return chunks;
    }

    /**
     * Merge results from chunked processing
     */
    mergeChunkResults(results) {
        const merged = {
            success: true,
            chunks: results.length,
            errors: [],
            data: []
        };
        
        results.forEach((result, index) => {
            if (result.error) {
                merged.success = false;
                merged.errors.push({ chunk: index, error: result.error });
            } else {
                merged.data.push(result);
            }
        });
        
        return merged;
    }

    /**
     * Yield control to UI thread
     */
    async yieldToUI() {
        return new Promise(resolve => {
            setTimeout(resolve, 0);
        });
    }

    /**
     * Debounced function execution
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttled function execution
     */
    throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * Background task processing queue
     */
    async addToQueue(task, priority = 'normal') {
        const queueItem = {
            task,
            priority,
            id: Date.now() + Math.random(),
            timestamp: Date.now()
        };
        
        if (priority === 'high') {
            this.processingQueue.unshift(queueItem);
        } else {
            this.processingQueue.push(queueItem);
        }
        
        if (!this.isProcessing) {
            this.processQueue();
        }
        
        return queueItem.id;
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }
        
        this.isProcessing = true;
        
        while (this.processingQueue.length > 0) {
            const item = this.processingQueue.shift();
            
            try {
                await item.task();
            } catch (error) {
                console.error('Queue task failed:', error);
            }
            
            // Yield periodically
            await this.yieldToUI();
        }
        
        this.isProcessing = false;
    }

    /**
     * Smart caching with size limits and TTL
     */
    createSmartCache(maxSize = 100, ttl = 5 * 60 * 1000) { // 5 minutes TTL
        const cache = new Map();
        const timestamps = new Map();
        
        return {
            get: (key) => {
                const timestamp = timestamps.get(key);
                if (timestamp && Date.now() - timestamp > ttl) {
                    cache.delete(key);
                    timestamps.delete(key);
                    return undefined;
                }
                return cache.get(key);
            },
            
            set: (key, value) => {
                // Remove oldest entries if at capacity
                if (cache.size >= maxSize) {
                    const oldestKey = Array.from(timestamps.entries())
                        .sort(([,a], [,b]) => a - b)[0][0];
                    cache.delete(oldestKey);
                    timestamps.delete(oldestKey);
                }
                
                cache.set(key, value);
                timestamps.set(key, Date.now());
            },
            
            has: (key) => {
                const timestamp = timestamps.get(key);
                if (timestamp && Date.now() - timestamp > ttl) {
                    cache.delete(key);
                    timestamps.delete(key);
                    return false;
                }
                return cache.has(key);
            },
            
            clear: () => {
                cache.clear();
                timestamps.clear();
            },
            
            size: () => cache.size
        };
    }

    /**
     * Performance measurement utilities
     */
    startTimer(label) {
        this.performanceMetrics.set(label, {
            start: performance.now(),
            label
        });
    }

    endTimer(label) {
        const metric = this.performanceMetrics.get(label);
        if (metric) {
            const duration = performance.now() - metric.start;
            this.performanceMetrics.set(label, {
                ...metric,
                end: performance.now(),
                duration
            });
            
            console.log(`Performance: ${label} took ${duration.toFixed(2)}ms`);
            return duration;
        }
        return 0;
    }

    getMetrics() {
        const metrics = {};
        this.performanceMetrics.forEach((value, key) => {
            if (value.duration !== undefined) {
                metrics[key] = {
                    duration: value.duration,
                    timestamp: value.start
                };
            }
        });
        return metrics;
    }

    /**
     * Memory-efficient string operations
     */
    async processLargeString(str, operation) {
        if (str.length <= this.largeFileThreshold) {
            return operation(str);
        }

        // Process in chunks for large strings
        const chunkSize = 1024 * 1024; // 1MB chunks
        const results = [];
        
        for (let i = 0; i < str.length; i += chunkSize) {
            const chunk = str.slice(i, i + chunkSize);
            const result = await operation(chunk);
            results.push(result);
            
            // Yield periodically
            if (i % (chunkSize * 5) === 0) {
                await this.yieldToUI();
            }
        }
        
        return results.join('');
    }

    /**
     * Optimize Monaco editor performance for large files
     */
    optimizeMonacoForLargeFile(model) {
        if (!model) return;
        
        const lineCount = model.getLineCount();
        
        if (lineCount > 1000) {
            // Disable some features for large files
            monaco.editor.setModelLanguage(model, 'plaintext');
            
            // Reduce syntax highlighting complexity
            const options = {
                wordWrap: 'off',
                minimap: { enabled: false },
                folding: false,
                lineNumbers: 'on',
                glyphMargin: false,
                renderLineHighlight: 'none',
                occurrencesHighlight: false,
                selectionHighlight: false,
                hover: { enabled: false }
            };
            
            return options;
        }
        
        return null;
    }

    /**
     * Progressive loading for large directory structures
     */
    async loadDirectoryProgressive(rootHandle, callback, batchSize = 50) {
        const allEntries = [];
        let batch = [];
        
        for await (const [name, handle] of rootHandle.entries()) {
            batch.push({ name, handle });
            
            if (batch.length >= batchSize) {
                allEntries.push(...batch);
                
                // Process batch
                if (callback) {
                    await callback(batch);
                }
                
                batch = [];
                await this.yieldToUI();
            }
        }
        
        // Process remaining items
        if (batch.length > 0) {
            allEntries.push(...batch);
            if (callback) {
                await callback(batch);
            }
        }
        
        return allEntries;
    }

    /**
     * Adaptive processing based on system performance
     */
    getOptimalChunkSize() {
        // Adjust chunk size based on available memory
        if ('memory' in performance) {
            const memInfo = performance.memory;
            const availableMemory = memInfo.jsHeapSizeLimit - memInfo.usedJSHeapSize;
            
            if (availableMemory < 50 * 1024 * 1024) { // Less than 50MB
                return 32 * 1024; // 32KB chunks
            } else if (availableMemory < 100 * 1024 * 1024) { // Less than 100MB
                return 64 * 1024; // 64KB chunks
            } else {
                return 128 * 1024; // 128KB chunks
            }
        }
        
        return this.chunkSize;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.processingQueue = [];
        this.performanceMetrics.clear();
        this.clearAllCaches();
    }
}

// Export singleton instance
export const performanceOptimizer = new PerformanceOptimizer();