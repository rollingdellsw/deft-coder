# Tools Reference

Deft uses a **skill-based tool loading** system. Core tools are always available, while specialized tools are loaded on-demand via skills to reduce context overhead.

Deft provides tools through two mechanisms:

1. **Native tools** - Built into the agent (patch, run_cmd, sandbox_ts, etc.)
2. **MCP tools** - Provided by Model Context Protocol servers (filesystem, git, search)

Tools are exposed directly to the LLM with no translation layer.

---

## Native Tools

### `patch`

Primary code modification tool. Applies unified diff patches with content-based matching.

**Parameters:**

| Parameter      | Type   | Description                      |
| -------------- | ------ | -------------------------------- |
| `unified_diff` | string | The patch in unified diff format |

**Features:**

- Content-based matching (line numbers are hints only)
- Self-healing: failed hunks auto-repaired by LLM
- Multi-file: create, modify, delete in one patch
- Interactive review: accept/reject each hunk

**Example:**

```javascript
patch({
  unified_diff: `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -15,6 +15,10 @@ export async function authenticate(token: string) {
   if (!token) {
     throw new AuthError('Token required');
   }
+
+  if (isExpired(token)) {
+    throw new AuthError('Token expired');
+  }

   return validateToken(token);
 }`,
});
```

---

### `edit_lines`

Line-based file editing tool. Replaces a range of lines with new content.

**Parameters:**

| Parameter     | Type     | Description                                        |
| ------------- | -------- | -------------------------------------------------- |
| `file`        | string   | File path (relative to working directory)          |
| `start_line`  | number   | Start line number (1-based, inclusive)             |
| `end_line`    | number   | End line number (1-based, inclusive)               |
| `replacement` | string[] | Array of replacement lines (empty array to delete) |

**Features:**

- Precise line-based editing using line numbers from `read_file` output
- Interactive diff review (same UI as `patch` tool)
- Supports insert, replace, and delete operations
- Generates unified diff for review before applying

**⚠️ Important: Line Drift**

After each `edit_lines` call, line numbers shift. The guardrail **invalidates** your file snapshot, forcing you to call `read_file` again before the next `edit_lines` on the same file. This prevents editing the wrong lines.

**Examples:**

```javascript
// Delete lines 5-10
edit_lines({
  file: "src/auth.ts",
  start_line: 5,
  end_line: 10,
  replacement: [],
});

// Replace line 15 with two new lines
edit_lines({
  file: "src/auth.ts",
  start_line: 15,
  end_line: 15,
  replacement: [
    "  const validated = await validateToken(token);",
    "  return validated;",
  ],
});

// Insert before line 5 (use end_line = start_line - 1)
edit_lines({
  file: "src/auth.ts",
  start_line: 5,
  end_line: 4,
  replacement: ["// New comment inserted above line 5"],
});
```

---

### `run_cmd`

Execute whitelisted project commands (build, test, lint).

**Parameters:**

| Parameter | Type   | Description              |
| --------- | ------ | ------------------------ |
| `command` | string | Exact command to execute |

**Configuration:**

```bash
export DEFT_ALLOWED_COMMANDS="npm test,npm run build,npm run lint"
```

**Examples:**

```javascript
run_cmd({ command: "npm test" });
run_cmd({ command: "npm run build" });
run_cmd({ command: "npm run lint" });
```

**Skill Scripts:**

When a skill is active and has `run_cmd` in its `allowed-tools`, relative script paths are resolved to the skill's directory:

```javascript
// If semantic-search skill is active at ~/.config/deft/skills/semantic-search/
run_cmd({ command: "scripts/index.sh" });
// → Executes ~/.config/deft/skills/semantic-search/scripts/index.sh
```

This allows skills to bundle and execute their own automation scripts without requiring them in the global whitelist.

---

### `read_skill`

Load a skill to access its instructions and tools.

**Parameters:**

| Parameter | Type   | Description        |
| --------- | ------ | ------------------ |
| `name`    | string | Skill name to load |

**Examples:**

```javascript
read_skill({ name: "web-research" }); // → unlocks sandbox_browser
read_skill({ name: "task-delegation" }); // → unlocks run_subtask
read_skill({ name: "ts-sandbox" }); // → unlocks sandbox_ts
read_skill({ name: "semantic-search" }); // → unlocks agentic_search
```

---

### `sandbox_ts`

Execute commands in an isolated TypeScript/Node.js Docker sandbox.

> **Note:** Commands must be prefixed with `docker exec deft-ts-sandbox`.

**Parameters:**

| Parameter | Type   | Description                                                         |
| --------- | ------ | ------------------------------------------------------------------- |
| `cmd`     | string | Docker exec command (must start with `docker exec deft-ts-sandbox`) |
| `timeout` | number | Timeout in ms (1000-60000, default 30000)                           |

