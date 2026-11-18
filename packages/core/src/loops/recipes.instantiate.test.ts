// Every built-in recipe instantiates, and a wire that can deliver nothing is refused.

import { describe, it, expect } from "vitest";
import { listRecipes, instantiateRecipe, instantiateRecipeFromDefinition } from "./recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { PipelineOrchestrator } from "../engine/pipeline.js";
import { BaseLoopNode } from "./base.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import type { NodeContext, NodeResult, Recipe, Signal } from "../types/pipeline.js";

const BUILT_IN = [
  "ralph-loop",
  "full-agent-pipeline",
  "exec-eval",
  "deep-reasoning",
  "supervised-coder",
  "adversarial-duel",
];

describe("built-in recipes", () => {
  it("registers the six built-in recipes", () => {
    const ids = listRecipes().map((r) => r.id);
    for (const id of BUILT_IN) expect(ids).toContain(id);
  });

  it.each(listRecipes().map((r) => [r.id, r] as const))(
    "%s instantiates with every wire it declares",
    (id, recipe) => {
      const pipeline = instantiateRecipe(id, {
        provider: scriptedProvider(),
        tools: createDefaultToolkit(),
        workingDir: "/tmp",
      });
      const graph = pipeline.getGraph();
      expect(graph.nodes.map((n) => n.id)).toEqual(recipe.nodes.map((n) => n.id));
      expect(graph.wires.map((w) => w.id).sort()).toEqual(recipe.wires.map((w) => w.id).sort());
    },
  );

  it("gives each node the ports its recipe declares", () => {
    const pipeline = instantiateRecipe("deep-reasoning", {
      provider: scriptedProvider(),
      tools: createDefaultToolkit(),
      workingDir: "/tmp",
    });
    const plan = pipeline.getGraph().nodes.find((n) => n.id === "plan")!;
    expect(plan.inputPorts.map((p) => p.name)).toEqual(["prompt", "replan", "eval_feedback"]);
  });
});

class Emitter extends BaseLoopNode {
  constructor(id: string, types: string[], private emitType: string) {
    super({
      id,
      name: id,
      category: "execution",
      description: "emits one signal",
      outputPorts: [{ name: "out", direction: "output", signalTypes: types, description: "out" }],
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    context.emit("out", this.emitType, { from: this.id });
    return this.emptyResult();
  }
}

class Sink extends BaseLoopNode {
  received: Signal[] = [];
  constructor(id: string, types: string[]) {
    super({
      id,
      name: id,
      category: "evaluation",
      description: "records inputs",
      inputPorts: [{ name: "in", direction: "input", signalTypes: types, description: "in" }],
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    this.received.push(...context.inputSignals);
    return this.emptyResult();
  }
}

function pipelineOf(...nodes: BaseLoopNode[]): PipelineOrchestrator {
  const p = new PipelineOrchestrator({ name: "t", workingDir: "/tmp", maxCycles: 2, delayMs: 0, schedule: "rounds" });
  for (const n of nodes) p.addNode(n);
  return p;
}

describe("typed delivery", () => {
  it("refuses a mistyped wire", () => {
    const p = pipelineOf(new Emitter("a", ["execution_result"], "execution_result"), new Sink("b", ["evaluation"]));
    expect(() => p.connectByName("a", "out", "b", "in")).toThrow(/Wire refused/);
  });

  it("refuses a recipe whose wire cannot deliver what its target accepts", () => {
    const recipe: Recipe = {
      id: "mistyped",
      name: "Mistyped",
      description: "an executor wired into a ground-truth port",
      version: "1.0.0",
      tags: [],
      nodes: [
        { id: "exec", type: "execution", name: "Do", category: "execution", description: "", version: "1", config: { maxIterations: 1, delayMs: 0 }, ports: { inputs: [], outputs: [] } },
        { id: "eval", type: "evaluation", name: "Check", category: "evaluation", description: "", version: "1", config: { maxIterations: 1, delayMs: 0 }, ports: { inputs: [], outputs: [] } },
      ],
      wires: [{ id: "w", sourcePortId: "exec:out:result", targetPortId: "eval:in:ground_truth", enabled: true }],
      defaults: {},
      createdAt: "",
      updatedAt: "",
    };
    expect(() =>
      instantiateRecipeFromDefinition(recipe, { provider: scriptedProvider(), tools: createDefaultToolkit(), workingDir: "/tmp" }),
    ).toThrow(/Wire refused: exec:out:result emits \[execution_result\]/);
  });

  it("refuses a feedback rule that re-types to something the target does not accept", () => {
    const p = pipelineOf(new Emitter("a", ["evaluation"], "evaluation"), new Sink("b", ["evaluation"]));
    expect(() => p.connectByName("a", "out", "b", "in", { feedback: { asSignal: "corrections" } })).toThrow(/Wire refused/);
  });

  it("drops at delivery what a custom transform re-types to an unaccepted type", async () => {
    const sink = new Sink("b", ["evaluation"]);
    const p = pipelineOf(new Emitter("a", ["evaluation"], "evaluation"), sink);
    p.connectByName("a", "out", "b", "in", { transform: (s) => ({ ...s, type: "corrections" }) });
    const dropped: string[] = [];
    p.on("signal:dropped", (d) => dropped.push(d.reason));
    await p.run();
    expect(sink.received).toHaveLength(0);
    expect(dropped[0]).toMatch(/accepts \[evaluation\], not "corrections"/);
  });

  it("delivers a signal to a port that accepts its type", async () => {
    const sink = new Sink("b", ["evaluation", "corrections"]);
    const p = pipelineOf(new Emitter("a", ["evaluation"], "evaluation"), sink);
    p.connectByName("a", "out", "b", "in");
    await p.run();
    expect(sink.received.map((s) => s.type)).toEqual(["evaluation"]);
  });
});
