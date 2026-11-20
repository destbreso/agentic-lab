// The locked rule's outcomes, and the words it puts them in.

import { describe, expect, it } from "vitest";
import { decide, sentence, summarise } from "./compare.js";
import type { AttemptRecord } from "./results.js";
import type { ArmInfo } from "./spec.js";
import type { TaskSet } from "./taskset.js";

describe("the rule", () => {
  it("supports when the arm's interval lies wholly above the other's", () => {
    const d = decide({ k: 18, n: 20 }, { k: 4, n: 20 });
    expect(d.verdict).toBe("supports");
    expect(d.why).toBe("above");
    expect(d.a.lower).toBeGreaterThan(d.b.upper);
    expect(sentence(d, "Execute & Evaluate", "Ralph Loop")).toBe(
      "supports: on these tasks and this model, Execute & Evaluate passed more often than Ralph Loop. Execute & Evaluate passed 18 of 20 (70% to 97%) and Ralph Loop 4 of 20 (8% to 42%), and the two 95% intervals do not overlap.",
    );
  });

  it("is against when it lies wholly below", () => {
    const d = decide({ k: 2, n: 20 }, { k: 15, n: 20 });
    expect(d.verdict).toBe("against");
    expect(d.why).toBe("below");
    expect(sentence(d, "A", "B")).toMatch(/^against: on these tasks and this model, A passed less often than B\. .*A's 95% interval lies wholly below B's\.$/);
  });

  it("is inconclusive when the intervals overlap, with the runs a difference of that size would need", () => {
    const d = decide({ k: 6, n: 10 }, { k: 4, n: 10 });
    expect(d.verdict).toBe("inconclusive");
    expect(d.why).toBe("overlap");
    // 0.6 against 0.4: the published 97 per arm.
    expect(d.runsPerArm).toBe(97);
    const s = sentence(d, "A", "B");
    expect(s).toContain("these counts do not tell the two apart");
    expect(s).toContain("about 97 runs per arm (two proportions, 95% two-sided, power 80%)");
    expect(s).toContain("stricter than that test, so expect more");
  });

  it("says no run count can be predicted when the rates are equal", () => {
    const d = decide({ k: 3, n: 6 }, { k: 3, n: 6 });
    expect(d.verdict).toBe("inconclusive");
    expect(d.runsPerArm).toBeNull();
    expect(sentence(d, "A", "B")).toContain("They passed equally often here");
  });

  it("with a margin, is against when the difference's interval lies inside it: no practical difference", () => {
    const d = decide({ k: 500, n: 1000 }, { k: 505, n: 1000 }, 0.1);
    expect(d.verdict).toBe("against");
    expect(d.why).toBe("no-practical-difference");
    expect(sentence(d, "A", "B", 0.1)).toMatch(/^against: no practical difference between A and B .*inside the margin of 10 points either way\.$/);
    // Without the margin the same counts decide nothing.
    expect(decide({ k: 500, n: 1000 }, { k: 505, n: 1000 }).verdict).toBe("inconclusive");
    // A margin the interval does not fit in leaves it inconclusive.
    expect(decide({ k: 5, n: 10 }, { k: 5, n: 10 }, 0.1).verdict).toBe("inconclusive");
  });

  it("decides nothing without attempts", () => {
    const d = decide({ k: 0, n: 0 }, { k: 3, n: 4 });
    expect(d.verdict).toBe("inconclusive");
    expect(d.why).toBe("no-attempts");
  });
});

describe("the summary", () => {
  const arms: ArmInfo[] = [
    { key: "direct", label: "Direct", kind: "direct", topology: null, source: "one model call, no tools" },
    { key: "ralph-loop", label: "Ralph Loop", kind: "baseline", topology: "ralph-loop", source: "built in" },
    { key: "exec-eval", label: "Execute & Evaluate", kind: "arm", topology: "exec-eval", source: "built in" },
  ];
  const set: TaskSet = {
    name: "s",
    description: "d",
    tasks: [
      { id: "a", task: "a", files: {}, checks: [{ name: "check 1", kind: "command", command: "true" }], checkFiles: [], direct: { answerFile: "x" }, tags: [] },
      { id: "b", task: "b", files: {}, checks: [{ name: "check 1", kind: "command", command: "true" }], checkFiles: [], tags: [] },
    ],
  };
  const rec = (arm: string, task: string, repetition: number, outcome: AttemptRecord["outcome"], extra: Partial<AttemptRecord> = {}): AttemptRecord => ({
    arm,
    kind: arms.find((a) => a.key === arm)!.kind,
    topology: arms.find((a) => a.key === arm)!.topology,
    task,
    repetition,
    run_id: `${arm}.${task}.${repetition}`,
    outcome,
    checks_passed: outcome === "passed" ? 1 : 0,
    checks_total: 1,
    tokens: { input: 0, output: 0, total: 100 },
    duration_ms: 1000,
    rounds: 1,
    fallbacks: [],
    call_errors: 0,
    model: "m/m",
    core: "0",
    at: "2026-11-19T00:00:00.000Z",
    ...extra,
  });

  it("counts the direct arm only on the tasks it applies to, and compares against it on those tasks alone", () => {
    const records = [
      rec("direct", "a", 1, "failed"),
      rec("ralph-loop", "a", 1, "passed"),
      rec("ralph-loop", "b", 1, "passed"),
      rec("exec-eval", "a", 1, "passed"),
      rec("exec-eval", "b", 1, "failed"),
    ];
    const s = summarise(arms, set, records, {}, false);
    expect(s.arms.map((a) => [a.arm.key, a.count.k, a.count.n, a.tasks])).toEqual([
      ["direct", 0, 1, ["a"]],
      ["ralph-loop", 2, 2, ["a", "b"]],
      ["exec-eval", 1, 2, ["a", "b"]],
    ]);
    // Every arm against the direct arm, then the arms against each baseline.
    expect(s.comparisons.map((c) => [c.arm.key, c.against.key, c.decision.a.n, c.decision.b.n])).toEqual([
      ["ralph-loop", "direct", 1, 1],
      ["exec-eval", "direct", 1, 1],
      ["exec-eval", "ralph-loop", 2, 2],
    ]);
    expect(s.comparisons[0]!.sentence).toMatch(/^inconclusive \(on the 1 of 2 tasks the direct arm applies to\): /);
  });

  it("leaves out an attempt that did not start, and one that fell back, unless the spec counts fallbacks", () => {
    const records = [
      rec("exec-eval", "a", 1, "passed", { fallbacks: [{ role: "exec", from: "x/a", to: "x/b", reason: "down" }] }),
      rec("exec-eval", "b", 1, null, { error: "unreachable" }),
      rec("exec-eval", "a", 2, "stopped"),
    ];
    const s = summarise(arms, set, records, {}, false);
    const e = s.arms.find((a) => a.arm.key === "exec-eval")!;
    expect([e.count.k, e.count.n, e.notStarted, e.fellBack, e.noVerdict]).toEqual([0, 1, 1, 1, 1]);
    const counted = summarise(arms, set, records, {}, true).arms.find((a) => a.arm.key === "exec-eval")!;
    expect([counted.count.k, counted.count.n, counted.fellBack]).toEqual([1, 2, 0]);
  });
});
