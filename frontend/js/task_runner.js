// This module will handle discovering and running tasks from package.json.

import { getFileHandleFromPath } from './file_system.js';

class TaskRunner {
    constructor() {
        this.tasks = {};
    }

    async discoverTasks(rootDirHandle) {
        try {
            const packageJsonHandle = await getFileHandleFromPath(rootDirHandle, 'package.json');
            const file = await packageJsonHandle.getFile();
            const content = await file.text();
            const packageJson = JSON.parse(content);
            this.tasks = packageJson.scripts || {};
        } catch (e) {
            this.tasks = {};
        }
        return this.tasks;
    }

    runTask(taskName) {
        const command = this.tasks[taskName];
        if (command) {
            ChatService.runToolDirectly('run_terminal_command', { command });
        } else {
            console.error(`Task not found: ${taskName}`);
        }
    }
}

export default new TaskRunner();