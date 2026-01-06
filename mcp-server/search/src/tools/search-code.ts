/**
 * Search Tools - Split into focused, single-purpose tools for better LLM usability
 *
 * Tools:
 * 1. find_definition - Find where a symbol is defined
 * 2. find_references - Find all usages of a symbol at a position
 * 3. get_hover - Get documentation/type info at a position
 * 4. search - Text/regex search
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { validatePath } from "../server.js";
import * as fs from "fs/promises";
import { spawn } from "child_process";
import { ToolHandler, MCPToolResult, ServerContext } from "../server.js";
import { ProjectDetector, ProjectRoot } from "../project-detector.js";
import { getLSPCache } from "../lsp-cache.js";
import { printDebug } from "../utils/log.js";

const execAsync = promisify(exec);

let projectDetector: ProjectDetector | undefined;

// ============================================================================
// Shared Types
// ============================================================================

export interface SearchResult {
  file_path: string;
  line: number;
  column: number;
  match_text: string;
  context?: string;
}

interface DefinitionResult {
  file_path: string;
  line: number;
  column: number;
  symbol_name: string;
  kind?: string;
}

// ============================================================================
// Shared Utilities
// ============================================================================

async function hasRipgrep(): Promise<boolean> {
  try {
    await execAsync("rg --version");
    return true;
  } catch {
    return false;
  }
}

function executeCommand(
  command: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command;
    if (cmd === undefined) {
      reject(new Error("Empty command"));
      return;
    }

    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 || code === 1) resolve({ stdout, stderr });
      else reject(new Error(`Command failed with code ${code}: ${stderr}`));
    });
    proc.on("error", reject);
  });
}

function buildRipgrepCommand(
  query: string,
  isRegex: boolean,
  searchPath: string,
  fileTypes: string[],
  excludePaths: string[],
  contextLines: number,
): string[] {
  const args: string[] = ["rg", "--json", "--line-number", "--column"];
  args.push(`--context=${contextLines}`);

  if (query.includes("\n") || query.includes("\\n")) {
    args.push("--multiline");
  }

  if (isRegex) {
    args.push("--regexp", query);
  } else {
    args.push("--fixed-strings", query);
  }

  if (fileTypes.length > 0) {
    fileTypes.forEach((ext) => {
      args.push("--type-add", `custom:*.${ext}`);
      args.push("--type", "custom");
    });
  }

  const defaultExcludes = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "*.min.js",
    "*.map",
  ];
  [...defaultExcludes, ...excludePaths].forEach((pattern) => {
    args.push("--glob", `!${pattern}`);
  });

  args.push(searchPath);
  return args;
}

function parseRipgrepOutput(output: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed["type"] !== "match") continue;

      const data = parsed["data"] as Record<string, unknown>;
      const pathData = data["path"] as Record<string, unknown>;
      const lineData = data["line_number"] as number;
      const linesData = data["lines"] as Record<string, unknown>;
      const submatches = data["submatches"] as Array<Record<string, unknown>>;

      if (!submatches || submatches.length === 0) continue;

      const firstMatch = submatches[0];
      if (!firstMatch) continue;

      const matchObj = firstMatch["match"] as Record<string, unknown>;

      results.push({
        file_path: pathData["text"] as string,
        line: lineData,
        column: (firstMatch["start"] as number) + 1,
        match_text: matchObj["text"] as string,
        context: (linesData["text"] as string).trim(),
      });
    } catch {
      continue;
    }
  }

  return results;
}

async function findSymbolColumnInFile(
  filePath: string,
  lineNumber: number,
  symbolName: string,
  fallbackColumn: number,
): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const line = lines[lineNumber - 1];

    if (!line) return fallbackColumn;

    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`);
    const match = line.match(regex);

    if (match && match.index !== undefined) {
      return match.index + 1;
    }

    const index = line.indexOf(symbolName);
    if (index !== -1) return index + 1;

    return fallbackColumn;
  } catch {
    return fallbackColumn;
  }
}

function prioritizeProjects(
  projects: ProjectRoot[],
  currentProject: ProjectRoot | null,
): ProjectRoot[] {
  return [...projects].sort((a, b) => {
    if (currentProject) {
      if (a.path === currentProject.path) return -1;
      if (b.path === currentProject.path) return 1;
    }
    const depthA = a.path.split(path.sep).length;
    const depthB = b.path.split(path.sep).length;
    return depthA - depthB;
  });
}

function formatResponse(data: unknown): MCPToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function formatError(
  message: string,
  context?: { language?: string; isTimeout?: boolean },
): MCPToolResult {
  let fullMessage = message;

  // Add actionable guidance for LSP timeouts
  if (context?.isTimeout) {
    const lang = context.language ?? "unknown";
    const warmupStatus = getLSPCache().getWarmupStatus();

    // Include warmup progress if relevant
    if (warmupStatus.inProgress && warmupStatus.language === lang) {
      const elapsedSec = Math.round(warmupStatus.elapsedMs / 1000);
      fullMessage =
        `${message}\n\n[LSP Warmup In Progress]\n` +
        `The ${lang} language server has been indexing for ${elapsedSec}s.\n` +
        `This is normal for large projects. Please retry in 30-60 seconds.\n\n` +
        getLspTimeoutGuidance(lang);
    } else {
      fullMessage = `${message}\n\n` + getLspTimeoutGuidance(lang);
    }
  }

  return {
    content: [{ type: "text", text: `Error: ${fullMessage}` }],
    isError: true,
  };
}

/**
 * Provide honest, actionable guidance when LSP times out.
 * Different languages have different caching behaviors.
 */
