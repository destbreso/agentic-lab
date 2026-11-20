// What each role sees is given by its wires and its definition, nothing else:
// no global recent signals, the blackboard only for a role that asks for it,
// the run's inputs only as its definition lists them, and a wire delivers only
// the fields it names. (Audit gap 5.)

import { describe, it, expect } from "vitest";
import { instantiateRecipe, getRecipe, instantiateRecipeFromDefinition } from "../roles/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";
import { PipelineOrchestrator, runViewFor } from "./pipeline.js";
import { BaseRoleEngine } from "../roles/base.js";
import type { NodeContext, NodeResult, Recipe, RunInput, Signal } from "../types/pipeline.js";

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["MARK-EVIDENCE"], corrections: ["fix"], confidence: 0.4 });

const INPUTS: RunInput[] = [
  { name: "conversation", content: "## Earlier\n\nMARK-CONVERSATION", provenance: "written" },
  { name: "memories", content: "## Recalled\n\nMARK-MEMORY", provenance: "written" },
];

/** Deep Reasoning, Check failing once, with every role's consumed signals kept. */
async function deepReasoning(recipe?: Recipe) {
  const provider = scriptedProvider((c: ScriptedCall) => {
    if (c.role === "do") return "MARK-DO-ANSWER";
    if (c.role === "check") return c.turn === 1 ? FAIL : undefined;
    if (c.role === "decide") return JSON.stringify({ decision: "refine", reason: "again", corrections: ["fix"] });
    return undefined;
  });
  const params = {
    provider,
    tools: createDefaultToolkit([]),
    workingDir: "/tmp",
    task: "MARK-TASK",
    inputs: INPUTS,
    maxRounds: 4,
  };
  const pipeline = recipe
    ? instantiateRecipeFromDefinition(recipe, params, { delayMs: 0 })
    : instantiateRecipe("deep-reasoning", params, { delayMs: 0 });
  const consumed: Record<string, Signal[]> = {};
  pipeline.on("node:inputs", ({ nodeId, signals }) => {
    (consumed[nodeId] ??= []).push(...signals);
  });
  const result = await pipeline.run();
  return { provider, result, consumed };
}

class Probe extends BaseRoleEngine {
  seen: NodeContext[] = [];
  constructor(id: string, config: Record<string, unknown> = {}) {
    super({ id, name: id, category: "custom", description: "", config: { maxIterations: 1, delayMs: 0, ...config } });
  }
  async execute(ctx: NodeContext): Promise<NodeResult> {
    this.seen.push(ctx);
    return this.emptyResult();
  }
}

describe("sight by structure", () => {
  it("gives no role the run's recent signals or the blackboard unless its definition asks", async () => {
    const plain = new Probe("plain");
    const reader = new Probe("reader", { blackboard: true });
    const p = new PipelineOrchestrator(
      { name: "t", workingDir: "/tmp", maxCycles: 1, delayMs: 0, schedule: "rounds" },
      { seedShared: { secret: "MARK-BLACKBOARD" } },
    );
    p.addNode(plain).addNode(reader);
    await p.run();
    const [a] = plain.seen;
    const [b] = reader.seen;
    expect(a.shared).toBeUndefined();
    expect(a.runtime?.shared).toBeUndefined();
    expect(a.pipelineState.recentSignals).toEqual([]);
    expect(a.pipelineState.shared).toEqual({});
    expect(b.shared?.get("secret")).toBe("MARK-BLACKBOARD");
  });

  it("hands each role the run inputs its definition lists", () => {
    const run = { task: "T", inputs: INPUTS };
    expect(runViewFor("execution", undefined, run)).toEqual({ task: "T", inputs: INPUTS });
    expect(runViewFor("critic", undefined, run)).toEqual({ inputs: [] });
    expect(runViewFor("refinement", undefined, run)).toEqual({ inputs: [] });
    expect(runViewFor("evaluation", ["task"], run)).toEqual({ task: "T", inputs: [] });
    expect(runViewFor("planning", ["memories"], run)).toEqual({ inputs: [INPUTS[1]] });
  });

  it("in Deep Reasoning, Critique and Decide never receive the task, the conversation, memories or Do's text", async () => {
    const { provider, result, consumed } = await deepReasoning();
    expect(result.outcome).toBe("passed");

    // Plan, Do and Check read the request with its other inputs.
    for (const role of ["plan", "do", "check"] as const) {
      const first = provider.promptsOf(role)[0];
      expect(first, role).toContain("MARK-TASK");
      expect(first, role).toContain("MARK-CONVERSATION");
      expect(first, role).toContain("MARK-MEMORY");
    }

    // What reaches Critique and Decide, read off the signals they consumed: no content, by structure.
    for (const role of ["critic", "refine"]) {
      const delivered = JSON.stringify(consumed[role] ?? []);
      expect(delivered, role).not.toMatch(/MARK-(TASK|CONVERSATION|MEMORY|DO-ANSWER|EVIDENCE)/);
      for (const s of consumed[role] ?? []) {
        if (s.type === "execution_result") expect(Object.keys(s.data).sort()).toEqual(["iteration", "toolCallCount", "truncated"]);
        if (s.type === "evaluation") expect(s.data).not.toHaveProperty("evidence");
      }
    }
    expect(consumed.critic?.some((s) => s.type === "execution_result")).toBe(true);
  });

  it("a wire drops the fields it does not list, and a definition can widen or narrow it", async () => {
    // Widen the wire to Critique to everything, and narrow Check to the task alone.
    const base = getRecipe("deep-reasoning")!;
    const recipe: Recipe = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "eval" ? { ...n, config: { ...n.config, runInputs: ["task"] } } : n)),
      wires: base.wires.map((w) => (w.id === "w-exec-critic" ? { ...w, fields: undefined } : w)),
    };
    const { provider, consumed } = await deepReasoning(recipe);
    const critic = (consumed.critic ?? []).find((s) => s.type === "execution_result");
    expect(critic?.data.responseText).toBe("MARK-DO-ANSWER");
    const check = provider.promptsOf("check")[0];
    expect(check).toContain("MARK-TASK");
    expect(check).not.toContain("MARK-MEMORY");
    expect(check).not.toContain("MARK-CONVERSATION");
  });
});
