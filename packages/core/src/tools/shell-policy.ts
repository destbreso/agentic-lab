// ============================================
// What the shell tool may run: an allow-list, read from the command itself
// ============================================
// A command is read the way sh would read it, into simple commands joined by
// pipes and lists. Each one's program must be on the role's allow-list, and
// every argument and redirection must stay inside the workspace. Anything
// whose meaning depends on an expansion the lab cannot see ($VAR, $(...),
// backticks, ~, braces, subshells, here-documents, background jobs) is
// refused before anything runs, so what was checked is what sh executes.

import * as fs from "fs";
import * as path from "path";

/**
 * The programs a role may run when its definition names none: reading,
 * comparing and arranging files inside the workspace. No interpreter, no
 * package manager, no network: a role that needs one gets it by name
 * (`config.toolPolicy.commands`), knowing that an interpreter can run anything.
 */
export const DEFAULT_SHELL_COMMANDS: readonly string[] = [
  "ls", "cat", "head", "tail", "wc", "echo", "printf", "pwd", "test", "[", "true", "false",
  "grep", "egrep", "fgrep", "sort", "uniq", "cut", "tr", "rev", "paste", "comm", "fold", "nl",
  "diff", "cmp", "file", "stat", "du", "basename", "dirname", "date", "seq", "od",
  "md5sum", "sha1sum", "sha256sum", "shasum", "find", "tee", "mkdir", "touch", "cp", "mv", "rm", "rmdir",
];

/** Flags of find that run or delete something, refused whatever the allow-list says. */
const FIND_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);

interface Word {
  value: string;
  /** Characters that were not quoted, as glob characters. */
  globbed: boolean;
  /** The word began with an unquoted ~. */
  tilde: boolean;
}

type Token = { kind: "word"; word: Word } | { kind: "op"; value: string } | { kind: "redirect"; value: string };

export class ShellRefusal extends Error {}

const refuse = (why: string): never => {
  throw new ShellRefusal(why);
};

/** Split a command into words, operators and redirections, as sh reads it. */
export function lex(command: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let cur: Word | null = null;
  const start = () => (cur ??= { value: "", globbed: false, tilde: false });
  const flush = () => {
    if (cur) out.push({ kind: "word", word: cur });
    cur = null;
  };
  while (i < command.length) {
    const c = command[i];
    const next = command[i + 1];
    if (c === " " || c === "\t") {
      flush();
      i++;
    } else if (c === "\n") {
      flush();
      out.push({ kind: "op", value: ";" });
      i++;
    } else if (c === "#" && !cur) {
      while (i < command.length && command[i] !== "\n") i++;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) refuse("an unterminated single quote");
      start().value += command.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      const w = start();
      i++;
      for (;;) {
        if (i >= command.length) refuse("an unterminated double quote");
        const d = command[i];
        if (d === '"') break;
        if (d === "$" || d === "`") refuse("an expansion inside double quotes ($ or a backtick): write the value itself, or use single quotes");
        if (d === "\\" && i + 1 < command.length && '"\\$`\n'.includes(command[i + 1])) {
          w.value += command[i + 1];
          i += 2;
          continue;
        }
        w.value += d;
        i++;
      }
      i++;
    } else if (c === "\\") {
      if (i + 1 >= command.length) refuse("a trailing backslash");
      if (command[i + 1] !== "\n") start().value += command[i + 1];
      i += 2;
    } else if (c === "$") {
      refuse("a variable or command expansion ($): write the value itself");
    } else if (c === "`") {
      refuse("a command substitution (backticks)");
    } else if (c === "(" || c === ")") {
      refuse("a subshell or a group in parentheses");
    } else if (c === "{" || c === "}") {
      refuse("braces: a group or a brace expansion");
    } else if (c === "|" || c === ";" || c === "&") {
      // A digit followed by > is a redirection of that descriptor; & alone runs a job in the background.
      if (c === "&" && next === ">") {
        flush();
        out.push({ kind: "redirect", value: command[i + 2] === ">" ? "&>>" : "&>" });
        i += command[i + 2] === ">" ? 3 : 2;
        continue;
      }
      flush();
      const two = c + (next ?? "");
      if (two === "||" || two === "&&" || two === ";;") {
        if (two === ";;") refuse("a case statement");
        out.push({ kind: "op", value: two });
        i += 2;
      } else if (c === "&") {
        refuse("a command sent to the background (&)");
      } else {
        if (c === "|" && next === "&") refuse("a pipe of stderr (|&)");
        out.push({ kind: "op", value: c });
        i++;
      }
    } else if (c === ">" || c === "<") {
      // A redirection; a word made only of a descriptor number just before it belongs to it.
      let fd = "";
      if (cur && /^\d$/.test((cur as Word).value) && !(cur as Word).globbed) {
        fd = (cur as Word).value;
        cur = null;
      }
      flush();
      if (c === "<" && next === "<") refuse("a here-document: write the file with file_write");
      if (next === "(") refuse("a process substitution");
      let op = c;
      i++;
      if (c === ">" && command[i] === ">") {
        op = ">>";
        i++;
      } else if (command[i] === "&") {
        // 2>&1 and the like join two descriptors and name no file.
        const m = /^&(\d|-)/.exec(command.slice(i));
        if (!m) refuse("a redirection to a descriptor the lab cannot read");
        i += m![0].length;
        continue;
      } else if (c === ">" && command[i] === "|") {
        i++;
      } else if (c === "<" && command[i] === ">") {
        op = "<>";
        i++;
      }
      out.push({ kind: "redirect", value: fd + op });
    } else {
      const w = start();
      if (c === "~" && w.value === "") w.tilde = true;
      if (c === "*" || c === "?" || c === "[") w.globbed = true;
      w.value += c;
      i++;
    }
  }
  flush();
  return out;
}

