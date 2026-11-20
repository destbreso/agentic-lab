// ============================================
// What an experiment will run, before anything runs
// ============================================
// The attempts are counted exactly. Tokens have a bound, not a forecast: each
// attempt stops after the model call that crosses its budget, so it can go
// over by that one call. Time is not estimated: it depends on the model and
// the machine, and no run has measured either yet.

import { planAttempts } from "./runner.js";
import { settled, attemptKey, type AttemptRecord } from "./results.js";
import { directApplies, type LoadedSpec } from "./spec.js";

export interface Estimate {
  attempts: number;
  byArm: Array<{ key: string; label: string; kind: string; tasks: number; attempts: number }>;
  /** Attempts times the per-attempt budget. */
  tokenBound: number;
  alreadyRecorded: number;
}

export function estimate(loaded: LoadedSpec, recorded: AttemptRecord[] = []): Estimate {
  const planned = planAttempts(loaded);
  const done = new Set(recorded.filter(settled).map(attemptKey));
  const reps = loaded.data.repetitions;
  return {
    attempts: planned.length,
    byArm: loaded.arms.map((a) => {
      const tasks = a.kind === "direct" ? loaded.taskSet.tasks.filter(directApplies).length : loaded.taskSet.tasks.length;
      return { key: a.key, label: a.label, kind: a.kind, tasks, attempts: tasks * reps };
    }),
    tokenBound: planned.length * loaded.data.budget.tokens,
    alreadyRecorded: planned.filter((p) => done.has(attemptKey({ arm: p.arm.key, task: p.task.id, repetition: p.repetition }))).length,
  };
}

export function renderEstimate(loaded: LoadedSpec, e: Estimate, outDir: string): string[] {
  const n = loaded.taskSet.tasks.length;
  const width = Math.max(...e.byArm.map((a) => a.label.length));
  const lines = [
    `${loaded.data.name}: ${e.byArm.length} arms on ${n} task${n === 1 ? "" : "s"} of ${loaded.taskSet.name}, ${loaded.data.repetitions} repetition${loaded.data.repetitions === 1 ? "" : "s"}, every role on ${loaded.data.model}`,
    "",
    ...e.byArm.map((a) => {
      const what = a.kind === "direct" ? `one model call each, no tools; applies to ${a.tasks} of ${n} tasks` : a.kind === "baseline" ? "baseline" : "arm";
      return `  ${a.label.padEnd(width)}  ${String(a.attempts).padStart(4)} attempts  (${what})`;
    }),
    "",
    `  ${e.attempts} attempts in all${e.alreadyRecorded ? `, ${e.alreadyRecorded} already recorded in ${outDir}` : ""}.`,
    `  Tokens: at most about ${e.tokenBound.toLocaleString("en-US")} (${e.attempts} attempts times ${loaded.data.budget.tokens.toLocaleString("en-US")}); each attempt stops after the model call that crosses its budget, so it can go over by that one call.`,
    "  Time: not estimated before a run; it depends on the model and the machine.",
  ];
  return lines;
}
