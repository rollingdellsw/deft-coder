import * as fs from "fs/promises";
import {
  ServerContext,
  ToolHandler,
  MCPToolResult,
  validatePath,
} from "../server.js";

/** Maximum output size for directory listings (~4KB) */
const LIST_MAX_OUTPUT_SIZE = 4096;

/**
 * Truncate directory listing with hint
 */
function truncateListOutput(
  output: string,
  totalItems: number,
  maxSize: number = LIST_MAX_OUTPUT_SIZE,
): string {
  if (output.length <= maxSize) {
    return output;
  }

  const truncatedBytes = output.length - maxSize;
  const hint = `Showing partial list. Use a more specific path to see subdirectories.`;
  const truncateMsg = `\n\n[OUTPUT TRUNCATED: ${truncatedBytes} chars, ${totalItems} total items. ${hint}]`;

  return output.slice(0, maxSize - truncateMsg.length) + truncateMsg;
}

export const listFilesToolHandler: ToolHandler = {
  name: "list_files",
  description: "List files in a directory",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Path to the directory relative to working directory (default: ".")',
      },
      includeHidden: {
        type: "boolean",
        description: "Include hidden files (starting with .)",
        default: false,
      },
    },
    required: [],
  },
  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    // Extract and validate parameters
    const dirPath =
      params["path"] !== undefined
        ? typeof params["path"] === "string"
          ? params["path"]
          : "."
        : ".";

    const includeHidden =
      params["includeHidden"] !== undefined
        ? typeof params["includeHidden"] === "boolean"
          ? params["includeHidden"]
          : false
        : false;

    // Validate path security
    const pathValidation = validatePath(dirPath, context.workingDirectory);
    if (!pathValidation.valid) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${pathValidation.error ?? "Invalid path"}`,
          },
        ],
        isError: true,
      };
    }

    try {
      if (pathValidation.fullPath === undefined) {
        throw new Error("Path validation succeeded but fullPath is undefined");
      }

      // Check if path is directory or file
      const stat = await fs.stat(pathValidation.fullPath);
      let fileInfos;

      if (stat.isDirectory()) {
        const files = await fs.readdir(pathValidation.fullPath, {
          withFileTypes: true,
        });

        // Filter and collect file information
        fileInfos = await Promise.all(
          files
            .filter((file) => includeHidden || !file.name.startsWith("."))
            .map(async (file) => {
              try {
                const stats = await fs.stat(
                  `${pathValidation.fullPath}/${file.name}`,
                );
                return {
                  name: file.name,
                  type: file.isDirectory() ? "directory" : "file",
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                };
              } catch {
                // If we can't stat, just return basic info
                return {
                  name: file.name,
                  type: file.isDirectory() ? "directory" : "file",
                };
              }
            }),
        );
      } else {
        // Handle single file case
        fileInfos = [
          {
            name: dirPath.split(/[/\\]/).pop() || dirPath,
            type: "file",
            size: stat.size,
            modified: stat.mtime.toISOString(),
          },
        ];
      }

      let formattedList = fileInfos
        .map(
          (f) =>
            `${f.type === "directory" ? "d" : "f"} ${f.name}${f.size !== undefined ? ` (${f.size} bytes)` : ""}`,
        )
        .join("\n");

      const header = `Files in ${dirPath} (${fileInfos.length} items):\n`;
      formattedList = truncateListOutput(
        header + formattedList,
        fileInfos.length,
      );

      return {
        content: [
          {
            type: "text",
            text: formattedList,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing files: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
