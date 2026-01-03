import * as fs from "fs/promises";
import {
  ServerContext,
  ToolHandler,
  MCPToolResult,
  validatePath,
} from "../server.js";

/** Maximum output size for file reads (~8KB) */
const FILE_READ_MAX_OUTPUT_SIZE = 8192;

/**
 * Add line numbers to content (cat -n style)
 * Format: "     1\t<line content>"
 * Line numbers are right-aligned in a 6-character field
 */
function addLineNumbers(content: string, startLine: number = 1): string {
  const lines = content.split("\n");
  const totalLines = lines.length + startLine - 1;
  // Calculate width needed for line numbers
  const width = Math.max(6, String(totalLines).length);

  return lines
    .map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(width, " ");
      return `${lineNum}  ${line}`;
    })
    .join("\n");
}

/**
 * Truncate content with line-aware hint
 */
function truncateFileContent(
  content: string,
  maxSize: number = FILE_READ_MAX_OUTPUT_SIZE,
): string {
  if (content.length <= maxSize) {
    return content;
  }

  const lines = content.split("\n");
  const totalLines = lines.length;
  const truncatedBytes = content.length - maxSize;

  const hint = `Use start_line/line_count params. File has ${totalLines} lines.`;
  const truncateMsg = `\n\n[OUTPUT TRUNCATED: ${truncatedBytes} chars omitted. ${hint}]`;

  return content.slice(0, maxSize - truncateMsg.length) + truncateMsg;
}

export const readFileToolHandler: ToolHandler = {
  name: "read_file",
  description: "Read the contents of a file",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Single file path" },
      paths: {
        type: "array",
        items: { type: "string" },
        description:
          "List of file paths to read. If provided, overrides 'path'.",
      },
      start_line: {
        type: "number",
        description: "Start line number (1-based)",
      },
      line_count: { type: "number", description: "Number of lines to read" },
    },
  },
  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    // Normalize inputs to array
    let targets: string[] = [];
    if (Array.isArray(params["paths"])) {
      targets = params["paths"].filter(
        (p): p is string => typeof p === "string",
      );
    } else if (typeof params["path"] === "string") {
      targets = [params["path"]];
    }

    // IMPROVEMENT: Sanitize paths by removing leading colon (common agent hallucination)
    targets = targets.map((p) => {
      if (p.startsWith(":")) {
        return p.slice(1);
      }
      return p;
    });

    if (targets.length === 0) {
      return {
        content: [{ type: "text", text: "Error: No path or paths provided" }],
        isError: true,
      };
    }

    // If multiple files, return DISTINCT blocks for each file
    if (targets.length > 1) {
      const contentBlocks: Array<{ type: string; text: string }> = [];
      const errors: string[] = [];

      for (const filePath of targets) {
        const pathValidation = validatePath(filePath, context.workingDirectory);
        if (!pathValidation.valid) {
          errors.push(`Error reading ${filePath}: ${pathValidation.error}`);
          // Push error block to maintain 1-to-1 mapping if possible, or just skip
          continue;
        }
        try {
          if (!pathValidation.fullPath)
            throw new Error("Resolved path is invalid");

          let content = await fs.readFile(pathValidation.fullPath, "utf-8");
          // Apply truncation per file
          content = truncateFileContent(content);

          // Return raw content in its own block.
          // The ToolExecutor will map this back to the file path based on index.
          contentBlocks.push({ type: "text", text: content });
        } catch (error) {
          errors.push(`Error reading ${filePath}: ${(error as Error).message}`);
        }
      }

      // Append errors as a final text block if any occurred
      if (errors.length > 0) {
        contentBlocks.push({
          type: "text",
          text: `Errors encountered:\n${errors.join("\n")}`,
        });
      }

      return {
        content: contentBlocks,
        isError: contentBlocks.length === 0 && errors.length > 0,
      };
    }

    // ... Single file logic remains the same ...
    const filePath = targets[0];
    if (filePath === undefined) {
      return {
        content: [{ type: "text", text: "Error: No path provided" }],
        isError: true,
      };
    }
    const parsedStartLine = Number(params["start_line"]);
    const startLine = parsedStartLine > 0 ? parsedStartLine : 1;
    const parsedLineCount = Number(params["line_count"]);
    const lineCount = parsedLineCount > 0 ? parsedLineCount : undefined;

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

      const content = await fs.readFile(pathValidation.fullPath, "utf-8");

      // Handle pagination
      if (startLine > 1 || lineCount !== undefined) {
        const lines = content.split("\n");
        const totalLines = lines.length;

        if (startLine > totalLines) {
          return {
            content: [
              {
                type: "text",
                text: `Error: start_line ${startLine} exceeds file length (${totalLines} lines)`,
              },
            ],
            isError: true,
          };
        }

        const start = Math.max(0, startLine - 1);
        const end =
          typeof lineCount === "number" ? start + lineCount : undefined;
        const actualStartLine = start + 1; // Convert back to 1-based for display
        const subset = lines.slice(start, end);
        const endLine = start + subset.length;
        const hasMore = end !== undefined && end < totalLines;

        let text =
          `[Lines ${startLine}-${endLine} of ${totalLines}]\n` +
          subset.join("\n");
        // Add line numbers to the subset
        text =
          `[Lines ${startLine}-${endLine} of ${totalLines}]\n` +
          addLineNumbers(subset.join("\n"), actualStartLine);
        if (hasMore) {
          text += `\n[... ${totalLines - endLine} more lines. Use start_line=${endLine + 1} to continue ...]`;
        }
        return { content: [{ type: "text", text }] };
      }

      // Add line numbers to full file content
      const numberedContent = addLineNumbers(content);
      return {
        content: [{ type: "text", text: truncateFileContent(numberedContent) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error reading file: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