function getLspTimeoutGuidance(language: string): string {
  switch (language) {
    case "rust":
      return `[Rust LSP Timeout]
rust-analyzer does NOT persist its index to disk.
- First call in a session is always slow (indexing from scratch)
- Subsequent calls in the SAME session will be fast
- Retry this call in 30-60 seconds, or use text search as fallback
- If you keep timing out, the project may be too large for CLI usage`;

    case "cpp":
      return `[C/C++ LSP Timeout]
clangd DOES persist its index to disk (.cache/clangd/index/).
- First run on a project: slow (building index)
- Subsequent runs: should be fast (loading from disk)
- If this is a repeated timeout, the project may be too large
- Fallback: use text search with 'search' tool`;

    case "typescript":
    case "go":
    case "python":
      return `[${language} LSP Timeout]
This language usually has fast LSP startup.
- Check if the project is unusually large
- Verify the language server is installed correctly
- Fallback: use text search with 'search' tool`;

    default:
      return `[LSP Timeout]
The language server did not respond in time.
- The project may be too large for LSP
- Fallback: use text search with 'search' tool`;
  }
}

// ============================================================================
// Tool 1: find_definition
// ============================================================================

export const findDefinitionToolHandler: ToolHandler = {
  name: "find_definition",
  description: `Find where a symbol is defined using LSP.

Returns the file path, line, and column where the symbol is declared.
Use this output with find_references or get_hover for further exploration.

Example: { "query": "UserService" }
Example with path filter: { "query": "UserService", "path": "src" }`,

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Symbol name to find (e.g., class name, function name)",
      },
      path: {
        type: "string",
        description: "Directory to search in (default: current directory)",
      },
      file_types: {
        type: "array",
        items: { type: "string" },
        description: 'File extensions to include, e.g. ["ts", "js"]',
      },
      max_results: {
        type: "integer",
        description: "Maximum results (default: 10)",
      },
      timeout_ms: {
        type: "integer",
        description:
          "LSP timeout in milliseconds (default: 30000, use 120000 for Rust)",
      },
    },
    required: ["query"],
  },

  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      const query = params["query"] as string;
      if (!query || typeof query !== "string") {
        return formatError("query is required");
      }

      const searchPath = (params["path"] as string) ?? ".";
      const fileTypes = (params["file_types"] as string[]) ?? [];
      const maxResults = Math.min((params["max_results"] as number) ?? 10, 50);
      const timeoutMs = params["timeout_ms"] as number | undefined;

      const absoluteWorkingDir = path.resolve(context.workingDirectory);

      // Initialize project detector
      if (!projectDetector) {
        projectDetector = new ProjectDetector(absoluteWorkingDir);
      }

      let projects = await projectDetector.detectProjects();
      if (projects.length === 0) {
        return formatError(
          "No projects detected. LSP requires a project configuration file (tsconfig.json, Cargo.toml, etc.)",
        );
      }

      // Handle Rust workspaces
      const workspaceRoots = projects.filter((p) => p.isWorkspaceRoot);
      const rustWorkspaceRoot = workspaceRoots.find(
        (p) => p.language === "rust",
      );
      if (rustWorkspaceRoot) {
        const nonRustProjects = projects.filter((p) => p.language !== "rust");
        projects = [rustWorkspaceRoot, ...nonRustProjects];
      }

      const cache = getLSPCache();
      const sortedProjects = prioritizeProjects(
        projects,
        cache.getCurrentProject(),
      );
      const results: DefinitionResult[] = [];
      const startTime = Date.now();
      const actualTimeout = timeoutMs ?? 30000;

      for (const project of sortedProjects) {
        if (results.length >= maxResults) break;

        const client = await cache.getClient(project, timeoutMs);
        if (!client) continue;

        try {
          // Polling Loop: Keep trying until we find symbols or timeout
          // This handles "Cold Start" where LSP returns [] immediately while indexing
          while (true) {
            const symbols = await client.getWorkspaceSymbols(query);

            if (symbols.length > 0) {
              for (const symbol of symbols) {
                if (results.length >= maxResults) break;

                const filePath = symbol.location.uri.replace("file://", "");
                const lineNumber = symbol.location.range.start.line + 1;

                // Filter by path if specified
                if (searchPath !== ".") {
                  const fullSearchPath = path.resolve(
                    context.workingDirectory,
                    searchPath,
                  );
                  if (!filePath.startsWith(fullSearchPath)) continue;
                }

                // Filter by file type if specified
                if (fileTypes.length > 0) {
                  const ext = path.extname(filePath).slice(1);
                  if (!fileTypes.includes(ext)) continue;
                }

                const accurateColumn = await findSymbolColumnInFile(
                  filePath,
                  lineNumber,
                  symbol.name,
                  symbol.location.range.start.character + 1,
                );

                results.push({
                  file_path: filePath,
                  line: lineNumber,
                  column: accurateColumn,
                  symbol_name: symbol.name,
                  kind: getSymbolKindName(symbol.kind),
                });
              }
              // Found symbols in this project, break the retry loop
              break;
            }

            // No symbols found yet. Check timeout.
            if (Date.now() - startTime >= actualTimeout) {
              break;
            }

            // Wait 1s before retrying
            printDebug(
              `[find_definition] No symbols yet, waiting for index... (${Math.round((Date.now() - startTime) / 1000)}s)`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          if (project.isWorkspaceRoot && results.length > 0) break;
        } catch (error) {
          printDebug(
            `[find_definition] LSP failed for ${project.path}: ${(error as Error).message}`,
          );
        }
      }

      if (results.length === 0) {
        // Check warmup status for better messaging
        const warmupStatus = getLSPCache().getWarmupStatus();
        const isWarmingUp =
          warmupStatus.inProgress &&
          warmupStatus.language === sortedProjects[0]?.language;
        const warmupElapsedSec = Math.round(warmupStatus.elapsedMs / 1000);

        return formatResponse({
          results: [],
          message: isWarmingUp
            ? `No definition found for "${query}". LSP is still indexing (${warmupElapsedSec}s elapsed). Retry in 30-60s.`
            : `No definition found for "${query}". The symbol may not exist or LSP may still be indexing.`,
          lsp_status: isWarmingUp ? "warmup_indexing" : "no_match",
          language: sortedProjects[0]?.language,
          ...(isWarmingUp && { warmup_elapsed_sec: warmupElapsedSec }),
        });
      }

      return formatResponse({ results });
    } catch (error) {
      return formatError((error as Error).message);
    }
  },
};