**Examples:**

```javascript
// Simple evaluation
sandbox_ts({ cmd: "docker exec deft-ts-sandbox node -e 'console.log(1+1)'" });

// Multi-step commands
sandbox_ts({
  cmd: 'docker exec deft-ts-sandbox bash -c \'npm init -y && npm install lodash && node -e "console.log(require(\\"lodash\\").chunk([1,2,3,4], 2))"\'',
});

// TypeScript compilation check
sandbox_ts({
  cmd: 'docker exec deft-ts-sandbox bash -c "echo \'const x: number = \\"hello\\";\' > /tmp/test.ts && npx tsc --noEmit /tmp/test.ts"',
});
```

**Requires:** Load `ts-sandbox` skill first, or preload it in config.

---

### `sandbox_browser`

Browser automation for web search and page fetching.

**Parameters:**

| Parameter        | Type    | Description                                 |
| ---------------- | ------- | ------------------------------------------- |
| `action`         | string  | `"search"`, `"fetch"`, or `"snapshot"`      |
| `query`          | string  | Search query (for search action)            |
| `url`            | string  | URL (for fetch/snapshot actions)            |
| `maxResults`     | number  | Max search results (1-100, default 10)      |
| `viewportWidth`  | number  | Viewport width for snapshot (default 1920)  |
| `viewportHeight` | number  | Viewport height for snapshot (default 1080) |
| `fullPage`       | boolean | Capture full page screenshot (default true) |

**Examples:**

```javascript
// Web search
sandbox_browser({
  action: "search",
  query: "TypeScript best practices",
  maxResults: 5,
});

// Fetch page content
sandbox_browser({ action: "fetch", url: "https://example.com/docs" });

// Take screenshot
sandbox_browser({
  action: "snapshot",
  url: "https://example.com",
  fullPage: true,
});
```

**Requires:** Load `web-research` skill first, or preload it in config.

---

### `agentic_search`

Smart multi-file code search using a sub-agent. Use this for complex, semantic queries. For simple text/regex or definition lookups, use the dedicated search tools (`search`, `find_definition`) instead.

**Parameters:**

| Parameter   | Type   | Description                      |
| ----------- | ------ | -------------------------------- |
| `query`     | string | Natural language or code pattern |
| `scope`     | string | Search scope (default: `"all"`)  |
| `timeoutMs` | number | Timeout in ms (default 30000)    |

**Examples:**

```javascript
agentic_search({ query: "authentication handler", scope: "src" });
agentic_search({ query: "where is UserService defined", scope: "all" });
agentic_search({ query: "test cases for login", scope: "tests" });
```

**Requires:** Load `semantic-search` skill first, or preload it in config.

---

### `run_subtask`

Delegate a self-contained task to a specialized sub-agent.

**Parameters:**

| Parameter              | Type     | Description                                       |
| ---------------------- | -------- | ------------------------------------------------- |
| `goal`                 | string   | Clear description of what to accomplish           |
| `verification_command` | string   | Command to verify success (e.g., `"npm test"`)    |
| `context_files`        | string[] | List of relevant file paths                       |
| `timeoutMs`            | number   | Timeout in ms (default 300000, max 15 iterations) |

**Example:**

```javascript
run_subtask({
  goal: "Add input validation to the login form",
  verification_command: "npm test -- --grep 'login'",
  context_files: ["src/components/LoginForm.tsx", "src/utils/validation.ts"],
  timeoutMs: 120000,
});
```

**Requires:** Load `task-delegation` skill first, or preload it in config.

---

## MCP Server Tools

These tools are provided by Model Context Protocol servers and are available directly to the LLM.

### Filesystem Server

| Tool               | Description                                     |
| ------------------ | ----------------------------------------------- |
| `read_file`        | Read file contents                              |
| `write_file`       | Write content to a file (requires confirmation) |
| `list_files`       | List directory contents                         |
| `search_files`     | Search for files using glob pattern             |
| `delete_file`      | Delete a file                                   |
| `create_directory` | Create directory (with optional recursive)      |

**Examples:**

```javascript
// Read entire file
read_file({ path: "src/index.ts" });

// Read specific lines (line 10-30)
read_file({ path: "src/index.ts", start_line: 10, line_count: 20 });

// Read multiple files
read_file({ paths: ["src/index.ts", "src/utils.ts"] });

// List directory
list_files({ path: "src" });

// Search for files
search_files({ pattern: "*.ts", path: "src" });

// Write file (triggers confirmation)
write_file({ path: "src/new.ts", content: "export const x = 1;" });

// Create directory
create_directory({ path: "src/utils", recursive: true });

// Delete file (triggers confirmation)
delete_file({ path: "src/old.ts" });
```

