---
name: project-discovery
description: Strategies for quickly understanding unfamiliar project structures
allowed-tools:
  - mgrep
  - list_files
  - read_file
  - search_code
  - get_file_structure
---

# Project Discovery

Use this skill when you lack context about the project structure, architecture, or conventions.

## Strategy 1: Documentation First

Check for existing docs before exploring code:

- `README.md` - Overview, setup, architecture
- `CONTRIBUTING.md` - Coding conventions
- `docs/` directory - Detailed documentation

Use `read_file` to read documentation files:

```
read_file({ path: "README.md" })
```

## Strategy 2: Stack Identification

Read config files to identify the technology stack:

- `package.json` - Node.js (scripts, dependencies, workspaces)
- `Cargo.toml` - Rust (workspace members, features)
- `pyproject.toml` / `setup.py` - Python
- `go.mod` - Go
- `docker-compose.yml` - Services and infrastructure

## Strategy 3: Structure Overview

Map top-level directories with `list_files`. Do not recursively list everything.

```
list_files({ path: "." })
list_files({ path: "src" })
```

## Strategy 4: Code Pattern Search

Use `mgrep` for semantic search across the codebase:

```
mgrep({ query: "authentication handler", scope: "src" })
```

Use `search_code` for LSP-based code search:

```
search_code({ query: "UserService", search_type: "definition" })
search_code({ query: "handleAuth", search_type: "references" })
```

Use `get_file_structure` to understand file organization:

```
get_file_structure({ file_path: "src/index.ts" })
```

## Strategy 5: Reading Specific Lines

To read specific portions of a file and save context, use `read_file` with line ranges:

```
read_file({ path: "src/index.ts", start_line: 10, line_count: 40 })
```
