# Deft Neovim Integration Guide

> Real-time LLM coding assistance with native diff review in your editor

This guide covers setting up and using Deft as a Neovim-integrated coding assistant.

---

## Quick Start

### 1. Confirm Installation

Ensure the plugin files exist in your Neovim configuration:

```bash
ls ~/.config/nvim/lua/deft/

```

### 2. Enable Plugin

Add the following to your `init.lua`:

```lua
require('deft').setup()

```

### 3. Start Using

- **Smart Toggle (`<leader>ca`)**:
- **Normal Mode**: Opens the Deft terminal. If open, it hides it (toggles visibility).
- **Visual Mode**: Takes selected code and opens the query prompt.
- **Terminal Mode**: Hides the Deft terminal (returns to your code).

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

**Workflow:**

1. **Chat**: Press `<leader>ca` to toggle the agent terminal. Ask questions like "How do I fix this?"
2. **Edit**: Select code, press `<leader>ca`. Type "Refactor this to use async/await."
3. **Review**: Deft proposes changes. A native Neovim Diff View opens.
4. **Decide**: Use `a` (Accept) or `r` (Reject) on specific changes.

---

## Configuration

### Full Configuration

```lua
require('deft').setup({
  -- Deft executable (use full path if not in PATH)
  deft_command = 'deft',

  -- Terminal split configuration
  split_position = 'vertical',  -- 'vertical' or 'horizontal'
  split_size = 80,              -- Initial width/height

  -- Keymaps
  keymaps = {
    code_query = '<leader>ca',  -- Smart toggle / Ask about selection
  },

  -- Visual selection hint (floating window)
  show_hint = false,            -- Show hint when entering visual mode
  hint_delay = 500,             -- Delay before showing hint (ms)

  -- Debug mode (verbose logging, default: false)
  debug = false,
})

```

---

## Keybindings

### Global Keymaps

| Mode   | Key          | Action                                   |
| ------ | ------------ | ---------------------------------------- |
| Visual | `<leader>ca` | Send selected code + instruction to Deft |
| Normal | `<leader>ca` | **Toggle** Deft terminal (Show/Hide)     |
| Term   | `<leader>ca` | **Toggle** Deft terminal (Hide)          |

### Terminal Keymaps

| Key     | Action                                    |
| ------- | ----------------------------------------- |
| `<C-o>` | Exit terminal focus, return to code       |
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

When Deft proposes changes via the `patch` tool:

1. **Diff View Opens**: The plugin temporarily hides your code windows to show a clean [Old] | [New] diff view alongside the Agent.
2. **Review**: Use `j`/`k` to navigate changes.
3. **Reject with Reason**: Pressing `r` opens a multi-line input box. You can explain _why_ you are rejecting it (e.g., "This introduces a security flaw"), and Deft will use that feedback to retry.
4. **Finish**: Press `<leader>d` to submit. Your code windows are restored exactly as they were.

**File Selector** (for multi-file patches):

```
╭─ Patch Review (3 files) ───────────────╮
│  ●  [2/3]  src/auth.ts                 │
│  ✓  [3/3]  src/utils.ts                │
│     [0/1]  tests/auth.test.ts          │
│                                        │
│  a:Accept r:Reject s:Submit q:Cancel   │
╰────────────────────────────────────────╯

```

---

## Commands

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `:DeftStart`  | Start Deft session                   |
| `:DeftStop`   | Stop Deft session and close terminal |
| `:DeftToggle` | Toggle terminal visibility           |
| `:DeftStatus` | Show connection status               |

---

## Troubleshooting

### "Deft exited with code 129"

This usually meant the process was killed when the window closed. The latest version fixes this by keeping the buffer alive in the background. If you see this, ensure you have updated `init.lua` to remove the `WinClosed` autocommand.

### "Command not found: deft"

The Deft executable isn't in PATH. Use the full path in your config:

```lua
require('deft').setup({ deft_command = '/home/user/bin/deft' })

```

### Diff View Layout Issues

If the windows look "cramped" or the wrong size, the plugin now uses `wincmd =` to naturally balance them based on your screen size. You can resize them manually during review; the plugin will not force them back until you reopen the view.
