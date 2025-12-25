// ~/.config/deft/guardrails.js

/**
 * Project type detection and verification commands
 * The guardrail auto-detects project type from:
 *   1. File extension being modified
 *   2. Project marker files in working directory
 */
const PROJECT_CONFIGS = {
  // Node.js / TypeScript
  node: {
    markers: ['package.json'],
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'],
    buildCmd: 'npm run build',
    testCmd: 'npm test',
  },
  // Rust
  rust: {
    markers: ['Cargo.toml'],
    extensions: ['.rs'],
    buildCmd: 'cargo build',
    testCmd: 'cargo test',
  },
  // Python
  python: {
    markers: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    extensions: ['.py'],
    buildCmd: null,  // Python typically doesn't have a build step
    testCmd: 'pytest',
  },
  // Go
  go: {
    markers: ['go.mod'],
    extensions: ['.go'],
    buildCmd: 'go build ./...',
    testCmd: 'go test ./...',
  },
  // C/C++ with CMake
  cmake: {
    markers: ['CMakeLists.txt'],
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'],
    buildCmd: 'cmake --build build',
    testCmd: 'ctest --test-dir build',
  },
  // C/C++ with Meson
  meson: {
    markers: ['meson.build'],
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'],
    buildCmd: 'meson compile -C builddir',
    testCmd: 'meson test -C builddir',
  },
  // C/C++ with Make (lower priority than CMake/Meson)
  make: {
    markers: ['Makefile', 'makefile', 'GNUmakefile'],
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'],
    buildCmd: 'make',
    testCmd: 'make test',
  },
};

/** Whether auto-verify is enabled globally */
const AUTO_VERIFY_ENABLED = true;

/**
 * Deft Programmable Guardrails
 *
 * This script runs in a sandbox within the Deft process.
 *
 * See docs/guardrails_api.md for full API reference.
 *
 * Quick reference - ctx contains:
 *   tool: { name, args }
 *   history: { messages, lastUserMessage }
 *   memory: { snapshot }
 *   system: { fs, cmd }
 *   std: Standard library helpers
 */

// Track retry counts to prevent infinite loops
// This is a simple in-memory counter; resets when Deft restarts
const outputRetryCounters = new Map();
const MAX_OUTPUT_RETRIES = 3;

// Track consecutive identical tool calls (loop detection)
const toolCallHistory = [];
const MAX_TOOL_HISTORY = 20;

/**
 * Extract semantic signature from tool call for loop detection.
 * This captures the "intent" rather than exact args, catching retries
 * with slightly different content but same target.
 */
function getToolSignature(toolName, args) {
  switch (toolName) {
    case 'patch': {
      // For patch: extract target files (ignore diff content changes)
      const files = [];
      const diffContent = args.unified_diff || '';
      const regex = /^\+\+\+ [ab]\/(.+)$/gm;
      let match;
      while ((match = regex.exec(diffContent)) !== null) {
        if (match[1]) files.push(match[1].trim());
      }
      return JSON.stringify({tool: toolName, files: files.sort()});
    }

    case 'read_file': {
      // INCLUDE the args in the signature so pagination isn't flagged as a loop
      const path = args.path || args.paths?.[0] || '';
      const start = args.start_line || 0;
      const count = args.line_count || 'all';
      return JSON.stringify({tool: toolName, path, start, count});
    }

    case 'write_file': {
      // For write_file: path only (content changes are expected in retries)
      return JSON.stringify({tool: toolName, path: args.path || ''});
    }

    case 'search_code':
    case 'mgrep': {
      // For search: query + scope (slight query variations still count as same
      // intent)
      const query =
          (args.query || '').substring(0, 50);  // Truncate long queries
      return JSON.stringify(
          {tool: toolName, query, scope: args.scope || args.path || '.'});
    }

    case 'run_cmd': {
      // For run_cmd: exact command (retrying same command is definitely a loop)
      return JSON.stringify({tool: toolName, command: args.command || ''});
    }

    default:
      // Fallback: full args signature
      return JSON.stringify({tool: toolName, args});
  }
}

/**
 * Detect if we're in a tool call loop (same intent 3+ times in last 6 calls)
 * Uses semantic signatures to catch retries with slightly different args.
 */
function detectLoop(toolName, args) {
  // read_file is exempt from loop detection - re-reading files is normal
  // during complex coding tasks, especially after modifications
  if (toolName === 'read_file') {
    return false;
  }

  const signature = getToolSignature(toolName, args);
  toolCallHistory.push({signature, timestamp: Date.now()});

  // Trim old history
  while (toolCallHistory.length > MAX_TOOL_HISTORY) {
    toolCallHistory.shift();
  }

  // Check recent calls for repeated signatures
  if (toolCallHistory.length >= 6) {  // Require more history before detecting
    const recent = toolCallHistory.slice(-6);
    const counts = {};
    for (const entry of recent) {
      counts[entry.signature] = (counts[entry.signature] || 0) + 1;
      if (counts[entry.signature] >= 4)
        return true;  // Require 4 repeats, not 3
    }
  }
  return false;
}

