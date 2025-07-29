# Application Architecture

This document provides a high-level overview of the application's architecture. For a more detailed guide on the project structure, development workflow, and how to contribute, please see the **[Contributing Guide](./CONTRIBUTING.md)**.

## Core Philosophy: Client-Centric Design

The application is architected to be **secure and frontend-heavy**. The majority of the logic, including all file system interactions, the editor, and the AI agent, runs directly in the browser. A minimal backend is used only for tasks that the browser's sandbox cannot perform.

## Component Overview

*   **Frontend**: A single-page application built with vanilla JavaScript, HTML, and CSS. It uses the Monaco Editor and manages all core application logic.
*   **Backend**: A lightweight Node.js/Express server that serves static files and provides sandboxed execution for terminal commands and URL fetching.
*   **AI Agents**: Multi-provider AI system managed entirely on the client-side with:
    *   **Service Factory** (`frontend/js/llm/service_factory.js`) - Creates appropriate LLM service instances
    *   **Provider Services** - Gemini, OpenAI, and Ollama service implementations
    *   **Chat Service** (`frontend/js/chat_service.js`) - Orchestrates interactions with all providers

## Frontend Code Logic Flow

This diagram illustrates the relationships and primary responsibilities of the key JavaScript modules in the `frontend/js` directory.

```mermaid
graph TD
    subgraph User Interface
        A[main.js]
        B[ui.js]
        S[settings.js]
    end

    subgraph LLM Services
        CS[chat_service.js]
        SF[llm/service_factory.js]
        GS[llm/gemini_service.js]
        OS[llm/openai_service.js]
        OLS[llm/ollama_service.js]
        BS[llm/base_llm_service.js]
    end

    subgraph Core Logic
        D[tool_executor.js]
        TL[tool_logger.js]
        UM[undo_manager.js]
    end

    subgraph Data & State
        E[db.js]
        F[api_manager.js]
        CI[code_intel.js]
    end

    subgraph Editor & Files
        G[editor.js]
        H[file_system.js]
        EV[events.js]
    end

    A -- Initializes & Orchestrates --> G
    A -- Handles User Input & Events --> CS
    A -- Uses --> B
    CS -- Creates Services --> SF
    SF -- Instantiates --> GS
    SF -- Instantiates --> OS
    SF -- Instantiates --> OLS
    GS -- Extends --> BS
    OS -- Extends --> BS
    OLS -- Extends --> BS
    CS -- Uses --> D
    CS -- Uses --> F
    D -- Executes Tools --> H
    D -- Executes Tools --> G
    D -- Logs Actions --> TL
    D -- Manages History --> UM
    G -- Manages Monaco Instance --> A
    E -- Manages IndexedDB --> A
    E -- Manages IndexedDB --> CS
    F -- Manages API Keys --> CS
    S -- Manages Configuration --> CS
    CI -- Indexes Codebase --> D
    EV -- Handles Events --> A
```

## Multi-Provider LLM Architecture

The application supports multiple AI providers through a unified interface:

### Provider Hierarchy
```mermaid
classDiagram
    class BaseLLMService {
        +apiKeyManager
        +model
        +isConfigured()
        +sendMessageStream()*
    }
    
    class GeminiService {
        +apiBaseUrl
        +loadKeys()
        +getCurrentKey()
        +_isRetryableError()
        +_prepareMessages()
    }
    
    class OpenAIService {
        +apiBaseUrl
        +_prepareMessages()
        +_prepareTools()
        +_aggregateToolCalls()
    }
    
    class OllamaService {
        +customConfig
        +_prepareMessages()
    }

    BaseLLMService <|-- GeminiService
    BaseLLMService <|-- OpenAIService
    BaseLLMService <|-- OllamaService
```

### API Key Rotation (Gemini Only)

Gemini service implements automatic API key rotation to handle rate limits:

```mermaid
flowchart TD
    A[API Request] --> B{Try Current Key}
    B -->|Success| C[Return Response]
    B -->|Rate Limit/Auth Error| D{More Keys Available?}
    D -->|Yes| E[Rotate to Next Key]
    E --> F[Retry Request]
    F --> B
    D -->|No| G[Throw Final Error]
```

## End-to-End Workflow

This diagram illustrates the primary interaction flow between the user, frontend, backend, and AI providers.

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
*   **`checkpoints`**: Stores complete, project-wide snapshots. Before the AI executes a destructive operation (like `rewrite_file`, `create_file`, or `apply_diff`), it saves the entire state of the editor (all open files, their content, and view states) as a single checkpoint. This allows for a full, commit-style restore of the workspace to a previous point in time.
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


---

## High-Performance Diffing Architecture

The `create_and_apply_diff` tool provides an efficient and stable way to modify files. To avoid performance bottlenecks and stack overflow errors when processing large files, the application uses a **line-based diffing strategy** implemented in `frontend/js/tool_executor.js`.

This approach, powered by the `diff-match-patch` library, avoids a direct, character-by-character comparison of the entire file content. Instead, it converts each line into a single character, performs the diff on this much smaller dataset, and then translates the results back into line-based changes.

The workflow is as follows:

```mermaid
graph TD
    subgraph "File Content"
        A[Original File Content]
        B[New File Content]
    end

    subgraph "Line-to-Char Mapping"
        C[dmp.diff_linesToChars_()]
    end

    subgraph "Core Diffing"
        D[dmp.diff_main()]
    end

    subgraph "Char-to-Line Restoration"
        E[dmp.diff_charsToLines_()]
    end

    subgraph "Patch Generation & Application"
        F[dmp.patch_make()]
        G[dmp.patch_apply()]
    end
    
    H[Patched File Content]

    A -- feeds --> C
    B -- feeds --> C
    C -- provides line arrays & char representations --> D
    D -- generates diffs --> E
    E -- restores line data to diffs --> F
    F -- creates patches --> G
    A -- provides original content for patching --> F
    A -- provides original content for applying patch --> G
    G -- outputs --> H

    style C fill:#d4edda,stroke:#155724,stroke-width:2px
    style D fill:#cce5ff,stroke:#004085,stroke-width:2px
    style E fill:#d4edda,stroke:#155724,stroke-width:2px
    style F fill:#fff3cd,stroke:#856404,stroke-width:2px
    style G fill:#fff3cd,stroke:#856404,stroke-width:2px
```

This architecture ensures that the diffing process is both fast and memory-efficient, making the AI agent's file modification capabilities robust and scalable.
