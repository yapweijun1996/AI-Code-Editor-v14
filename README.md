# AI-Powered Browser-Based Code Editor

This project is a sophisticated, browser-based code editor that integrates a powerful AI agent (Google's Gemini) to assist with a wide range of coding tasks. The application is designed with a secure, client-centric architecture, ensuring that all file system operations run directly in the browser, providing a seamless and safe user experience.

---

## Core Architecture

The editor's architecture has been streamlined to use a local Node.js server, simplifying setup and management.

*   **Local Node.js Server**: A lightweight `Express` server (`index.js`) now serves the `frontend` assets, making the application accessible at `http://localhost:3000`. This approach provides a stable and consistent runtime environment.

*   **Client-Centric File Operations**: All core logic and file system interactions remain securely on the client-side in `frontend/js/main.js`. The application uses the browser's native **File System Access API**, ensuring that all file operations are handled directly and safely by the user's browser.

*   **Stateful Experience with IndexedDB**: The application uses IndexedDB to persist user data and session state locally, ensuring a seamless experience across page loads.

---

## Features

*   **Monaco Editor**: Integrates the same powerful editor used in VS Code, providing a rich and familiar coding environment with syntax highlighting and advanced editing features.
*   **Gemini AI Agent**: A stateful AI assistant powered by the **Google Gemini API** (`v1beta`) and its official tool-calling capabilities. This ensures a reliable and predictable conversational loop:
    1.  **Tool Declaration**: The frontend formally declares its available functions to the Gemini API.
    2.  **Function Call**: The AI responds with a structured `functionCall` when it needs to use a tool.
    3.  **Frontend Execution**: The browser executes the requested function (e.g., reading a file).
    4.  **Function Response**: The result is sent back to the AI in a formal `functionResponse`.
    5.  **Final Answer**: The AI provides a natural-language response to the user.
*   **Resizable Panels**: A flexible UI with resizable panels for the file tree, editor, and AI chat.
*   **Intelligent Tab and File Management**:
    *   **Path-Based Identification**: Open files are tracked by their unique file path, which prevents the creation of duplicate tabs when a file is accessed multiple times.
    *   **Automatic Focus**: When the AI uses a tool like `read_file` or `rewrite_file`, the application automatically opens the relevant file or switches to its existing tab, providing a seamless workflow.
    *   **Stateful UI**: The file tree and open tabs are rendered dynamically, providing a clear and consistent view of the project state.
*   **Automatic File Opening**: When the AI agent reads, creates, or rewrites a file, it is automatically opened or focused, providing immediate visibility into the agent's actions.
*   **AST-Powered Code Analysis**: The AI can use the `analyze_code` tool to parse JavaScript code into an Abstract Syntax Tree (AST), enabling a deep, structural understanding of the code for more precise refactoring and analysis.
*   **Multimodal Input**: The AI chat supports both text and image uploads, allowing you to ask questions about visual content.
*   **Multiple Agent Modes**: Switch between different AI modes (`Code`, `Plan`, `Search`) to tailor the agent's behavior to your specific needs.
*   **Persistent Model Selection**: The application remembers your chosen AI model across sessions, saving you from having to re-select it on every visit.
*   **Customizable AI Behavior**:
    *   **Per-Mode Custom Rules**: Define unique sets of rules for each AI mode (`Code`, `Plan`). These rules are stored locally in your browser's IndexedDB.
    *   **Dynamic System Prompt**: Your custom rules are automatically injected into the AI's system prompt, allowing you to precisely tailor its behavior, enforce coding standards, or provide specific instructions for its workflow.
    *   **Immediate Application**: Rule changes are applied instantly to the next AI interaction.
    *   **Visible In-Chat Rules**: The currently active custom rules are displayed directly within the chat interface, providing constant visibility into the AI's operational context.
*   **Project-Wide Checkpoint System**:
    *   **Automatic Session Restore**: Your entire workspace—including all open files, their content, and the full chat history—is automatically saved to your browser's IndexedDB. This state is seamlessly restored when you reload the page.
    *   **Manual & Automatic Snapshots**: Create manual, named checkpoints of your entire workspace at any time. The system also automatically creates a timestamped checkpoint before the AI performs any file modification, ensuring you can always revert to a safe state.
    *   **Full Workspace Restoration**: Restore the entire project to a previous state from the Checkpoints manager. This action reverts all files to their snapshotted content and re-opens the exact set of files that were active at that time.
*   **Key Bug Fixes & Stability Improvements**:
    *   **API Stability**: Resolved a critical bug that caused an API error when the AI responded after a tool call, ensuring a stable and reliable chat experience.
    *   **File Path Correction**: Fixed an issue where the `get_project_structure` tool generated incorrect, nested file paths, improving the reliability of file operations.
    *   **Session Handling**: Addressed a bug where a restored project folder from a previous session was not correctly recognized by the AI's tools.

---

## Application Workflow

The following diagram illustrates the core workflow, showing how the browser-based frontend interacts with the local file system, the backend server, and the Gemini AI to execute tasks.

```mermaid
sequenceDiagram
    participant User
    participant Frontend (Browser) as FE
    participant FileSystem API as FS
    participant Backend (Node.js) as BE
    participant Gemini AI as AI

    User->>FE: Enters prompt (e.g., "Read app.js")
    FE->>AI: Sends user prompt

    alt Client-Side Tool (e.g., read_file)
        AI-->>FE: Requests tool call: read_file('app.js')
        FE->>FS: Uses File System Access API
        FS-->>FE: Returns file content
        FE-->>AI: Sends tool response
    else Backend Tool (e.g., run_terminal_command)
        AI-->>FE: Requests tool call: run_terminal_command('ls -l')
        FE->>BE: POST /api/execute-tool
        BE-->>FE: Returns command output
        FE-->>AI: Sends tool response
    end

    AI->>AI: Processes result & formulates answer
    AI-->>FE: Streams final response
    FE->>User: Displays formatted AI response
```

---

## Getting Started

Running the application is now managed by simple, powerful scripts for all major operating systems.

### Prerequisites

*   [Node.js](https://nodejs.org/) (which includes `npm`) installed on your system.

### Installation and Management

The application includes interactive scripts to handle all aspects of installation, execution, and process management.

1.  **Launch the Management Script**:
    *   **On Windows**: Double-click `app.bat`.
    *   **On macOS / Linux**: First, make the script executable by running `chmod +x ./app.sh`, then run it with `./app.sh`.

2.  **Install Dependencies (First-Time Setup)**:
    *   From the script's main menu, select **[1] Install Dependencies**. This will download the necessary `npm` packages and install `pm2` globally.

3.  **Start the Server**:
    *   From the menu, select **[2] Start Server**. This will launch the application using `pm2`.

4.  **Access the Application**:
    *   Open your web browser (e.g., Chrome, Edge) and navigate to **`http://localhost:3000`**.

The management scripts also provide options to **stop**, **restart**, and **monitor** the server, as well as **enable/disable auto-startup** on system reboot.

### Configuration

1.  **Add API Keys**:
    *   In the AI Chat panel, expand the "API Key Settings" section.
    *   Enter one or more Google Gemini API keys, separated by new lines.
    *   Click "Save Keys". The keys are stored securely in your browser's IndexedDB.

2.  **Open a Project**:
    *   Click the "Open Project Folder" button.
    *   Select a local directory to work with. The application will remember this folder for future sessions.

---

## For Developers

Interested in contributing? We welcome your help!

Our **[Contributing Guide](./docs/CONTRIBUTING.md)** contains all the information you need to get started, including:

*   A detailed architectural overview.
*   The complete development setup and workflow.
*   Our coding standards and best practices.

We recommend reading the guide to understand the project's design and how to contribute effectively.

