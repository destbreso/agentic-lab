// ============================================
// The runner: every arm, task and repetition, resumable
// ============================================
// Attempts go repetition by repetition, so an experiment stopped halfway has
// covered every arm and task about equally. The lock is written before the
// first attempt; each attempt's line is appended as it ends. A rerun skips
// what is already settled and tries again what could not start.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { coreVersion, type LLMProvider } from "jig-core";
import { runAttempt, type AttemptRunner } from "./attempt.js";
import { lockExperiment, type Lock } from "./lock.js";
import { RESULTS_FILE, attemptKey, readResults, settled, type AttemptRecord } from "./results.js";
import { directApplies, type Arm, type LoadedSpec } from "./spec.js";
import type { BenchTask } from "./taskset.js";
import { benchmarkVersion } from "./version.js";

export interface PlannedAttempt {
  arm: Arm;
  task: BenchTask;
  /** 1-based. */
  repetition: number;
}

/** Every attempt the spec asks for: the direct arm only on the tasks it applies to. */
export function planAttempts(loaded: LoadedSpec): PlannedAttempt[] {
  const out: PlannedAttempt[] = [];
  for (let repetition = 1; repetition <= loaded.data.repetitions; repetition++) {
    for (const task of loaded.taskSet.tasks) {
      for (const arm of loaded.arms) if (arm.kind !== "direct" || directApplies(task)) out.push({ arm, task, repetition });
    }
  }
  return out;
}

export interface RunOptions {
  outDir: string;
  provider: LLMProvider;
  /** Runs one attempt (default: the real one, through jig-core). */
  attempt?: AttemptRunner;
  signal?: AbortSignal;
  /** Called as each attempt starts and ends: its place in the queue and how many are queued. */
  onStart?: (p: PlannedAttempt, index: number, queued: number) => void;
  onEnd?: (record: AttemptRecord, index: number, queued: number) => void;
  /** Where each attempt's workspace is made (default: the system's temporary folder). */
  workRoot?: string;
  /** Checked before each attempt: an unreachable provider is recorded as an attempt that did not start. */
  ready?: () => Promise<string | null>;
  versions?: { core: string; benchmark: string };
  now?: () => Date;
}

export interface RunSummary {
  lock: Lock;
  lockCreated: boolean;
  /** Attempts run now, in the order they ended. */
  ran: AttemptRecord[];
  /** Already settled before this run. */
  skipped: number;
  /** Planned and still not settled (interrupted, or could not start). */
  remaining: number;
  interrupted: boolean;
  planned: number;
}

export async function runExperiment(loaded: LoadedSpec, options: RunOptions): Promise<RunSummary> {
  const versions = options.versions ?? { core: coreVersion(), benchmark: benchmarkVersion() };
  const { lock, created } = await lockExperiment(options.outDir, loaded, versions, options.now?.() ?? new Date());
  const runsDir = join(options.outDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const before = await readResults(options.outDir);
  const done = new Set(before.records.filter(settled).map(attemptKey));
  const planned = planAttempts(loaded);
  const queue = planned.filter((p) => !done.has(attemptKey({ arm: p.arm.key, task: p.task.id, repetition: p.repetition })));
  const attempt = options.attempt ?? runAttempt;
  const ran: AttemptRecord[] = [];
  let interrupted = false;
  let next = 0;
  // One writer: lines from concurrent attempts never interleave.
  let writing: Promise<void> = Promise.resolve();
  const record = (r: AttemptRecord) => {
    writing = writing.then(() => appendFile(join(options.outDir, RESULTS_FILE), `${JSON.stringify(r)}\n`));
    return writing;
  };

  const worker = async () => {
    while (next < queue.length && !options.signal?.aborted) {
      const index = next++;
      const p = queue[index]!;
      options.onStart?.(p, index, queue.length);
      let rec: AttemptRecord;
      const notReady = options.ready ? await options.ready() : null;
      if (notReady) {
        rec = failedToStart(p, loaded, versions.core, notReady);
      } else {
        try {
          const out = await attempt({ spec: loaded.data, arm: p.arm, task: p.task, repetition: p.repetition, provider: options.provider, runsDir, ...(options.workRoot ? { workRoot: options.workRoot } : {}), ...(options.signal ? { signal: options.signal } : {}) });
          if (out.interrupted) {
            interrupted = true;
            continue;
          }
          rec = out.record;
        } catch (e) {
          rec = failedToStart(p, loaded, versions.core, (e as Error).message);
        }
      }
      await record(rec);
      ran.push(rec);
      options.onEnd?.(rec, index, queue.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(loaded.data.concurrency, Math.max(queue.length, 1)) }, worker));
  await writing;
  if (options.signal?.aborted) interrupted = true;
  const after = await readResults(options.outDir);
  const settledNow = new Set(after.records.filter(settled).map(attemptKey));
  const remaining = planned.filter((p) => !settledNow.has(attemptKey({ arm: p.arm.key, task: p.task.id, repetition: p.repetition }))).length;
  return { lock, lockCreated: created, ran, skipped: planned.length - queue.length, remaining, interrupted, planned: planned.length };
}

function failedToStart(p: PlannedAttempt, loaded: LoadedSpec, core: string, error: string): AttemptRecord {
  return {
    arm: p.arm.key,
    kind: p.arm.kind,
    topology: p.arm.topology,
    task: p.task.id,
    repetition: p.repetition,
    run_id: "",
    outcome: null,
    checks_passed: 0,
    checks_total: p.task.checks.length,
    tokens: { input: 0, output: 0, total: 0 },
    duration_ms: 0,
    rounds: null,
    fallbacks: [],
    call_errors: 0,
    error,
    model: loaded.data.model,
    core,
    at: new Date().toISOString(),
  };
}
