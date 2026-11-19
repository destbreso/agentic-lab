// ============================================
// The person's permission rules, where they live
// ============================================
// As Claude Code keeps them: the user's config (~/.config/jig/config.json),
// the project's jig.config.json (shared with the repository), and
// .jig/settings.local.json (personal; .jig/ is ignored by git). Each holds
// "permissions": { allow, ask, deny, defaultMode, additionalDirectories }.
// All three are read and their lists joined; deny wins over ask over allow
// whichever file a rule is in. "Don't ask again" writes to the local file.
// Bypass is never a remembered mode: only --dangerously-skip-permissions.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  LEGACY_PROJECT_CONFIG,
  PERMISSION_MODES,
  PROJECT_CONFIG,
  ensureProjectDirSync,
  mergeRules,
  projectPath,
  userConfigFile,
  type PermissionMode,
  type PermissionRules,
  type PermissionSettings,
} from "jig-core";

interface PermissionBlock extends Partial<PermissionRules> {
  defaultMode?: string;
  additionalDirectories?: string[];
}

const readBlock = (file: string): PermissionBlock => {
  try {
    if (!existsSync(file)) return {};
    return ((JSON.parse(readFileSync(file, "utf-8")) as { permissions?: PermissionBlock }).permissions ?? {}) as PermissionBlock;
  } catch {
    return {};
  }
};

/** The three files, in the order they are read. */
export function ruleFiles(workingDir: string): { user: string; project: string; local: string } {
  const project = existsSync(path.join(workingDir, PROJECT_CONFIG)) || !existsSync(path.join(workingDir, LEGACY_PROJECT_CONFIG)) ? path.join(workingDir, PROJECT_CONFIG) : path.join(workingDir, LEGACY_PROJECT_CONFIG);
  return { user: userConfigFile(), project, local: projectPath(workingDir, "settings.local.json") };
}

export interface PermissionOptions {
  /** --permission-mode. */
  mode?: string;
  /** --dangerously-skip-permissions: bypass for this run only. */
  skip?: boolean;
  /** --add-dir. */
  addDirs?: string[];
  /** --allow and --deny, for this run only. */
  allow?: string[];
  deny?: string[];
}

/** The settings a session or a run starts with. */
export function loadPermissions(workingDir: string, o: PermissionOptions = {}): PermissionSettings {
  const f = ruleFiles(workingDir);
  const blocks = [readBlock(f.user), readBlock(f.project), readBlock(f.local)];
  const rules = mergeRules(...blocks, { allow: o.allow ?? [], deny: o.deny ?? [] });
  const remembered = blocks.map((b) => b.defaultMode).filter((m): m is string => Boolean(m)).at(-1);
  const asked = o.mode ?? remembered ?? "default";
  if (o.mode === "bypassPermissions") throw new Error("bypass is only ever --dangerously-skip-permissions, for one session or run");
  if (!PERMISSION_MODES.includes(asked as PermissionMode)) throw new Error(`--permission-mode is one of: default, acceptEdits, plan`);
  // A remembered bypass is ignored: bypass is only ever the flag's, for one run.
  const mode: PermissionMode = o.skip ? "bypassPermissions" : asked === "bypassPermissions" ? "default" : (asked as PermissionMode);
  const dirs = [...blocks.flatMap((b) => b.additionalDirectories ?? []), ...(o.addDirs ?? [])].map((d) => path.resolve(workingDir, d));
  return { mode, rules, workingDirs: [path.resolve(workingDir), ...new Set(dirs)] };
}

/** Each file's rules, for /permissions to say where a rule comes from. */
export function ruleSources(workingDir: string): Array<{ label: "user" | "project" | "local"; file: string; rules: PermissionRules; dirs: string[] }> {
  const f = ruleFiles(workingDir);
  return (["user", "project", "local"] as const).map((label) => {
    const b = readBlock(f[label]);
    return { label, file: f[label], rules: { allow: b.allow ?? [], ask: b.ask ?? [], deny: b.deny ?? [] }, dirs: b.additionalDirectories ?? [] };
  });
}

/** Add rules to a list of the local file (.jig/settings.local.json), remove one from every list there, or keep a folder added. */
export function saveLocalRules(workingDir: string, change: { add?: { list: keyof PermissionRules; rules: string[] }; remove?: string; addDir?: string }): void {
  ensureProjectDirSync(workingDir);
  const file = projectPath(workingDir, "settings.local.json");
  let data: Record<string, unknown> = {};
  try {
    if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    data = {};
  }
  const p = { allow: [], ask: [], deny: [], ...((data.permissions as Partial<PermissionRules>) ?? {}) } as PermissionRules & Record<string, unknown>;
  if (change.add) for (const r of change.add.rules) if (!p[change.add.list].includes(r)) p[change.add.list].push(r);
  if (change.remove) for (const k of ["allow", "ask", "deny"] as const) p[k] = p[k].filter((r) => r !== change.remove);
  if (change.addDir) {
    const dirs = (p.additionalDirectories as string[] | undefined) ?? [];
    if (!dirs.includes(change.addDir)) p.additionalDirectories = [...dirs, change.addDir];
  }
  writeFileSync(file, `${JSON.stringify({ ...data, permissions: p }, null, 2)}\n`);
}

export const MODE_LABEL: Record<PermissionMode, string> = {
  default: "manual: asks before edits and commands",
  acceptEdits: "accept edits: writes and mkdir, touch, mv, cp inside the working directories run",
  plan: "plan: reads and read-only commands only",
  bypassPermissions: "bypass: everything runs but deny rules, ask rules and dangerous removals",
};

/** Shift+Tab's cycle, as Claude Code's: default, accept edits, plan, and bypass after plan only in a session started with it. */
export const nextMode = (m: PermissionMode, withBypass = false): PermissionMode =>
  m === "default" ? "acceptEdits" : m === "acceptEdits" ? "plan" : m === "plan" && withBypass ? "bypassPermissions" : "default";
