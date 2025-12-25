---
name: filesystem
description: Read, write, and manage files in the project
allowed-tools:
  - read_file
  - write_file
  - list_files
  - search_files
  - delete_file
  - create_directory
---

# Filesystem Operations

Direct file system access via MCP tools.

## Examples

```javascript
read_file({ path: "src/index.ts" });
read_file({ path: "src/index.ts", start_line: 10, line_count: 20 });
list_files({ path: "src" });
search_files({ pattern: "*.ts", path: "src" });
create_directory({ path: "src/utils", recursive: true });
```
