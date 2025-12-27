# Deft Neovim Integration Guide

> Real-time LLM coding assistance with native diff review in your editor

This guide covers setting up and using Deft as a Neovim-integrated coding assistant.

---

## Quick Start

### 1. Confirm it's installed by npm install:

```bash
ls ~/.config/nvim/lua/deft/
```

### 2. Confirm it's enabled by npm install:

cat `~/.config/nvim/init.lua`:

```lua
require('deft').setup()
```

### 3. Start Using

- **Visual mode**: Select code → `<leader>ca` → Enter your instruction
- **Normal mode**: `<leader>ca` → Opens/focuses Deft terminal

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         Neovim                                  │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Your Code  │  │ Diff Viewer  │  │ Deft Terminal (right)  │   │
│  │            │  │              │  │                        │   │
│  │ Select code│  │ Old   │  New │  │ LLM responses here     │   │
│  │ + <leader>ca─►│       │      │◄─│ Patches sent for       │   │
│  │            │  │       │      │  │ review via IPC         │   │
│  └────────────┘  └──────────────┘  └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                          TCP Socket
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Deft Agent                             │
│  Processes queries, calls LLM, generates patches                │
└─────────────────────────────────────────────────────────────────┘
```

**Communication Flow:**

1. Select code in Neovim, press `<leader>ca`, enter instruction
2. Plugin sends context (selected code + full file) to Deft via IPC
3. Deft processes with LLM, generates patches
4. Patches appear in native Neovim diff view for review
5. Accept (`a`) or reject (`r`) each hunk
6. Confirmed changes are applied to files

---

## Configuration

### Minimal Setup

```lua
require('deft').setup()
```

### Full Configuration

```lua
require('deft').setup({
  -- Deft executable (use full path if not in PATH)
  deft_command = 'deft',

  -- Terminal split configuration
  split_position = 'vertical',  -- 'vertical' or 'horizontal'
  split_size = 80,              -- Width (vertical) or height (horizontal)

  -- Keymaps
  keymaps = {
    code_query = '<leader>ca',  -- Ask about selected code
  },

  -- Visual selection hint (floating window)
  show_hint = false,            -- Show hint when entering visual mode
  hint_delay = 500,             -- Delay before showing hint (ms)

  -- Auto-hide terminal when focus leaves (default: true)
  auto_hide = true,             -- Terminal auto-hides when you switch to code

  -- Debug mode (verbose logging, default: false)
  debug = false,
})
```

### Debug Mode

Enable to troubleshoot issues:

```lua
require('deft').setup({
  debug = true,
})
```

This will:

- Log IPC messages to `:messages`
- Run Deft with `--verbose` flag
- Show socket connection details

---

## Keybindings

### Global Keymaps

| Mode   | Key          | Action                                   |
| ------ | ------------ | ---------------------------------------- |
| Visual | `<leader>ca` | Send selected code + instruction to Deft |
| Normal | `<leader>ca` | Start Deft or focus terminal             |

### Terminal Keymaps

| Key     | Action                                    |
| ------- | ----------------------------------------- |
| `<C-o>` | Exit terminal, return to code window      |
| `<Esc>` | Send ESC to Deft (for its internal modes) |

### Diff Review Keymaps

| Key          | Action                                   |
| ------------ | ---------------------------------------- |
| `a`          | Accept current hunk                      |
| `r`          | Reject current hunk (prompts for reason) |
| `j` / `↓`    | Next hunk in file                        |
| `k` / `↑`    | Previous hunk in file                    |
| `<leader>sf` | Open file selector (multi-file patches)  |
| `<leader>d`  | Submit review (done)                     |
| `<leader>r`  | Reject all remaining changes             |

---

## Diff Review Workflow

When Deft proposes changes via the `patch` or `write_file` tool:

1. **Diff View Opens**: Side-by-side comparison (old left, new right)
2. **Navigate Hunks**: Use `j`/`k` to move between changes
3. **Review Each Hunk**:
   - Press `a` to accept
   - Press `r` to reject (optionally provide reason)
4. **Multi-file Patches**: Use `<leader>sf` to switch files
5. **Submit**: Press `<leader>d` when done reviewing

**File Selector** (for multi-file patches):

```
╔═══════════════════════════════════════════════════════════╗
║  Select File to Review                              [3/5] ║
╠═══════════════════════════════════════════════════════════╣

 ●  [2/3]  src/auth.ts
 ✓  [3/3]  src/utils.ts
    [0/1]  tests/auth.test.ts