function getSymbolKindName(kind: number): string {
  const kinds: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
  };
  return kinds[kind] ?? "Unknown";
}

// ============================================================================
// Tool 2: find_references
// ============================================================================

export const findReferencesToolHandler: ToolHandler = {
  name: "find_references",
  description: `Find all usages of a symbol at a specific position using LSP.

Use the file_path, line, and column from a find_definition result.

Example: { "file_path": "src/user.ts", "line": 10, "column": 14 }`,

  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "File path from find_definition result",
      },
      line: {
        type: "integer",
        description: "1-based line number from find_definition result",
      },
      column: {
        type: "integer",
        description: "1-based column number from find_definition result",
      },
      max_results: {
        type: "integer",
        description: "Maximum results (default: 50)",
      },
      timeout_ms: {
        type: "integer",
        description: "LSP timeout in milliseconds (default: 30000)",
      },
    },
    required: ["file_path", "line", "column"],
  },

  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      const filePath = params["file_path"] as string;
      const line = params["line"] as number;
      const column = params["column"] as number;

      if (!filePath || typeof line !== "number" || typeof column !== "number") {
        return formatError("file_path, line, and column are required");
      }

      const maxResults = Math.min((params["max_results"] as number) ?? 50, 100);
      const timeoutMs = params["timeout_ms"] as number | undefined;

      const absoluteWorkingDir = path.resolve(context.workingDirectory);
      const absoluteFilePath = path.resolve(absoluteWorkingDir, filePath);

      if (!projectDetector) {
        projectDetector = new ProjectDetector(absoluteWorkingDir);
      }

      const project =
        await projectDetector.findProjectForFile(absoluteFilePath);
      if (!project) {
        return formatError(`No project found for file: ${filePath}`);
      }

      const cache = getLSPCache();
      const client = await cache.getClient(project, timeoutMs);
      if (!client) {
        return formatError(`Could not start LSP for ${project.language}`);
      }

      try {
        const content = await fs.readFile(absoluteFilePath, "utf-8");
        const uri = `file://${absoluteFilePath}`;

        await client.openDocument(uri, project.language, content);
        await client.ensureProjectInitialized();

        const position = { line: line - 1, character: column - 1 };
        const references = await client.getReferences(uri, position, true);

        const results = references.slice(0, maxResults).map((ref) => ({
          file_path: ref.uri.replace("file://", ""),
          line: ref.range.start.line + 1,
          column: ref.range.start.character + 1,
        }));

        return formatResponse({
          references: results,
          total_count: references.length,
        });
      } catch (error) {
        const errMsg = (error as Error).message;
        const isTimeout =
          errMsg.includes("timeout") || errMsg.includes("Timeout");
        return formatError(`LSP references failed: ${errMsg}`, {
          language: project.language,
          isTimeout,
        });
      }
    } catch (error) {
      return formatError((error as Error).message);
    }
  },
};

