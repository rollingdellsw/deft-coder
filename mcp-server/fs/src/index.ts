#!/usr/bin/env node

import { createServer } from "./server.js";
import {
  readFileToolHandler,
  writeFileToolHandler,
  listFilesToolHandler,
  searchFilesToolHandler,
  deleteFileTool,
  createDirectoryTool,
} from "./tools/index.js";

// Get working directory from env or use cwd
const workingDir = process.env["WORKING_DIR"] ?? process.cwd();

const server = createServer({
  name: "filesystem-server",
  version: "1.0.0",
  workingDirectory: workingDir,
  tools: [
    readFileToolHandler,
    writeFileToolHandler,
    listFilesToolHandler,
    searchFilesToolHandler,
    deleteFileTool,
    createDirectoryTool,
  ],
});

server.start();