interface SimpleCommand {
  words: Word[];
  targets: Word[];
}

function commandsOf(tokens: Token[]): SimpleCommand[] {
  const out: SimpleCommand[] = [];
  let cur: SimpleCommand = { words: [], targets: [] };
  let pendingRedirect = false;
  const end = (op: string) => {
    if (pendingRedirect) refuse(`a redirection with no file before "${op}"`);
    if (cur.words.length === 0) {
      if (cur.targets.length) refuse("a redirection with no command");
      if (op !== "end") refuse(`"${op}" with no command before it`);
      return;
    }
    out.push(cur);
    cur = { words: [], targets: [] };
  };
  for (const t of tokens) {
    if (t.kind === "op") end(t.value);
    else if (t.kind === "redirect") {
      if (pendingRedirect) refuse("two redirections in a row");
      pendingRedirect = true;
    } else if (pendingRedirect) {
      cur.targets.push(t.word);
      pendingRedirect = false;
    } else cur.words.push(t.word);
  }
  end("end");
  return out;
}

const realOrSelf = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/** Whether a path, once resolved (symlinks too, when it exists), is inside the workspace. */
export function insideWorkspace(root: string, candidate: string): boolean {
  const base = realOrSelf(path.resolve(root));
  const resolved = path.resolve(root, candidate);
  // A path that does not exist yet is judged by its nearest existing parent.
  let probe = resolved;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const real = path.join(realOrSelf(probe), path.relative(probe, resolved));
  const rel = path.relative(base, real);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function checkPath(word: Word, root: string, cwd: string, what: string): void {
  if (word.tilde) refuse(`${what} "${word.value}" starts with ~, the home directory, outside the workspace`);
  if (word.value === "/dev/null") return;
  if (word.globbed && /(^|\/)\.[*?[]/.test(word.value)) refuse(`${what} "${word.value}" is a pattern that can match "..", outside the workspace`);
  const relToRoot = path.relative(root, path.resolve(cwd, word.value));
  if (!insideWorkspace(root, relToRoot || ".")) refuse(`${what} "${word.value}" is outside the workspace`);
}

export interface ShellCheck {
  /** The workspace no argument, redirection or working directory may leave. */
  root: string;
  /** The directory the command runs in, already checked to be inside the root. */
  cwd: string;
  /** The programs allowed. */
  commands: readonly string[];
}

/**
 * The programs of a command that are not on the allow-list and are named
 * plainly (no path, pattern or variable): the ones a person may allow. A
 * command that does not parse names none; checkCommand says why.
 */
export function unlistedPrograms(command: string, commands: readonly string[]): string[] {
  const allowed = new Set(commands);
  let parsed: SimpleCommand[];
  try {
    parsed = commandsOf(lex(command));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const cmd of parsed) {
    const program = cmd.words[0];
    if (!program || program.globbed || program.tilde || program.value.includes("/") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(program.value)) continue;
    if (!allowed.has(program.value) && !out.includes(program.value)) out.push(program.value);
  }
  return out;
}

/** A command's simple commands, each as its words and its redirection targets (throws a ShellRefusal on what sh would expand). */
export function parsedCommands(command: string): Array<{ words: string[]; targets: string[]; globbed: boolean }> {
  return commandsOf(lex(command)).map((c) => ({ words: c.words.map((w) => w.value), targets: c.targets.map((w) => w.value), globbed: c.words.some((w) => w.globbed || w.tilde) }));
}

/** Throw a ShellRefusal naming the first thing in the command the policy does not allow. */
export function checkCommand(command: string, policy: ShellCheck): void {
  if (!command.trim()) refuse("an empty command");
  const allowed = new Set(policy.commands);
  for (const cmd of commandsOf(lex(command))) {
    const [program, ...args] = cmd.words;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(program.value)) refuse(`setting a variable ("${program.value.split("=")[0]}=...") before a command`);
    if (program.globbed || program.tilde) refuse(`the program "${program.value}" is a pattern`);
    if (!allowed.has(program.value)) {
      refuse(
        program.value.includes("/")
          ? `"${program.value}" runs a file by its path; only programs on the allow-list run (${[...allowed].join(", ")})`
          : `"${program.value}" is not on this role's allow-list (${[...allowed].join(", ")})`,
      );
    }
    for (const a of args) {
      if (program.value === "find" && FIND_ACTIONS.has(a.value)) refuse(`find ${a.value} runs or deletes something`);
      if (a.value.startsWith("-") && !a.tilde) {
        const eq = a.value.indexOf("=");
        if (eq > 0) checkPath({ ...a, value: a.value.slice(eq + 1), tilde: a.value[eq + 1] === "~" }, policy.root, policy.cwd, "the value");
        continue;
      }
      checkPath(a, policy.root, policy.cwd, "the argument");
      if ((program.value === "rm" || program.value === "rmdir") && path.relative(realOrSelf(policy.root), realOrSelf(path.resolve(policy.cwd, a.value))) === "") {
        refuse(`${program.value} "${a.value}" would remove the workspace itself`);
      }
    }
    for (const t of cmd.targets) checkPath(t, policy.root, policy.cwd, "the redirection to");
  }
}
