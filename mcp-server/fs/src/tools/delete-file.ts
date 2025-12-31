import * as fs from "fs/promises";
import { ToolHandler, validatePath } from "../server.js";
import { printError, printDebug } from "../utils/log.js";

export const deleteFileTool: ToolHandler = {
  name: "delete_file",
  description: "Delete a file from the file system",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Path to the file to delete (relative to working directory)",
      },
    },
    required: ["path"],
  },
  handler: async (params, context) => {
    const { path: filePath } = params as { path: string };

    printDebug(`[delete_file] Request to delete: ${filePath}`);

    const validation = validatePath(filePath, context.workingDirectory);
    if (!validation.valid) {
      printError(`[delete_file] ✗ Validation failed: ${validation.error}`);
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
      await fs.unlink(validation.fullPath as string);
      printDebug(`[delete_file] ✓ Successfully deleted: ${filePath}`);
      return {
        content: [{ type: "text", text: `Deleted file: ${filePath}` }],
      };
    } catch (error) {
      printError(`[delete_file] Error: ${(error as Error).message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error deleting file: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
