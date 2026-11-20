// ============================================
// The lab's measured checks
// ============================================
// Each run of the checks happens in a fresh directory the lab makes outside
// the workspace: a copy of the workspace as it is now, with the task's check
// files written back from the lab's own copy. No role has a path to it, it
// exists only while the checks run, and a role that edited a check file in the
// workspace changes nothing. Commands run with the scrubbed child environment.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { childEnv } from "../tools/child-env.js";
import { cloneTree, makeTempDir, removeTempDir } from "../housekeeping/temp.js";
import type { CheckFile, CheckRunner, MeasuredCheckResult, MeasuredCheckRun, TaskCheck } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 4000;

const clip = (text: string, max = OUTPUT_LIMIT) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** A path inside `root`, or an error: a check never reads or writes outside its copy. */
function inside(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`"${path}" is outside the workspace`);
  return full;
}

/** Whether a text meets every condition given. */
function meets(text: string, check: { equals?: string; contains?: string; matches?: string }): { passed: boolean; expected: string } {
  const expected: string[] = [];
  let passed = true;
  if (check.equals !== undefined) {
    expected.push(`equal to ${JSON.stringify(check.equals.trim())}`);
    passed &&= text.trim() === check.equals.trim();
  }
  if (check.contains !== undefined) {
    expected.push(`containing ${JSON.stringify(check.contains)}`);
    passed &&= text.includes(check.contains);
  }
  if (check.matches !== undefined) {
    expected.push(`matching /${check.matches}/`);
    passed &&= new RegExp(check.matches).test(text.trim());
  }
  return { passed, expected: expected.join(" and ") || "anything" };
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("sh", ["-c", command], { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer) => {
      if (output.length < OUTPUT_LIMIT * 2) output += chunk.toString();
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      output += `\n[killed after ${Math.round(timeoutMs / 1000)}s]`;
      child.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      output += `\n${e.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({ exitCode: code, output: clip(output.trim()) });
    });
  });
}

export interface MeasuredCheckerOptions {
  /** The workspace the roles work in. */
  workspace: string;
  checks: TaskCheck[];
  checkFiles?: CheckFile[];
  /** Where the lab makes its copies (default: the system's temp directory). */
  tmpRoot?: string;
}

export class MeasuredChecker implements CheckRunner {
  private originals: Array<{ path: string; content: string }> | null = null;

  constructor(private readonly options: MeasuredCheckerOptions) {}

  async capture(): Promise<void> {
    const originals: Array<{ path: string; content: string }> = [];
    for (const file of this.options.checkFiles ?? []) {
      if (typeof file === "string") {
        const content = await readFile(inside(this.options.workspace, file), "utf-8").catch(() => {
          throw new Error(`check file "${file}" is not in the workspace`);
        });
        originals.push({ path: file, content });
      } else {
        inside(this.options.workspace, file.path);
        originals.push({ path: file.path, content: file.content });
      }
    }
    this.originals = originals;
  }

  async run(opts: { label: string; answer?: string; signal?: AbortSignal }): Promise<MeasuredCheckRun> {
    if (this.originals === null) await this.capture();
    const started = Date.now();
    const dir = await makeTempDir("jig-check-", "a copy of the workspace where Jig runs a task's measured checks", this.options.tmpRoot ?? tmpdir());
    const copy = join(dir, "ws");
    try {
      // Cloned where the disk can, so a copy with node_modules costs almost nothing on APFS or btrfs.
      await cloneTree(this.options.workspace, copy);
      for (const file of this.originals!) {
        const target = inside(copy, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      const results: MeasuredCheckResult[] = [];
      for (const check of this.options.checks) results.push(await this.runOne(check, copy, opts));
      return {
        label: opts.label,
        passed: results.length > 0 && results.every((r) => r.passed),
        results,
        at: new Date(started).toISOString(),
        durationMs: Date.now() - started,
      };
    } finally {
      await removeTempDir(dir).catch(() => false);
    }
  }

  private async runOne(
    check: TaskCheck,
    copy: string,
    opts: { answer?: string; signal?: AbortSignal },
  ): Promise<MeasuredCheckResult> {
    const started = Date.now();
    const done = (passed: boolean, output: string, exitCode?: number | null): MeasuredCheckResult => ({
      name: check.name,
      kind: check.kind,
      passed,
      ...(exitCode !== undefined ? { exitCode } : {}),
      output,
      durationMs: Date.now() - started,
    });
    try {
      switch (check.kind) {
        case "command": {
          const { exitCode, output } = await runCommand(check.command, copy, check.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
          return done(exitCode === 0, output, exitCode);
        }
        case "file": {
          let text: string;
          try {
            text = await readFile(inside(copy, check.path), "utf-8");
          } catch {
            return done(false, `${check.path} does not exist`);
          }
          const { passed, expected } = meets(text, check);
          return done(passed, `${check.path} holds ${JSON.stringify(clip(text.trim(), 500))}; expected ${expected}`);
        }
        case "answer": {
          const answer = opts.answer ?? "";
          const { passed, expected } = meets(answer, check);
          return done(passed, `the answer is ${JSON.stringify(clip(answer.trim(), 500))}; expected ${expected}`);
        }
      }
    } catch (error) {
      return done(false, `the check could not run: ${(error as Error).message}`);
    }
  }
}
