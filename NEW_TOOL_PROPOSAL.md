# New Tool and Feature Proposal

This document outlines a roadmap for new tools and features based on user feedback. The goal is to enhance file management, code editing, and debugging capabilities.

---

## 1. Granular File/Folder Manipulation

These tools will provide more specific and auditable file system operations than using `run_terminal_command` with `mv` or `cp`.

### `copy_file`
- **Description:** Copies a file from a source path to a destination path.
- **Parameters:**
    - `source_path` (string): The path to the file to be copied.
    - `destination_path` (string): The path to the new file.
- **Returns:** `{ "message": "File 'source.txt' copied to 'destination.txt'." }`
- **Error Handling:** Throws an error if the source does not exist or the destination is a directory.

### `move_file` (alias for `rename_file`)
- **Action:** Since `rename_file` already supports moving files across directories, this will be an alias for discoverability. The underlying handler will be the same.

### `copy_folder`
- **Description:** Recursively copies a folder from a source path to a destination path.
- **Parameters:**
    - `source_folder_path` (string): The path to the folder to be copied.
    - `destination_folder_path` (string): The path to the new folder.
- **Returns:** `{ "message": "Folder 'src' copied to 'src_backup'." }`

### `move_folder` (alias for `rename_folder`)
- **Action:** Since `rename_folder` already supports moving folders, this will be an alias.

---

## 2. Enhanced Code Editing

### `find_and_replace_in_file`
- **Description:** A powerful, regex-capable find-and-replace tool that operates on a single file.
- **Parameters:**
    - `filename` (string): The path to the file to modify.
    - `find_pattern` (string): The literal string or regex pattern to search for.
    - `replace_string` (string): The string to replace matches with. Supports regex capture groups (e.g., `$1`).
    - `options` (object, optional):
        - `use_regex` (boolean, default: `false`): Treats `find_pattern` as a regular expression.
        - `case_sensitive` (boolean, default: `true`): Performs a case-sensitive search.
- **Returns:** `{ "message": "Replaced 5 occurrences in 'app.js'." }`

---

## 3. Future Development: Refactoring & Debugging

These are more complex features that require significant work. This section serves as a placeholder for future planning.

### `refactor_code` (Conceptual)
- **Description:** A tool to perform common, language-aware refactoring operations.
- **Potential Operations:**
    - `rename_variable`: Renames a variable within its scope.
    - `extract_method`: Extracts a block of code into a new method/function.
    - `inline_variable`: Replaces a variable with its value.
- **Challenges:** Requires building or integrating with a robust code parser (AST) for each supported language to ensure safety and correctness.

### Interactive Debugging Tools (Conceptual)
- **Description:** A suite of tools to enable interactive debugging sessions.
- **Potential Tools:**
    - `set_breakpoint(filename, line_number)`
    - `remove_breakpoint(filename, line_number)`
    - `step_over()`
    - `step_into()`
    - `step_out()`
    - `continue_execution()`
    - `inspect_variables()`
- **Challenges:** Requires integration with a debugging protocol (like the Debug Adapter Protocol) and managing the state of a running debugger process. This is a significant architectural undertaking.
