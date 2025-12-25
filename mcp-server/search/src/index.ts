#!/usr/bin/env node

import { createServer } from "./server.js";
import { LSPManager } from "./lsp-manager.js";
import { printDebug } from "./utils/log.js";
import {
  searchCodeToolHandler,
  getFileStructureToolHandler,
  searchAndReplaceToolHandler,
  getLspDiagnosticsToolHandler,
} from "./tools/index.js";

// Get working directory from env or use cwd
const workingDir = process.env["WORKING_DIR"] ?? process.cwd();

/**
 * Test and display LSP server availability at startup
 */
async function checkLspAvailability(workingDirectory: string): Promise<void> {
  printDebug("[Search MCP] Checking LSP server availability...");

  const lspManager = new LSPManager(workingDirectory);

  // Infer language first to optimize detection
  const inferredLanguage = await lspManager.inferLanguage();

  // Only check for the relevant LSP server to save time
  await lspManager.initialize(inferredLanguage);

  const summary = lspManager.getDetectedServersSummary();

  // Display available servers
  if (summary.available.length > 0) {
    printDebug("[Search MCP] ✓ Available LSP servers:");
    for (const server of summary.available) {
      printDebug(`[Search MCP]   • ${server.language}: ${server.command}`);
    }
  }

  // Check if the inferred project language has LSP support
  if (inferredLanguage !== undefined) {
    printDebug(`[Search MCP] Detected project language: ${inferredLanguage}`);

    const hasLspForProject = summary.available.some(
      (s) => s.language === inferredLanguage,
    );

    if (hasLspForProject) {
      printDebug(
        `[Search MCP] ✓ LSP support available for ${inferredLanguage}`,
      );
    } else {
      printDebug(`[Search MCP] ⚠ No LSP server found for ${inferredLanguage}`);
      printDebug(
        `[Search MCP]   Install the language server for better code intelligence:`,
      );
      printLspInstallHint(inferredLanguage);
    }
  }

  // Warn if no LSP servers are available at all
  if (summary.available.length === 0) {
    printDebug(
      "[Search MCP] ════════════════════════════════════════════════════════════",
    );
    printDebug("[Search MCP] ⚠ WARNING: No LSP servers detected!");
    printDebug("[Search MCP]");
    printDebug(
      "[Search MCP] Setting up LSP for your project is HIGHLY RECOMMENDED for",
    );
    printDebug("[Search MCP] LLM coding tasks. LSP provides:");
    printDebug(
      "[Search MCP]   • Precise error locations (get_lsp_diagnostics tool)",
    );
    printDebug(
      "[Search MCP]   • Symbol definitions and references (search_code tool)",
    );
    printDebug(
      "[Search MCP]   • Better code intelligence for the AI assistant",
    );
    printDebug("[Search MCP]");
    printDebug(
      "[Search MCP] Install a language server based on your project type:",
    );
    printDebug(
      "[Search MCP]   TypeScript: npm install -g typescript-language-server typescript",
    );
    printDebug("[Search MCP]   Python:     pip install python-lsp-server");
    printDebug("[Search MCP]   Rust:       rustup component add rust-analyzer");
    printDebug(
      "[Search MCP]   Go:         go install golang.org/x/tools/gopls@latest",
    );
    printDebug(
      "[Search MCP]   C/C++:      Install clangd (apt install clangd / brew install llvm)",
    );
    printDebug(
      "[Search MCP] ════════════════════════════════════════════════════════════",
    );
  }

  // Stop the manager (we'll create new instances as needed for actual operations)
  lspManager.stopAll();
}

/**
 * Print language-specific LSP installation hint
 */
function printLspInstallHint(language: string): void {
  const hints: Record<string, string> = {
    typescript: "  npm install -g typescript-language-server typescript",
    python: "  pip install python-lsp-server",
    rust: "  rustup component add rust-analyzer",
    go: "  go install golang.org/x/tools/gopls@latest",
    java: "  Install Eclipse JDT Language Server (jdtls)",
    cpp: "  Install clangd: apt install clangd / brew install llvm",
    c: "  Install clangd: apt install clangd / brew install llvm",
  };

  const hint = hints[language];
  if (hint !== undefined) {
    printDebug(`[Search MCP] ${hint}`);
  }
}

const server = createServer({
  name: "search-server",
  version: "1.0.0",
  workingDirectory: workingDir,
  tools: [
    searchCodeToolHandler,
    getFileStructureToolHandler,
    searchAndReplaceToolHandler,
    getLspDiagnosticsToolHandler,
  ],
});

// Start server immediately to handle 'initialize' request and avoid timeout
server.start();

// Run LSP check in background
checkLspAvailability(workingDir).catch((error) => {
  // Log warning only, do not crash the server
  printDebug(
    `[Search MCP] LSP availability check skipped: ${(error as Error).message}`,
  );
  printDebug(`[Search MCP] LSP check debug: ${(error as Error).stack}`);
});

printDebug(
  `[Search MCP Server] Initialized with working directory: ${workingDir}`,
);
