# Configuration Guide

Deft uses a layered configuration system with sensible defaults.

---

## Quick Setup

### Patch-Only (No Config Needed)

```bash
deft patch ./changes.patch
```

Works out of the box. No API keys, no config files.

### Full Agent

#### Runtime Dependencies

The agent relies on a Docker image to run a sandboxed TypeScript environment. To use its full features, you need to install the Docker runtime (you can disable the sandbox MCP server in your config if you do not need this).

The agent also relies on ripgrep and LSP servers (install them for your selected language) to perform code searches. Please ensure they are installed on your system:

```bash
$ rg --version
ripgrep 13.0.0

$ typescript-language-server --version
5.1.3

$ rust-analyzer --version
rust-analyzer 1.91.0 (f8297e3 2025-10-28)

$ which gopls

```

### Setup sandbox_ts docker for Windows and Mac users

For **Windows and Mac** users, please setup the sandbox_ts docker (see README.md for how to build it) in a Linux instance (WSL2 for Windows or a remote Linux for Mac).

```bash
docker run -d --rm --name deft-ts-sandbox -p 127.0.0.1:3000:3000 ts-sandbox
```

Use a ssh tunnel to connect to it:

> **Note:** On Windows with WSL2, try `curl http://localhost:3000` first - the tunnel may not be needed if WSL2 networking is configured to forward ports automatically.

```
ssh -L 3000:localhost:3000 <your-wsl-user>@<WSL_IP>
```

Then set the SANDBOX_ENDPOINT environmental variable to let deft to connect:

```
# For Mac
export SANDBOX_ENDPOINT=http://localhost:3000
# For Windows
[Environment]::SetEnvironmentVariable("SANDBOX_ENDPOINT", "http://localhost:3000", "User")
```

### Setup environmental variable on Windows

```bash
[Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY", "your_openrouter_api_key", "User")
[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "your_gemini_api_key", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "your_anthropic_api_key", "User")
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "your_openai_api_key", "User")
[Environment]::SetEnvironmentVariable("DEFT_ALLOWED_COMMANDS", "npm test,npm run build,npm run lint,cargo build", "User")
```

#### Edit the default configuration

```bash
nvim -p ~/.config/deft/config.json
```

---

## Configuration Files

| File                                | Purpose                                            |
| ----------------------------------- | -------------------------------------------------- |
| `~/.config/deft/config.json`        | Main configuration                                 |
| `~/.config/deft/config.<name>.json` | Named config profiles (use with `--config <name>`) |
| `~/.config/deft/system_prompt.md`   | Custom system prompt                               |
| `~/.config/deft/reminders.json`     | Global reminder rules                              |
| `~/.config/deft/guardrails.js`      | Programmable guardrails                            |
| `${PWD}/.deft/reminders.json`       | Project reminder rules                             |

---

## Full Config Reference

> **Note:** All sections except `llm`, `mcpServers`, and `agent` are optional with sensible defaults.

```json
{
  "llm": {
    "provider": "openrouter | anthropic | gemini | openai",
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "anthropic/claude-sonnet-4-20250514",
    "baseUrl": "https://openrouter.ai/api/v1",
    "temperature": 0.7,
    "maxTokens": 4096,
    "topP": 0.9,
    "topK": 40,
    "contextWindow": 200000,
    "providerRouting": {
      "order": ["Anthropic", "Together"],
      "allowFallbacks": true,
      "sort": "price"
    },
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  },

  "executor": {
    "enabled": true,
    "model": "anthropic/claude-3-haiku",
    "maxTokens": 4096,
    "timeoutMs": 60000,
    "maxIterations": 10
  },

  "storage": {
    "maxSessionStorageMb": 100,
    "autoCleanupDays": 30
  },

  "mcpServers": [
    {
      "name": "filesystem",
      "type": "local",
      "command": "node",
      "args": ["mcp-server/fs/dist/index.js"]
    }
  ],

  "agent": {
    "workingDirectory": ".",
    "sessionDirectory": "${HOME}/.local/deft/sessions",
    "systemPrompt": "You are an expert software engineer...",
    "ipc": {
      "enabled": true
    },
    "editor": "${EDITOR:-vim}"
  },

  "tools": {
    "visibilityMode": "smart",
    "patch": {
      "autoHeal": true
    },
    "whitelist": ["read_file", "list_files", "search_files"]
  },

  "skills": {
    "sources": [
      { "type": "local", "location": "~/.config/deft/skills" },
      { "type": "local", "location": "./skills" }
    ],
    "preload": ["task-delegation", "code-navigation", "filesystem", "git-scm"]
  }
}
```

---

## Environment Variables

### Variable Expansion

Config values support environment variable expansion:

```json
{
  "llm": {
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "${DEFT_MODEL:-anthropic/claude-sonnet-4-20250514}"
  }
}
```

