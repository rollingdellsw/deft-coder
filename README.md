# Deft™ - The Programmer-Centric Coding Agent

_Your faithful tool to drive LLMs_

---

## Why Deft™?

> **10x LLM coding productivity with battle-tested patch mechanics**

Deft™ transforms how you work with AI-generated code. Instead of copy-pasting snippets and hoping they work, Deft™ applies LLM-generated unified diff patches with surgical precision.

### The Problem

Every LLM can generate code. But getting that code into your codebase? This is where most approaches fail:

- **Full rewrite is wasteful** - Rewriting 1000 lines just to change 10.
- **String replacement is fragile** - Multi-line changes compressed into single strings break easily (especially Python, where indentation is syntax). Splitting logical changes into pieces forces LLMs to track edit history - costly and error-prone.
- **Standard patch tools reject LLM output** - LLMs can't count line numbers accurately.

### The Solution

Deft™ works with what LLMs are trained to generate: **patches**. Content-based matching, self-healing hunks, and interactive review make AI-generated changes apply reliably.

---

## Key Innovations

### 1. **Patch Tool - Standard Diff Format**

LLMs are trained on millions of Git diffs. Deft™ speaks their native language.

```diff
--- a/src/auth.ts
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
 }
```

**Why it works:**

| Feature                    | Benefit                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| **Content-based matching** | Line numbers don't matter - hunks find their location by context       |
| **Self-healing**           | Failed hunks automatically repaired by LLM subtask                     |
| **Partial success**        | Good hunks apply even when others fail, clear error message for fixing |
| **Multi-file ops**         | Create, modify, delete files in one patch                              |

**Standalone CLI** — Apply patches from **ANY!** LLM (ChatGPT, Claude, Gemini), just ask: "give me a single standard unified diff mode patch", then apply it:

```bash
$ deft patch ./llm-suggestions.patch
```

