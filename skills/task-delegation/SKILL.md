---
name: task-delegation
description: Delegate complex multi-step tasks to specialized sub-agents
license: MIT
allowed-tools:
  - run_subtask
---

# Task Delegation

Delegate self-contained subtasks to a specialized sub-agent. The sub-agent:

## When to Use

- Implementing a specific feature with clear success criteria
- Fixing a bug that can be verified with a test
- Any task that can run independently

## Usage

```javascript
run_subtask({
  goal: "Description of what to accomplish",
  verification_command: "npm test",
  context_files: ["src/relevant.ts"],
  timeoutMs: 300000,
});
```

## Examples

### Fix a failing test

```javascript
run_subtask({
  goal: "Fix the failing test in auth.test.ts - the token validation is returning false for valid tokens",
  verification_command: "npm test -- auth.test.ts",
  context_files: ["src/auth.ts", "tests/auth.test.ts"],
});
```
