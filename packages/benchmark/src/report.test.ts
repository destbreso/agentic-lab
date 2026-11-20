// The report drawn from fixed results, as text: the direct arm first, then the baselines, then the arms.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Lock } from "./lock.js";
import { renderConclusions, renderReport, renderTable, buildSummary, shownPath } from "./report.js";
import type { AttemptRecord } from "./results.js";
import { armInfo, loadSpec } from "./spec.js";
import { helloSpec, helloTasks, scratch, type Scratch } from "./test-support/fixtures.js";

let s: Scratch;
let lock: Lock;

beforeAll(async () => {
  s = await scratch();
  await s.writeTasks(helloTasks);
  await s.writeSpec(helloSpec({ repetitions: 2, arms: ["reflexion", "exec-eval"], rule: { margin: 0.2 } }));
  const loaded = await loadSpec(s.spec);
  lock = {
    hash: loaded.hash,
    lockedAt: "2026-11-19T10:00:00.000Z",
    core: "0.1.7",
    benchmark: "0.1.0",
    specFile: "/home/someone/bench/spec.yaml",
    taskSetFile: loaded.taskSetFile,
    spec: loaded.data,
    taskSet: loaded.taskSet,
    arms: loaded.arms.map(armInfo),
    topologyFiles: {},
  };
});
afterAll(() => s.remove());

const rec = (arm: string, task: string, repetition: number, outcome: AttemptRecord["outcome"], extra: Partial<AttemptRecord> = {}): AttemptRecord => ({
  arm,
  kind: arm === "direct" ? "direct" : arm === "ralph-loop" ? "baseline" : "arm",
  topology: arm === "direct" ? null : arm,
  task,
  repetition,
  run_id: `${arm}.${task}.${repetition}.x`,
  outcome,
  checks_passed: outcome === "passed" ? 1 : 0,
  checks_total: 1,
  tokens: { input: 900, output: 100 * repetition, total: 900 + 100 * repetition },
  duration_ms: 2000 * repetition,
  rounds: arm === "direct" ? null : repetition,
  fallbacks: [],
  call_errors: 0,
  model: "scripted/scripted",
  core: "0.1.7",
  at: "2026-11-19T10:00:00.000Z",
  ...extra,
});

const records: AttemptRecord[] = [
  rec("direct", "hello", 1, "failed"),
  rec("direct", "hello", 2, "passed"),
  rec("ralph-loop", "hello", 1, "passed"),
  rec("ralph-loop", "hello", 2, "failed"),
  rec("ralph-loop", "bye", 1, "failed"),
  rec("ralph-loop", "bye", 2, null, { run_id: "", error: "scripted does not answer", rounds: null }),
  rec("reflexion", "hello", 1, "passed"),
  rec("reflexion", "hello", 2, "passed"),
  rec("reflexion", "bye", 1, "passed", { call_errors: 1 }),
  rec("reflexion", "bye", 2, "inconclusive"),
  rec("exec-eval", "hello", 1, "passed"),
  rec("exec-eval", "hello", 2, "passed"),
  rec("exec-eval", "bye", 1, "passed"),
];

describe("the report", () => {
  it("is drawn the same from the same results", () => {
    const md = renderReport({ lock, records, version: "0.1.0", generatedAt: new Date("2026-11-19T12:00:00.000Z"), home: "/home/someone" });
    expect(md).toMatchSnapshot();
  });

  it("orders the direct arm, then the baselines, then the arms, in every table and in the conclusions", () => {
    const md = renderReport({ lock, records, version: "0.1.0", generatedAt: new Date("2026-11-19T12:00:00.000Z"), home: "/home/someone" });
    expect(md).toContain("| Task | Direct | Ralph Loop | Reflexion | Execute & Evaluate |");
    const side = md.slice(md.indexOf("## The arms side by side"), md.indexOf("## Every attempt"));
    const rows = side.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Arm"));
    expect(rows.map((r) => r.split(" | ")[0]!.slice(2))).toEqual(["Direct", "Ralph Loop", "Reflexion", "Execute & Evaluate"]);
    expect(md.indexOf("### Against the direct arm")).toBeLessThan(md.indexOf("### Against Ralph Loop, a baseline"));
    const summary = buildSummary(lock, records);
    expect(renderTable(summary).split("\n").slice(2).map((l) => l.split("  ")[0])).toEqual(["Direct", "Ralph Loop", "Reflexion", "Execute & Evaluate"]);
    expect(renderConclusions(summary)[0]).toBe("Against the direct arm:");
  });

  it("marks n/a where the direct arm does not apply, and says so under the table", () => {
    const md = renderReport({ lock, records, version: "0.1.0", generatedAt: new Date("2026-11-19T12:00:00.000Z") });
    expect(md).toMatch(/\| `bye` \| n\/a \| /);
    expect(md).toContain("The direct arm's count is over the 1 of 2 tasks that say where its answer goes; on the others it is not applicable, never a failure.");
    expect(md).toContain("The direct arm gets one call and no tools, by design.");
    expect(md).toContain("Writing its answer into the task's file is the lab's doing, not the model's");
  });

  it("says it is not complete while attempts are missing", () => {
    const md = renderReport({ lock, records, version: "0.1.0", generatedAt: new Date("2026-11-19T12:00:00.000Z") });
    expect(md).toContain("Not complete: 12 of 14 attempts ran to an outcome.");
  });

  it("shows the home folder as ~", () => {
    expect(shownPath("/home/someone/bench/spec.yaml", "/home/someone")).toBe("~/bench/spec.yaml");
    expect(shownPath("/elsewhere/spec.yaml", "/home/someone")).toBe("/elsewhere/spec.yaml");
  });
});
