import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { validatePath } from "../server.js";
import * as fs from "fs/promises";
import { spawn } from "child_process";
import { ToolHandler, MCPToolResult, ServerContext } from "../server.js";
import { LSPManager } from "../lsp-manager.js";
import { printDebug } from "../utils/log.js";

const execAsync = promisify(exec);

/** Maximum output size for search results (~4KB) */
const SEARCH_MAX_OUTPUT_SIZE = 4096;

/**
 * Truncate search output with pagination hint
 */
function truncateSearchOutput(
  output: string,
  maxSize: number = SEARCH_MAX_OUTPUT_SIZE,
): string {
  if (output.length <= maxSize) {
    return output;
  }

  const truncatedBytes = output.length - maxSize;
  const hint = "Use start/max_results params for pagination, or narrow query";
  const truncateMsg = `\n\n[OUTPUT TRUNCATED: ${truncatedBytes} chars omitted. ${hint}]`;
  const reserveForMsg = truncateMsg.length + 50;
  const availableSize = maxSize - reserveForMsg;

  return output.slice(0, availableSize) + truncateMsg;
}

let lspManager: LSPManager | undefined;

export interface SearchCodeParams {
  query: string;
  search_type: "definition" | "references" | "text" | "regex";
  path?: string;
  file_types?: string[];
  exclude_paths?: string[];
  max_results?: number;
  start?: number;
  context_lines?: number;
}

export interface SearchResult {
  file_path: string;
  line_number: number;
  column: number;
  match_text: string;
  context: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total_count: number;
  search_backend: "ripgrep" | "grep" | "lsp";
}

/**
 * Detect if ripgrep is available
 */
async function hasRipgrep(): Promise<boolean> {
  try {
    await execAsync("rg --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Build ripgrep command
 */
function buildRipgrepCommand(
  query: string,
  searchType: string,
  searchPath: string,
  fileTypes: string[],
  excludePaths: string[],
  contextLines: number,
): string[] {
  const args: string[] = ["rg"];

  // Basic flags
  args.push("--json"); // JSON output for parsing
  args.push("--line-number");
  args.push("--column");
  args.push(`--context=${contextLines}`);

  // Auto-enable multiline mode if query contains newlines
  if (query.includes("\n") || query.includes("\\r") || query.includes("\\n")) {
    args.push("--multiline");
  }

  // Search type flags
  if (searchType === "regex") {
    args.push("--regexp", query);
  } else if (searchType === "text") {
    args.push("--fixed-strings", query);
  } else {
    // For definition/references, use word boundary matching
    args.push("--word-regexp", query);
  }

  // File type filters
  if (fileTypes.length > 0) {
    fileTypes.forEach((ext) => {
      args.push("--type-add", `custom:*.${ext}`, "--type", "custom");
    });
  }

  // Exclude patterns
  excludePaths.forEach((pattern) => {
    args.push("--glob", `!${pattern}`);
  });

  // Default excludes for common directories
  const defaultExcludes = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "*.min.js",
    "*.map",
  ];
  defaultExcludes.forEach((pattern) => {
    args.push("--glob", `!${pattern}`);
  });

  // Search path
  args.push(searchPath);

  return args;
}

/**
 * Build grep command as fallback
 */
function buildGrepCommand(
  query: string,
  searchType: string,
  searchPath: string,
  fileTypes: string[],
  excludePaths: string[],
  contextLines: number,
): string[] {
  const args: string[] = ["grep"];

  // Basic flags
  args.push("-r"); // Recursive
  args.push("-n"); // Line numbers
  args.push(`-C${contextLines}`); // Context lines

  // Search type flags
  if (searchType === "regex") {
    args.push("-E", query);
  } else if (searchType === "text") {
    args.push("-F", query);
  } else {
    // Word boundary matching
    args.push("-w", query);
  }

  // File type filters (basic - just add --include patterns)
  if (fileTypes.length > 0) {
    fileTypes.forEach((ext) => {
      args.push("--include", `*.${ext}`);
    });
  }

  // Exclude patterns
  excludePaths.forEach((pattern) => {
    args.push("--exclude-dir", pattern);
  });

  // Default excludes
  args.push("--exclude-dir", "node_modules");
  args.push("--exclude-dir", ".git");
  args.push("--exclude-dir", "dist");
  args.push("--exclude-dir", "build");

  // Search path
  args.push(searchPath);

  return args;
}

/**
 * Parse ripgrep JSON output
 */
function parseRipgrepOutput(output: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      // Only process match entries
      if (parsed["type"] !== "match") continue;

      const data = parsed["data"] as Record<string, unknown>;
      const pathData = data["path"] as Record<string, unknown>;
      const lineData = data["line_number"] as number;
      const lines = data["lines"] as Record<string, unknown>;
      const submatches = data["submatches"] as Array<Record<string, unknown>>;

      if (
        submatches === undefined ||
        submatches === null ||
        submatches.length === 0
      )
        continue;

      const firstMatch = submatches[0];
      if (firstMatch === undefined) continue;

      const matchObj = firstMatch["match"] as Record<string, unknown>;
      const matchText = matchObj["text"] as string;

      results.push({
        file_path: pathData["text"] as string,
        line_number: lineData,
        column: (firstMatch["start"] as number) + 1, // Convert to 1-based
        match_text: matchText,
        context: lines["text"] as string,
      });
    } catch (e) {
      // Skip malformed JSON lines
      printDebug(
        `[Search] Failed to parse ripgrep line: ${line.slice(0, 100)}`,
      );
      continue;
    }
  }

  return results;
}

