import { LSPClient } from "./lsp-client.js";
import { ProjectRoot, LanguageID } from "./project-detector.js";
import { printDebug, printInfo } from "./utils/log.js";

interface ServerConfig {
  command: string[];
}

const SERVER_CONFIGS: Record<LanguageID, ServerConfig> = {
  typescript: { command: ["typescript-language-server", "--stdio"] },
  rust: { command: ["rust-analyzer"] },
  python: { command: ["pylsp"] },
  go: { command: ["gopls"] },
  java: { command: ["jdtls"] },
  cpp: { command: ["clangd"] },
  c: { command: ["clangd"] },
};

/**
 * Single-server LSP cache with automatic idle shutdown.
 *
 * Memory-bounded: Only ONE LSP server runs at a time.
 * When switching projects, the old server is stopped before starting a new one.
 */
export class LSPServerCache {
  private currentClient: LSPClient | null = null;
  private currentProject: ProjectRoot | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  /** Idle timeout before auto-shutdown (5 minutes) */
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  /**
   * Get LSP client for a project.
   * - Cache hit: returns existing client
   * - Cache miss: stops old client, starts new one
   */
  async getClient(
    project: ProjectRoot,
    timeoutMs?: number,
  ): Promise<LSPClient | null> {
    this.resetIdleTimer();

    // Cache hit - same project, client still alive
    if (
      this.currentProject?.path === project.path &&
      this.currentClient?.isInitialized
    ) {
      printDebug(`[LSP Cache] Hit: reusing client for ${project.path}`);
      return this.currentClient;
    }

    // Cache miss - need to switch
    printDebug(
      `[LSP Cache] Miss: switching from ${this.currentProject?.path ?? "none"} to ${project.path}`,
    );

    // Stop old client
    await this.stopCurrent();

    // Start new client
    const config = SERVER_CONFIGS[project.language];
    if (!config) {
      printInfo(
        `[LSP Cache] No server config for language: ${project.language}`,
      );
      return null;
    }

    try {
      const client = new LSPClient(
        config.command,
        project.path,
        project.language,
        timeoutMs,
      );
      const started = await client.start();

      if (!started) {
        printInfo(`[LSP Cache] Failed to start LSP for ${project.path}`);
        return null;
      }

      this.currentClient = client;
      this.currentProject = project;

      printDebug(
        `[LSP Cache] Started ${project.language} LSP at ${project.path}`,
      );
      return client;
    } catch (error) {
      printInfo(`[LSP Cache] Error starting LSP: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Check if we have an active client for the given project
   */
  hasClientFor(project: ProjectRoot): boolean {
    return (
      this.currentProject?.path === project.path &&
      this.currentClient?.isInitialized === true
    );
  }

  /**
   * Get current project (if any)
   */
  getCurrentProject(): ProjectRoot | null {
    return this.currentProject;
  }

  /**
   * Stop the current LSP server and clear cache
   */
  async stopCurrent(): Promise<void> {
    if (this.currentClient) {
      printDebug(`[LSP Cache] Stopping LSP at ${this.currentProject?.path}`);
      try {
        await this.currentClient.stop();
      } catch (error) {
        printDebug(
          `[LSP Cache] Error stopping client: ${(error as Error).message}`,
        );
      }
      this.currentClient = null;
      this.currentProject = null;
    }
  }

  /**
   * Stop all and cleanup (call on shutdown)
   */
  async shutdown(): Promise<void> {
    this.clearIdleTimer();
    await this.stopCurrent();
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();

    this.idleTimer = setTimeout(() => {
      printDebug("[LSP Cache] Idle timeout reached - stopping LSP server");
      void this.stopCurrent();
    }, this.IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// Global singleton instance
let globalCache: LSPServerCache | null = null;

export function getLSPCache(): LSPServerCache {
  if (!globalCache) {
    globalCache = new LSPServerCache();
  }
  return globalCache;
}

export function shutdownLSPCache(): Promise<void> {
  if (globalCache) {
    return globalCache.shutdown();
  }
  return Promise.resolve();
}
