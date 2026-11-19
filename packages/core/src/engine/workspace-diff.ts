// ============================================
// What a turn changed in the workspace, measured by the lab
// ============================================
// A snapshot of the workspace before a role's turn and another after it give
// the files the turn created, changed or removed, and a bounded diff of the
// text ones. These are measured: they come from the file system, never from
// what a model says it did. Folders that are not the work (.git, node_modules,
// .jig) are left out, and so is anything past the size and count limits, which
// the result says.

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SKIP = new Set([".git", "node_modules", ".jig", ".agentic-lab", ".next", "dist", "__pycache__", ".venv", "venv", ".turbo"]);
const MAX_FILES = 2000;
/** Text files up to this size keep their content for the diff. */
const MAX_TEXT = 64 * 1024;

export interface FileState {
  hash: string;
  size: number;
  /** The content, for a text file small enough to diff. */
  text?: string;
}

export interface Snapshot {
  files: Map<string, FileState>;
  /** More files than the limit: the rest were not looked at. */
  truncated: boolean;
}

export interface WorkspaceChange {
  /** Paths relative to the workspace, each with what happened to it. */
  files: Array<{ path: string; change: "created" | "modified" | "deleted" }>;
  /** A unified-style diff of the text files, cut at `limit` characters. */
  diff: string;
  /** Whether the snapshot or the diff was cut. */
  truncated: boolean;
}

const isText = (buf: Buffer) => !buf.subarray(0, 8000).includes(0);

export async function snapshot(root: string): Promise<Snapshot> {
  const files = new Map<string, FileState>();
  let truncated = false;
  const walk = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.size >= MAX_FILES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) await walk(full);
      } else if (e.isFile()) {
        try {
          // A large file is told apart by its size and time, never read whole.
          const st = await fs.stat(full);
          if (st.size > 2 * 1024 * 1024) {
            files.set(path.relative(root, full), { hash: `${st.size}:${st.mtimeMs}`, size: st.size });
            continue;
          }
          const buf = await fs.readFile(full);
          files.set(path.relative(root, full), {
            hash: createHash("sha1").update(buf).digest("hex"),
            size: buf.length,
            ...(buf.length <= MAX_TEXT && isText(buf) ? { text: buf.toString("utf-8") } : {}),
          });
        } catch {
          /* unreadable: left out */
        }
      }
    }
  };
  await walk(root);
  return { files, truncated };
}

/** The lines of b that are not in a, and of a that are not in b, in order: a longest-common-subsequence diff. */
function lineDiff(a: string[], b: string[]): string[] {
  if (a.length * b.length > 400_000) return [`@@ ${a.length} lines → ${b.length} lines (too large to diff here)`];
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out;
}

/** What changed between two snapshots, with a diff of at most `limit` characters. */
export function changes(before: Snapshot, after: Snapshot, limit = 4000): WorkspaceChange {
  const files: WorkspaceChange["files"] = [];
  for (const [p, s] of after.files) {
    const old = before.files.get(p);
    if (!old) files.push({ path: p, change: "created" });
    else if (old.hash !== s.hash) files.push({ path: p, change: "modified" });
  }
  for (const p of before.files.keys()) if (!after.files.has(p)) files.push({ path: p, change: "deleted" });
  files.sort((x, y) => x.path.localeCompare(y.path));
  let diff = "";
  let cut = before.truncated || after.truncated;
  for (const f of files) {
    const a = before.files.get(f.path);
    const b = after.files.get(f.path);
    const head = `--- ${f.change === "created" ? "/dev/null" : `a/${f.path}`}\n+++ ${f.change === "deleted" ? "/dev/null" : `b/${f.path}`}\n`;
    const body = (a && a.text === undefined) || (b && b.text === undefined) ? "(binary or large: not diffed)\n" : `${lineDiff((a?.text ?? "").split("\n"), (b?.text ?? "").split("\n")).join("\n")}\n`;
    const piece = head + body;
    if (diff.length + piece.length > limit) {
      diff += piece.slice(0, Math.max(0, limit - diff.length));
      diff += "\n… (diff cut by the lab)";
      cut = true;
      break;
    }
    diff += piece;
  }
  return { files, diff, truncated: cut };
}