/**
 * Parse grep output
 */
function parseGrepOutput(output: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lines = output.trim().split("\n");

  let currentContext: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    // Grep output format: filename:line:content or filename-line-content
    const matchLine = line.match(/^([^:]+):(\d+):(.*)$/);
    const contextLine = line.match(/^([^-]+)-(\d+)-(.*)$/);

    if (matchLine !== null) {
      const [, filePath, lineNum, content] = matchLine;

      // Build context from previous lines
      const contextStr =
        currentContext.length > 0
          ? currentContext.join("\n") + "\n" + content
          : content;

      results.push({
        file_path: filePath ?? "",
        line_number: parseInt(lineNum ?? "1", 10),
        column: 1, // Grep doesn't provide column info
        match_text: content?.trim() ?? "",
        context: contextStr,
      });

      currentContext = [];
    } else if (contextLine !== null) {
      // Context line
      currentContext.push(contextLine[3] ?? "");
      if (currentContext.length > 5) {
        currentContext.shift(); // Keep only last 5 context lines
      }
    }
  }

  return results;
}

/**
 * Execute command with proper argument handling
 */
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

/**
 * Search code using available backend
 */
async function searchCode(
  params: SearchCodeParams,
  workingDir: string,
): Promise<SearchResponse> {
  let query = params.query;
  const searchType = params.search_type;

  // IMPROVEMENT: Handle common agent hallucination where they prefix queries with colon (e.g. :MySymbol)
  // Only apply to symbol searches where a colon is syntactically invalid/unlikely at start
  if (
    (searchType === "definition" || searchType === "references") &&
    query.startsWith(":")
  ) {
    printDebug(`[Search] Sanitizing query: "${query}" -> "${query.slice(1)}"`);
    query = query.slice(1);
  }

  const searchPath = params.path ?? ".";
  const fileTypes = params.file_types ?? [];
  const excludePaths = params.exclude_paths ?? [];
  const maxResults = Math.min(params.max_results ?? 50, 50);
  const start = params.start ?? 0;
  const contextLines = Math.min(params.context_lines ?? 3, 5);

  // LSP-based search for definitions and references
  if (searchType === "definition" || searchType === "references") {
    try {
      if (!lspManager) {
        // IMPROVEMENT: Ensure absolute path for LSP rootUri (fixes file://. issues)
        const absoluteWorkingDir = path.resolve(workingDir);
        printDebug(
          `[DEBUG search-code] Creating LSPManager with workingDir=${absoluteWorkingDir}`,
        );
        lspManager = new LSPManager(absoluteWorkingDir);
        await lspManager.initialize();
      }
      const language = await lspManager.inferLanguage();
      printDebug(`[DEBUG search-code] inferLanguage returned: ${language}`);
      if (language) {
        const client = await lspManager.getClientForLanguage(language);
        printDebug(
          `[DEBUG search-code] getClientForLanguage(${language}) returned: ${client ? "client" : "undefined"}`,
        );
        if (client) {
          printDebug(`[Search] Using backend: lsp`);
          const symbols = await client.getWorkspaceSymbols(query);

          // Resolve full search path for filtering
          const validation = validatePath(searchPath, workingDir);
          const fullSearchPath = validation.valid
            ? validation.fullPath!
            : path.resolve(workingDir, searchPath);

          let results = symbols.map((symbol) => ({
            file_path: symbol.location.uri.replace("file://", ""),
            line_number: symbol.location.range.start.line + 1,
            column: symbol.location.range.start.character + 1,
            match_text: symbol.name,
            context: `Symbol: ${symbol.name} (kind: ${symbol.kind})`,
          }));

          // Apply path filter (LSP returns workspace-wide results)
          if (searchPath !== ".") {
            results = results.filter((r) =>
              r.file_path.startsWith(fullSearchPath),
            );
          }

          // Apply file_types filter
          if (fileTypes.length > 0) {
            results = results.filter((r) => {
              const ext = path.extname(r.file_path).slice(1); // Remove leading dot
              return fileTypes.includes(ext);
            });
          }

          // Apply exclude_paths filter
          if (excludePaths.length > 0) {
            results = results.filter((r) => {
              return !excludePaths.some((pattern) =>
                r.file_path.includes(pattern),
              );
            });
          }

          return {
            results: results.slice(start, start + maxResults),
            total_count: results.length,
            search_backend: "lsp",
          };
        }
      }
      printDebug(
        "[Search] LSP not available, falling back to ripgrep (text-based, non-semantic).",
      );
    } catch (error) {
      printDebug(
        `[DEBUG search-code] LSP search failed: ${(error as Error).message}\n${(error as Error).stack}`,
      );
    }
  }

  // Validate search path using shared validator
  const validation = validatePath(searchPath, workingDir);
  if (!validation.valid) {
    throw new Error(`Invalid search path: ${validation.error}`);
  }
  const fullSearchPath = validation.fullPath!;

  // Check if path exists
  try {
    await fs.access(fullSearchPath);
  } catch {
    throw new Error(`Search path does not exist: ${searchPath}`);
  }

  const useRipgrep = await hasRipgrep();
  const backend = useRipgrep ? "ripgrep" : "grep";

  printDebug(`[Search] Using backend: ${backend}`);
  printDebug(
    `[Search] Query: "${query}", Type: ${searchType}, Path: ${searchPath}`,
  );

  let results: SearchResult[] = [];

  try {
    if (useRipgrep) {
      const command = buildRipgrepCommand(
        query,
        searchType,
        fullSearchPath,
        fileTypes,
        excludePaths,
        contextLines,
      );

      printDebug(`[Search] Running: ${command.join(" ")}`);

      const { stdout } = await executeCommand(command);

      results = parseRipgrepOutput(stdout);
    } else {
      const command = buildGrepCommand(
        query,
        searchType,
        fullSearchPath,
        fileTypes,
        excludePaths,
        contextLines,
      );

      printDebug(`[Search] Running: ${command.join(" ")}`);

      const { stdout } = await executeCommand(command);

      results = parseGrepOutput(stdout);
    }
  } catch (error) {
    // Check if it's just "no matches found" (exit code 1)
    if (error instanceof Error && error.message.includes("code 1")) {
      // No matches found - return empty results
      printDebug("[Search] No matches found");
      return {
        results: [],
        total_count: 0,
        search_backend: backend,
      };
    }

    // Real error
    printDebug(`[Search] Error: ${(error as Error).message}`);
    throw error;
  }

  printDebug(`[Search] Found ${results.length} total results`);

  // Apply pagination
  const totalCount = results.length;
  const paginatedResults = results.slice(start, start + maxResults);

  printDebug(
    `[Search] Returning ${paginatedResults.length} results (start=${start}, max=${maxResults})`,
  );

  return {
    results: paginatedResults,
    total_count: totalCount,
    search_backend: backend,
  };
}