- `${VAR}` - Direct substitution (replaced at config load time)
- `${VAR:-default}` - With fallback value if variable is unset
- `${HOME}` - Expands to home directory

### Required Variables (Provider-Dependent)

| Variable               | Purpose                          |
| ---------------------- | -------------------------------- |
| `OPENROUTER_API_KEY`   | OpenRouter API authentication    |
| `ANTHROPIC_API_KEY`    | Anthropic API authentication     |
| `GEMINI_API_KEY`       | Google Gemini API authentication |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (for ADC auth)    |
| `OPENAI_API_KEY`       | OpenAI API authentication        |

### Optional Variables

| Variable                 | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `DEFT_ALLOWED_COMMANDS`  | Whitelist for `run_cmd` tool                                                       |
| `MAX_GENERATION_TIME_MS` | Override 5-minute timeout for LLM reasoning (default: 300000)                      |
| `DEFT_SUBTASK_THINKING`  | Set to "on" to enable thinking for subtasks (may not work for all thinking models) |
| `SANDBOX_ENDPOINT`       | Custom endpoint for sandbox MCP server (for Windows/Mac users)                     |

---

## LLM Providers

### OpenRouter (Multi-Provider Gateway)

Access to multiple models through one API:

```json
{
  "llm": {
    "provider": "openrouter",
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "anthropic/claude-sonnet-4-20250514",
    "baseUrl": "https://openrouter.ai/api/v1",
    "temperature": 0.7,
    "maxTokens": 32768
  }
}
```

**Available models via OpenRouter:**

- `anthropic/claude-sonnet-4-20250514`
- `deepseek/deepseek-v3.2`
- `moonshotai/kimi-k2-thinking`
- `x-ai/grok-4.1-fast`

### Anthropic (Direct)

Direct Anthropic API with native extended thinking support:

```json
{
  "llm": {
    "provider": "anthropic",
    "apiKey": "${ANTHROPIC_API_KEY}",
    "model": "claude-sonnet-4-5",
    "baseUrl": "https://api.anthropic.com",
    "contextWindow": 200000,
    "temperature": 1,
    "maxTokens": 64000,
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  }
}
```

**Supported models:**

- `claude-sonnet-4-5` / `claude-opus-4-5` / `claude-haiku-4-5`
- `claude-sonnet-4` / `claude-opus-4` / `claude-haiku-4`

### Google Gemini (API Key)

Direct Google Generative AI API:

```json
{
  "llm": {
    "provider": "gemini",
    "apiKey": "${GEMINI_API_KEY}",
    "model": "gemini-3-flash-preview",
    "baseUrl": "https://generativelanguage.googleapis.com",
    "temperature": 0.7,
    "maxTokens": 32768,
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  }
}
```

### Google Gemini (ADC - Your Own GCP Billing)

Use Gemini with your own GCP billing via Application Default Credentials. No API key required.

**Step 1: Setup ADC**

```bash
# Enable Vertex AI API in your GCP project
# Get client_secret.json from GCP Console > APIs & Services > Credentials

# Authenticate (run from a platform with browser, e.g., Windows host, not WSL2)
gcloud auth application-default login \
  --client-id-file=./client_secret.json \
  --scopes="https://www.googleapis.com/auth/cloud-platform"

# Verify credentials were created
cat ~/.config/gcloud/application_default_credentials.json

# Set your GCP project
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

**Step 2: Verify Setup**

```bash
# Test that ADC works (expected: "Hello!" or similar greeting)
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  -H "Content-Type: application/json" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Say hello"}]}]}' \
  | jq '.candidates[0].content.parts[0].text'
