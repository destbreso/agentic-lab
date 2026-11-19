// ============================================
// Permissions, as Claude Code's: as safe, and no more restrictive
// ============================================
// Every tool call a role makes is decided here before it runs, from the
// permission mode, the person's rules and the working directories:
//   - reading inside the working directories runs; outside it asks;
//   - writing asks, with a diff, unless the mode accepts edits or the person
//     allowed edits for the session; outside the working directories, or into
//     a protected path (.git, .jig, shell and tool configs), it always asks;
//   - a shell command runs when every part of it is read-only or a rule
//     allows it, and otherwise asks; a command whose meaning depends on an
//     expansion, or that names a path outside, asks with a warning;
//   - plan mode reads and runs read-only commands, and refuses the rest;
//   - bypass (only with --dangerously-skip-permissions) allows everything
//     except what no mode approves: an ask rule, a dangerous removal.
// Rules are Claude Code's shape: Shell(npm test *), Write(src/**),
// Read(./.env); Bash and Edit are read as Shell and Write. Deny wins over ask,
// and ask over allow. A topology limits what a role may attempt (its tools),
// never what the person allows. Without someone to ask (jig run), what would
// ask is denied, and says so.

import { homedir } from "node:os";
import * as path from "node:path";
import { insideWorkspace, parsedCommands } from "../tools/shell-policy.js";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";
export const PERMISSION_MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

export interface PermissionRules {
  allow: string[];
  ask: string[];
  deny: string[];
}

export interface PermissionSettings {
  mode: PermissionMode;
  rules: PermissionRules;
  /** The working directories: the first is the project; the rest were added (--add-dir, /add-dir). */
  workingDirs: string[];
  home?: string;
}

/** What the person allowed for the rest of the session, beyond the rules. */
export interface SessionGrants {
  edits: boolean;
  /** Rules granted this session: shell prefixes ("Shell(<prefix> *)") and folders outside to read ("Read(//dir/**)"). */
  rules: string[];
}

export type Action =
  | { tool: "Read"; path: string }
  | { tool: "Write"; path: string }
  | { tool: "Shell"; command: string; cwd: string };

export interface Decision {
  behavior: "allow" | "ask" | "deny";
  /** Why, in words: the rule, the mode, read-only, or what makes it ask. */
  reason: string;
  rule?: string;
  /** Said with the question: an expansion, a path outside, a protected folder. */
  warning?: string;
  /** The rules a yes beyond once would add: one per part of a shell command that asked (saved), or a read's folder (for the session). */
  remember?: string[];
}

type RuleTool = "Shell" | "Write" | "Read";

/** A rule as its tool and its pattern; Bash is Shell and Edit is Write, as in Claude Code's rules. */
export function parseRule(rule: string): { tool: RuleTool; pattern: string | null } | null {
  const m = /^\s*(Shell|Bash|Write|Edit|Read)\s*(?:\((.*)\))?\s*$/.exec(rule);
  if (!m) return null;
  const tool: RuleTool = m[1] === "Bash" ? "Shell" : m[1] === "Edit" ? "Write" : (m[1] as RuleTool);
  return { tool, pattern: m[2] === undefined || m[2].trim() === "" || m[2].trim() === "*" ? null : m[2].trim() };
}

