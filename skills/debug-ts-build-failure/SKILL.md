---
name: debug-ts-build-failure
description: Debug TypeScript build failures using LSP diagnostics to identify and fix compilation errors.
license: MIT
allowed-tools:
  - get_lsp_diagnostics
  - read_file
  - run_cmd
---

# Debug TypeScript Build Failure

## When to Use

Use this skill when:

- `npm run build` or `tsc` fails with compilation errors
- You need to understand the exact location and cause of type errors

## Workflow

### Step 1: Identify Failed Files

After a build failure, identify which files have errors from the build output. Look for patterns like:

- `src/foo/bar.ts(42,10): error TS2345: ...`
- `error TS2307: Cannot find module '...'`

### Step 2: Get LSP Diagnostics

Use `get_lsp_diagnostics` to get precise error information:

```
get_lsp_diagnostics({
  file_path: "src/foo/bar.ts",
  severity_filter: "error"
})
```

This returns exact line/column positions and detailed error messages from the TypeScript language server.

### Step 3: Read Context Around Errors

Use `read_file` with line ranges to see the code context:

```
read_file({
  path: "src/foo/bar.ts",
  start_line: 35,
  line_count: 20
})
```

Or read the entire file if it's small:

```
read_file({ path: "src/foo/bar.ts" })
```

### Step 4: Fix and Verify

1. Apply fixes using `patch` tool
2. Re-run build to verify (if `npm run build` is in allowed commands):
   ```
   run_cmd({ command: "npm run build" })
   ```
3. If errors persist, repeat from Step 2

## Tips

- Start with `get_lsp_diagnostics` - it gives more precise info than build output
- Fix errors in dependency order (imported modules first)
- Check for missing type definitions (`@types/*` packages)
- Look for circular dependencies if you see strange resolution errors
