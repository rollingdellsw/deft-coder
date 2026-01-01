import * as path from "path";
import * as fs from "fs/promises";
import { printDebug } from "./utils/log.js";

export type LanguageID =
  | "typescript"
  | "rust"
  | "python"
  | "go"
  | "java"
  | "cpp"
  | "c";

export interface ProjectRoot {
  path: string; // Absolute path to project root
  language: LanguageID;
  configFile: string; // e.g., "tsconfig.json"
  isWorkspaceRoot?: boolean; // True if this is a Cargo/npm workspace root
}

interface ConfigMarker {
  file: string;
  language: LanguageID;
}

const CONFIG_MARKERS: ConfigMarker[] = [
  { file: "tsconfig.json", language: "typescript" },
  { file: "Cargo.toml", language: "rust" },
  { file: "go.mod", language: "go" },
  { file: "pyproject.toml", language: "python" },
  { file: "setup.py", language: "python" },
  { file: "pom.xml", language: "java" },
  { file: "build.gradle", language: "java" },
];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  "__pycache__",
  "venv",
  ".venv",
]);

export class ProjectDetector {
  private cache: ProjectRoot[] | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 60_000; // 1 minute

  constructor(private workspaceRoot: string) {}

  /**
   * Find all project roots in the workspace
   * Results are cached for 1 minute
   */
  async detectProjects(): Promise<ProjectRoot[]> {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < this.CACHE_TTL) {
      return this.cache;
    }

    printDebug(
      `[ProjectDetector] Scanning ${this.workspaceRoot} for projects...`,
    );
    const projects: ProjectRoot[] = [];
    await this.scanDirectory(this.workspaceRoot, projects, 0);

    // Filter out workspace members (keep only workspace roots for Rust/TS)
    const filtered = await this.filterWorkspaceMembers(projects);

    // Sort: prefer shallower paths (root projects first)
    filtered.sort((a, b) => {
      const depthA = a.path.split(path.sep).length;
      const depthB = b.path.split(path.sep).length;
      return depthA - depthB;
    });

    printDebug(
      `[ProjectDetector] Found ${filtered.length} projects (after workspace filtering)`,
    );
    this.cache = filtered;
    this.cacheTime = now;

