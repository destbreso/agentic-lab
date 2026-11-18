// Round scheduling: the drawn order runs once per round, a way back starts the
// next round at its target, Critique runs every round, and "done" ends the run.

import { describe, it, expect } from "vitest";
import { instantiateRecipe } from "../loops/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall, type ScriptedReply } from "../test-support/scripted-provider.js";
import type { PipelineResult } from "../types/pipeline.js";

const FAIL = (corrections: string[]) =>
  JSON.stringify({ verdict: "fail", evidence: ["wrong"], corrections, confidence: 0.8 });
const PASS = JSON.stringify({ verdict: "pass", evidence: ["right"], corrections: [], confidence: 0.9 });
const DECIDE = (decision: string, reason = "because", corrections: string[] = []) =>
  JSON.stringify({ decision, reason, corrections });

async function run(
  recipe: string,
  script: (call: ScriptedCall) => ScriptedReply | string | undefined,
  params: Record<string, unknown> = {},
): Promise<{ order: string[]; result: PipelineResult; provider: ReturnType<typeof scriptedProvider> }> {
  const provider = scriptedProvider(script);
  const pipeline = instantiateRecipe(
    recipe,
    { provider, tools: createDefaultToolkit([]), workingDir: "/tmp", seedShared: { task: "add 2 and 2" }, ...params },
    { delayMs: 0 },
  );
  const order: string[] = [];
  pipeline.on("node:start", ({ nodeId }) => order.push(nodeId));
  const result = await pipeline.run();
  return { order, result, provider };
}

describe("round scheduling", () => {
  it("runs Deep Reasoning in its drawn order, and a backtrack starts the next round at Plan", async () => {
    const { order, result } = await run("deep-reasoning", (c) => {
      if (c.role === "check") return c.turn === 1 ? FAIL(["fix it"]) : PASS;
      if (c.role === "decide") return DECIDE("backtrack");
      return undefined;
    });
    expect(order).toEqual([
      "plan", "exec", "eval", "critic", "refine",
      "plan", "exec", "eval", "critic", "refine",
    ]);
    expect(result.outcome).toBe("passed");
    expect(result.totalCycles).toBe(2);
  });

  it("a refine sends the next round back to Do, not to Plan", async () => {
    const { order, result } = await run("deep-reasoning", (c) => {
      if (c.role === "check") return c.turn === 1 ? FAIL(["fix it"]) : PASS;
      if (c.role === "decide") return DECIDE("refine", "close", ["fix it"]);
      return undefined;
    });
    expect(order).toEqual([
      "plan", "exec", "eval", "critic", "refine",
      "exec", "eval", "critic", "refine",
    ]);
    expect(result.outcome).toBe("passed");
  });

  it("orders Execute & Evaluate, Supervised Coder and Adversarial Duel by their forward edges", async () => {
    const ee = await run("exec-eval", () => undefined);
    expect(ee.order).toEqual(["exec", "eval"]);
    const sc = await run("supervised-coder", () => undefined);
    expect(sc.order).toEqual(["planner", "coder", "reviewer"]);
    const duel = await run("adversarial-duel", () => undefined);
    expect(duel.order).toEqual(["arena", "alpha", "beta", "arbiter"]);
  });

  it("a failing Check with no Decide sends Execute & Evaluate back to Do until it passes", async () => {
    const { order, result } = await run("exec-eval", (c) => {
      if (c.role === "check") return c.turn < 3 ? FAIL(["again"]) : PASS;
      return undefined;
    });
    expect(order).toEqual(["exec", "eval", "exec", "eval", "exec", "eval"]);
    expect(result.outcome).toBe("passed");
    expect(result.reason).toMatch(/Check passed/);
  });
});
