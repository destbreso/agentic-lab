// Check's verdict follows the measured check when the task has one: the
// lab's result decides the round, the model's verdict is kept beside it as
// written, and a model that hides its verdict in a tool call or never gives
// one no longer decides anything. `verdictFrom: "model"` turns that off, so
// H2 can be tested; the reported outcome is the final measured check's either way.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "../engine/agent-session.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall, type ScriptedReply } from "../test-support/scripted-provider.js";
import type { StepRecord } from "../types/step.js";

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "verdict-"));
  await writeFile(join(ws, "PROBE.txt"), "7351-kestrel\n");
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

const CHECK = { name: "result", kind: "file" as const, path: "RESULT.txt", equals: "kestrel-7351" };

/** Do writes the probe unswapped, and swaps it once a correction names the failed check. */
function doer(c: ScriptedCall): ScriptedReply | string | undefined {
  if (c.role !== "do") return undefined;
  const toolTurns = c.options.messages.filter((m) => m.role === "tool").length;
  if (toolTurns > 0) return "wrote RESULT.txt";
  const corrected = c.prompt.includes('The measured check "result" failed');
  return { toolCalls: [{ name: "file_write", arguments: { path: "RESULT.txt", content: corrected ? "kestrel-7351" : "7351-kestrel" } }] };
}

/** What qwen2.5 did in phase 0: the verdict JSON in a shell call's arguments, then prose. */
function hidesItsVerdict(c: ScriptedCall): ScriptedReply | string | undefined {
  if (c.role !== "check") return doer(c);
  if (!c.options.messages.some((m) => m.role === "tool")) {
    return { toolCalls: [{ name: "shell", arguments: { verdict: "pass", evidence: ["looks right"] } }] };
  }
  return "Everything looks correct to me.";
}

/** Check's model always says pass. */
function alwaysPasses(c: ScriptedCall): ScriptedReply | string | undefined {
  if (c.role !== "check") return doer(c);
  return JSON.stringify({ verdict: "pass", evidence: ["it is there"], corrections: [], confidence: 0.9 });
}

async function run(script: (c: ScriptedCall) => ScriptedReply | string | undefined, opts: { verdictFrom?: "measured" | "model"; topology?: string } = {}) {
  return new AgentSession({
    provider: scriptedProvider(script),
    tools: createDefaultToolkit(),
    topology: opts.topology ?? "exec-eval",
    workingDir: ws,
    delayMs: 0,
    verdictFrom: opts.verdictFrom,
  }).run({ task: "Swap the two parts of PROBE.txt into RESULT.txt.", checks: [CHECK] });
}

const evaluations = (steps: StepRecord[]) =>
  steps.flatMap((s) => s.outputs.filter((o) => o.type === "evaluation").map((o) => ({ round: s.round, ...o.fields })));

describe("Check's verdict follows the measured check", () => {
  it("decides the round on the lab's check when the model hides its verdict in a tool call", async () => {
    const r = await run(hidesItsVerdict);
    const [first, second] = evaluations(r.steps);
    expect(first.verdict).toEqual({ provenance: "measured", value: "fail" });
    expect(first.verdictSource.value).toBe("measured");
    expect(first.modelVerdict).toEqual({ provenance: "written", value: null });
    expect(first.measuredChecks.value).toMatchObject([{ name: "result", passed: false }]);

    // The way back to Do carries the failed check's own output, marked measured.
    const doRound2 = r.steps.find((s) => s.role === "exec" && s.round === 2)!;
    const corrections = doRound2.inputs.find((i) => i.name === "corrections")!;
    expect(corrections.fields?.corrections.provenance).toBe("measured");
    expect(String(corrections.fields?.corrections.value)).toContain('expected equal to "kestrel-7351"');

    expect(second.verdict.value).toBe("pass");
    expect(r.result.outcome).toBe("passed");
    expect(r.outcome).toBe("passed");
    expect(r.result.errors).toEqual([]);
  });

  it("each check Check ran is one of its inputs, measured", async () => {
    const r = await run(hidesItsVerdict);
    const check = r.steps.find((s) => s.role === "eval")!;
    const input = check.inputs.find((i) => i.source === "check")!;
    expect(input).toMatchObject({ from: "lab", provenance: "measured", name: "round 1 · Evaluator" });
    expect(input.fields?.passed).toEqual({ provenance: "measured", value: false });
  });

  it("keeps the model's verdict beside the measured one when they disagree", async () => {
    const r = await run(alwaysPasses);
    const [first] = evaluations(r.steps);
    expect(first.verdict.value).toBe("fail");
    expect(first.modelVerdict).toEqual({ provenance: "written", value: "pass" });
    expect(r.outcome).toBe("passed");
  });

  it("shows Do what the failed check printed beside corrections a model wrote", async () => {
    const writes = (c: ScriptedCall) =>
      c.role === "check"
        ? JSON.stringify({ verdict: "fail", evidence: ["wrong order"], corrections: ["MARK-WRITTEN swap them"], confidence: 0.7 })
        : doer(c);
    const r = await run(writes, { topology: "exec-eval" });
    const doRound2 = r.steps.find((s) => s.role === "exec" && s.round === 2)!;
    const prompt = doRound2.calls[0].messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("MARK-WRITTEN swap them");
    expect(prompt).toContain("## Measured checks that failed");
    expect(prompt).toContain('RESULT.txt holds "7351-kestrel"; expected equal to "kestrel-7351"');
  });

  it("with the switch off, the model's verdict drives the topology, and the outcome is still the lab's", async () => {
    const r = await run(alwaysPasses, { verdictFrom: "model" });
    const [first] = evaluations(r.steps);
    expect(first.verdict).toEqual({ provenance: "written", value: "pass" });
    expect(first.verdictSource.value).toBe("model");
    // Check's model passed a wrong result: the topology stopped after one round...
    expect(r.result.outcome).toBe("passed");
    expect(r.result.totalCycles).toBe(1);
    // ...and the lab's final check says what happened.
    expect(r.measured?.passed).toBe(false);
    expect(r.outcome).toBe("failed");
  });

  it("a model that never gives a verdict does not fail Check when there is a check to follow", async () => {
    const loops = (c: ScriptedCall) =>
      c.role === "check" ? { toolCalls: [{ name: "file_read", arguments: { path: "RESULT.txt" } }] } : doer(c);
    const r = await run(loops);
    const [first] = evaluations(r.steps);
    expect(first.verdict.value).toBe("fail");
    expect(String(first.modelError.value)).toMatch(/tool-call cap/);
    expect(r.result.errors).toEqual([]);
    expect(r.outcome).toBe("passed");
  });

  it("makes Decide's pass rate and its rule's decision measured", async () => {
    // Decide's model sends the failed round back; the passing round converges by rule.
    const refine = (c: ScriptedCall) =>
      c.role === "decide" ? JSON.stringify({ decision: "refine", reason: "the check failed", corrections: [] }) : alwaysPasses(c);
    const r = await run(refine, { topology: "deep-reasoning" });
    const decisions = r.steps.flatMap((s) => s.outputs.filter((o) => o.type === "refinement_decision").map((o) => o.fields));
    expect(decisions[0].action).toEqual({ provenance: "written", value: "refine" });
    expect(decisions[0].passRate).toEqual({ provenance: "measured", value: 0 });
    const last = decisions.at(-1)!;
    expect(last.action.value).toBe("converge");
    expect(last.passRate).toEqual({ provenance: "measured", value: 1 });
    expect(last.action.provenance).toBe("measured");
    expect(r.outcome).toBe("passed");
  });
});