    return filtered;
  }

  /**
   * Filter out workspace member projects.
   * For Cargo workspaces: keep only the root, not individual crates.
   * For TypeScript: keep only composite project roots.
   */
  private async filterWorkspaceMembers(
    projects: ProjectRoot[],
  ): Promise<ProjectRoot[]> {
    const workspaceRoots = new Set<string>();
    const memberPaths = new Set<string>();

    // First pass: identify workspace roots and their members
    for (const project of projects) {
      if (project.language === "rust") {
        const members = await this.getCargoWorkspaceMembers(project.path);
        if (members.length > 0) {
          // This is a workspace root
          workspaceRoots.add(project.path);
          project.isWorkspaceRoot = true;
          for (const member of members) {
            memberPaths.add(member);
          }
          printDebug(
            `[ProjectDetector] Cargo workspace root: ${project.path} (${members.length} members)`,
          );
        }
      } else if (project.language === "typescript") {
        const isComposite = await this.isTypeScriptComposite(project.path);
        if (isComposite) {
          workspaceRoots.add(project.path);
          project.isWorkspaceRoot = true;
          // Get referenced projects
          const refs = await this.getTypeScriptReferences(project.path);
          for (const ref of refs) {
            memberPaths.add(ref);
          }
          printDebug(
            `[ProjectDetector] TypeScript composite root: ${project.path}`,
          );
        }
      }
    }

    // Second pass: filter out members that have a workspace root ancestor
    return projects.filter((project) => {
      // Always keep workspace roots
      if (workspaceRoots.has(project.path)) {
        return true;
      }

      // Check if this project is a member of a workspace
      if (memberPaths.has(project.path)) {
        printDebug(
          `[ProjectDetector] Filtering out workspace member: ${project.path}`,
        );
        return false;
      }

      // Check if any workspace root is an ancestor of this project
      for (const root of workspaceRoots) {
        if (
          project.path.startsWith(root + path.sep) &&
          project.language === projects.find((p) => p.path === root)?.language
        ) {
          printDebug(
            `[ProjectDetector] Filtering out nested project: ${project.path} (under ${root})`,
          );
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Parse Cargo.toml to get workspace members
   * Returns empty array if not a workspace
   */
  private async getCargoWorkspaceMembers(
    projectPath: string,
  ): Promise<string[]> {
    try {
      const cargoPath = path.join(projectPath, "Cargo.toml");
      const content = await fs.readFile(cargoPath, "utf-8");

      // Simple TOML parsing for [workspace] members
      // Look for [workspace] section
      if (!content.includes("[workspace]")) {
        return [];
      }

      // Extract members array
      // Handles: members = ["crate1", "crate2"] or multi-line
      const membersMatch = content.match(
        /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/,
      );
      if (!membersMatch) {
        return [];
      }

      const membersStr = membersMatch[1];
      const members: string[] = [];

      // Parse quoted strings, handling globs
      const stringMatches = membersStr.matchAll(/"([^"]+)"|'([^']+)'/g);
      for (const match of stringMatches) {
        const memberPattern = match[1] ?? match[2];
        if (memberPattern) {
          // Handle glob patterns like "packages/*"
          if (memberPattern.includes("*")) {
            const expanded = await this.expandGlob(projectPath, memberPattern);
            members.push(...expanded);
          } else {
            const memberPath = path.resolve(projectPath, memberPattern);
            members.push(memberPath);
          }
        }
      }

      return members;
    } catch {
      return [];
    }
  }

  /**
   * Expand a glob pattern to actual directories
   */
  private async expandGlob(
    basePath: string,
    pattern: string,
  ): Promise<string[]> {
    const results: string[] = [];

    // Simple glob handling for "dir/*" patterns
    if (pattern.endsWith("/*")) {
      const parentDir = pattern.slice(0, -2);
      const fullParent = path.resolve(basePath, parentDir);
      try {
        const entries = await fs.readdir(fullParent, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            results.push(path.join(fullParent, entry.name));
          }
        }
      } catch {
        // Directory doesn't exist
      }
    } else {
      // Non-glob pattern
      results.push(path.resolve(basePath, pattern));
    }

    return results;
  }

  /**
   * Check if tsconfig.json is a composite project (has references)
   */
  private async isTypeScriptComposite(projectPath: string): Promise<boolean> {
    try {
      const tsconfigPath = path.join(projectPath, "tsconfig.json");
      const content = await fs.readFile(tsconfigPath, "utf-8");
      const config = JSON.parse(content);
      return (
        config.compilerOptions?.composite === true ||
        (Array.isArray(config.references) && config.references.length > 0)
      );
    } catch {
      return false;
    }
  }

  /**
   * Get referenced project paths from tsconfig.json
   */
  private async getTypeScriptReferences(
    projectPath: string,
  ): Promise<string[]> {
    try {
      const tsconfigPath = path.join(projectPath, "tsconfig.json");
      const content = await fs.readFile(tsconfigPath, "utf-8");
      const config = JSON.parse(content);

      if (!Array.isArray(config.references)) {
        return [];
      }

      return config.references
        .filter((ref: { path?: string }) => ref.path)
        .map((ref: { path: string }) => path.resolve(projectPath, ref.path));
    } catch {
      return [];
    }
  }

  /**
   * Find the project root for a specific file path
   * Walks up directory tree looking for config files
   */
  async findProjectForFile(filePath: string): Promise<ProjectRoot | null> {
    let dir = path.dirname(path.resolve(filePath));
    const root = path.parse(dir).root;

    while (dir !== root && dir.startsWith(this.workspaceRoot)) {
      for (const marker of CONFIG_MARKERS) {
        const configPath = path.join(dir, marker.file);
        if (await this.fileExists(configPath)) {
          return {
            path: dir,
            language: marker.language,
            configFile: marker.file,
          };
        }
      }
      dir = path.dirname(dir);
    }

    return null;
  }

  /**
   * Invalidate the cache (call after file system changes)
   */
  invalidateCache(): void {
    this.cache = null;
  }

  private async scanDirectory(
    dir: string,
    projects: ProjectRoot[],
    depth: number,
  ): Promise<void> {
    // Limit recursion depth to prevent slow scans
    if (depth > 5) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Check for config files in this directory
      for (const marker of CONFIG_MARKERS) {
        const configPath = path.join(dir, marker.file);
        if (await this.fileExists(configPath)) {
          // Avoid duplicate languages in same directory
          const existing = projects.find(
            (p) => p.path === dir && p.language === marker.language,
          );
          if (!existing) {
            projects.push({
              path: dir,
              language: marker.language,
              configFile: marker.file,
            });
            printDebug(`[ProjectDetector]   Found ${marker.language}: ${dir}`);
          }
        }
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;

        await this.scanDirectory(
          path.join(dir, entry.name),
          projects,
          depth + 1,
        );
      }
    } catch (error) {
      // Ignore permission errors, etc.
      printDebug(
        `[ProjectDetector] Error scanning ${dir}: ${(error as Error).message}`,
      );
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
