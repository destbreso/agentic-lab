// Decide: a round without a verdict is inconclusive, a verdict counts once,
// partial, inconclusive and unparsed verdicts never pass, "done" ends the run,
// and the round limit counts the rounds taken.

import { describe, it, expect } from "vitest";
import { RefinementLoop } from "./refinement.js";
import { instantiateRecipe } from "./recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { InMemorySharedStore } from "../engine/capability-resolver.js";
import { scriptedProvider, type ScriptedCall, type ScriptedReply } from "../test-support/scripted-provider.js";
import type { NodeContext, Signal } from "../types/pipeline.js";

function sig(type: string, data: Record<string, unknown>, source = "eval"): Signal {
  return { sourceNodeId: source, type, data, timestamp: new Date().toISOString() };
}

function contextWith(inputSignals: Signal[], round = 1) {
  const emitted: Signal[] = [];
  const done: string[] = [];
  const context: NodeContext = {
    nodeId: "refine",
    traceId: "t",
    iteration: round,
    round,
    workingDir: "/tmp",
    inputSignals,
    emit: (_port, type, data) => emitted.push(sig(type, data, "refine")),
    requestStop: () => {},
    done: (reason) => done.push(reason),
    pipelineState: {
      pipelineId: "p",
      status: "running",
      cycle: round,
      round,
      totalTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      recentSignals: [],
      nodeStatuses: {},
      shared: {},
    },
    shared: new InMemorySharedStore({}),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  return { context, emitted, done };
}

function decide(script?: (c: ScriptedCall) => string | undefined) {
  const provider = scriptedProvider(script);
  const loop = new RefinementLoop({ provider, convergenceThreshold: 0.7, maxRounds: 3 });
  return { provider, loop };
}

const decisionOf = (emitted: Signal[]) => emitted.find((s) => s.type === "refinement_decision")!.data;

describe("Decide", () => {
  it("treats a round without a verdict as inconclusive, not a pass", async () => {
    const { provider, loop } = decide(() => JSON.stringify({ decision: "refine", reason: "no verdict yet", corrections: [] }));
    const { context, emitted, done } = contextWith([sig("critic_feedback", { status: "ok", feedback: "No issues" }, "critic")]);
    await loop.execute(context);
    // No shortcut to converge: the model was asked, and told there was no verdict.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].prompt).toMatch(/no verdict was given this round/);
    expect(decisionOf(emitted).passRate).toBeNull();
    expect(done).toHaveLength(0);
  });

  it("counts a verdict once, though evaluation and eval_metrics both carry it", async () => {
    const { loop } = decide(() => JSON.stringify({ decision: "refine", reason: "r", corrections: [] }));
    const { context, emitted } = contextWith([
      sig("evaluation", { verdict: "fail", iteration: 1 }),
      sig("eval_metrics", { verdict: "fail", iteration: 1 }),
    ]);
    await loop.execute(context);
    expect(decisionOf(emitted).failedCriteria).toEqual(["verdict: fail"]);
  });

  it.each([
    ["partial", { verdict: "partial", iteration: 1 }],
    ["inconclusive", { verdict: "inconclusive", iteration: 1 }],
    ["unparsed", { verdict: "pass", parsed: false, iteration: 1 }],
  ])("never counts a %s verdict as passing", async (_label, data) => {
    const { provider, loop } = decide(() => JSON.stringify({ decision: "refine", reason: "r", corrections: [] }));
    const { context, emitted, done } = contextWith([sig("evaluation", data)]);
    await loop.execute(context);
    expect(decisionOf(emitted).passRate).toBe(0);
    expect(provider.calls).toHaveLength(1);
    expect(done).toHaveLength(0);
  });

  it("converges on a parsed pass without asking the model, and declares the run done", async () => {
    const { provider, loop } = decide();
    const { context, emitted, done } = contextWith([sig("evaluation", { verdict: "pass", iteration: 1 })]);
    await loop.execute(context);
    expect(provider.calls).toHaveLength(0);
    expect(decisionOf(emitted).action).toBe("converge");
    expect(done).toHaveLength(1);
  });

  it("warns of recurrence when the same criterion fails two rounds running", async () => {
    const { provider, loop } = decide(() => JSON.stringify({ decision: "refine", reason: "r", corrections: [] }));
    await loop.execute(contextWith([sig("evaluation", { verdict: "fail", iteration: 1 })], 1).context);
    await loop.execute(contextWith([sig("evaluation", { verdict: "fail", iteration: 2 })], 2).context);
    expect(provider.calls[1].prompt).toMatch(/Same criteria failing across rounds/);
  });
});

async function deepReasoning(script: (c: ScriptedCall) => ScriptedReply | string | undefined, maxRounds = 3) {
  const provider = scriptedProvider(script);
  const pipeline = instantiateRecipe(
    "deep-reasoning",
    { provider, tools: createDefaultToolkit([]), workingDir: "/tmp", seedShared: { task: "t" }, maxRounds },
    { delayMs: 0 },
  );
  const result = await pipeline.run();
  return { provider, result };
}

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["no"], corrections: ["fix"], confidence: 0.8 });

describe("Decide in a run", () => {
  it("'done' stops the run: a passing first round ends it", async () => {
    const { provider, result } = await deepReasoning(() => undefined);
    expect(provider.promptsOf("do")).toHaveLength(1);
    expect(result.totalCycles).toBe(1);
    expect(result.outcome).toBe("passed");
    expect(result.success).toBe(true);
  });

  it("a converge on a failing round still stops the run, and is not a success", async () => {
    const { provider, result } = await deepReasoning((c) => {
      if (c.role === "check") return FAIL;
      if (c.role === "decide") return JSON.stringify({ decision: "converge", reason: "good enough", corrections: [] });
      return undefined;
    });
    expect(provider.promptsOf("do")).toHaveLength(1);
    expect(result.outcome).toBe("failed");
    expect(result.success).toBe(false);
  });

  it("the round limit counts the rounds taken", async () => {
    const { provider, result } = await deepReasoning((c) => {
      if (c.role === "check") return FAIL;
      if (c.role === "decide") return JSON.stringify({ decision: "refine", reason: "again", corrections: ["fix"] });
      return undefined;
    }, 2);
    expect(provider.promptsOf("do")).toHaveLength(2);
    expect(result.totalCycles).toBe(2);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/round limit \(2\) reached without a passing verdict/);
  });

  it("a Check whose answer no parser can read gives no passing verdict", async () => {
    const { result } = await deepReasoning((c) => {
      if (c.role === "check") return "Looks fine to me.";
      if (c.role === "decide") return JSON.stringify({ decision: "converge", reason: "fine", corrections: [] });
      return undefined;
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.outcome).toBe("inconclusive");
    expect(result.success).toBe(false);
  });
});