---

### Git Server

| Tool          | Description                                    |
| ------------- | ---------------------------------------------- |
| `git_command` | Execute git commands (push blocked for safety) |

**Examples:**

```javascript
git_command({ command: "status" });
git_command({ command: "log --oneline -10" });
git_command({ command: "diff HEAD~1" });
git_command({ command: "show HEAD:src/index.ts" });
git_command({ command: "branch -a" });
git_command({ command: "blame src/index.ts" });
```

Note: Pass the git subcommand without the `git` prefix.

---

### Search Server

| Tool                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `find_definition`     | Find where a symbol is defined (LSP)              |
| `find_references`     | Find usages of a symbol at position (LSP)         |
| `get_hover`           | Get documentation/type info at position (LSP)     |
| `search`              | Pattern search (ripgrep)                          |
| `get_file_structure`  | Parse file structure: classes, functions, imports |
| `search_and_replace`  | Bulk find/replace across files                    |
| `get_lsp_diagnostics` | Get build errors/warnings for a file              |

**LSP Tools:**

The tools `find_definition`, `find_references`, and `get_hover` use a robust LSP backend that supports automatic workspace detection, monorepos, and single-server caching.

**Examples:**

```javascript
// 1. Find Definition (LSP)
// Returns file_path, line, and column.
find_definition({
  query: "UserService",
});

// 2. Find References (LSP)
// Uses the precise location from find_definition.
find_references({
  file_path: "src/services/user_service.ts",
  line: 45,
  column: 14,
});

// 3. Get Hover (LSP)
// Get types and documentation at a position.
get_hover({
  file_path: "src/services/user_service.ts",
  line: 45,
  column: 14,
});

// 4. Text Search (ripgrep)
// Fast, literal search.
search({
  query: "TODO:",
  path: "src",
});

// 5. Regex Search (ripgrep)
// Advanced pattern matching.
search({
  pattern: "class\\s+\\w+Controller",
  file_types: ["ts"],
});

// 6. With custom timeout (for large projects/slow LSPs like Rust)
find_definition({
  query: "MySymbol",
  timeout_ms: 60000,
});

// File structure analysis
get_file_structure({ file_path: "src/index.ts" });
get_file_structure({
  file_path: "src/services/auth.ts",
  include_private: true,
});

// LSP diagnostics (errors, warnings)
get_lsp_diagnostics({ file_path: "src/index.ts" });
get_lsp_diagnostics({ file_path: "src/index.ts", severity_filter: "error" });
```

---

## Tool Visibility by Agent Role

Tool visibility is controlled by the `tools.visibilityMode` config option (`"smart"` | `"manual"` | `"hybrid"`).

**Smart Mode** (default):

| Role                          | Available Tools                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main**                      | All tools except low-level: `search_files`, `git_log`, `git_status`, `web_search`, `fetch_url`                                                                                        |
| **Executor** (agentic_search) | Read-only: `search_files`, `read_file`, `list_files`, `search`, `get_file_structure`, `get_lsp_diagnostics`, `web_search`, `fetch_url`, `git_log`, `git_status` (no `agentic_search`) |
| **Subtask**                   | All except `run_subtask` (prevents recursion)                                                                                                                                         |

**Manual Mode**:

| Role                          | Available Tools                                  |
| ----------------------------- | ------------------------------------------------ |
| **Main**                      | All native + MCP tools                           |
| **Executor** (agentic_search) | All tools except `agentic_search` (no recursion) |
| **Subtask**                   | All except `run_subtask` (no recursion)          |

**Hybrid Mode**:

| Role                          | Available Tools                                  |
| ----------------------------- | ------------------------------------------------ |
| **Main**                      | All tools (both high-level and low-level search) |
| **Executor** (agentic_search) | Same as Smart mode                               |
| **Subtask**                   | All except `run_subtask` (no recursion)          |

---

## Skills & Tool Injection

Some tools are only available after loading a skill:

| Skill             | Injected Tool     | Purpose              |
| ----------------- | ----------------- | -------------------- |
| `semantic-search` | `agentic_search`  | Smart code search    |
| `ts-sandbox`      | `sandbox_ts`      | TypeScript sandbox   |
| `web-research`    | `sandbox_browser` | Browser automation   |
| `task-delegation` | `run_subtask`     | Sub-agent delegation |

**Preloading:**

Skills can be preloaded in config to make their tools immediately available:

```json
{
  "skills": {
    "preload": ["semantic-search", "task-delegation"]
  }
}
```

Or per-project in `.project_context.md`:

```markdown
---
load_skills:
  - ts-sandbox
  - semantic-search
---
```

---

## Tool Confirmation

Tools are categorized by their confirmation requirements:

**Auto-approved (whitelisted):**