/**
 * Detect project type from file path and working directory
 * @param {string} filePath - The file being modified
 * @param {{readFile: function, getChecksum: function}} fsApi - Filesystem API
 *     from ctx.system.fs
 * @returns {Promise<{projectType: string, buildCmd: string|null, testCmd:
 *     string|null}|null>}
 */
async function detectProjectType(filePath, fsApi) {
  const ext = filePath.substring(filePath.lastIndexOf('.'));

  // First try to match by file extension
  for (const [name, config] of Object.entries(PROJECT_CONFIGS)) {
    if (config.extensions.includes(ext)) {
      // Verify project marker exists
      for (const marker of config.markers) {
        try {
          await fsApi.readFile(marker);
          // Marker found, use this config
          return {
            projectType: name,
            buildCmd: config.buildCmd,
            testCmd: config.testCmd,
          };
        } catch {
          // Marker not found, try next
        }
      }
    }
  }

  // Fallback: check all markers regardless of extension
  for (const [name, config] of Object.entries(PROJECT_CONFIGS)) {
    for (const marker of config.markers) {
      try {
        await fsApi.readFile(marker);
        return {
          projectType: name,
          buildCmd: config.buildCmd,
          testCmd: config.testCmd,
        };
      } catch {
        // Continue
      }
    }
  }

  return null;  // Unknown project type
}