export const searchCodeToolHandler: ToolHandler = {
  name: "search_code",
  description:
    "Search for code patterns. Types: definition/references (LSP workspace symbols, same behavior), text (literal), regex. Falls back to ripgrep if LSP unavailable.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The text pattern or symbol name to search for",
      },
      search_type: {
        type: "string",
        enum: ["definition", "references", "text", "regex"],
        description: "Type of search to perform",
      },
      path: {
        type: "string",
        description: 'Root directory to search from (default: ".")',
      },
      file_types: {
        type: "array",
        items: { type: "string" },
        description: 'File extensions to include (e.g., ["ts", "js"])',
      },
      exclude_paths: {
        type: "array",
        items: { type: "string" },
        description: 'Paths/patterns to exclude (e.g., ["test/", "vendor/"])',
      },
      max_results: {
        type: "integer",
        description:
          "Maximum number of results to return (default: 50, max: 50)",
      },
      start: {
        type: "integer",
        description: "Pagination offset (default: 0)",
      },
      context_lines: {
        type: "integer",
        description:
          "Number of context lines before/after match (default: 3, max: 5)",
      },
    },
    required: ["query", "search_type"],
  },

  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      // Validate required parameters
      if (typeof params["query"] !== "string") {
        throw new Error("query must be a string");
      }
      if (typeof params["search_type"] !== "string") {
        throw new Error("search_type must be a string");
      }

      const searchParams: SearchCodeParams = {
        query: params["query"],
        search_type: params["search_type"] as
          | "definition"
          | "references"
          | "text"
          | "regex",
        path: typeof params["path"] === "string" ? params["path"] : undefined,
        file_types: Array.isArray(params["file_types"])
          ? (params["file_types"] as string[])
          : undefined,
        exclude_paths: Array.isArray(params["exclude_paths"])
          ? (params["exclude_paths"] as string[])
          : undefined,
        max_results:
          typeof params["max_results"] === "number"
            ? params["max_results"]
            : undefined,
        start:
          typeof params["start"] === "number" ? params["start"] : undefined,
        context_lines:
          typeof params["context_lines"] === "number"
            ? params["context_lines"]
            : undefined,
      };

      const result = await searchCode(searchParams, context.workingDirectory);

      const output = truncateSearchOutput(JSON.stringify(result, null, 2));

      return {
        content: [
          {
            type: "text",
            text: output,
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
