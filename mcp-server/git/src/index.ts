#!/usr/bin/env node

import { createServer } from "./server.js";
import { gitCommandToolHandler } from "./tools/index.js";
import { printDebug } from "./utils/log.js";

// Get working directory from env or use cwd
const workingDir = process.env["WORKING_DIR"] ?? process.cwd();

const server = createServer({
  name: "git-server",
  version: "1.0.0",
  workingDirectory: workingDir,
  tools: [gitCommandToolHandler],
});

server.start();

printDebug(
  `[Git MCP Server] Initialized with working directory: ${workingDir}`,
);
