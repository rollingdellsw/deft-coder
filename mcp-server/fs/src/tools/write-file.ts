import * as fs from "fs/promises";
import * as path from "path";
import {
  ServerContext,
  ToolHandler,
  MCPToolResult,
  validatePath,
} from "../server.js";

export const writeFileToolHandler: ToolHandler = {
  name: "write_file",
  description: "Write content to a file",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file relative to working directory",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    // Type guards
    if (
      typeof params["path"] !== "string" ||
      typeof params["content"] !== "string"
    ) {
      return {
        content: [
          {
            type: "text",
            text: "Error: path and content parameters must be strings",
          },
        ],
        isError: true,
      };
    }

    let filePath = params["path"];
    // IMPROVEMENT: Sanitize paths by removing leading colon (common agent hallucination)
    if (filePath.startsWith(":")) {
      filePath = filePath.slice(1);
    }

    const content = params["content"];

    // Validate path security
    const pathValidation = validatePath(filePath, context.workingDirectory);
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

      // Create parent directory if it doesn't exist
      const dir = path.dirname(pathValidation.fullPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(pathValidation.fullPath, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote to ${filePath}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error writing file: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
