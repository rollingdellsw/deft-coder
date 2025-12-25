import { execSync } from "child_process";
import { ToolHandler, MCPToolResult, ServerContext } from "../server.js";
import { printDebug } from "../utils/log.js";

/**
 * Output size limit for git commands (~6KB)
 */
const GIT_MAX_OUTPUT_SIZE = 6144;

/** Commands where we should keep the tail (recent output) */
const TAIL_COMMANDS = ["log", "reflog", "stash"];

/**
 * List of blocked git commands for security
 */
const BLOCKED_COMMANDS = ["push"];

/**
 * Parse git command string into command and arguments
 */
function parseGitCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.trim().split(/\s+/);

  // Remove 'git' prefix if present
  if (parts[0] === "git") {
    parts.shift();
  }

  const cmd = parts[0] ?? "";
  const args = parts.slice(1);

  return { cmd, args };
}

/**
 * Check if a git command is blocked
 */
function isCommandBlocked(cmd: string): boolean {
  return BLOCKED_COMMANDS.includes(cmd.toLowerCase());
}

/**
 * Execute a git command in the working directory
 */
async function executeGitCommand(
  command: string,
  workingDirectory: string,
): Promise<{ output: string; error?: string }> {
  const { cmd, args } = parseGitCommand(command);

  // Check if command is blocked
  if (isCommandBlocked(cmd)) {
    throw new Error(`Git command '${cmd}' is blocked for security reasons`);
  }

  try {
    printDebug(`[Git Tool] Executing: git ${cmd} ${args.join(" ")}`);

    const result = execSync(
      `git ${cmd} ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`,
      {
        cwd: workingDirectory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
    );

    printDebug(
      `[Git Tool] Success: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`,
    );

    return { output: result };
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    const message = err.stderr?.trim() || err.message;
    printDebug(`[Git Tool] Error: ${message}`);
    throw new Error(`Git command failed: ${message}`);
  }
}

/**
 * Truncate output to fit within size limit
 */
function truncateOutput(
  output: string,
  cmd: string,
  maxSize: number = GIT_MAX_OUTPUT_SIZE,
): string {
  if (output.length <= maxSize) {
    return output;
  }

  const keepTail = TAIL_COMMANDS.some((c) => cmd.startsWith(c));
  const truncatedBytes = output.length - maxSize;

  // Build pagination hint based on command
  let hint = "Use specific args to narrow output";
  if (cmd.startsWith("log")) {
    hint = "Use: git log -n <count> or git log <path>";
  } else if (cmd.startsWith("diff")) {
    hint = "Use: git diff <path> or git diff --stat";
  } else if (cmd.startsWith("show")) {
    hint = "Use: git show --stat or git show <commit> -- <path>";
  }

  const truncateMsg = `\n\n[OUTPUT TRUNCATED: ${truncatedBytes} chars omitted. ${hint}]`;
  const reserveForMsg = truncateMsg.length + 50;
  const availableSize = maxSize - reserveForMsg;

  if (keepTail) {
    return "[...truncated...]\n" + output.slice(-availableSize) + truncateMsg;
  }

  return output.slice(0, availableSize) + truncateMsg;
}

export const gitCommandToolHandler: ToolHandler = {
  name: "git_command",
  description: `Execute git commands in the working directory. All local git operations are allowed except 'git push' which is blocked for safety`,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          'The git command to execute (with or without "git" prefix). Example: "status" or "git status"',
      },
    },
    required: ["command"],
  },
  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      const command = params["command"];
      if (typeof command !== "string") {
        throw new Error("command must be a string");
      }

      // Sanitize input: remove markdown code blocks often added by LLMs
      let cleanCommand = command;
      const codeBlockMatch = command.match(/```(?:[a-z]*\n)?([\s\S]*?)```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        cleanCommand = codeBlockMatch[1].trim();
      } else {
        cleanCommand = command.trim();
      }

      const { cmd } = parseGitCommand(cleanCommand);
      const result = await executeGitCommand(
        cleanCommand,
        context.workingDirectory,
      );

      const truncatedOutput = truncateOutput(result.output, cmd);

      return {
        content: [
          {
            type: "text",
            text: truncatedOutput,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
