# Deft Skills System

> Implementation of the [Anthropic Claude Skills specification](https://github.com/anthropics/skills)

Skills are capability packages that allow dynamic loading of tool instructions and tool definitions into the LLM context. They solve the context explosion problem by deferring full instruction loading until the LLM actually needs a capability.

## Problem Statement

Traditional approach:

```
17 tools × (name + description + parameters) = massive context overhead
```

Skills approach:

```
3 core tools (patch, run_cmd, read_skill) = minimal context
+ skill summaries (name + 1-line description)
→ LLM reads full SKILL.md only when needed
→ Tool definitions injected on-demand
```

This approach aligns with Anthropic's "progressive disclosure" architecture for Skills.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    System Prompt (lightweight)                  │
│                                                                 │
│  Core Tools: patch, run_cmd, read_skill                         │
│  MCP Tools: read_file, list_files, git_command, ...             │
│                                                                 │
│  <available_skills>                                             │
│    - semantic-search: Smart multi-file code search              │
│    - ts-sandbox: Execute TypeScript in isolated environment     │
│    - task-delegation: Delegate complex tasks to sub-agents      │
│  </available_skills>                                            │
│                                                                 │
│  Use read_skill(name) to load a skill when needed.              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ LLM decides it needs a skill
┌─────────────────────────────────────────────────────────────────┐
│  LLM calls: read_skill({ name: "semantic-search" })             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Agent resolves and injects
┌─────────────────────────────────────────────────────────────────┐
│  SkillLoader:                                                   │
│    1. Load SKILL.md from ~/.config/deft/skills/semantic-search/ │
│    2. Parse allowed-tools: [agentic_search]                     │
│    3. Inject agentic_search tool definition into LLM context    │
│    4. Return skill instructions to LLM                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ LLM now has the tool available
┌──────────────────────────────────────────────────────────────────────────┐
│  LLM can now call: agentic_search({ query: "ToolExecutor", scope: "src"})│
└──────────────────────────────────────────────────────────────────────────┘
```

### Try It Out

Use the test prompts below to see how skills work under Deft.

---

#### 1. Semantic Search (agentic_search)

**Precondition**: Confirm a test symbol (e.g., `ToolExecutor`) exists under PWD.

```
use skill semantic-search to find where <YOUR_SYMBOL> is defined
```

**Expect:** Skill loads, then agentic_search search results

---

#### 2. TypeScript Sandbox

```
use skill ts-sandbox to verify that 2 + 2 equals 4 using node
```

**Expect:** Skill loads, sandbox executes `node -e "console.log(2+2)"`, returns 4

---

#### 3. Web Research

```
use skill web-research to search for "rust async cancellation safety mitigation methods"
```

**Expect:** Skill loads, DuckDuckGo search results

---

#### 4. Code Navigation (LSP)

```
use skill code-navigation to find the definition of <YOUR_SYMBOL> class
```

**Expect:** Skill loads, `search_*` group tools finds class definition with LSP accuracy

---

#### 5. Git Operations

```
use skill git-scm to show the last 3 commits
```

**Expect:** Skill loads, git log output without confirmation prompt

---

#### 6. Chrome DevTool

**Precondition**: Set up Chrome DevTools MCP following the official docs. Confirm you can access the Chrome instance:

```
$ curl http://localhost:9222/json/version
{
   "Browser": "Chrome/143.0.7499.42",
   "Protocol-Version": "1.3",
   "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
   "V8-Version": "14.3.127.16",
   "WebKit-Version": "537.36 (@24bdc8c48a0c8c2cd7780deb48bd92b9ed57a490)",
   "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/ea258088-955e-4459-86d8-287ae8384238"
}
```

Then run:

```
use skill chrome-devtools to navigate to https://example.com and run document.title using evaluate_script
```

**Expect:** Skill loads, Chrome navigates to example.com, outputs `document.title: "Example Domain"`

---

## Two Types of Skills

### 1. Tool-Injecting Skills

These skills provide **new tool definitions** that become available after loading:

| Skill             | Injected Tool     | Purpose                              |
| ----------------- | ----------------- | ------------------------------------ |
| `semantic-search` | `agentic_search`  | AI-powered multi-file code search    |
| `ts-sandbox`      | `sandbox_ts`      | Execute TypeScript in Docker sandbox |
| `web-research`    | `sandbox_browser` | Browser automation for web search    |
| `task-delegation` | `run_subtask`     | Delegate work to sub-agents          |

### 2. Instruction-Only Skills

These skills provide **usage instructions** for tools that are already available via MCP servers:

| Skill               | MCP Tools Used                                                                                          | Purpose                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| `code-navigation`   | `find_definition`, `get_references`, `get_hover`, `search`, `get_file_structure`, `get_lsp_diagnostics` | LSP-based code analysis |
| `git-scm`           | `git_command`                                                                                           | Git operations          |
| `filesystem`        | `read_file`, `write_file`, `list_files`                                                                 | File operations         |
| `project-discovery` | `read_file`, `list_files`, `get_references`, `get_hover`, `search`                                      | Project exploration     |

> **Note:** MCP tools are always available in the LLM's tool list. Instruction-only skills teach the LLM how to use them effectively for specific workflows.

## SKILL.md Format

Skills follow the [Claude Skills Spec](https://github.com/anthropics/skills). Each skill is a directory containing a `SKILL.md` file:

```
my-skill/
  SKILL.md
  scripts/        # Optional supporting scripts
  examples/       # Optional examples
```

### SKILL.md Structure

```markdown
---
name: my-skill
description: One-line description shown in available_skills list
license: MIT
allowed-tools:
  - agentic_search
  - sandbox_ts
metadata:
  author: your-name
  version: 1.0.0
version: 1.0.0
---

# My Skill

Detailed instructions for the LLM on how to use this capability.

## Usage

Explain how to call the tools with specific parameters.

## Examples

Provide concrete examples the LLM can follow.
```

### Required Fields

| Field         | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `name`        | Skill identifier (should match directory name for clarity) |
| `description` | One-line description for the skill index                   |

### Optional Fields

| Field           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `license`       | License for the skill                                                 |
| `version`       | Skill version (semver recommended)                                    |
| `allowed-tools` | Tools this skill uses - **injectable tools are added to LLM context** |
| `metadata`      | Additional key-value metadata (e.g., `author`, custom fields)         |

### Injectable Tools

The following built-in tools are injected when listed in `allowed-tools`:

- `agentic_search` - Smart multi-file search
- `run_subtask` - Sub-agent delegation
- `sandbox_ts` - TypeScript sandbox
- `sandbox_browser` - Browser automation

Additionally, any MCP tool listed in `allowed-tools` will also be injected if its definition is available from the MCP server manager.

Other tools (like MCP tools) listed in `allowed-tools` are informational and enable:

- Confirmation bypass for those tools
- Documentation of skill dependencies

### Skill Scripts

Skills can include shell scripts in a `scripts/` subdirectory. When a skill with `run_cmd` in its `allowed-tools` is active, relative script paths are automatically resolved:

```markdown
---
name: my-workflow
allowed-tools:
  - run_cmd
---

# My Workflow

Run the initialization script:
```

run_cmd({ command: "scripts/init.sh" })

```

```

The agent resolves `scripts/init.sh` to the skill's directory (e.g., `~/.config/deft/skills/my-workflow/scripts/init.sh`) and executes it without requiring the script to be in the global whitelist.

## Configuration

Add skill sources to `~/.config/deft/config.json`:

```json
{
  "skills": {
    "sources": [
      { "type": "local", "location": "~/.config/deft/skills" },
      { "type": "local", "location": "./skills" },
      {
        "type": "remote",
        "location": "https://skills.mycompany.com",
        "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
      }
    ]
  }
}
```

> **Note:** For remote skills, `publicKey` is optional. If provided, ECDSA P-256 signature verification is enforced. If omitted, remote skills are loaded without verification (use only for trusted sources).

### Default Sources

If no sources are configured, Deft uses:

- `~/.config/deft/skills/` - User skills
- `./skills/` - Project-local skills

### Preloading Skills

Skills can be preloaded to make their tools immediately available without calling `read_skill`:

```json
{
  "skills": {
    "preload": ["semantic-search", "task-delegation"]
  }
}
```

You can also preload skills per-project using `.project_context.md`:

```markdown
---
load_skills:
  - debug-ts-build-failure
  - ts-sandbox
---
```

## Built-in Skills

Deft ships with these skills in `packages/deft/skills/`:

### semantic-search

Smart multi-file code search using AI.

```markdown
---
name: semantic-search
description: Smart multi-file code search with semantic understanding
allowed-tools:
  - agentic_search
---
```

**Injects:** `agentic_search` tool

### ts-sandbox

Execute TypeScript in an isolated Docker environment.

```markdown
---
name: ts-sandbox
description: Execute TypeScript code in isolated Docker sandbox
allowed-tools:
  - sandbox_ts
---
```

**Injects:** `sandbox_ts` tool

### web-research

Search the web and fetch page content.

```markdown
---
name: web-research
description: Search the web and extract content using browser sandbox
allowed-tools:
  - sandbox_browser
---
```

**Injects:** `sandbox_browser` tool

### task-delegation

Delegate complex multi-step tasks to sub-agents.

```markdown
---
name: task-delegation
description: Delegate complex tasks to specialized sub-agents
allowed-tools:
  - run_subtask
---
```

**Injects:** `run_subtask` tool

### debug-ts-build-failure

Debug TypeScript build failures using LSP diagnostics.

```markdown
---
name: debug-ts-build-failure
description: Debug TypeScript build failures using LSP diagnostics
allowed-tools:
  - get_lsp_diagnostics
  - read_file
  - run_cmd
---
```

**Uses MCP tools:** `get_lsp_diagnostics`, `read_file` (instruction-only, no injection)

### project-discovery

Strategies for quickly understanding unfamiliar projects.

```markdown
---
name: project-discovery
description: Strategies for quickly understanding unfamiliar project structures
allowed-tools:
  - agentic_search
  - list_files
  - read_file
  - search
---
```

**Injects:** `agentic_search` tool

### code-navigation

LSP-based code analysis and navigation.

```markdown
---
name: code-navigation
description: LSP-based code analysis and navigation
allowed-tools:
  - search
  - get_file_structure
  - get_lsp_diagnostics
---
```

**Uses MCP tools:** `search`, `get_file_structure`, `get_lsp_diagnostics` (instruction-only)

### git-scm

Git version control operations.

```markdown
---
name: git-scm
description: Git version control operations
allowed-tools:
  - git_command
---
```

**Uses MCP tools:** `git_command` (instruction-only)

### filesystem

File system operations.

```markdown
---
name: filesystem
description: File system read/write operations
allowed-tools:
  - read_file
  - write_file
  - list_files
---
```

**Uses MCP tools:** `read_file`, `write_file`, `list_files` (instruction-only)

## Architecture

### Tool Injection Flow

```
read_skill({ name: "semantic-search" })
    │
    ▼
SkillLoader.resolve()
    │
    ├── Load SKILL.md content
    ├── Parse frontmatter (allowed-tools: [agentic_search])
    ├── Look up agentic_search in INJECTABLE_TOOLS map
    └── Return Skill { content, toolDefinitions: [AgenticSearchToolDefinition] }
    │
    ▼
ToolExecutor.onToolInjection callback
    │
    ├── Register skill path for script resolution
    └── Add allowed-tools to confirmation bypass list
    │
    ▼
LLMConversation.injectToolsFromSkill()
    │
    ▼
Next LLM request includes agentic_search in tools array
```

### Package Structure

```
@deft/core/skills/
├── types.ts          # ISkillResolver, SkillMetadata, Skill
├── skill-parser.ts   # YAML frontmatter parser
├── definitions.ts    # READ_SKILL_TOOL_DEFINITION
└── index.ts          # Exports

@deft/node/skills/
├── skill-loader.ts   # SkillLoader + INJECTABLE_TOOLS map
├── signature.ts      # ECDSA P-256 verification
└── index.ts          # Exports
```

### Key Types

```typescript
interface Skill {
  metadata: SkillMetadata;
  content: string;
  source: "local" | "remote";
  basePath: string; // Absolute path to skill directory (for script resolution)
  toolDefinitions?: LLMToolDefinition[]; // Injected tools
}

// In skill-loader.ts
const INJECTABLE_TOOLS: Record<string, LLMToolDefinition> = {
  agentic_search: AgenticSearchToolDefinition,
  run_subtask: RunSubtaskToolDefinition,
  sandbox_ts: SANDBOX_TS_TOOL_DEFINITION,
  sandbox_browser: SANDBOX_BROWSER_TOOL_DEFINITION,
};
```

### Full Type Definitions

```typescript
/**
 * Skill metadata parsed from YAML frontmatter
 */
interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  version?: string;
  metadata?: Record<string, string>;
}

