// ============================================
// results.jsonl: one line per attempt
// ============================================
// Appended as each attempt ends, so a run that is stopped keeps what it did.
// An attempt that could not start is recorded with its error and counts for
// nothing; a rerun tries it again, and the newest line for an attempt wins.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunOutcome } from "jig-core";
import type { ArmKind } from "./spec.js";

export interface AttemptRecord {
  arm: string;
  kind: ArmKind;
  /** The topology's id; null for the direct arm. */
  topology: string | null;
  task: string;
  /** 1-based. */
  repetition: number;
  run_id: string;
  /** How the attempt ended, by the task's measured checks; null when it did not start. */
  outcome: RunOutcome | null;
  /** Why it ended so, in plain words, as jig-core says it. */
  reason?: string;
  checks_passed: number;
  checks_total: number;
  tokens: { input: number; output: number; total: number };
  duration_ms: number;
  /** Rounds the topology took; null for the direct arm. */
  rounds: number | null;
  /** Every fallback a role took along its chain: an attempt with one counts for nothing unless the spec says otherwise. */
  fallbacks: Array<{ role: string; from: string; to: string; reason: string }>;
  /** Model calls that ended in an error (a timeout, a refused connection). */
  call_errors: number;
  /** Why the attempt did not start or did not finish. */
  error?: string;
  model: string;
  core: string;
  at: string;
}

export const RESULTS_FILE = "results.jsonl";

export const attemptKey = (r: { arm: string; task: string; repetition: number }) => `${r.arm}\u0000${r.task}\u0000${r.repetition}`;

/** Whether an attempt is settled: it ran to an outcome. One that did not start is tried again. */
export const settled = (r: AttemptRecord) => r.outcome !== null && !r.error;

export interface ReadResults {
  records: AttemptRecord[];
  /** Lines that could not be read (a write cut short), by number. */
  unreadable: number[];
}

/** Every attempt in the file, the newest line for each attempt kept. */
export async function readResults(outDir: string): Promise<ReadResults> {
  let text = "";
  try {
    text = await readFile(join(outDir, RESULTS_FILE), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { records: [], unreadable: [] };
    throw e;
  }
  const latest = new Map<string, AttemptRecord>();
  const unreadable: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r = JSON.parse(line) as AttemptRecord;
      if (typeof r.arm !== "string" || typeof r.task !== "string" || typeof r.repetition !== "number") throw new Error("not an attempt");
      latest.set(attemptKey(r), r);
    } catch {
      unreadable.push(i + 1);
    }
  });
  return { records: [...latest.values()], unreadable };
}

/** Whether an attempt counts in its arm's k of n: it ran, and fell back to no other model (unless the spec counts those). */
export function counts(r: AttemptRecord, countFallbacks: boolean): boolean {
  return settled(r) && (countFallbacks || r.fallbacks.length === 0);
}
