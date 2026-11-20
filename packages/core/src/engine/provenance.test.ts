// Every field of every signal is declared as given, measured or written.
// Each built-in topology runs with a scripted model through a scenario that
// reaches each loop's emission paths (failing and passing checks, refine and
// backtrack, Critique's model and its rules, memory with milestones, tool
// calls), and the test fails on any field the registry does not declare.

import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instantiateRecipe, listRecipes } from "../roles/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";
import {
  describeFields,
  provenanceOf,
  registerSignalFields,
  undeclaredFields,
} from "./provenance.js";
import { PipelineOrchestrator } from "./pipeline.js";
import { BaseRoleEngine } from "../roles/base.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";

const fail = JSON.stringify({ verdict: "fail", evidence: ["seen"], corrections: ["fix"], confidence: 0.4 });
const pass = JSON.stringify({ verdict: "pass", evidence: ["seen"], corrections: [], confidence: 0.9 });

/** Fails three times, then passes; Decide refines, backtracks, then converges; Critique escalates. */
function script(c: ScriptedCall) {
  const lastIsTool = c.options.messages.at(-1)?.role === "tool";
  switch (c.role) {
    case "do":
      if (!lastIsTool && c.tools.includes("file_read")) {
        return { toolCalls: [{ name: "file_read", arguments: { path: "NOTE.txt" } }] };
      }
      return `answer ${c.turn}`;
    case "check":
      return c.turn < 4 ? fail : pass;
    case "decide":
      if (c.turn === 1) return JSON.stringify({ decision: "refine", reason: "close", corrections: ["fix"] });
      if (c.turn === 2) return JSON.stringify({ decision: "backtrack", reason: "start over", corrections: [] });
      return JSON.stringify({ decision: "converge", reason: "good", corrections: [] });
    case "critique":
      return JSON.stringify({ status: "critical", issues: ["looping"], intervention: "force_replan", reasoning: "r" });
    case "memory":
      return JSON.stringify({
        summary: "s",
        isMilestone: true,
        milestoneDescription: "m",
        memories: ["remember this"],
        noiseFiltered: "",
      });
    default:
      return undefined;
  }
}

async function signalsOf(recipeId: string): Promise<Signal[]> {
  const dir = await mkdtemp(join(tmpdir(), "provenance-"));
  try {
    await writeFile(join(dir, "NOTE.txt"), "a note");
    const pipeline = instantiateRecipe(
      recipeId,
      {
        provider: scriptedProvider(script),
        tools: createDefaultToolkit(),
        workingDir: dir,
        seedShared: { task: "the task" },
        maxRounds: 6,
      },
      { delayMs: 0, maxCycles: 6 },
    );
    const signals: Signal[] = [];
    pipeline.on("signal:sent", ({ signal }) => signals.push(signal));
    pipeline.on("signal:received", ({ signal }) => signals.push(signal));
    await pipeline.run();
    return signals;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("provenance: every signal field is declared", () => {
  for (const recipe of listRecipes()) {
    it(`${recipe.name} emits only declared fields`, async () => {
      const signals = await signalsOf(recipe.id);
      expect(signals.length).toBeGreaterThan(0);
      const undeclared = signals.flatMap((s) => undeclaredFields(s).map((f) => `${s.type}.${f}`));
      expect([...new Set(undeclared)]).toEqual([]);
    });
  }

  it("reaches the emission paths the registry declares", async () => {
    const types = new Set<string>();
    for (const recipe of listRecipes()) for (const s of await signalsOf(recipe.id)) types.add(s.type);
    for (const t of [
      "task", "plan", "strategy", "execution_result", "tool_calls", "token_usage", "evaluation",
      "eval_metrics", "corrections", "critic_feedback", "stagnation_alert", "intervention",
      "refinement_decision", "replan_signal", "convergence", "compressed_context", "milestone", "memory",
    ]) {
      expect(types, t).toContain(t);
    }
  });

  it("fails on a field nothing declares, and passes once it is declared", () => {
    const signal = { type: "custom_probe", data: { answer: "x", iteration: 1 } };
    expect(undeclaredFields(signal)).toEqual(["answer", "iteration"]);
    registerSignalFields("custom_probe", { answer: "written", iteration: "measured" });
    expect(undeclaredFields(signal)).toEqual([]);
    expect(describeFields(signal)).toEqual({
      answer: { provenance: "written", value: "x" },
      iteration: { provenance: "measured", value: 1 },
    });
  });

  it("names undeclared keys inside a shaped field", () => {
    const signal = { type: "tool_calls", data: { calls: [{ name: "shell", secret: 1 }], iteration: 1 } };
    expect(undeclaredFields(signal)).toEqual(["calls[].secret"]);
  });

  it("counts a varying field as written until it is stamped", () => {
    const signal = { type: "evaluation", data: { verdict: "pass" } };
    expect(provenanceOf(signal, "verdict")).toBe("written");
    expect(undeclaredFields(signal)).toEqual(["verdict (varying, not stamped)"]);
    expect(provenanceOf({ ...signal, provenance: { verdict: "measured" } }, "verdict")).toBe("measured");
  });

  it("keeps the declared kinds of a signal a wire re-types, and makes the fields it sets given", async () => {
    class Emit extends BaseRoleEngine {
      constructor() {
        super({
          id: "a",
          name: "A",
          category: "evaluation",
          description: "",
          outputPorts: [{ name: "out", direction: "output", signalTypes: ["corrections"] }],
        });
      }
      async execute(ctx: NodeContext): Promise<NodeResult> {
        ctx.emit("out", "corrections", { corrections: ["c"], iteration: 1 }, { corrections: "written" });
        return this.emptyResult();
      }
    }
    class Sink extends BaseRoleEngine {
      got: Signal[] = [];
      constructor() {
        super({
          id: "b",
          name: "B",
          category: "execution",
          description: "",
          inputPorts: [{ name: "in", direction: "input", signalTypes: ["task"] }],
        });
      }
      async execute(ctx: NodeContext): Promise<NodeResult> {
        this.got.push(...ctx.inputSignals);
        return this.emptyResult();
      }
    }
    const sink = new Sink();
    const p = new PipelineOrchestrator({ name: "t", workingDir: "/tmp", maxCycles: 1, delayMs: 0, schedule: "rounds" });
    p.addNode(new Emit()).addNode(sink);
    p.connectByName("a", "out", "b", "in", { feedback: { asSignal: "task", set: { hint: "from the definition" } } });
    await p.run();
    const [got] = sink.got;
    expect(got.type).toBe("task");
    expect(got.originType).toBe("corrections");
    expect(provenanceOf(got, "corrections")).toBe("written");
    expect(provenanceOf(got, "hint")).toBe("given");
    expect(undeclaredFields(got)).toEqual([]);
  });
});
