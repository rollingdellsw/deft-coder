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

export interface SearchCodeParams {
  query: string;
  search_type: "definition" | "references" | "hover" | "text" | "regex";
  path?: string;
  file_types?: string[];
  exclude_paths?: string[];
  max_results?: number;
  start?: number;
  context_lines?: number;
  timeout_ms?: number;
  // Positional parameters for references/definition/hover at a specific location
  file_path?: string;
  line?: number;
  column?: number;
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
  limit_reason?: "max_results" | "output_size_limit";
  next_start?: number;
  remaining_count?: number;
  // For hover results
  hover_content?: string;
}

interface HoverResponse {
  hover_content: string;
  file_path: string;
  line: number;
  column: number;
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
      args.push("--type-add", `custom:*.${ext}`);
      args.push("--type", "custom");
    });
  }

  // Helper to convert exclude path to proper glob pattern for ripgrep
  const toGlobPattern = (pattern: string): string[] => {
    const patterns: string[] = [];
    // If pattern ends with /, it's explicitly a directory
    if (pattern.endsWith("/")) {
      patterns.push(`!${pattern}**`);
      patterns.push(`!**/${pattern}**`);
    } else if (pattern.includes("/")) {
      // Pattern contains /, it's a path (could be file or directory)
      patterns.push(`!${pattern}`);
      patterns.push(`!${pattern}/**`);
    } else {
      // Simple name - exclude as both file and directory at any depth
      patterns.push(`!**/${pattern}`);
      patterns.push(`!**/${pattern}/**`);
    }
    return patterns;
  };

  // Apply exclude patterns
  excludePaths.flatMap(toGlobPattern).forEach((pattern) => {
    args.push("--glob", pattern);
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
 * Get references at a specific position using textDocument/references
 */
async function getReferencesAtPosition(
  filePath: string,
  line: number,
  column: number,
  workingDir: string,
  timeoutMs?: number,
): Promise<SearchResult[] | null> {
  printDebug(`[Search] getReferencesAtPosition: ${filePath}:${line}:${column}`);
  const absoluteWorkingDir = path.resolve(workingDir);
  const absoluteFilePath = path.resolve(absoluteWorkingDir, filePath);

  // Find project for this file
  if (!projectDetector) {
    projectDetector = new ProjectDetector(absoluteWorkingDir);
  }
  const project = await projectDetector.findProjectForFile(absoluteFilePath);
  if (!project) {
    printDebug(
      `[Search] getReferencesAtPosition: No project found for file: ${absoluteFilePath}`,
    );
    return null;
  }

  printDebug(
    `[Search] getReferencesAtPosition: Found project ${project.path} (${project.language})`,
  );

  const cache = getLSPCache();
  const client = await cache.getClient(project, timeoutMs);
  if (!client) {
    printDebug(
      `[Search] getReferencesAtPosition: Could not get LSP client for ${project.path}`,
    );
    return null;
  }

  try {
    // Read file content and open document
    const fsModule = await import("fs/promises");
    const content = await fsModule.readFile(absoluteFilePath, "utf-8");
    const uri = `file://${absoluteFilePath}`;

    printDebug(`[Search] getReferencesAtPosition: Opening document ${uri}`);
    await client.openDocument(uri, project.language, content);

    // Ensure project is fully initialized (wait for indexing)
    await client.ensureProjectInitialized();

    // LSP uses 0-based positions
    const position = { line: line - 1, character: column - 1 };
    printDebug(
      `[Search] getReferencesAtPosition: Calling textDocument/references at position ${JSON.stringify(position)}`,
    );
    const references = await client.getReferences(uri, position, true);

    printDebug(
      `[Search] Found ${references.length} references at ${filePath}:${line}:${column}`,
    );

    return references.map((ref) => ({
      file_path: ref.uri.replace("file://", ""),
      line_number: ref.range.start.line + 1,
      column: ref.range.start.character + 1,
      match_text: "", // Will be filled by caller if needed
      context: `Reference at line ${ref.range.start.line + 1}`,
    }));
  } catch (error) {
    printDebug(`[Search] LSP references failed: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Get hover information at a specific position
 */
async function getHoverAtPosition(
  filePath: string,
  line: number,
  column: number,
  workingDir: string,
  timeoutMs?: number,
): Promise<HoverResponse | null> {
  printDebug(`[Search] getHoverAtPosition: ${filePath}:${line}:${column}`);
  const absoluteWorkingDir = path.resolve(workingDir);
  const absoluteFilePath = path.resolve(absoluteWorkingDir, filePath);

  if (!projectDetector) {
    projectDetector = new ProjectDetector(absoluteWorkingDir);
  }
  const project = await projectDetector.findProjectForFile(absoluteFilePath);
  if (!project) {
    printDebug(
      `[Search] getHoverAtPosition: No project found for file: ${absoluteFilePath}`,
    );
    return null;
  }

  printDebug(
    `[Search] getHoverAtPosition: Found project ${project.path} (${project.language})`,
  );

  const cache = getLSPCache();
  const client = await cache.getClient(project, timeoutMs);
  if (!client) {
    printDebug(
      `[Search] getHoverAtPosition: Could not get LSP client for ${project.path}`,
    );
    return null;
  }

  try {
    const fsModule = await import("fs/promises");
    const content = await fsModule.readFile(absoluteFilePath, "utf-8");
    const uri = `file://${absoluteFilePath}`;

    printDebug(`[Search] getHoverAtPosition: Opening document ${uri}`);
    await client.openDocument(uri, project.language, content);

    // Ensure project is fully initialized (wait for indexing)
    await client.ensureProjectInitialized();

    const position = { line: line - 1, character: column - 1 };
    printDebug(
      `[Search] getHoverAtPosition: Calling textDocument/hover at position ${JSON.stringify(position)}`,
    );
    const hover = await client.getHover(uri, position);

    if (!hover) {
      printDebug(`[Search] getHoverAtPosition: No hover result returned`);
      return null;
    }

    printDebug(`[Search] getHoverAtPosition: Got hover result`);

    // Normalize hover contents to string
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

    return {
      hover_content: hoverText,
      file_path: filePath,
      line,
      column,
    };
  } catch (error) {
    printDebug(`[Search] LSP hover failed: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Check if a file path should be excluded based on exclude patterns
 * Matches both directory paths and file names
 */
function shouldExcludePath(filePath: string, excludePaths: string[]): boolean {
  if (excludePaths.length === 0) {
    return false;
  }

  const normalizedPath = filePath.replace(/\\/g, "/"); // Normalize Windows paths

  return excludePaths.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // If pattern ends with /, match only directories
    if (normalizedPattern.endsWith("/")) {
      return (
        normalizedPath.startsWith(normalizedPattern) ||
        normalizedPath.includes(`/${normalizedPattern}`)
      );
    }

    // If pattern contains /, it's a path - check if filePath starts with it
    if (normalizedPattern.includes("/")) {
      return (
        normalizedPath.startsWith(normalizedPattern) ||
        normalizedPath.startsWith(`/${normalizedPattern}`) ||
        normalizedPath.includes(`/${normalizedPattern}/`)
      );
    }

    // Simple name - check if any path component matches
    const pathComponents = normalizedPath.split("/");
    return pathComponents.some((component) => component === normalizedPattern);
  });
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
): Promise<SearchResponse | HoverResponse> {
  let query = params.query;
  const searchType = params.search_type;
  const timeoutMs = params.timeout_ms;

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

  // Positional parameters for precise LSP queries
  const filePath = params.file_path;
  const line = params.line;
  const column = params.column;
  const hasPosition =
    filePath !== undefined && line !== undefined && column !== undefined;

  // Handle hover requests (always requires position)
  if (searchType === "hover") {
    if (!hasPosition) {
      throw new Error(
        "hover search_type requires file_path, line, and column parameters",
      );
    }
    const hoverResult = await getHoverAtPosition(
      filePath,
      line,
      column,
      workingDir,
      timeoutMs,
    );
    if (hoverResult === null) {
      // Don't fall through to workspace/symbol - hover is position-specific
      throw new Error(
        `No hover information available at ${filePath}:${line}:${column}. The LSP server may still be indexing, or the position may not have hover info.`,
      );
    }
    return hoverResult;
  }

  // Handle positional references (textDocument/references)
  if (searchType === "references" && hasPosition) {
    printDebug(
      `[Search] Using positional references for ${filePath}:${line}:${column}`,
    );
    const refResults = await getReferencesAtPosition(
      filePath,
      line,
      column,
      workingDir,
      timeoutMs,
    );
    if (refResults !== null && refResults.length > 0) {
      const paginatedResults = refResults.slice(start, start + maxResults);
      return {
        results: paginatedResults,
        total_count: refResults.length,
        search_backend: "lsp",
      };
    }
    // For positional references, don't fall through - return empty or error
    printDebug("[Search] LSP references returned no results at position.");
    return {
      results: [],
      total_count: 0,
      search_backend: "lsp",
    };
  }

  // Handle positional definition (textDocument/definition)
  // Note: For definition, we typically want workspace/symbol for fuzzy search,
  // but if position is provided, we can use textDocument/definition for precision

  // LSP-based search for definitions and references
  if (searchType === "definition" || searchType === "references") {
    try {
      const lspResults = await searchWithLSP(
        query,
        workingDir,
        searchPath,
        fileTypes,
        excludePaths,
        timeoutMs,
      );

      if (lspResults !== null && lspResults.length > 0) {
        // Apply pagination
        const paginatedResults = lspResults.slice(start, start + maxResults);
        return {
          results: paginatedResults,
          total_count: lspResults.length,
          search_backend: "lsp",
        };
      }

      printDebug("[Search] LSP returned no results, falling back to ripgrep.");
    } catch (error) {
      printDebug(
        `[Search] LSP search failed: ${(error as Error).message}, falling back to ripgrep`,
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

  // Apply exclude_paths filter (extra safety after ripgrep/grep)
  if (excludePaths.length > 0) {
    const beforeFilter = results.length;
    results = results.filter(
      (result) => !shouldExcludePath(result.file_path, excludePaths),
    );
    const afterFilter = results.length;
    if (beforeFilter !== afterFilter) {
      printDebug(
        `[Search] Excluded ${beforeFilter - afterFilter} results matching exclude_paths`,
      );
    }
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
  description: `Search for code symbols, references, documentation, and text patterns using LSP and ripgrep.

SEARCH TYPES:
- definition: Find where a symbol is defined (uses LSP workspace/symbol)
- references: Find all usages of a symbol at a specific position (uses LSP textDocument/references)
- hover: Get documentation/type info at a specific position (uses LSP textDocument/hover)
- text: Literal text search (uses ripgrep)
- regex: Pattern search (uses ripgrep)

TWO-PHASE WORKFLOW for finding all usages:
1. First, find the definition: search_code({ query: "MyClass", search_type: "definition" })
   → Returns file_path, line_number, column pointing to the symbol name
2. Then, find references: search_code({ search_type: "references", file_path: "...", line: N, column: M })
   → Returns all locations where the symbol is used

HOVER for documentation:
- search_code({ search_type: "hover", file_path: "...", line: N, column: M })
- Use the file_path/line/column from a definition result

EXAMPLES:
- Find class definition: { query: "UserService", search_type: "definition" }
- Find all usages: { search_type: "references", file_path: "src/user.ts", line: 10, column: 14 }
- Get docs: { search_type: "hover", file_path: "src/user.ts", line: 10, column: 14 }
- Text search: { query: "TODO", search_type: "text" }
- Regex search: { query: "async\\s+function", search_type: "regex" }`,

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Symbol name or text pattern to search for. Required for definition/text/regex. Not needed for references/hover when file_path/line/column are provided.",
      },
      search_type: {
        type: "string",
        enum: ["definition", "references", "hover", "text", "regex"],
        description:
          "Search type: 'definition' finds symbol declarations, 'references' finds all usages (requires position), 'hover' gets docs (requires position), 'text' for literal search, 'regex' for patterns.",
      },
      path: {
        type: "string",
        description:
          "Directory to search in (default: current directory). Only for definition/text/regex.",
      },
      file_path: {
        type: "string",
        description:
          "REQUIRED for references/hover. The file_path from a definition search result. Must be an absolute path or relative to working directory.",
      },
      line: {
        type: "integer",
        description:
          "REQUIRED for references/hover. 1-based line number from a definition search result.",
      },
      column: {
        type: "integer",
        description:
          "REQUIRED for references/hover. 1-based column number from a definition search result. Points to the start of the symbol name.",
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
          "Number of context lines before/after match (default: 5, max: 10)",
      },
      timeout_ms: {
        type: "integer",
        description:
          "LSP request timeout in milliseconds (default: 30000 for most languages, 120000 for Rust)",
      },
    },
    required: ["query", "search_type"],
  },

  handler: async (
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<MCPToolResult> => {
    try {
      // Validate required parameters - query is optional for positional references/hover
      const hasPosition =
        params["file_path"] !== undefined &&
        params["line"] !== undefined &&
        params["column"] !== undefined;

      if (typeof params["query"] !== "string" && !hasPosition) {
        throw new Error(
          "query must be a string (or provide file_path/line/column for positional queries)",
        );
      }
      if (typeof params["search_type"] !== "string") {
        throw new Error("search_type must be a string");
      }

      const searchParams: SearchCodeParams = {
        query: typeof params["query"] === "string" ? params["query"] : "",
        search_type: params["search_type"] as
          | "definition"
          | "references"
          | "hover"
          | "text"
          | "regex",
        path: typeof params["path"] === "string" ? params["path"] : undefined,
        file_path:
          typeof params["file_path"] === "string"
            ? params["file_path"]
            : undefined,
        line: typeof params["line"] === "number" ? params["line"] : undefined,
        column:
          typeof params["column"] === "number" ? params["column"] : undefined,
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
        timeout_ms:
          typeof params["timeout_ms"] === "number"
            ? params["timeout_ms"]
            : undefined,
      };

      const result = await searchCode(searchParams, context.workingDirectory);

      // Smart Truncation: ensure JSON output fits within 4KB while maintaining valid JSON
      const MAX_OUTPUT_SIZE = 4096;
      // Reserve space for pagination metadata
      const SAFE_SIZE_LIMIT = MAX_OUTPUT_SIZE - 150;

      let json = JSON.stringify(result, null, 2);

      // Only apply truncation/pagination for SearchResponse (not HoverResponse)
      if ("results" in result) {
        if (json.length > SAFE_SIZE_LIMIT) {
          result.limit_reason = "output_size_limit";
          // Iteratively remove results until it fits
          while (json.length > SAFE_SIZE_LIMIT && result.results.length > 0) {
            result.results.pop();
            json = JSON.stringify(result, null, 2);
          }
        }

        // Add pagination hints
        const start = searchParams.start ?? 0;
        const nextStart = start + result.results.length;
        const remaining = result.total_count - nextStart;

        if (remaining > 0) {
          result.next_start = nextStart;
          result.remaining_count = remaining;
          json = JSON.stringify(result, null, 2);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: json,
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

/**
 * Search using LSP with single-server cache.
 * Iterates through detected projects until results are found.
 */
async function searchWithLSP(
  query: string,
  workingDir: string,
  searchPath: string,
  fileTypes: string[],
  excludePaths: string[],
  timeoutMs?: number,
): Promise<SearchResult[] | null> {
  const absoluteWorkingDir = path.resolve(workingDir);

  // Initialize project detector
  if (!projectDetector) {
    projectDetector = new ProjectDetector(absoluteWorkingDir);
  }

  // Detect all projects in workspace
  let projects = await projectDetector.detectProjects();
  if (projects.length === 0) {
    printDebug("[Search] No projects detected in workspace");
    return null;
  }

  // For Rust workspaces: only query the workspace root, not individual crates
  // rust-analyzer at workspace root already indexes all member crates
  const workspaceRoots = projects.filter((p) => p.isWorkspaceRoot);
  const rustWorkspaceRoot = workspaceRoots.find((p) => p.language === "rust");

  if (rustWorkspaceRoot) {
    printDebug(
      `[Search] Using Cargo workspace root: ${rustWorkspaceRoot.path} (skipping ${projects.filter((p) => p.language === "rust").length - 1} member crates)`,
    );
    // Filter to only use the workspace root for Rust
    const nonRustProjects = projects.filter((p) => p.language !== "rust");
    projects = [rustWorkspaceRoot, ...nonRustProjects];
  }

  printDebug(
    `[Search] Found ${projects.length} projects, searching for "${query}"`,
  );

  // Prioritize projects: current cached project first, then by path depth
  const cache = getLSPCache();
  const sortedProjects = prioritizeProjects(
    projects,
    cache.getCurrentProject(),
  );

  const allResults: SearchResult[] = [];

  for (const project of sortedProjects) {
    printDebug(
      `[Search] Querying project: ${project.path}${project.isWorkspaceRoot ? " (workspace root)" : ""}`,
    );

    const client = await cache.getClient(project, timeoutMs);
    if (!client) {
      printDebug(`[Search] Could not get LSP client for ${project.path}`);
      continue;
    }

    try {
      const symbols = await client.getWorkspaceSymbols(query);
      printDebug(
        `[Search] Project ${project.path} returned ${symbols.length} symbols`,
      );

      if (symbols.length > 0) {
        const results: SearchResult[] = [];

        for (const symbol of symbols) {
          const filePath = symbol.location.uri.replace("file://", "");
          const lineNumber = symbol.location.range.start.line + 1;

          // Calculate accurate column by finding the symbol name in the source line
          const accurateColumn = await findSymbolColumnInFile(
            filePath,
            lineNumber,
            symbol.name,
            symbol.location.range.start.character + 1,
          );

          results.push({
            file_path: filePath,
            line_number: lineNumber,
            column: accurateColumn,
            match_text: symbol.name,
            context: `Symbol: ${symbol.name} (kind: ${symbol.kind})`,
          });
        }

        allResults.push(...results);
      }

      // Optimization: For workspace roots, we can stop after getting results
      // since the workspace root LSP already indexes all member crates
      if (project.isWorkspaceRoot && allResults.length > 0) {
        printDebug(
          `[Search] Found ${allResults.length} results from workspace root, stopping search`,
        );
        break;
      }
    } catch (error) {
      printDebug(
        `[Search] LSP query failed for ${project.path}: ${(error as Error).message}`,
      );
    }
  }

  if (allResults.length === 0) {
    return null;
  }

  // Apply filters
  let filtered = allResults;

  // Path filter
  if (searchPath !== ".") {
    const fullSearchPath = path.resolve(workingDir, searchPath);
    filtered = filtered.filter((r) => r.file_path.startsWith(fullSearchPath));
  }

  // File type filter
  if (fileTypes.length > 0) {
    filtered = filtered.filter((r) => {
      const ext = path.extname(r.file_path).slice(1);
      return fileTypes.includes(ext);
    });
  }

  // Exclude paths filter
  if (excludePaths.length > 0) {
    filtered = filtered.filter(
      (r) => !shouldExcludePath(r.file_path, excludePaths),
    );
  }

  // Deduplicate by file:line
  const seen = new Set<string>();
  filtered = filtered.filter((r) => {
    const key = `${r.file_path}:${r.line_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return filtered;
}

/**
 * Sort projects for optimal search order:
 * 1. Currently cached project (no LSP restart needed)
 * 2. Shallower paths first (root projects more likely to have shared code)
 */
function prioritizeProjects(
  projects: ProjectRoot[],
  currentProject: ProjectRoot | null,
): ProjectRoot[] {
  return [...projects].sort((a, b) => {
    // Current project always first
    if (currentProject) {
      if (a.path === currentProject.path) return -1;
      if (b.path === currentProject.path) return 1;
    }

    // Then by path depth (shallower first)
    const depthA = a.path.split(path.sep).length;
    const depthB = b.path.split(path.sep).length;
    return depthA - depthB;
  });
}

/**
 * Find the accurate column position of a symbol name in a source file.
 *
 * workspace/symbol returns the start of the declaration (e.g., column 1 for "export class Foo"),
 * but hover/references need the position of the symbol name itself (e.g., column 14 for "Foo").
 *
 * This function reads the source line and finds where the symbol name actually starts.
 */
async function findSymbolColumnInFile(
  filePath: string,
  lineNumber: number,
  symbolName: string,
  fallbackColumn: number,
): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const line = lines[lineNumber - 1]; // Convert to 0-based

    if (!line) {
      return fallbackColumn;
    }

    // Find the symbol name in the line
    // Use word boundary matching to avoid partial matches
    // e.g., for "LSPClient", don't match "LSPClientFactory"
    const regex = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`);
    const match = line.match(regex);

    if (match && match.index !== undefined) {
      return match.index + 1; // Convert to 1-based column
    }

    // Fallback: simple indexOf (less accurate but better than nothing)
    const index = line.indexOf(symbolName);
    if (index !== -1) {
      return index + 1;
    }

    return fallbackColumn;
  } catch (error) {
    printDebug(
      `[Search] Could not read file for column calculation: ${filePath}`,
    );
    return fallbackColumn;
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
