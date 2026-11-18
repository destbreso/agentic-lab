// ============================================
// Where Jig keeps things: the project folder and the user's config
// ============================================
// A project's runs, sessions and history live in .jig/ in its working
// directory, which gets a .gitignore holding "*" the first time it is made,
// so a repository never commits the prompts and answers kept there. Before
// the rename the folder was .agentic-lab/: it is still read, never written.
// The user's own configuration lives in the platform's config directory
// (XDG_CONFIG_HOME/jig, ~/.config/jig by default, %APPDATA%\jig on Windows).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

export const PROJECT_DIR = ".jig";
/** The project folder's name before the rename, read as a fallback. */
export const LEGACY_PROJECT_DIR = ".agentic-lab";
export const PROJECT_CONFIG = "jig.config.json";
export const LEGACY_PROJECT_CONFIG = "agentic-lab.config.json";

const IGNORE_ALL = "# Jig keeps runs, sessions and prompts here: none of it belongs in the repository.\n*\n";

/** A path in the project folder (the new one: where everything is written). */
export function projectPath(workingDir: string, ...parts: string[]): string {
  return path.resolve(workingDir, PROJECT_DIR, ...parts);
}

/** The same path in both folders, the new one first: where to look when reading. */
export function readablePaths(workingDir: string, ...parts: string[]): string[] {
  return [projectPath(workingDir, ...parts), path.resolve(workingDir, LEGACY_PROJECT_DIR, ...parts)];
}

/** The first of the readable paths that exists, or null. */
export function existingProjectPath(workingDir: string, ...parts: string[]): string | null {
  return readablePaths(workingDir, ...parts).find((p) => existsSync(p)) ?? null;
}

/** The ignore file, written once when the folder is new; an existing one is the user's and is left alone. */
function ignoreFileIn(dir: string): void {
  const file = path.join(dir, ".gitignore");
  if (!existsSync(file)) writeFileSync(file, IGNORE_ALL);
}

/** Make a folder inside .jig/ (and .jig/ itself, with its .gitignore). Returns the folder. */
export async function ensureProjectDir(workingDir: string, ...parts: string[]): Promise<string> {
  const root = projectPath(workingDir);
  await fs.mkdir(root, { recursive: true });
  ignoreFileIn(root);
  const dir = projectPath(workingDir, ...parts);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** The same, synchronously. */
export function ensureProjectDirSync(workingDir: string, ...parts: string[]): string {
  const root = projectPath(workingDir);
  mkdirSync(root, { recursive: true });
  ignoreFileIn(root);
  const dir = projectPath(workingDir, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Entries of a folder in both project folders, the new one's first, each name once. */
export async function listProjectEntries(workingDir: string, ...parts: string[]): Promise<Array<{ name: string; dir: string; legacy: boolean }>> {
  const seen = new Set<string>();
  const out: Array<{ name: string; dir: string; legacy: boolean }> = [];
  for (const [i, dir] of readablePaths(workingDir, ...parts).entries()) {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      out.push({ name: e.name, dir: path.join(dir, e.name), legacy: i > 0 });
    }
  }
  return out;
}

/** The user's config directory for Jig. JIG_CONFIG_DIR overrides it. */
export function userConfigDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.JIG_CONFIG_DIR) return path.resolve(env.JIG_CONFIG_DIR);
  if (platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "jig");
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(env.HOME || homedir(), ".config");
  return path.join(base, "jig");
}

/** The user's config file. */
export const userConfigFile = (env: NodeJS.ProcessEnv = process.env): string => path.join(userConfigDir(env), "config.json");