→ [Installation](#installation)

LLM providers' web UIs typically deliver the best results for coding tasks. Combining that with this patch tool is the secret to your 10x productivity boost.

---

### 2. **Interactive Review - You Stay in Control**

Besides being a standalone CLI, Deft™ can also work within Neovim as a plugin. In both modes, it provides per-hunk interactive change review capability.

![Interactive Review Demo](docs/demo.gif "Deft Neovim Workflow")

When working with Neovim, select any code, press `<leader>ca`, ask questions or request changes, then review in the native diff view.

→ [Neovim Integration Guide](./docs/neovim-integration.md)

---

### 3. **Advanced LLM Agent Features**

#### 3.1. **Reminder System — Boost LLM Performance With Dynamic Context Injection**

Give an LLM a 1000-line system prompt and 100 MCP tools - it loses focus and ignores your intentions. Deft™'s Reminder Engine injects context-aware guidance exactly when needed.

→ [Full Reminder System Guide](./docs/reminder-system.md)

---

#### 3.2. **Programmable Guardrails — "Linter" for Agent Behavior**

While Reminders are "soft" suggestions, Guardrails are **"hard" rules**. You can define policy checks in JavaScript that run **before** (input) and **after** (output) tools execute.

The default guardrail config will reject 'patch' calls if the file content has changed, and automatically run build/test commands when a patch is applied (read ~/.config/deft/guardrails.js for details).

---

#### 3.3. **Skills System — Anthropic Claude Skills Spec Support**

Deft™ implements the [Anthropic Claude Skills specification](https://github.com/anthropics/skills), enabling dynamic capability loading with minimal context overhead.

→ [Full Skills System Guide](./docs/skills.md)

---

#### 3.4. **MCP for Tool Extension**

This agent supports adding existing MCP servers. Simply add an MCP server like [Chrome Devtool MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md) to the agent [configuration file](./configs/config.openai.json).

The tools from the newly added MCP server will not be visible to the LLM by default; they require a new [SKILL.md](https://github.com/rollingdellsw/deft-coder/blob/main/skills/chrome-devtools/SKILL.md) for the LLM to load them on-demand.

---

#### 3.5. **Faithful Full Cognitive Continuity**

This agent strictly follows providers' ([Gemini](https://ai.google.dev/gemini-api/docs/thought-signatures), [OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning-blocks), [Claude](https://platform.claude.com/docs/en/build-with-claude/extended-thinking#interleaved-thinking), [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)) official API documentation for [fully interleaved thinking](./docs/sample_session_interaction.json) behaviors, to preserve the complete "Reasoning Chain" across turns.

---

#### 3.6. **Stateful Cognitive Persistence & Branching**

The agent preserves LLM sessions to a state that can be faithfully restored from local session logs. This also allows the user to branch out any session from any intermediate user message — no **context compression**, no pruning. You manage the context when Deft™ warns that your context size limit is approaching.

---

## Configuration

### Installation

```bash
# Confirm you have Node.js >= 20 (v22 recommended)
$ node --version

# Clone and install globally
$ git clone https://github.com/rollingdellsw/deft-coder.git
$ npm install -g deft-coder/release/linux/deft-1.0.2.tgz

# Build the Docker image for the sandbox MCP server
$ docker build -t ts-sandbox deft-coder/mcp-server/sandbox-ts
```

```bash
# Deft CLI usage
$ deft --help
Usage: deft [command] [options]

Commands:
  patch <file>   Apply a LLM generated unified diff file directly

Options:
  --full-auto             Bypass all confirmations (auto-approve all changes)
  --stdin                 Read task from stdin and exit after completion
  --config <name>         Load a non-default model (e.g. deepseek, gemini, kimi, xai)
  --thinking-budget <lvl> Override thinking budget level
                          (xhigh, high, medium, low, minimal, none)
  --help, -h              Show this help message

# In-session commands:
  /save <n>, /s           Save current session with name
  /load [id], /l          Load session (interactive or by ID)
  /branch, /b             Branch from a selected message
  /config [list|switch]   List/switch model at runtime
  /attach <pattern>       Attach files (supports globs)
  /detach <pattern>       Detach files
  /list-attachments, /la  List attached files
  /exit, /quit, /q        Exit the application
```

### Minimal Setup (Patch-only)

No configuration needed for patch-only usage.

### For Full LLM functions

Using your API key or GCP Vertex AI token, run the tool from the CLI or launch it inside Neovim to select models from OpenRouter (default GLM 4.7, Kimi K2, DeepSeek v3.2, Grok 4 Fast), Vertex AI (Gemini), Anthropic (Claude), or OpenAI (GPT), mixing them in any arbitrary planner/executor combination.

```bash
# Add your API key (choose one)
export OPENROUTER_API_KEY="your_openrouter_api_key"
export GEMINI_API_KEY="your_gemini_api_key"
export GOOGLE_CLOUD_PROJECT="your_gcp_project"
export ANTHROPIC_API_KEY="your_anthropic_api_key"
export OPENAI_API_KEY="your_openai_api_key"
```

→ [Full Configuration Guide](./docs/configuration.md)

---

## Available Tools

### Core Tools (Always Available)

| Tool        | Purpose                               |
| ----------- | ------------------------------------- |
| **patch**   | Apply unified diffs with self-healing |
| **run_cmd** | Execute whitelisted project commands  |

### MCP Tools (Via Servers)

| Tool                    | Purpose                       |
| ----------------------- | ----------------------------- |
| **read_file**           | Read file contents            |
| **write_file**          | Write content to files        |
| **list_files**          | List directory contents       |
| **search_files**        | Find files by pattern         |
| **git_command**         | Git operations (push blocked) |
| **search_code**         | LSP + ripgrep code search     |
| **get_file_structure**  | Parse file structure          |
| **get_lsp_diagnostics** | Get build errors/warnings     |

### Skill-Injected Tools (On-Demand)

| Tool                | Skill Required  | Purpose                      |
| ------------------- | --------------- | ---------------------------- |
| **mgrep**           | semantic-search | AI-powered code search       |
| **sandbox_ts**      | ts-sandbox      | TypeScript execution sandbox |
| **sandbox_browser** | web-research    | Browser automation           |
| **run_subtask**     | task-delegation | Delegate tasks to sub-agent  |

Tools are loaded on-demand when a skill needs them.

→ [Tools Reference](./docs/tools.md)

---

## Security

- **Programmable Guardrails** - Hard guardrails for LLM behaviors
- **Path validation** - No directory traversal attacks
- **Git push blocked** - Prevents accidental remote changes
- **Command whitelist** - Shell commands require explicit approval
- **Sandbox isolation** - Code execution in Docker containers
- **Skill scripts** - Only run from within skill directories

---

## Licensing

Deft™ is proprietary software available under a dual-license model:

- **Personal Use (Free):** Free for personal projects, open-source contributions, and educational use.
- **Commercial Use (Paid):** A license is required for use in a business, corporate environment, or for paid professional work.

---

## Privacy & Data Ownership

**We do not collect any data.**

- **Zero "Home Phoning":** Deft™ does not send usage statistics, crash reports, or code snippets to us (the creators).
- **Local-Only Logs:** The built-in session log and telemetry system writes reports strictly to your local machine (`~/.local/deft/sessions/`) for your own performance analysis. It never uploads them.

### Direct-to-Provider LLM Traffic

When using AI features, Deft™ acts as a pure client to the LLM provider directly:

- **Direct Connection:** Your prompt and code context are sent **directly** from your machine to your configured LLM provider (e.g., OpenAI, Anthropic, OpenRouter).
- **No Middleman:** Your data never passes through our servers.
- **Your Keys, Your Rules:** You manage your own API keys.

---

## Documentation

| Document                                           | Description                         |
| -------------------------------------------------- | ----------------------------------- |
| [Reminder System](./docs/reminder-system.md)       | Configure dynamic context injection |
| [Guardrails System](./docs/guardrails_api.md)      | Configure tool execution guardrails |
| [Neovim Integration](./docs/neovim-integration.md) | Editor setup and workflows          |
| [Configuration](./docs/configuration.md)           | Full config reference               |
| [Skills System](./docs/skills.md)                  | Dynamic capability loading          |
| [Tools Reference](./docs/tools.md)                 | All available tools                 |

---