/** Whether a shell rule's pattern matches one part of a command: "npm test:*" and "npm test *" are prefixes, anything else exact. */
export function shellMatches(pattern: string | null, part: string): boolean {
  if (pattern === null) return true;
  const p = pattern.replace(/:\*$/, " *");
  if (p.endsWith(" *")) {
    const prefix = p.slice(0, -2).trim();
    return part === prefix || part.startsWith(`${prefix} `);
  }
  if (p.includes("*")) return new RegExp(`^${p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(part);
  return part === p;
}

/** A path pattern as Claude Code writes one: //absolute, ~/home, /project-root or ./relative, with ** and *. */
export function pathMatches(pattern: string | null, file: string, root: string, home = homedir()): boolean {
  if (pattern === null) return true;
  const base = pattern.startsWith("//") ? pattern.slice(1) : pattern.startsWith("~/") ? path.join(home, pattern.slice(2)) : path.join(root, pattern.replace(/^\.\//, "").replace(/^\//, ""));
  const glob = path.resolve(base);
  const re = new RegExp(
    `^${glob
      .split("/")
      .map((seg) => (seg === "**" ? "\u0000" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")))
      .join("/")
      .replace(/\/\u0000/g, "(?:/.*)?")
      .replace(/\u0000/g, ".*")}$`,
  );
  return re.test(path.resolve(file));
}

/** Programs that only read: they run without asking when everything they name is inside. */
const READ_ONLY = new Set([
  "ls", "cat", "head", "tail", "wc", "echo", "printf", "pwd", "test", "[", "true", "false", "grep", "egrep", "fgrep",
  "sort", "uniq", "cut", "tr", "rev", "paste", "comm", "fold", "nl", "diff", "cmp", "file", "stat", "du", "basename",
  "dirname", "date", "seq", "od", "md5sum", "sha1sum", "sha256sum", "shasum", "find", "which", "tree", "realpath",
]);
const READ_ONLY_GIT = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "blame"]);
/** Programs accept-edits mode also runs, for paths inside: Claude Code's mkdir, touch, mv and cp. */
const FILE_EDITS = new Set(["mkdir", "touch", "mv", "cp"]);
/** Paths a write always asks about, in every mode but bypass: Claude Code's protected paths, and Jig's own folder. */
const PROTECTED_DIRS = new Set([".git", ".jig", ".agentic-lab", ".claude", ".vscode", ".idea", ".husky", ".cargo", ".devcontainer", ".yarn", ".mvn"]);
const PROTECTED_FILES = new Set([
  ".gitconfig", ".gitmodules", ".bashrc", ".bash_profile", ".bash_login", ".bash_aliases", ".bash_logout", ".zshrc", ".zprofile",
  ".zshenv", ".zlogin", ".zlogout", ".profile", ".envrc", ".npmrc", ".yarnrc", ".yarnrc.yml", ".pnp.cjs", ".pnp.loader.mjs",
  ".pnpmfile.cjs", "bunfig.toml", ".bunfig.toml", ".bazelrc", ".bazelversion", ".bazeliskrc", ".pre-commit-config.yaml",
  "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "gradle-wrapper.properties", "maven-wrapper.properties",
  ".devcontainer.json", ".ripgreprc", "pyrightconfig.json", ".mcp.json", ".claude.json",
]);
/** Programs whose first word after the flags is a pattern or a script, not a file. */
const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg", "sed", "awk"]);

/** The protected folder or file a path is in, if any. */
function protectedName(file: string, dirs: string[], home: string): string | undefined {
  for (const base of [...dirs, home]) {
    const rel = path.relative(base, file);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const segs = rel.split(path.sep);
    const dir = segs.slice(0, -1).find((s) => PROTECTED_DIRS.has(s));
    if (dir) return dir;
    if (rel.startsWith(`.config${path.sep}git`)) return ".config/git";
    if (PROTECTED_FILES.has(segs[segs.length - 1])) return segs[segs.length - 1];
  }
  return undefined;
}

const inside = (dirs: string[], file: string) => dirs.some((d) => insideWorkspace(d, path.relative(d, path.resolve(d, file)) || "."));

function matching(list: string[], tool: RuleTool, test: (pattern: string | null) => boolean): string | undefined {
  for (const r of list) {
    const p = parseRule(r);
    if (p && p.tool === tool && test(p.pattern)) return r;
  }
  return undefined;
}

const RUNNERS = new Set(["run", "exec", "x", "dlx", "run-script"]);
const INTERPRETERS = new Set(["python", "python3", "node", "bash", "sh", "zsh", "ruby", "perl", "php", "deno", "bun", "Rscript", "tsx", "ts-node"]);

/**
 * What "don't ask again" saves for one part of a command: its program and its subcommand (npm test), a runner's
 * script (npm run build), an interpreter's file (python3 app.py, python3 -m pytest). Null when no prefix would name
 * only what was asked: code given inline (node -e, python3 -c) or an interpreter with nothing after it.
 */
export function prefixOf(part: string): string | null {
  const [program, second, third] = part.split(/\s+/);
  if (second && RUNNERS.has(second) && third && !third.startsWith("-")) return `${program} ${second} ${third}`;
  if (INTERPRETERS.has(program)) {
    if (second === "-m" && third) return `${program} -m ${third}`;
    if (!second || second.startsWith("-")) return null;
    return `${program} ${second}`;
  }
  return second && /^[a-z][\w:-]*$/i.test(second) ? `${program} ${second}` : program;
}

/** A removal no mode approves without asking: the root, a top-level folder, the home folder, or a working directory or one above it. */
function criticalRemoval(words: string[], cwd: string, home: string, dirs: string[]): string | undefined {
  if (words[0] !== "rm" && words[0] !== "rmdir") return undefined;
  for (const w of words.slice(1)) {
    if (w.startsWith("-")) continue;
    const t = path.resolve(cwd, w === "~" || w.startsWith("~/") ? path.join(home, w.slice(1)) : w);
    const above = (d: string) => d === t || !path.relative(t, d).startsWith("..");
    if (t === path.parse(t).root || path.dirname(t) === path.parse(t).root || above(home) || dirs.some(above)) return w;
  }
  return undefined;
}

/** Decide one action. */
export function decide(action: Action, s: PermissionSettings, grants: SessionGrants = { edits: false, rules: [] }): Decision {
  const root = s.workingDirs[0];
  const home = s.home ?? homedir();
  const rules = { allow: [...s.rules.allow, ...grants.rules], ask: s.rules.ask, deny: s.rules.deny };
  const bypass = s.mode === "bypassPermissions";
  const bypassed = { behavior: "allow", reason: "permissions are bypassed (--dangerously-skip-permissions)" } as const;

  if (action.tool === "Read" || action.tool === "Write") {
    const file = path.resolve(root, action.path);
    const test = (p: string | null) => pathMatches(p, file, root, home);
    // A Read deny rule also keeps a file from being written, as in Claude Code.
    const denied = matching(rules.deny, action.tool, test) ?? (action.tool === "Write" ? matching(rules.deny, "Read", test) : undefined);
    if (denied) return { behavior: "deny", reason: `a rule denies it: ${denied}`, rule: denied };
    if (action.tool === "Write" && s.mode === "plan") return { behavior: "deny", reason: "plan mode: reading only, no writes" };
    const asked = matching(rules.ask, action.tool, test);
    if (asked) return { behavior: "ask", reason: `a rule asks: ${asked}`, rule: asked };
    if (bypass) return bypassed;
    const isInside = inside(s.workingDirs, file);
    const allowed = matching(rules.allow, action.tool, test);
    if (action.tool === "Read") {
      if (isInside) return { behavior: "allow", reason: "reading inside the working directories" };
      if (allowed) return { behavior: "allow", reason: `a rule allows it: ${allowed}`, rule: allowed };
      // "Yes for the session" covers the folder the file is in, never more, and is not saved.
      return { behavior: "ask", reason: "reading outside the working directories", warning: `${file} is outside the working directories`, remember: [`Read(/${path.dirname(file)}/**)`] };
    }
    const prot = protectedName(file, s.workingDirs, home);
    if (prot) return { behavior: "ask", reason: `writing into ${prot}`, warning: `${prot} is protected: a write there always asks` };
    if (!isInside) {
      if (allowed) return { behavior: "allow", reason: `a rule allows it: ${allowed}`, rule: allowed };
      return { behavior: "ask", reason: "writing outside the working directories", warning: `${file} is outside the working directories` };
    }
    if (allowed) return { behavior: "allow", reason: `a rule allows it: ${allowed}`, rule: allowed };
    if (s.mode === "acceptEdits") return { behavior: "allow", reason: "accept-edits mode" };
    if (grants.edits) return { behavior: "allow", reason: "you allowed edits for this session" };
    return { behavior: "ask", reason: "a write" };
  }

  // A shell command: each part on its own, as Claude Code does.
  let parts: Array<{ text: string; words: string[]; targets: string[] }>;
  let warning: string | undefined;
  try {
    parts = parsedCommands(action.command).map((c) => ({ text: c.words.join(" "), words: c.words, targets: c.targets }));
  } catch (e) {
    // An expansion or a construct the lab cannot read: the whole command is one part, and it asks.
    parts = [{ text: action.command.trim(), words: [], targets: [] }];
    warning = `the lab cannot read all of it: ${(e as Error).message}`;
  }
  const expand = (w: string) => (w === "~" || w.startsWith("~/") ? path.join(home, w.slice(1)) : w);
  // A cd moves where later relative paths point: each path is checked from the command's folder and from every cd's.
  const bases = [path.resolve(action.cwd), ...parts.filter((p) => p.words[0] === "cd" && p.words[1] && p.words[1] !== "-").map((p) => path.resolve(action.cwd, expand(p.words[1])))];
  const resolveAll = (w: string) => [...new Set(bases.map((b) => path.resolve(b, expand(w))))];
  for (const part of parts) {
    const denied = matching(rules.deny, "Shell", (p) => shellMatches(p, part.text));
    if (denied) return { behavior: "deny", reason: `a rule denies it: ${denied}`, rule: denied };
    // Read and Write deny rules hold for the files a command names and the files it redirects to or from.
    const positional = part.words.slice(1).filter((w) => !w.startsWith("-"));
    const files = PATTERN_FIRST.has(part.words[0]) && !part.words.includes("-e") && !part.words.includes("-f") ? positional.slice(1) : positional;
    for (const f of files) {
      const r = matching(rules.deny, "Read", (p) => resolveAll(f).some((x) => pathMatches(p, x, root, home)));
      if (r) return { behavior: "deny", reason: `a rule denies reading ${f}: ${r}`, rule: r };
    }
    const written = [...part.targets, ...(part.words[0] === "tee" || FILE_EDITS.has(part.words[0]) ? positional : [])];
    for (const f of written) {
      const hit = (p: string | null) => resolveAll(f).some((x) => pathMatches(p, x, root, home));
      const r = matching(rules.deny, "Write", hit) ?? matching(rules.deny, "Read", hit);
      if (r) return { behavior: "deny", reason: `a rule denies writing ${f}: ${r}`, rule: r };
    }
  }
  const outside = (p: { words: string[]; targets: string[] }) =>
    [...p.words.slice(1).filter((w) => !w.startsWith("-") || w.includes("=")), ...p.targets]
      .map((w) => (w.startsWith("-") ? w.slice(w.indexOf("=") + 1) : w))
      .filter((w) => w && w !== "/dev/null" && (w.includes("/") || w.startsWith("~") || w === ".." || p.words[0] === "cd"))
      .some((w) => resolveAll(w).some((x) => !inside(s.workingDirs, x)));
  // A cd elsewhere makes a git after it run that folder's hooks, so the git asks (Claude Code's rule).
  const cdElsewhere = bases.some((b) => b !== bases[0]);
  const readOnly = (p: { words: string[]; targets: string[] }) => {
    if (!p.words.length || p.targets.length || outside(p)) return false;
    const [program, ...args] = p.words;
    const positional = args.filter((w) => !w.startsWith("-"));
    // cd alone or cd - goes where the lab cannot see; a cd's own target is checked as a path above.
    if (program === "cd") return args.length === 1 && args[0] !== "-";
    if (program === "git") {
      if (cdElsewhere) return false;
      if (args[0] === "branch") return args.slice(1).every((w) => ["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "--show-current"].includes(w));
      return READ_ONLY_GIT.has(args[0] ?? "") && !args.some((w) => w.startsWith("--output"));
    }
    if (program === "find" && args.some((w) => /^-(exec|execdir|ok|okdir|delete|fprint)/.test(w))) return false;
    // Read-only programs that can still write a file.
    if ((program === "sort" || program === "tree") && args.some((w) => w === "-o" || w.startsWith("--output"))) return false;
    if (program === "uniq" && positional.length > 1) return false;
    if (program === "date" && args.some((w) => w === "-s" || w.startsWith("--set"))) return false;
    return READ_ONLY.has(program) && !program.includes("/");
  };
  if (s.mode === "plan" && (warning || !parts.every(readOnly))) return { behavior: "deny", reason: "plan mode: reading only, no command that changes anything" };
  // What no mode approves on its own, bypass included: an ask rule, and a removal that could take everything.
  for (const part of parts) {
    const asked = matching(rules.ask, "Shell", (p) => shellMatches(p, part.text));
    if (asked) return { behavior: "ask", reason: `a rule asks: ${asked}`, rule: asked, ...(warning ? { warning } : {}) };
    const critical = criticalRemoval(part.words, action.cwd, home, s.workingDirs);
    if (critical) return { behavior: "ask", reason: "a dangerous removal", warning: `it removes ${critical}: no mode or rule approves that on its own` };
  }
  if (warning && /(^|[\s;&|(`])(rm|rmdir)\s/.test(action.command)) {
    return { behavior: "ask", reason: "a removal the lab cannot read", warning: `${warning}; a dangerous removal is not ruled out` };
  }
  if (bypass) return bypassed;
  const fileEdit = (p: { words: string[]; targets: string[] }) => s.mode === "acceptEdits" && FILE_EDITS.has(p.words[0]) && !outside(p) && !p.targets.length;
  if (s.mode === "plan") return { behavior: "allow", reason: "plan mode: a read-only command" };
  const pending = parts.filter((p) => !(readOnly(p) || fileEdit(p) || (!warning && matching(rules.allow, "Shell", (pat) => shellMatches(pat, p.text)))));
  if (!pending.length && !warning) {
    const rule = parts.map((p) => matching(rules.allow, "Shell", (pat) => shellMatches(pat, p.text))).find(Boolean);
    return { behavior: "allow", reason: rule ? `a rule allows it: ${rule}` : "read-only", ...(rule ? { rule } : {}) };
  }
  const out = parts.some(outside);
  const programByPath = parts.some((p) => p.words[0]?.includes("/"));
  const warn = warning ?? (out ? "it names a path outside the working directories" : programByPath ? "it runs a program by its path" : undefined);
  // "Don't ask again" is offered only when it would allow exactly what it names.
  const prefixes = pending.map((p) => prefixOf(p.text));
  const remember = warn || prefixes.some((x) => x === null) ? undefined : [...new Set(prefixes.map((x) => `Shell(${x} *)`))];
  return { behavior: "ask", reason: "a shell command", ...(warn ? { warning: warn } : {}), ...(remember?.length ? { remember } : {}) };
}

/** Rules from several sources, one list each, in the order given. */
export function mergeRules(...sources: Array<Partial<PermissionRules> | undefined>): PermissionRules {
  const out: PermissionRules = { allow: [], ask: [], deny: [] };
  for (const s of sources) {
    if (!s) continue;
    for (const k of ["allow", "ask", "deny"] as const) for (const r of s[k] ?? []) if (!out[k].includes(r)) out[k].push(r);
  }
  return out;
}
