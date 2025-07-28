# Tool Usage Guide: `search_code` vs. `query_codebase`

This document clarifies the differences between the `search_code` and `query_codebase` tools to help you choose the right one for your task.

---

## `search_code`

**Mechanism:** Performs a direct, real-time search for a literal string or regular expression across all files in the project (respecting `.gitignore`). It does not use any pre-existing index.

### Best For:
- **Literal Searches:** Finding every single occurrence of a specific, known string (e.g., a variable name `myVar`, an exact error message, a URL).
- **Regex Patterns:** Searching for code that matches a specific pattern (e.g., finding all `TODO:` comments that follow a certain format).
- **Guaranteed Freshness:** Since it searches the live file system, the results are always 100% up-to-date.

### Limitations:
- **Slower on Large Projects:** Can be slow as it needs to read every file on every search.
- **No Code Intelligence:** It does not understand the structure of the code. It cannot differentiate between a function definition, a function call, or a mention in a comment.

**Example Use Case:** You need to find every single place the string `"API_KEY_SECRET"` appears in the codebase, regardless of context.

---

## `query_codebase`

**Mechanism:** Searches a pre-built, structured index of the codebase. This index contains parsed definitions (functions, classes, etc.) and the full, lowercased content of indexed files.

### Best For:
- **Fast Lookups:** Extremely fast for finding where a known function, class, or variable is defined.
- **Conceptual Searches:** Finding files related to a general concept (e.g., "authentication") where the exact term might vary.
- **Structural Awareness:** Can identify and return specific code constructs like `function` or `class` definitions.

### Limitations:
- **Requires an Index:** You must run `build_or_update_codebase_index` or `reindex_codebase_paths` to create or update the index.
- **Stale Results Possible:** If you have made changes since the last index, the query results may be out of date.
- **Dependent on Parser:** The quality of definition-based search depends on the accuracy of the internal code parser, which may not capture every possible language construct perfectly.

**Example Use Case:** You need to quickly find the definition of a function named `calculateTotal` without searching through every file where it might be called or mentioned.

---

## Summary

| Feature | `search_code` | `query_codebase` |
| :--- | :--- | :--- |
| **Speed** | Slower (reads files live) | Very Fast (uses index) |
| **Data Source** | Live File System | Pre-built Index |
| **Context-Aware**| No | Yes (identifies definitions) |
| **Setup** | None | Requires indexing step |
| **Best Use** | Finding exact strings/regex | Finding definitions & concepts |
