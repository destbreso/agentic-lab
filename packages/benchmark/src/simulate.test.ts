// A simulated experiment: a seeded fake attempt-runner with known pass rates per arm, through the real runner,
// lock, results and rule. With enough runs the rule finds the difference that is there; with few it says inconclusive.

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptRunner } from "./attempt.js";
import { buildSummary } from "./report.js";
import { readLock } from "./lock.js";
import { readResults } from "./results.js";
import { runExperiment } from "./runner.js";
import { loadSpec } from "./spec.js";
import { helloSpec, scratch, scriptedProvider, type Scratch } from "./test-support/fixtures.js";

/** mulberry32: a small seeded generator, so a simulated run is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Passes with the arm's probability; every attempt is otherwise an ordinary record. */
function fake(rates: Record<string, number>, seed: number): AttemptRunner {
  const random = seeded(seed);
  return async ({ spec, arm, task, repetition }) => {
    const passed = random() < rates[arm.key]!;
    return {
      interrupted: false,
      record: {
        arm: arm.key,
        kind: arm.kind,
        topology: arm.topology,
        task: task.id,
        repetition,
        run_id: `${arm.key}.${task.id}.${repetition}`,
        outcome: passed ? "passed" : "failed",
        checks_passed: passed ? 1 : 0,
        checks_total: 1,
        tokens: { input: 80, output: 20, total: 100 },
        duration_ms: 1000,
        rounds: arm.kind === "direct" ? null : 1,
        fallbacks: [],
        call_errors: 0,
        model: spec.model,
        core: "0.0.0",
        at: "2026-11-19T00:00:00.000Z",
      },
    };
  };
}

const tasks = (n: number) => ({
  name: "sim",
  description: "Simulated tasks.",
  tasks: Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, task: `task ${i + 1}`, checks: ["true"], direct: { answer_file: "a.txt" } })),
});

let s: Scratch;
beforeEach(async () => {
  s = await scratch();
});
afterEach(() => s.remove());

let runs = 0;
async function simulate(reps: number, rates: Record<string, number>, seed: number, margin?: number) {
  await s.writeTasks(tasks(5));
  await s.writeSpec(helloSpec({ repetitions: reps, ...(margin ? { rule: { margin } } : {}) }));
  const loaded = await loadSpec(s.spec);
  // Each simulation in a folder of its own: the same spec in the same folder would resume, not run again.
  const outDir = join(s.dir, `out-${++runs}`);
  await runExperiment(loaded, { outDir, provider: scriptedProvider(), attempt: fake(rates, seed) });
  const lock = (await readLock(outDir))!;
  const summary = buildSummary(lock, (await readResults(outDir)).records);
  const verdict = (arm: string, against: string) => summary.comparisons.find((c) => c.arm.key === arm && c.against.key === against)!;
  return { summary, verdict };
}

describe("a simulated experiment", () => {
  it("with enough runs, supports the arm that is better and is against the one that is worse", async () => {
    // 5 tasks times 16 repetitions: 80 attempts per arm.
    const { summary, verdict } = await simulate(16, { direct: 0.2, "ralph-loop": 0.35, "exec-eval": 0.9 }, 7);
    expect(summary.arms.map((a) => a.count.n)).toEqual([80, 80, 80]);
    expect(verdict("exec-eval", "direct").decision.verdict).toBe("supports");
    expect(verdict("exec-eval", "ralph-loop").decision.verdict).toBe("supports");
    const worse = await simulate(16, { direct: 0.9, "ralph-loop": 0.9, "exec-eval": 0.2 }, 11);
    expect(worse.verdict("exec-eval", "ralph-loop").decision.verdict).toBe("against");
    expect(worse.verdict("exec-eval", "direct").decision.verdict).toBe("against");
  });

  it("with few runs, says inconclusive and how many runs would likely decide it", async () => {
    // 5 tasks times 2 repetitions: 10 attempts per arm, true rates 10 points apart.
    const { verdict } = await simulate(2, { direct: 0.45, "ralph-loop": 0.45, "exec-eval": 0.55 }, 3);
    const c = verdict("exec-eval", "ralph-loop");
    expect(c.decision.verdict).toBe("inconclusive");
    expect(c.sentence).toContain("these counts do not tell the two apart");
    if (c.decision.a.rate !== c.decision.b.rate) expect(c.decision.runsPerArm).toBeGreaterThan(10);
  });

  it("with many runs and a margin, finds no practical difference between arms that are the same", async () => {
    // 5 tasks times 400 repetitions: 2,000 attempts per arm at the same rate.
    const { verdict } = await simulate(400, { direct: 0.5, "ralph-loop": 0.5, "exec-eval": 0.5 }, 5, 0.1);
    const c = verdict("exec-eval", "ralph-loop");
    expect(c.decision.verdict).toBe("against");
    expect(c.decision.why).toBe("no-practical-difference");
  });

  it("reaches the right conclusion across seeds, not only on one", async () => {
    let right = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { verdict } = await simulate(16, { direct: 0.2, "ralph-loop": 0.3, "exec-eval": 0.85 }, seed);
      if (verdict("exec-eval", "ralph-loop").decision.verdict === "supports") right++;
    }
    // A 55-point gap at 80 attempts per arm: the rule's power is near 1, so every seed should find it.
    expect(right).toBe(8);
  });
});
