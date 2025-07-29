/**
 * @file tool_logger.js
 * @description Handles logging of AI tool executions for transparency and debugging.
 */

export const ToolLogger = {
    DB_NAME: 'ToolExecutionDB',
    STORE_NAME: 'ToolLogs',
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                return resolve();
            }

            const request = indexedDB.open(this.DB_NAME, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('Tool execution log database initialized.');
                resolve();
            };

            request.onerror = (event) => {
                console.error('Error initializing tool log database:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    async log(toolName, params, status, result) {
        if (!this.db) {
            await this.init();
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            toolName,
            params,
            status, // 'Success' or 'Error'
            result, // Could be a success message or an error object
        };

        const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.add(logEntry);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = (event) => {
                console.error('Failed to write to tool log:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    async getLogs() {
        if (!this.db) {
            await this.init();
        }

        const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            request.onerror = (event) => {
                console.error('Failed to retrieve tool logs:', event.target.error);
                reject(event.target.error);
            };
        });
    }
};

// Initialize the logger on load
ToolLogger.init().catch(err => console.error("Failed to init ToolLogger on startup:", err));
