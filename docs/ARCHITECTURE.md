# Application Architecture

This document provides a high-level overview of the application's architecture. For a more detailed guide on the project structure, development workflow, and how to contribute, please see the **[Contributing Guide](./CONTRIBUTING.md)**.

## Core Philosophy: Client-Centric Design

The application is architected to be **secure and frontend-heavy**. The majority of the logic, including all file system interactions, the editor, and the AI agent, runs directly in the browser. A minimal backend is used only for tasks that the browser's sandbox cannot perform.

## Component Overview

*   **Frontend**: A single-page application built with vanilla JavaScript, HTML, and CSS. It uses the Monaco Editor and manages all core application logic.
*   **Backend**: A lightweight Node.js/Express server that serves static files and provides sandboxed execution for terminal commands and URL fetching.
*   **AI Agent**: The Gemini agent logic is managed entirely on the client-side in `frontend/js/gemini_chat.js`, which defines all available tools and orchestrates the interaction with the model.

## Frontend Code Logic Flow

This diagram illustrates the relationships and primary responsibilities of the key JavaScript modules in the `frontend/js` directory.

```mermaid
graph TD
    subgraph User Interface
        A[main.js]
        B[ui.js]
    end

    subgraph Core Logic
        C[gemini_chat.js]
        D[tool_executor.js]
    end

    subgraph Data & State
        E[db.js]
        F[api_manager.js]
    end

    subgraph Editor & Files
        G[editor.js]
        H[file_system.js]
    end

    A -- Initializes & Orchestrates --> G
    A -- Handles User Input & Events --> C
    A -- Uses --> B
    C -- Uses --> D
    C -- Uses --> F
    D -- Executes Tools --> H
    D -- Executes Tools --> G
    G -- Manages Monaco Instance & Tabs --> A
    E -- Manages IndexedDB --> A
    E -- Manages IndexedDB --> C
    F -- Manages API Keys --> C

    linkStyle 0 stroke:#66c2a5,stroke-width:2px;
    linkStyle 1 stroke:#66c2a5,stroke-width:2px;
    linkStyle 2 stroke:#fc8d62,stroke-width:2px;
    linkStyle 3 stroke:#8da0cb,stroke-width:2px;
    linkStyle 4 stroke:#8da0cb,stroke-width:2px;
    linkStyle 5 stroke:#e78ac3,stroke-width:2px;
    linkStyle 6 stroke:#e78ac3,stroke-width:2px;
    linkStyle 7 stroke:#a6d854,stroke-width:2px;
    linkStyle 8 stroke:#ffd92f,stroke-width:2px;
    linkStyle 9 stroke:#ffd92f,stroke-width:2px;
    linkStyle 10 stroke:#b3b3b3,stroke-width:2px;
```

## End-to-End Workflow

This diagram illustrates the primary interaction flow between the user, frontend, backend, and the Gemini AI.

```mermaid
sequenceDiagram
    participant User
    participant Frontend (Browser) as FE
    participant FileSystem API as FS
    participant Backend (Node.js) as BE
    participant Gemini AI as AI

    User->>FE: Enters prompt (e.g., "Read app.js and tell me what it does")
    FE->>AI: Sends user prompt

    alt Client-Side Tool Execution (e.g., read_file)
        AI-->>FE: Requests tool call: read_file('app.js')
        FE->>FS: Uses File System Access API to get file handle
        FS-->>FE: Returns file handle
        FE->>FS: Reads file content
        FS-->>FE: Returns file content
        FE-->>AI: Sends file content as tool response
    end

    AI->>AI: Processes tool result and formulates answer
    AI-->>FE: Streams final text response to user
    FE->>User: Displays formatted AI response in chat
    FE->>FE: Opens 'app.js' in Monaco Editor
```

## State Management

The application's state is persisted entirely within the browser's **IndexedDB**, ensuring a robust and seamless user experience. The database (`CodeEditorDB`) is managed by `frontend/js/db.js` and contains several object stores:

*   **`apiKeys`**: Stores the user's Gemini API keys.
*   **`fileHandles`**: Persists the handle to the root project directory, allowing for quick reconnection.
*   **`sessionState`**: Automatically saves the entire workspace state (open files, active tab, unsaved content, and chat history) before the page unloads. This state is restored when the application starts, preventing any loss of work.
*   **`checkpoints`**: Stores complete, project-wide snapshots. Before the AI executes a destructive operation (like `rewrite_file` or `create_file`), it saves the entire state of the editor (all open files, their content, and view states) as a single checkpoint. This allows for a full, commit-style restore of the workspace to a previous point in time.
*   **`codeIndex`**: Caches a searchable index of the codebase for performance.
*   **`settings`**: Stores miscellaneous user preferences, such as the last selected AI model.
*   **`customRules`**: Stores user-defined rules for each AI mode, allowing for persistent, fine-grained control over the AI's behavior.

This comprehensive state management ensures that both the user's configuration and their work-in-progress are preserved across sessions.

## System Stability and Error Handling

The architecture includes several mechanisms to ensure stability and provide a reliable user experience:

*   **API-Compliant Payloads**: The communication with the Gemini API is carefully structured to adhere to its strict requirements. For instance, `functionResponse` parts are sent in dedicated messages, separate from any other content, preventing API errors and ensuring the tool-calling loop remains stable.
*   **Robust Session Restoration**: The session and file handle management has been hardened to correctly restore the project context, even after a page reload, ensuring that AI tools have immediate and correct access to the file system.
*   **Accurate File Path Generation**: The logic for generating the project's file structure has been corrected to prevent erroneous paths, ensuring that all file-based tool calls (`create_file`, `delete_file`, etc.) operate reliably.

## Custom Rule Injection Workflow

To ensure the AI's behavior can be tailored by the user, custom rules are dynamically injected into the system prompt before every request. This process guarantees that the AI always operates with the most up-to-date instructions for the selected mode.

```mermaid
graph TD
    A[User sends a message] --> B{Select AI Mode};
    B -- Code Mode --> C[Get Base Prompt for Code];
    B -- Plan Mode --> D[Get Base Prompt for Plan];
    
    subgraph "Rule Injection"
        E[Get Custom Rules for Selected Mode from DB]
    end

    C --> F[Combine Base Prompt + Custom Rules];
    D --> F;
    E --> F;
    
    F --> G[Send Combined Instruction to Gemini AI];
    G --> H[AI generates response based on all rules];
    H --> I[Display final response to user];

    style E fill:#d4edda,stroke:#155724,stroke-width:2px
```
