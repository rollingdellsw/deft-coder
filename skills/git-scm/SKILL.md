---
name: git-scm
description: Manage source code control using Git
allowed-tools:
  - git_command
---

# Git Source Control

Use the `git_command` tool for version control operations.

## Constraints

- **Blocked**: `git push` is blocked for safety reasons.
- **Scope**: Operations are limited to the current working directory.

## Usage

Call git_command with the git subcommand (without the "git" prefix):

```javascript
git_command({ command: "status" });
git_command({ command: "log --oneline -10" });
git_command({ command: "show HEAD" });
```
