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

The agent also relies on ripgrep and LSP servers to perform code searches. Please ensure they are installed on your system:

```bash
$ rg --version
ripgrep 13.0.0
$ typescript-language-server --version
5.1.3
```

For **Windows and Mac** users, please comment out the sandbox_ts and sandbox_browser MCP servers in the configurations, as they depend on Docker to run.

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

```json
{
  "llm": {
    "provider": "openrouter | anthropic | gemini | openai",
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "anthropic/claude-sonnet-4-20250514",
    "baseUrl": "https://openrouter.ai/api/v1",
    "temperature": 0.7,
    "maxTokens": 4096,
    "contextWindow": 200000,
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

| Variable                | Purpose                      |
| ----------------------- | ---------------------------- |
| `DEFT_ALLOWED_COMMANDS` | Whitelist for `run_cmd` tool |

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

Thinking for subtask and mgrep are disabled by default, you can enable thinking for subtask by setting environmental variable DEFT_SUBTASK_THINKING to "on".

---

## MCP Servers

### Local Server

```json
{
  "name": "filesystem",
  "type": "local",
  "command": "node",
  "args": ["mcp-server/fs/dist/index.js"],
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
      "search_code",
      "get_file_structure",
      "get_lsp_diagnostics",
      "git",
      "sandbox_ts",
      "sandbox_browser",
      "mgrep",
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
