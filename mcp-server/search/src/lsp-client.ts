import { spawn, ChildProcess } from "child_process";
import { printDebug, printInfo } from "./utils/log.js";

// Basic LSP types
export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: LSPLocation;
  containerName?: string;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  code?: string | number;
  source?: string;
  message: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LSPDiagnostic[];
}

// JSON-RPC message structures
interface RPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any;
}

interface RPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: any;
}

interface RPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

type RPCMessage = RPCResponse | RPCNotification;

export class LSPClient {
  private process!: ChildProcess;
  private requestCounter = 0;
  private pendingRequests: Map<number, (response: RPCResponse) => void> =
    new Map();
  // Waiters for diagnostics per URI
  private diagnosticWaiters: Map<string, (d: LSPDiagnostic[]) => void> =
    new Map();
  public isInitialized = false;
  public capabilities: any = {};

  // Store diagnostics received via notifications
  private diagnosticsMap: Map<string, LSPDiagnostic[]> = new Map();

  constructor(
    private serverCommand: string[],
    private workspaceRoot: string,
  ) {}

  public async start(): Promise<boolean> {
    printDebug(
      `[LSPClient] Starting LSP server: ${this.serverCommand.join(" ")}`,
    );
    const [command, ...args] = this.serverCommand;

    this.process = spawn(command, args, {
      cwd: this.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stderr?.on("data", (data) => {
      printDebug(`[LSPClient Server STDERR] ${data.toString()}`);
    });

    this.process.stdout?.on("data", (data) => this.handleData(data));

    this.process.on("exit", (code) => {
      printInfo(`[LSPClient] Server process exited with code ${code}`);
      this.isInitialized = false;
    });

    return this.initialize();
  }

  private async initialize(): Promise<boolean> {
    const params = {
      processId: process.pid,
      rootUri: `file://${this.workspaceRoot}`,
      capabilities: {
        workspace: {
          symbol: {
            dynamicRegistration: true,
            symbolKind: {
              valueSet: [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                19, 20, 21, 22, 23, 24, 25, 26,
              ],
            },
          },
        },
        textDocument: {
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: false,
            tagSupport: { valueSet: [1, 2] },
            codeDescriptionSupport: true,
            dataSupport: true,
          },
        },
      },
      trace: "off",
    };

    try {
      const response = await this.sendRequest("initialize", params);
      this.capabilities = response.result.capabilities;
      this.sendNotification("initialized", {});
      this.isInitialized = true;
      printDebug("[LSPClient] LSP server initialized successfully.");
      return true;
    } catch (error) {
      printInfo("[LSPClient] LSP initialization failed:", error);
      return false;
    }
  }

  private sendRequest(method: string, params: any): Promise<RPCResponse> {
    return new Promise((resolve, reject) => {
      const id = this.requestCounter++;
      const request: RPCRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      this.pendingRequests.set(id, resolve);
      this.sendMessage(request);

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${id} (${method}) timed out.`));
        }
      }, 10000); // 10 second timeout
    });
  }

  private sendNotification(method: string, params: any): void {
    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.sendMessage(notification);
  }

  private sendMessage(message: object): void {
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    this.process.stdin?.write(header);
    this.process.stdin?.write(body);
  }

  private buffer = "";
  private handleData(data: Buffer) {
    this.buffer += data.toString("utf-8");
    while (true) {
      const match = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!match) {
        break;
      }

      const contentLength = parseInt(match[1], 10);
      const messageStart = match.index! + match[0].length;

      if (this.buffer.length < messageStart + contentLength) {
        break;
      }

      const messageBody = this.buffer.substring(
        messageStart,
        messageStart + contentLength,
      );
      this.buffer = this.buffer.substring(messageStart + contentLength);

      try {
        const message = JSON.parse(messageBody) as RPCMessage;
        if ("id" in message) {
          const callback = this.pendingRequests.get(message.id);
          if (callback) {
            callback(message);
            this.pendingRequests.delete(message.id);
          }
        } else {
          // Handle notifications from server (e.g., diagnostics)
          this.handleNotification(message);
        }
      } catch (error) {
        printInfo("[LSPClient] Error parsing message:", error);
      }
    }
  }

  private handleNotification(notification: RPCNotification): void {
    if (notification.method === "textDocument/publishDiagnostics") {
      const params = notification.params as PublishDiagnosticsParams;
      if (params?.uri && params?.diagnostics) {
        this.diagnosticsMap.set(params.uri, params.diagnostics);
        printDebug(
          `[LSPClient] Received ${params.diagnostics.length} diagnostics for ${params.uri}`,
        );

        // Resolve any pending waiters for this URI
        const waiter = this.diagnosticWaiters.get(params.uri);
        if (waiter) {
          waiter(params.diagnostics);
          this.diagnosticWaiters.delete(params.uri);
        }
      }
    }
  }

  public async getWorkspaceSymbols(
    query: string,
  ): Promise<SymbolInformation[]> {
    if (!this.isInitialized) {
      throw new Error("LSP client is not initialized.");
    }
    const params = { query };
    const response = await this.sendRequest("workspace/symbol", params);
    return response.result as SymbolInformation[];
  }

  /**
   * Open a document to trigger diagnostics
   */
  public async openDocument(
    uri: string,
    languageId: string,
    content: string,
  ): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("LSP client is not initialized.");
    }

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    });

    // Note: We don't sleep here anymore. The caller should use waitForDiagnostics
  }

  /**
   * Wait for diagnostics.
   * IMPROVED: Waits for a "settle" period after the first diagnostic
   * to allow for multi-pass servers (Syntax first, then Semantic).
   */
  public async waitForDiagnostics(
    uri: string,
    timeoutMs: number = 5000,
  ): Promise<LSPDiagnostic[]> {
    return new Promise<LSPDiagnostic[]>((resolve) => {
      let settled = false;
      const settleTime = 1000; // Wait 1s after last message to ensure stream is done

      // Hard timeout (failsafe)
      const maxTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.diagnosticWaiters.delete(uri);
          printDebug(`[LSPClient] Max timeout reached for ${uri}`);
          resolve(this.getDiagnostics(uri));
        }
      }, timeoutMs);

      let settleTimer: NodeJS.Timeout | undefined;

      // CHANGE: Removed 'diagnostics' parameter to fix TS6133
      this.diagnosticWaiters.set(uri, () => {
        if (settled) return;

        printDebug(
          `[LSPClient] Received diagnostics update... waiting for settle`,
        );

        // Reset the settle timer on every update
        if (settleTimer) clearTimeout(settleTimer);

        settleTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            clearTimeout(maxTimer);
            this.diagnosticWaiters.delete(uri);
            printDebug(`[LSPClient] Diagnostics settled for ${uri}`);
            resolve(this.getDiagnostics(uri));
          }
        }, settleTime);
      });
    });
  }

  /**
   * Close a document
   */
  public closeDocument(uri: string): void {
    if (!this.isInitialized) return;

    this.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });

    // Clear cached diagnostics
    this.diagnosticsMap.delete(uri);
  }

  /**
   * Get cached diagnostics for a URI
   */
  public getDiagnostics(uri: string): LSPDiagnostic[] {
    return this.diagnosticsMap.get(uri) ?? [];
  }

  /**
   * Clear all cached diagnostics
   */
  public clearDiagnostics(): void {
    this.diagnosticsMap.clear();
  }

  public stop() {
    this.sendNotification("exit", {});
    this.process.kill();
  }
}