export default {
  /**
   * INPUT HOOK: Runs BEFORE a tool is executed.
   * Return { allowed: true } or { allowed: false, message: "..." }
   */
  input:
      async (ctx) => {
        // -------------------------------------------------------------------------
        // RULE 0: Loop Detection (Cross-call pattern - tools can't see this)
        // -------------------------------------------------------------------------
        if (detectLoop(ctx.tool.name, ctx.tool.args)) {
          return {
            allowed: false,
            message:
                `LOOP DETECTED: You've called '${
                    ctx.tool.name}' with similar arguments multiple times. ` +
                `STOP and try a different approach or ask the user for guidance.`
          };
        }

        // -------------------------------------------------------------------------
        // RULE 1: Stale Context Check (Anti-Hallucination)
        // -------------------------------------------------------------------------
        // If the LLM tries to patch a file, verify that the file hasn't changed
        // on disk since the LLM last read it via 'read_file'.
        if (ctx.tool.name === 'patch' || ctx.tool.name === 'write_file') {
          // For write_file, check the single target file
          if (ctx.tool.name === 'write_file') {
            const targetPath = ctx.tool.args.path;
            if (targetPath && await ctx.std.isFileStale(targetPath)) {
              return {
                allowed: false,
                message: `SAFETY BLOCK: File '${
                    targetPath}' has changed on disk since you read it. You MUST call 'read_file' again before overwriting.`
              };
            }
          } else {
            // For patch, check all files in the diff
            const staleFiles =
                await ctx.std.checkStaleContext(ctx.tool.args.unified_diff);

            if (staleFiles.length > 0) {
              return {
                allowed: false,
                message:
                    `SAFETY BLOCK: The following files have changed on disk since you read them: ${
                        staleFiles.join(
                            ', ')}. \n\nYou rely on stale context. You MUST call 'read_file' on these files again before applying the patch.`
              };
            }
          }
        }

        // -------------------------------------------------------------------------
        // RULE 2: Protect Critical Files
        // -------------------------------------------------------------------------
        if (ctx.tool.name === 'write_file' || ctx.tool.name === 'read_file' ||
            ctx.tool.name === 'patch') {
          const filePath = ctx.tool.args.path || ctx.tool.args.filepath;
          // More precise patterns to avoid false positives (e.g.,
          // "my.environment.ts")
          const protectedPatterns = [
            /(?:^|[/\\])\.env(?:\..+)?$/,  // .env, .env.local, .env.production
            /id_rsa/,                      // SSH private keys
            /id_ed25519/,                  // Ed25519 SSH keys
            /\.pem$/,                      // Certificate files
            /(?:^|[/\\])secrets?\.(?:json|ya?ml)$/i,  // secrets.json,
                                                      // secret.yaml
            /(?:^|[/\\])\.git[/\\]/,  // .git directory internals
          ];
          if (filePath && protectedPatterns.some(p => p.test(filePath))) {
            return {
              allowed: false,
              message:
                  'SECURITY BLOCK: You are not allowed to modify protected files (.env, SSH keys, .git internals).'
            };
          }
        }

        return {allowed: true};
      },

  /**
   * OUTPUT HOOK: Runs AFTER a tool is executed.
   * Return { override: false } or { override: true, result: "...", isError:
   * boolean }
   */
  output: async (ctx) => {
    // -------------------------------------------------------------------------
    // RETRY LIMIT: Prevent infinite loops from output overrides
    // -------------------------------------------------------------------------
    const retryKey = `${ctx.tool.name}_output`;
    const currentRetries = outputRetryCounters.get(retryKey) ?? 0;

    // Check if we've exceeded retry limit
    if (currentRetries >= MAX_OUTPUT_RETRIES) {
      // Log warning but allow the result through
      outputRetryCounters.set(retryKey, 0);  // Reset for next sequence
      return {override: false};
    }

    // -------------------------------------------------------------------------
    // RULE 3: Auto-Verify Changes After Successful Code Edits (Multi-Language)
    // -------------------------------------------------------------------------
    const isCodeEditTool =
        ctx.tool.name === 'patch' || ctx.tool.name === 'write_file';
    const isFullSuccess = !ctx.result.isError &&
        !ctx.result.content?.includes('partial') &&
        !ctx.result.content?.includes('PARTIAL');

    if (!AUTO_VERIFY_ENABLED || !isCodeEditTool || !isFullSuccess) {
      return {override: false};
    }

    // Get the file path from tool args (different for patch vs write_file)
    let filePath;
    if (ctx.tool.name === 'patch') {
      // Extract first file from unified diff
      const files = ctx.std.parseUnifiedDiff(ctx.tool.args.unified_diff);
      filePath = files[0];
    } else {
      // write_file uses path directly
      filePath = ctx.tool.args.path || ctx.tool.args.filepath;
    }

    if (!filePath) {
      return {override: false};
    }

    // Detect project type
    const projectConfig = await detectProjectType(filePath, ctx.system.fs);
    if (!projectConfig) {
      // Unknown project type, skip verification
      return {override: false};
    }

    // Dynamically add build/test commands to allowed list if needed
    // This requires 'process' access within the guardrail sandbox
    const ensureAllowed = (cmd) => {
      if (!cmd || typeof process === 'undefined' || !process.env) return;
      const key = 'DEFT_ALLOWED_COMMANDS';
      const current = process.env[key] || '';
      // Check strict inclusion to avoid duplication
      if (!current.split(',').map(s => s.trim()).includes(cmd)) {
        process.env[key] = current ? `${current},${cmd}` : cmd;
      }
    };
    ensureAllowed(projectConfig.buildCmd);
    ensureAllowed(projectConfig.testCmd);

    const verifyResults = [];
    let hasFailure = false;

    // Run build command
    if (projectConfig.buildCmd) {
      const build = await ctx.system.cmd.exec(projectConfig.buildCmd);
      if (build.exitCode !== 0) {
        hasFailure = true;
        verifyResults.push(`BUILD FAILED [${projectConfig.projectType}] (exit ${
            build.exitCode}):\n${
            (build.stdout + build.stderr).substring(0, 1000)}`);
      } else {
        verifyResults.push(`BUILD [${projectConfig.projectType}]: OK`);
      }
    }

    // Run test command (only if build succeeded or no build cmd)
    if (projectConfig.testCmd && !hasFailure) {
      const test = await ctx.system.cmd.exec(projectConfig.testCmd);
      if (test.exitCode !== 0) {
        hasFailure = true;
        verifyResults.push(`TESTS FAILED [${projectConfig.projectType}] (exit ${
            test.exitCode}):\n${
            (test.stdout + test.stderr).substring(0, 1500)}`);
      } else {
        verifyResults.push(`TESTS [${projectConfig.projectType}]: OK`);
      }
    }

    // Augment the result with verification output
    const separator = '\n\n--- AUTO-VERIFY ---\n';
    const augmentedResult =
        ctx.result.content + separator + verifyResults.join('\n');

    if (hasFailure) {
      outputRetryCounters.set(retryKey, currentRetries + 1);
      return {
        override: true,
        isError: true,
        result: augmentedResult + '\n\nFix the issues above before proceeding.'
      };
    }

    // Success case: still augment with verification results
    return {
      override: true,
      isError: false,
      result: augmentedResult + '\n\n<system-reminder>\n' +
          'Build and tests have ALREADY been executed by the guardrail. ' +
          'Do NOT run build/test commands yourself. Proceed to the next task.\n' +
          '</system-reminder>'
    };
  }
};