```

**Step 3: Configure Deft**

```json
{
  "llm": {
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "temperature": 0.7,
    "maxTokens": 32768,
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  }
}
```

> **Note:** When no `apiKey` is provided, Deft automatically uses ADC via the Vertex AI endpoint.

---

## Verified Provider Configurations

### DeepSeek V3

```json
{
  "llm": {
    "provider": "openrouter",
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "deepseek/deepseek-v3.2",
    "contextWindow": 128000,
    "baseUrl": "https://openrouter.ai/api/v1",
    "temperature": 0.0,
    "maxTokens": 32768,
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  }
}
```

### Kimi K2

```json
{
  "llm": {
    "provider": "openrouter",
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "moonshotai/kimi-k2-thinking",
    "contextWindow": 262144,
    "baseUrl": "https://openrouter.ai/api/v1",
    "temperature": 1.0,
    "maxTokens": 32768,
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  }
}
```

### xAI Grok

```json
{
  "llm": {
    "provider": "openrouter",
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "x-ai/grok-4.1-fast",
    "contextWindow": 512000,
    "baseUrl": "https://openrouter.ai/api/v1",
    "temperature": 0.7,
    "maxTokens": 32768,
    "thinking": {
      "enabled": true,
      "budgetLevel": "high",
      "fallbackToPrompt": true
    }
  }
}
```

---

## Storage Configuration

Control session storage limits and automatic cleanup:

```json
{
  "storage": {
    "maxSessionStorageMb": 100,
    "autoCleanupDays": 30
  }
}
```

| Option                | Default | Description                                     |
| --------------------- | ------- | ----------------------------------------------- |
| `maxSessionStorageMb` | `100`   | Maximum storage for sessions in MB              |
| `autoCleanupDays`     | -       | Automatically delete sessions older than N days |

---

## Provider Routing (OpenRouter)

When using OpenRouter, you can control which underlying providers handle your requests:

```json
{
  "llm": {
    "provider": "openrouter",
    "providerRouting": {
      "order": ["Anthropic", "Together"],
      "allowFallbacks": true,
      "sort": "price",
      "dataCollection": "deny",
      "ignore": ["ProviderToSkip"],
      "quantizations": ["fp16", "bf16"]
    }
  }
}
```

| Option           | Values                           | Description                                    |
| ---------------- | -------------------------------- | ---------------------------------------------- |
| `order`          | Array of provider names          | Prioritize specific providers in order         |
| `allowFallbacks` | `true/false`                     | Allow fallback to other providers on failure   |
| `sort`           | `price`, `throughput`, `latency` | Sort available providers by this metric        |
| `dataCollection` | `allow`, `deny`                  | Skip providers that may train on inputs        |
| `ignore`         | Array of provider names          | Explicitly skip these providers                |
| `quantizations`  | Array (e.g., `["fp16", "bf16"]`) | Only use providers with specific quantizations |

**Example: Enforce specific provider without fallbacks:**

```json
{
  "llm": {
    "providerRouting": {
      "order": ["Anthropic"],
      "allowFallbacks": false
    }
  }
}
```

> **Note:** If you set `sort` or `order`, OpenRouter disables automatic load balancing. See [OpenRouter Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection) for details.

---

## Thinking Configuration

Control LLM reasoning/thinking capabilities:

```json
{
  "thinking": {
    "enabled": true,
    "budgetLevel": "high",
    "fallbackToPrompt": true
  }
}
```

| Option             | Values                                              | Description                                           |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| `enabled`          | `true/false`                                        | Enable thinking mode                                  |
| `budgetLevel`      | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | Token budget for reasoning                            |
| `fallbackToPrompt` | `true/false`                                        | Use `<think>` blocks when native thinking unavailable |

There's a hard 5 minutes timeout for LLM reasoning time (reasoning without actionable output), you can set environmental variable MAX_GENERATION_TIME_MS to overwrite this default value.

Thinking for subtask and agentic_search are disabled by default. You can enable thinking for subtasks by setting the environment variable `DEFT_SUBTASK_THINKING` to `"on"`. Note that this setting may not work correctly with all thinking-enabled models.

---

## Tool Visibility Mode

Control how tools are exposed to the LLM:

```json
{
  "tools": {
    "visibilityMode": "smart"
  }
}
```

| Mode     | Description                                            |
| -------- | ------------------------------------------------------ |
| `smart`  | (Default) Dynamically show/hide tools based on context |
| `manual` | Only show tools explicitly enabled in config           |
| `hybrid` | Combination of smart detection with manual overrides   |

---

## Executor Configuration

The executor handles subtask delegation to a secondary LLM:

```json
{
  "executor": {
    "enabled": true,
    "provider": "openrouter",
    "apiKey": "${OPENROUTER_API_KEY}",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-3-haiku",
    "temperature": 0.7,
    "maxTokens": 4096,
    "topP": 0.9,
    "topK": 40,
    "timeoutMs": 60000,
    "maxIterations": 10,
    "thinking": {
      "enabled": false,
      "budgetLevel": "low"
    },
    "providerRouting": {
      "order": ["Anthropic"],
      "allowFallbacks": true
    }
  }
}
```

| Option            | Default | Description                                            |
| ----------------- | ------- | ------------------------------------------------------ |
| `enabled`         | `true`  | Enable/disable executor for subtasks                   |
| `provider`        | -       | Override LLM provider (inherits from main if not set)  |
| `apiKey`          | -       | Override API key (inherits from main if not set)       |
| `baseUrl`         | -       | Override base URL (inherits from main if not set)      |
| `model`           | -       | Model for executor (often a faster/cheaper model)      |
| `temperature`     | -       | Temperature for executor responses                     |
| `maxTokens`       | `4096`  | Maximum tokens for executor responses                  |
| `topP`            | -       | Top-p sampling parameter (type only, not in schema)    |
| `topK`            | -       | Top-k sampling parameter (type only, not in schema)    |
| `timeoutMs`       | `60000` | Timeout for executor calls in ms (recommended: 180000) |
| `maxIterations`   | `10`    | Maximum tool iterations per subtask                    |
| `thinking`        | -       | Thinking configuration for executor                    |
| `providerRouting` | -       | Provider routing (OpenRouter only)                     |

---

## MCP Servers

### Local Server

```json
{
  "name": "filesystem",
  "type": "local",
  "command": "node",
  "args": ["mcp-server/fs/dist/index.js"],
  "workingDirectory": ".",
  "env": {
    "WORKING_DIR": "."
  }
}
```

### Docker Server

```json
{
  "name": "sandbox",
  "type": "docker",
  "imageName": "ts-sandbox",
  "containerName": "deft-ts-sandbox",
  "portMapping": "3000:3000",
  "endpoint": "http://localhost:3000"
}
```

### Standard MCP Server Set

```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "type": "local",
      "command": "node",
      "args": ["mcp-server/fs/dist/index.js"],
      "workingDirectory": ".",
      "env": { "WORKING_DIR": "." }
    },
    {
      "name": "git",
      "type": "local",
      "command": "node",
      "args": ["mcp-server/git/dist/index.js"],
      "env": { "WORKING_DIR": "." }
    },
    {
      "name": "search",
      "type": "local",
      "command": "node",
      "args": ["mcp-server/search/dist/index.js"],
      "env": { "WORKING_DIR": "." }
    },
    {
      "name": "sandbox",
      "type": "docker",
      "imageName": "ts-sandbox",
      "containerName": "deft-ts-sandbox",
      "portMapping": "3000:3000",
      "endpoint": "http://localhost:3000"
    },
    {
      "name": "sandbox_browser",
      "type": "docker",
      "imageName": "ts-sandbox",
      "containerName": "deft-ts-sandbox",
      "portMapping": "3000:3000",
      "endpoint": "http://localhost:3000"
    },
    {
      "name": "chrome-devtools",
      "type": "local",
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--browserUrl=http://localhost:9222"
      ]
    }
  ]
}
```

---

## Tool Configuration

### Patch Tool

```json
{
  "tools": {
    "patch": {
      "autoHeal": true,
      "maxHealingAttempts": 10,
      "totalHealingTimeoutMs": 300000
    }
  }
}
```

### Tool Whitelist

Tools that execute without user confirmation:

```json
{
  "tools": {
    "whitelist": [
      "read_file",
      "list_files",
      "search_files",
      "find_definition",
      "find_references",
      "get_hover",
      "search",
      "get_file_structure",
      "get_lsp_diagnostics",
      "git_command",
      "sandbox_ts",
      "sandbox_browser",
      "agentic_search",
      "run_subtask",
      "run_cmd"
    ]
  }
}
```

### Command Whitelist

The `run_cmd` tool only executes whitelisted commands:

```bash
export DEFT_ALLOWED_COMMANDS="npm test,npm run build,npm run lint,cargo test"
```

---

## Skills Configuration

```json
{
  "skills": {
    "sources": [
      { "type": "local", "location": "~/.config/deft/skills" },
      { "type": "local", "location": "./skills" }
    ],
    "preload": ["task-delegation", "code-navigation", "filesystem", "git-scm"]
  }
}
```

- **sources**: Directories to search for skills
- **preload**: Skills loaded at startup (tools available without calling `read_skill`)

---

## System Prompt

### From Config

```json
{
  "agent": {
    "systemPrompt": "You are an expert software engineer..."
  }
}
```

### From File (Recommended)

Create `~/.config/deft/system_prompt.md`:

```markdown
# Coding Agent System Prompt

You are an expert coding agent. Implement production-ready solutions.

## Core Principles

- **Production-ready** - comprehensive error handling, input validation
- **Search before implementing** - understand existing patterns first
- **Verify changes** - run builds/tests after modifications
```

File takes precedence over config value.

---

## IPC (Editor Integration)

```json
{
  "agent": {
    "ipc": {
      "enabled": true
    },
    "editor": "${EDITOR:-vim}"
  }
}
```

See [Neovim Integration](./neovim-integration.md) for editor setup.

---

## Config Profiles

Use named config files for different providers:

```bash
# ~/.config/deft/config.claude.json
# ~/.config/deft/config.deepseek.json
# ~/.config/deft/config.gemini.json
# ~/.config/deft/config.gemini-adc.json
# ~/.config/deft/config.kimi.json
# ~/.config/deft/config.xai.json

# Run with specific profile
deft --config claude
deft --config deepseek
deft --config gemini-adc
```

---

## Bypassing Confirmation

Use `--full-auto` flag to skip all confirmations (use with caution):

```bash
deft --full-auto
```
