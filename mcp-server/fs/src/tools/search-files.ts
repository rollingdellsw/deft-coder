import * as fs from "fs/promises";
import * as path from "path";
import { ServerContext, ToolHandler, MCPToolResult } from "../server.js";

/** Maximum output size for file search results (~4KB) */
const SEARCH_FILES_MAX_OUTPUT_SIZE = 4096;

/**
 * Truncate file search output
 */
function truncateSearchFilesOutput(
  output: string,
  totalFiles: number,
  maxSize: number = SEARCH_FILES_MAX_OUTPUT_SIZE,
): string {
  if (output.length <= maxSize) {
    return output;
  }

  const truncatedBytes = output.length - maxSize;
  const hint = `Use a more specific glob pattern or add ignorePatterns.`;
  const truncateMsg = `\n\n[OUTPUT TRUNCATED: ${truncatedBytes} chars, ${totalFiles} total files. ${hint}]`;

  return output.slice(0, maxSize - truncateMsg.length) + truncateMsg;
}

async function walkDir(dir: string, baseDir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          results.push(...(await walkDir(fullPath, baseDir)));
        }
      } else {
        results.push(relativePath);
      }
    }
  } catch {
    // Ignore permission errors
  }
  return results;
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${regexPattern}$`).test(filePath);
}

export const searchFilesToolHandler: ToolHandler = {
  name: "search_files",
  description: "Search for files using a glob pattern",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          'Glob pattern to search for (e.g., "**/*.ts", "src/**/*.json")',
      },
      ignorePatterns: {
        type: "array",
        description: "Patterns to ignore (default: node_modules, .git)",
        items: { type: "string" },
      },
    },
    required: ["pattern"],
  },
  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    // Type guards
    if (typeof params["pattern"] !== "string") {
      return {
        content: [
          { type: "text", text: "Error: pattern parameter must be a string" },
        ],
        isError: true,
      };
    }

    const pattern = params["pattern"];
    const ignorePatterns =
      params["ignorePatterns"] !== undefined
        ? Array.isArray(params["ignorePatterns"])
          ? (params["ignorePatterns"] as string[])
          : ["**/node_modules/**", "**/.git/**"]
        : ["**/node_modules/**", "**/.git/**"];

    // Validate ignorePatterns are all strings
    if (!ignorePatterns.every((p) => typeof p === "string")) {
      return {
        content: [
          {
            type: "text",
            text: "Error: ignorePatterns must be an array of strings",
          },
        ],
        isError: true,
      };
    }

    try {
      const allFiles = await walkDir(
        context.workingDirectory,
        context.workingDirectory,
      );

      const safeFiles = allFiles.filter(
        (file) =>
          matchGlob(file, pattern) &&
          !ignorePatterns.some((ignore) => matchGlob(file, ignore)),
      );

      let fileList =
        safeFiles.length > 0 ? safeFiles.join("\n") : "No files found";

      const header = `Found ${safeFiles.length} file(s) matching "${pattern}":\n`;
      fileList = truncateSearchFilesOutput(header + fileList, safeFiles.length);

      return {
        content: [
          {
            type: "text",
            text: fileList,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching files: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
