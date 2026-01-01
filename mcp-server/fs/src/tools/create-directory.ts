import * as fs from "fs/promises";
import { ToolHandler, validatePath } from "../server.js";
import { printError, printDebug } from "../utils/log.js";

export const createDirectoryTool: ToolHandler = {
  name: "create_directory",
  description: "Create a directory (optionally with parent directories)",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Path to the directory to create (relative to working directory)",
      },
      recursive: {
        type: "boolean",
        description: "Create parent directories if they do not exist",
        default: false,
      },
    },
    required: ["path"],
  },
  handler: async (params, context) => {
    const { path: dirPath, recursive = false } = params as {
      path: string;
      recursive?: boolean;
    };

    printDebug(
      `[create_directory] Request to create: ${dirPath} (recursive: ${recursive})`,
    );

    const validation = validatePath(dirPath, context.workingDirectory);
    if (!validation.valid) {
      printError(`[create_directory] ✗ Validation failed: ${validation.error}`);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${validation.error}`,
          },
        ],
        isError: true,
      };
    }

    try {
      await fs.mkdir(validation.fullPath as string, { recursive });
      printDebug(`[create_directory] ✓ Successfully created: ${dirPath}`);
      return {
        content: [{ type: "text", text: `Created directory: ${dirPath}` }],
      };
    } catch (error) {
      printError(`[create_directory] Error: ${(error as Error).message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error creating directory: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
