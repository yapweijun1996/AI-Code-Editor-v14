/**
 * @file undo_manager.js
 * @description Manages a simple undo stack for file modification operations.
 */

export const UndoManager = {
    stack: [],
    MAX_STACK_SIZE: 50, // Limit the size of the undo history

    /**
     * Pushes a file's state onto the undo stack before a change.
     * @param {string} filename - The path of the file being changed.
     * @param {string} content - The content of the file before the modification.
     */
    push(filename, content) {
        if (this.stack.length >= this.MAX_STACK_SIZE) {
            this.stack.shift(); // Remove the oldest entry if the stack is full
        }
        this.stack.push({
            filename,
            content,
            timestamp: Date.now(),
        });
        console.log(`Undo state saved for ${filename}. Stack size: ${this.stack.length}`);
    },

    /**
     * Pops the most recent state from the undo stack.
     * @returns {object|null} The last saved state or null if the stack is empty.
     */
    pop() {
        if (this.stack.length === 0) {
            return null;
        }
        return this.stack.pop();
    },

    /**
     * Peeks at the top of the stack without removing the item.
     * @returns {object|null} The last saved state or null if the stack is empty.
     */
    peek() {
        if (this.stack.length === 0) {
            return null;
        }
        return this.stack[this.stack.length - 1];
    },

    /**
     * Clears the entire undo stack.
     */
    clear() {
        this.stack = [];
    }
};