╠═══════════════════════════════════════════════════════════╣
║  ↑/↓ Navigate  Enter Select  ESC Cancel                   ║
╚═══════════════════════════════════════════════════════════╝
```

- `●` = Current file
- `✓` = All hunks reviewed
- `[n/m]` = Reviewed/total hunks

---

## Commands

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `:DeftStart`  | Start Deft session in terminal split |
| `:DeftStop`   | Stop Deft session                    |
| `:DeftShow`   | Show hidden terminal                 |
| `:DeftToggle` | Toggle terminal visibility           |
| `:DeftStatus` | Show connection status               |

---

## Usage Examples

### Ask About Code

1. Select code in visual mode
2. Press `<leader>ca`
3. Type: "Explain this function"
4. Deft responds in terminal

### Request Changes

1. Select code in visual mode
2. Press `<leader>ca`
3. Type: "Add input validation here"
4. Review proposed changes in diff view
5. Accept or reject each hunk

### Quick Chat (No Selection)

1. Press `<leader>ca` in normal mode
2. Terminal opens/focuses
3. Type directly to Deft

---

## Troubleshooting

### "Command not found: deft"

The Deft executable isn't in PATH.

**Solution**: Use full path in config (get from 'which deft'):

```lua
require('deft').setup({
  deft_command = '/usr/local/bin/deft',
})
```

### "Failed to connect to Deft"

IPC connection failed.

**Possible causes:**

- Deft didn't start properly
- IPC not enabled in Deft config

**Solutions:**

1. Check Deft output:

```vim
:messages
```

2. Verify IPC is enabled in `~/.config/deft/config.json`:

```json
{
  "agent": {
    "ipc": { "enabled": true }
  }
}
```

3. Enable debug mode:

```lua
require('deft').setup({ debug = true })
```

### Terminal Appears in Wrong Position

**Solution**: Adjust split configuration:

```lua
require('deft').setup({
  split_position = 'vertical',  -- or 'horizontal'
  split_size = 100,             -- Adjust width/height
})
```

### Diff View Layout Issues

If diff windows appear with unequal sizes, this is usually resolved automatically. If issues persist:

1. Close the diff view
2. Use `:DeftToggle` to hide/show terminal
3. Retry the operation

### ESC Key Not Working in Terminal

The plugin remaps ESC to pass through to Deft. To exit terminal mode:

- Use `<C-o>` (Ctrl+O) to return to code window
- Use `<C-\><C-n>` for standard Neovim terminal escape

---

## Plugin Architecture

### File Structure

```
~/.config/nvim/lua/deft/
├── init.lua      # Main plugin entry, setup, commands
├── ipc.lua       # TCP socket communication with Deft
├── diff.lua      # Diff viewer and review UI
├── query.lua     # Code selection and query formatting
└── hint.lua      # Visual mode floating hint
```

### IPC Protocol

Communication uses newline-delimited JSON over TCP:

**Messages from Neovim → Deft:**

- `code_query`: Send code context and user instruction
- `confirmation_response`: Accept/reject patch hunks

**Messages from Deft → Neovim:**

- `show_diff`: Display diff for review

See `ipc_schema.json` for full message schemas.

---

## Requirements

- **Neovim** ≥ 0.8.0
- **Deft** installed and configured

---

## Tips

### Efficient Review Workflow

1. Review multi-file patches file-by-file using `<leader>sf`
2. Use `a` to quickly accept obvious changes
3. Use `r` with detailed reasons for rejections - these are sent back to the LLM

### Terminal Management

- Terminal auto-hides when you switch to code (with `auto_hide = true`)
- Use `<leader>ca` in normal mode to quickly re-show it
- `:DeftToggle` works from any window

### Combining with Deft Commands

In the Deft terminal, you can use:

- `/attach <file>` to add context
- `/save` to checkpoint your session
- `/branch` to try alternative approaches