// ============================================================================
// Tool 3: get_hover
// ============================================================================

export const getHoverToolHandler: ToolHandler = {
  name: "get_hover",
  description: `Get documentation and type information at a specific position using LSP.

Use the file_path, line, and column from a find_definition result.

Example: { "file_path": "src/user.ts", "line": 10, "column": 14 }`,

  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "File path from find_definition result",
      },
      line: {
        type: "integer",
        description: "1-based line number from find_definition result",
      },
      column: {
        type: "integer",
        description: "1-based column number from find_definition result",
      },
      timeout_ms: {
        type: "integer",
        description: "LSP timeout in milliseconds (default: 30000)",
      },
    },
    required: ["file_path", "line", "column"],
  },

  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      const filePath = params["file_path"] as string;
      const line = params["line"] as number;
      const column = params["column"] as number;

      if (!filePath || typeof line !== "number" || typeof column !== "number") {
        return formatError("file_path, line, and column are required");
      }

      const timeoutMs = params["timeout_ms"] as number | undefined;

      const absoluteWorkingDir = path.resolve(context.workingDirectory);
      const absoluteFilePath = path.resolve(absoluteWorkingDir, filePath);

      if (!projectDetector) {
        projectDetector = new ProjectDetector(absoluteWorkingDir);
      }

      const project =
        await projectDetector.findProjectForFile(absoluteFilePath);
      if (!project) {
        return formatError(`No project found for file: ${filePath}`);
      }

      const cache = getLSPCache();
      const client = await cache.getClient(project, timeoutMs);
      if (!client) {
        return formatError(`Could not start LSP for ${project.language}`);
      }

      try {
        const content = await fs.readFile(absoluteFilePath, "utf-8");
        const uri = `file://${absoluteFilePath}`;

        await client.openDocument(uri, project.language, content);
        await client.ensureProjectInitialized();

        const position = { line: line - 1, character: column - 1 };
        const hover = await client.getHover(uri, position);

        if (!hover) {
          return formatResponse({
            documentation: null,
            message: "No hover information available at this position",
          });
        }

        let hoverText: string;
        if (typeof hover.contents === "string") {
          hoverText = hover.contents;
        } else if (Array.isArray(hover.contents)) {
          hoverText = hover.contents
            .map((c) => (typeof c === "string" ? c : c.value))
            .join("\n\n");
        } else {
          hoverText = hover.contents.value;
        }

        return formatResponse({
          documentation: hoverText,
          file_path: filePath,
          line,
          column,
        });
      } catch (error) {
        const errMsg = (error as Error).message;
        const isTimeout =
          errMsg.includes("timeout") || errMsg.includes("Timeout");
        return formatError(`LSP hover failed: ${errMsg}`, {
          language: project.language,
          isTimeout,
        });
      }
    } catch (error) {
      return formatError((error as Error).message);
    }
  },
};

