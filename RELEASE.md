# Release v1.0.5

- Split LSP based search_code into three separate tools, find_definition, find_references and get_hover.
- Merge search_text and search_regx into one search tool.
- Add edit_lines LLM tool.
- Fixed reminder injection for tool_call type.
- Fixed patch return message format for partial success cases.
- Add line number to `read_file` output.
- Add LSP based search for C/C++.

# Release v1.0.4

- Enable positional queries - definition, references, hover for LSP search_code
- Enable multiple LSP server support for monorepo workspaces.
- Fix path matching for stale context detection in guardrail.
- Enable ripgrep as backup strategy for search_code.
- Refine Neovim diff UI aesthetics.
- Refactor UI architecture to use stdout-based rendering (fixes flickering/performance).
- Fix session flickering during streaming via windowed rendering strategy.
- Fix /branch and /load commands synchronization and session directory handling.
- Refine LSP MCP server test scripts.
- Add maxSessionStorageMb configuration option.
- Add expand/collapse toggle for branch selector.
- Fix LSP workspace symbol search and language-aware project initialization.
- Enable reasoning parameter for OpenRouter based on thinking config.
- Enhance OpenAI debug logging for reasoning items.
- Allow listing available configurations via config option.
- Fix bug where thinking config was lost during LLM client reconfiguration (Claude).
- Fix Neovim plugin multi-file diff review logic (hunk tracking/rejection).
- Enable syntax highlighting for Neovim diff view.
- Fix UI focus issue: bring window to foreground on external query.
- Fix and validate IPC schema.