- `read_file`, `list_files`, `search_files` (read-only)
- `git_log`, `git_status`, `git_diff`, `git_show` (git read operations)
- `sandbox_ts`, `sandbox_browser` (sandboxed)
- `agentic_search`, `web_search`, `fetch_url`, `read_skill` (safe)
- `run_cmd` (governed by command whitelist)
- `search`, `get_file_structure`, `get_lsp_diagnostics` (read-only)
- `patch`, `write_file` (have own diff review UI)
- `edit_lines` (has own diff review UI)

**Requires confirmation:**

- `delete_file`
- `git_command` (note: specific read operations like `git_log`, `git_status`, `git_diff`, `git_show` are whitelisted separately)
- Any tool not in whitelist

**Skill-based bypass:**

When a skill is active, tools listed in its `allowed-tools` field bypass confirmation prompts.

---

## Adding Custom Tools

### Via MCP Server

Add a new MCP server to your config:

```json
{
  "mcpServers": [
    {
      "name": "my-server",
      "type": "local",
      "command": "node",
      "args": ["path/to/server.js"]
    }
  ]
}
```

### Via Skill

Create a skill that documents how to use existing tools for a specific workflow:

```markdown
---
name: my-workflow
description: Custom workflow using existing tools
allowed-tools:
  - git_command
  - run_cmd
---

# My Workflow

Instructions for the LLM on how to combine tools...
```

The `allowed-tools` list:

- Injects tool definitions (for injectable tools: agentic_search, sandbox_ts, etc.)
- Bypasses confirmation prompts (for all listed tools)
- Enables skill script execution (when `run_cmd` is listed)

---

## Quick Reference

### File Operations

| Task           | Tool           | Example                                                                         |
| -------------- | -------------- | ------------------------------------------------------------------------------- |
| Read file      | `read_file`    | `read_file({ path: "src/index.ts" })`                                           |
| Read lines     | `read_file`    | `read_file({ path: "src/index.ts", start_line: 10, line_count: 20 })`           |
| List directory | `list_files`   | `list_files({ path: "src" })`                                                   |
| Find files     | `search_files` | `search_files({ pattern: "*.ts" })`                                             |
| Write file     | `write_file`   | `write_file({ path: "x.ts", content: "..." })`                                  |
| Apply patch    | `patch`        | `patch({ unified_diff: "..." })`                                                |
| Edit lines     | `edit_lines`   | `edit_lines({ file: "x.ts", start_line: 5, end_line: 10, replacement: [...] })` |

### Code Search

| Task            | Tool                 | Example                                                              |
| --------------- | -------------------- | -------------------------------------------------------------------- |
| Semantic search | `agentic_search`     | `agentic_search({ query: "auth handler" })`                          |
| Text search     | `search`             | `search({ query: "TODO" })`                                          |
| Find definition | `find_definition`    | `find_definition({ query: "UserService" })`                          |
| Find references | `find_references`    | `find_references({ file_path: "src/user.ts", line: 10, column: 5 })` |
| File outline    | `get_file_structure` | `get_file_structure({ file_path: "src/index.ts" })`                  |

### Git Operations

| Task                | Tool          | Example                                           |
| ------------------- | ------------- | ------------------------------------------------- |
| Status              | `git_command` | `git_command({ command: "status" })`              |
| Log                 | `git_command` | `git_command({ command: "log --oneline -10" })`   |
| Diff                | `git_command` | `git_command({ command: "diff" })`                |
| Show file at commit | `git_command` | `git_command({ command: "show HEAD:path/file" })` |

### Build & Test

| Task       | Tool                  | Example                                              |
| ---------- | --------------------- | ---------------------------------------------------- |
| Run tests  | `run_cmd`             | `run_cmd({ command: "npm test" })`                   |
| Build      | `run_cmd`             | `run_cmd({ command: "npm run build" })`              |
| Lint       | `run_cmd`             | `run_cmd({ command: "npm run lint" })`               |
| Get errors | `get_lsp_diagnostics` | `get_lsp_diagnostics({ file_path: "src/index.ts" })` |

### Sandbox Execution

| Task           | Tool              | Example                                                                       |
| -------------- | ----------------- | ----------------------------------------------------------------------------- |
| Run TypeScript | `sandbox_ts`      | `sandbox_ts({ cmd: "docker exec deft-ts-sandbox npx ts-node script.ts" })`    |
| Run Node       | `sandbox_ts`      | `sandbox_ts({ cmd: "docker exec deft-ts-sandbox node -e 'console.log(1)'" })` |
| Web search     | `sandbox_browser` | `sandbox_browser({ action: "search", query: "..." })`                         |
| Fetch page     | `sandbox_browser` | `sandbox_browser({ action: "fetch", url: "..." })`                            |
