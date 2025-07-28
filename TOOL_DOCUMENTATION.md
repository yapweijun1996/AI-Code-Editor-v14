# Tool Documentation

This guide provides details on specific tools, their behaviors, and best practices for their use.

---

## General Tool Notes & Recent Updates

- **`rewrite_file`**: This tool now functions as an "upsert" operation. If the specified file does not exist, it will be **created**. If the file already exists, its content will be completely **overwritten**.

- **`format_code`**: This tool runs entirely on the **client-side** using a Web Worker with **Prettier**. It automatically detects the file type, applies the correct formatting rules, and **overwrites the file** with the formatted code.
  - **Important**: This tool requires the file to contain **valid code** corresponding to its file extension (e.g., valid JavaScript for a `.js` file). Running it on plain text files or files with syntax errors will result in a parser error from Prettier.

- **Selection-Based Tools (`get_selected_text`, `replace_selected_text`)**: These tools require the user to **manually select text** in the editor before execution. They will return a helpful error message if no text is selected.

- **`get_file_history`**: This tool now provides more specific feedback. It will explicitly state if a file is not tracked by Git or if the project is not a Git repository, in addition to showing the commit history.

---

## Code Indexing and Searching Tools

The IDE now features two distinct indexing systems: a legacy frontend system and a new, scalable backend system.

### 1. Backend Indexer (`build_backend_index`, `query_backend_index`) - **Recommended for Large Projects**

This is the new, scalable indexing solution designed for large codebases, especially with non-standard file types like ColdFusion (`.cfm`).

- **Mechanism**: A backend service continuously watches for file changes (`.cfm` files for now) and automatically updates a central `codebase_index.json` file. This means the index is **always up-to-date** without needing manual intervention.
- **`build_backend_index`**: Manually triggers a full rebuild of the entire project index. This is generally only needed once for initial setup or if the watcher is suspected to be out of sync.
- **`query_backend_index`**: Searches the automatically updated backend index. It is extremely fast and ideal for finding function definitions and symbols in supported files.

### 2. Frontend Indexer (`build_or_update_codebase_index`, `query_codebase`) - **Legacy**

This is the original, browser-based indexing system that uses IndexedDB.

- **Mechanism**: Scans the codebase from the browser and stores a searchable index in IndexedDB.
- **`build_or_update_codebase_index`**: **Manual trigger required.** You must run this tool to populate or update the index.
- **`query_codebase`**: Searches the IndexedDB index.
- **Limitations**: Can be slow and memory-intensive on large projects. The index can easily become **stale** if you make file changes without manually running the update tool. **This tool is now considered legacy.**

---

## `search_code` (Real-time File Search)

- **Mechanism**: Performs a direct, real-time search for a literal string or regular expression across all files in the project. It does not use any index.
- **Best For**: Finding every occurrence of a specific string, searching with regex, and guaranteeing 100% up-to-the-second results.
- **Limitations**: Can be slow on very large projects as it has to read every file.

---

## Summary and Recommendations

| Feature | `query_backend_index` (Recommended) | `search_code` (For Literal/Regex) | `query_codebase` (Legacy) |
| :--- | :--- | :--- | :--- |
| **Speed** | Very Fast | Slow on Large Projects | Fast (but on smaller projects) |
| **Data Source** | Backend JSON file | Live File System | Browser IndexedDB |
| **Index Freshness** | **Automatic (Live)** | N/A (Always Live) | **Manual** |
| **Best Use** | Finding definitions, scalable | Finding exact strings/regex | Legacy, small projects |
