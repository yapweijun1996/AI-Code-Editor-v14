# Incremental Implementation Roadmap for Advanced Features

This document outlines the plan for developing the next set of advanced features for the IDE.

## Recently Completed Features ✅

| Feature | Description | Status |
|---|---|---|
| **Multi-Provider LLM Support** | Added support for OpenAI GPT and Ollama alongside Gemini | ✅ Completed |
| **Automatic API Key Rotation** | Implemented seamless key rotation for Gemini to handle rate limits | ✅ Completed |
| **Latest Model Support** | Updated to support Gemini 2.5 series and GPT-4.1/o1 models | ✅ Completed |
| **Enhanced Tool Suite** | Expanded to 20+ specialized tools for comprehensive file/project management | ✅ Completed |
| **Message Format Fixes** | Resolved API compatibility issues across all providers | ✅ Completed |
| **Project Structure Tool** | Fixed and enhanced get_project_structure with proper tree formatting | ✅ Completed |

---

## 1. AI-Powered Git Management

The goal is to enable the AI agent to perform Git operations based on natural language commands.

| # | Task | Description | Status |
|---|---|---|---|
| 1.1 | Expose Git Functions as Tools | Create a suite of tools for the AI agent that wrap the core `gitManager` functions (e.g., `git_add`, `git_commit`, `git_status`, `git_log`, `git_push`, `git_pull`). | Pending |
| 1.2 | Implement Natural Language Parsing | Enhance the AI agent's prompt to recognize and parse Git-related commands from user chat messages (e.g., "commit my changes," "show me the latest logs"). | Pending |
| 1.3 | Develop Interactive Workflows | For complex operations like merge conflicts, create guided, multi-step interactions where the AI asks clarifying questions and presents options to the user. | Pending |
| 1.4 | Create "Git Assistant" Agent Mode | Add a new agent mode specialized for Git operations, providing proactive suggestions and contextual actions based on the repository's status. | Pending |
| 1.5 | Add UI for Advanced Git Operations | Implement UI components for viewing commit history, visualizing branches, and managing remote repositories. | Pending |


## 2. Enhanced Search and Replace

The goal is to build a more powerful and interactive search experience.

| # | Task | Description | Status |
|---|---|---|---|
| 2.1 | Implement "Search and Replace" | Add functionality to perform a "replace all" operation on the search results, either across a single file or the entire project. | Pending |
| 2.2 | Implement "Go to Line" on Click | Make the search result items clickable, so that selecting a result opens the corresponding file and navigates the editor to the exact line of the match. | Pending |
| 2.3 | Add File/Folder Filtering | Add input fields to the search panel to allow users to include or exclude specific files or folders from the search (e.g., `*.js`, `!node_modules/`). | Pending |
| 2.4 | Show Context Lines | Display a few lines of code above and below each search result to provide better context without having to open the file. | Pending |


## 3. Enhanced Task Runner

The goal is to create a more robust and interactive task runner.

| # | Task | Description | Status |
|---|---|---|---|
| 3.1 | Stream Real-time Task Output | Instead of showing a static message, stream the live output from the running task directly into the task output panel. | Pending |
| 3.2 | Implement "Stop Task" Button | Add a button to terminate a currently running task. | Pending |
| 3.3 | Support for Additional Task Files | Extend the task discovery mechanism to find tasks in other common file types, such as `Makefile` or `justfile`. | Pending |
| 3.4 | Custom Task Configuration | Add a UI for users to define and save their own custom shell commands as tasks within the IDE. | Pending |
