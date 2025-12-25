---
name: ts-sandbox
description: Execute TypeScript code in an isolated environment for verification
license: MIT
allowed-tools:
  - sandbox_ts
---

# TypeScript Sandbox

Use the `sandbox_ts` tool to execute TypeScript code in an isolated Docker container. This is useful for:

- Verifying logical assumptions
- Testing small code snippets before implementing them in the main codebase
- Running mathematical or logical proofs (Curry-Howard Correspondence)

## Usage

Pass the shell command to execute inside the sandbox. The container has `node` and `ts-node` available.

### Examples

- Run a quick verification script:\*\*

```javascript
sandbox_ts({
  cmd: "node -e 'console.log(require(\"os\").cpus().length)'",
});
```

- Run a complex multi-step logical check:

```javascript
sandbox_ts({
  cmd: `echo "
    type IsString<T> = T extends string ? true : false;
    type Check = IsString<123>; // false
    console.log('Type check complete');
  " > test.ts && npx ts-node test.ts`,
});
```

### Constraints

- Isolation: The sandbox does not have access to the main project's file system unless files are explicitly created within the command.
- Timeout: Commands default to a 30-second timeout.