// ============================================================================
// Tool 4: search
// ============================================================================

export const searchToolHandler: ToolHandler = {
  name: "search",
  description: `Search for text or patterns in files using ripgrep.

Fast full-text search across the codebase.

Example: { "query": "TODO" }
Example regex: { "query": "async\\\\s+function\\\\s+\\\\w+" }
Example with filters: { "query": "console.log", "path": "src", "file_types": ["ts", "js"] }`,

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regex pattern to search for",
      },
      path: {
        type: "string",
        description: "Directory to search in (default: current directory)",
      },
      file_types: {
        type: "array",
        items: { type: "string" },
        description: 'File extensions to include, e.g. ["ts", "js"]',
      },
      exclude_paths: {
        type: "array",
        items: { type: "string" },
        description: 'Paths to exclude, e.g. ["test/", "vendor/"]',
      },
      max_results: {
        type: "integer",
        description: "Maximum results (default: 50)",
      },
      context_lines: {
        type: "integer",
        description: "Context lines before/after match (default: 2)",
      },
    },
    required: ["query"],
  },

  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      const query = params["query"] as string;
      if (!query || typeof query !== "string") {
        return formatError("query is required");
      }

      const searchPath = (params["path"] as string) ?? ".";
      const fileTypes = (params["file_types"] as string[]) ?? [];
      const excludePaths = (params["exclude_paths"] as string[]) ?? [];
      const maxResults = Math.min((params["max_results"] as number) ?? 50, 100);
      const contextLines = Math.min(
        (params["context_lines"] as number) ?? 2,
        5,
      );

      const validation = validatePath(searchPath, context.workingDirectory);
      if (!validation.valid) {
        return formatError(`Invalid path: ${validation.error}`);
      }

      try {
        await fs.access(validation.fullPath!);
      } catch {
        return formatError(`Path does not exist: ${searchPath}`);
      }

      const useRipgrep = await hasRipgrep();
      if (!useRipgrep) {
        return formatError("ripgrep (rg) is required but not installed");
      }

      const command = buildRipgrepCommand(
        query,
        true, // always use regex (literal text is valid regex)
        validation.fullPath!,
        fileTypes,
        excludePaths,
        contextLines,
      );

      const { stdout } = await executeCommand(command);
      const allResults = parseRipgrepOutput(stdout);
      const results = allResults.slice(0, maxResults);

      return formatResponse({
        results,
        total_count: allResults.length,
        ...(allResults.length > maxResults && { next_start: maxResults }),
      });
    } catch (error) {
      if ((error as Error).message.includes("code 1")) {
        return formatResponse({ results: [], total_count: 0 });
      }
      return formatError((error as Error).message);
    }
  },
};

// ============================================================================
// Export all tool handlers
// ============================================================================

export const searchToolHandlers: ToolHandler[] = [
  findDefinitionToolHandler,
  findReferencesToolHandler,
  getHoverToolHandler,
  searchToolHandler,
];