/**
 * Lightweight index entry for system prompt injection
 */
interface SkillIndexEntry {
  name: string;
  description: string;
}

/**
 * Skill source configuration
 */
interface SkillSourceConfig {
  type: "local" | "remote";
  location: string; // Directory path or base URL
  publicKey?: string; // For remote signature verification (ECDSA P-256)
}

/**
 * Platform-agnostic skill resolver interface
 */
interface ISkillResolver {
  buildIndex(): Promise<SkillIndexEntry[]>;
  resolve(name: string): Promise<Skill>;
  exists(name: string): Promise<boolean>;
  refresh?(): Promise<void>;
}
```

## Security

### Local Skills

Local skills are trusted by default, consistent with the Anthropic spec.

### Skill Scripts

When a skill is loaded that has `run_cmd` in its `allowed-tools`, scripts within that skill's directory can be executed without being in the global command whitelist. This allows skills to bundle their own automation scripts.

Script resolution rules:

- `scripts/foo.sh` → `${skillPath}/scripts/foo.sh`
- `./run.sh` → `${skillPath}/run.sh`

### Remote Skills

Remote skills support ECDSA P-256 signature verification:

1. Server signs `SKILL.md` content with private key
2. Signature stored in `SKILL.md.sig` (base64 encoded)
3. Client verifies using public key from config

## References

- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Agent Skills Announcement](https://www.anthropic.com/news/skills)
- [Skills Engineering Deep Dive](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
