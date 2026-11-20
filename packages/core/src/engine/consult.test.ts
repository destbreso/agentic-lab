// The consult edge: Do decides when to ask, at most a number of times a turn,
// and the consulted role sees only what the edge lists. Each consultation is a
// recorded step of the consulted role.

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopologyRun, type RunEvent } from "./topology-run.js";
import { getRecipe } from "../roles/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";
import { checkTopology, type Topology } from "../formats/index.js";
import type { CheckRunner } from "../tasks/types.js";

const advisorTopology = () => structuredClone(getRecipe("advisor")!) as Topology;
const isAdvisor = (c: ScriptedCall) => c.system.startsWith("You are an advisor");

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consult-"));
  await writeFile(join(dir, "NOTES.txt"), "WORLD-MARK\n");
  return dir;
}

describe("the consult edge", () => {
  it("Do consults the Advisor when it decides to, and reads the advice", async () => {
    const ws = await workspace();
    try {
      let doTurn = 0;
      const provider = scriptedProvider((call) => {
        if (isAdvisor(call)) return "ADVICE-MARK: check the edge case first";
        if (call.role !== "do") return undefined;
        doTurn++;
        if (doTurn === 1) return { toolCalls: [{ name: "file_read", arguments: { path: "NOTES.txt" } }] };
        if (doTurn === 2) return { content: "DO-WORDS-MARK thinking aloud", toolCalls: [{ name: "consult_advisor", arguments: {} }] };
        return "done";
      });
      const events: RunEvent[] = [];
      const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "advisor", workingDir: ws, delayMs: 0 });
      session.on("event", (e) => events.push(e));
      const run = await session.run("TASK-MARK: fix the bug.");

      // The advice came back to Do as the tool's result.
      const lastDo = provider.calls.filter((c) => c.role === "do").at(-1)!;
      expect(lastDo.prompt).toContain("ADVICE-MARK");
      // The advisor saw the task and Do's whole turn, its tool results included.
      const advisor = provider.calls.find(isAdvisor)!;
      expect(advisor.prompt).toContain("TASK-MARK");
      expect(advisor.prompt).toContain("WORLD-MARK");
      expect(advisor.prompt).toContain("DO-WORDS-MARK");
      expect(advisor.tools).toEqual([]);

      // A step of its own, with what it saw and where each came from.
      const step = run.steps.find((s) => s.role === "advisor")!;
      expect(step.inputs.map((i) => [i.name, i.provenance])).toEqual([
        ["task", "given"],
        ["transcript", "written"],
      ]);
      expect(step.calls).toHaveLength(1);
      expect(step.outputs[0].type).toBe("advice");
      expect(step.outputs[0].fields.advice).toEqual({ provenance: "written", value: "ADVICE-MARK: check the edge case first" });

      const consult = events.filter((e) => e.type === "consult:start" || e.type === "consult:end");
      expect(consult.map((e) => e.type)).toEqual(["consult:start", "consult:end"]);
      expect(consult[1]).toMatchObject({ from: "exec", to: "advisor", sealed: false, real: false });
      const start = events.find((e) => e.type === "run:start");
      expect(start).toMatchObject({ consults: [{ from: "exec", to: "advisor", limit: 3, sees: ["task", "transcript"] }] });
      // The advisor's tokens count for the run.
      expect(run.result.finalState.totalTokens.totalTokens).toBe(15 * provider.calls.length);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("stops at the edge's limit for the turn", async () => {
    let doCalls = 0;
    const provider = scriptedProvider((call) => {
      if (isAdvisor(call)) return "advice";
      if (call.role !== "do") return undefined;
      doCalls++;
      return doCalls <= 4 ? { toolCalls: [{ name: "consult_advisor", arguments: {} }] } : "done";
    });
    const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "advisor", workingDir: "/tmp", delayMs: 0 });
    const run = await session.run("a task");
    expect(run.steps.filter((s) => s.role === "advisor")).toHaveLength(3);
    const doStep = run.steps.find((s) => s.role === "exec")!;
    expect(doStep.toolCalls.map((t) => String(t.result).startsWith("Error"))).toEqual([false, false, false, true]);
  });

  it("shows a consulted role only measured evidence when its sight says so", async () => {
    const topology = advisorTopology();
    topology.consults[0].sees = ["tool_results", "checks"];
    const ws = await workspace();
    try {
      let doTurn = 0;
      const provider = scriptedProvider((call) => {
        if (isAdvisor(call)) return "advice from evidence";
        if (call.role !== "do") return undefined;
        doTurn++;
        if (doTurn === 1) return { content: "DO-WORDS-MARK", toolCalls: [{ name: "file_read", arguments: { path: "NOTES.txt" } }] };
        if (doTurn === 2) return { content: "DO-WORDS-MARK again", toolCalls: [{ name: "consult_advisor", arguments: {} }] };
        return "done";
      });
      const checker: CheckRunner = {
        capture: async () => {},
        run: async ({ label }) => ({ label, passed: false, results: [{ name: "probe", kind: "command", passed: false, exitCode: 1, output: "CHECK-MARK", durationMs: 0 }], at: new Date(0).toISOString(), durationMs: 0 }),
      };
      const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology, workingDir: ws, delayMs: 0, checkRunner: () => checker });
      const run = await session.run({ task: "TASK-MARK", checks: [{ name: "probe", kind: "command", command: "false" }] });
      const advisor = provider.calls.find(isAdvisor)!;
      expect(advisor.prompt).toContain("WORLD-MARK");
      expect(advisor.prompt).toContain("CHECK-MARK");
      expect(advisor.prompt).not.toContain("DO-WORDS-MARK");
      expect(advisor.prompt).not.toContain("TASK-MARK");
      const step = run.steps.find((s) => s.role === "advisor")!;
      expect(step.inputs.map((i) => [i.name, i.provenance])).toEqual([
        ["tool_results", "measured"],
        ["checks", "measured"],
      ]);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("passes the caller's question only when the sight lists it", async () => {
    const topology = advisorTopology();
    topology.consults[0].sees = ["question"];
    const provider = scriptedProvider((call) => {
      if (isAdvisor(call)) return "advice";
      if (call.role !== "do") return undefined;
      if (!call.prompt.includes("advice")) {
        expect(call.options.tools?.find((t) => t.name === "consult_advisor")?.parameters.required).toEqual(["question"]);
        return { toolCalls: [{ name: "consult_advisor", arguments: { question: "QUESTION-MARK" } }] };
      }
      return "done";
    });
    await new TopologyRun({ provider, tools: createDefaultToolkit(), topology, workingDir: "/tmp", delayMs: 0 }).run("TASK-MARK");
    const advisor = provider.calls.find(isAdvisor)!;
    expect(advisor.prompt).toContain("QUESTION-MARK");
    expect(advisor.prompt).not.toContain("TASK-MARK");
  });

  it("is refused from a role whose engine calls no tools", () => {
    const t = structuredClone(getRecipe("deep-reasoning")!) as Topology;
    t.consults = [{ ...advisorTopology().consults[0], from: "critic" }];
    expect(checkTopology(t)).toContainEqual(expect.objectContaining({ path: "/consults/0/from", message: expect.stringContaining("only Plan, Do and Check") }));
  });
});
