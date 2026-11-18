// Memory recall can be scoped to a run or a task: a role recalls only what
// its scope allows, so an earlier, unrelated task cannot reach it.

import { describe, it, expect } from "vitest";
import { AgentSession } from "./agent-session.js";
import { scopePrefix, taskKey, type MemoryScope } from "./memory-scope.js";
import { InMemoryStorage } from "../storage/memory.js";
import { getRecipe } from "../loops/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import type { Recipe } from "../types/pipeline.js";

/** The Ralph Loop with a Do that recalls before it works. */
function recalling(): Recipe {
  const base = getRecipe("ralph-loop")!;
  return {
    ...base,
    id: "ralph-recalling",
    nodes: base.nodes.map((n) => ({ ...n, config: { ...n.config, memory: { contextual: true } } })),
  };
}

async function seeded() {
  const storage = new InMemoryStorage();
  await storage.memory.put(["task", taskKey("Task A"), "shared"], "a", { content: "MARK-TASK-A" });
  await storage.memory.put(["run", "run-1", "shared"], "r", { content: "MARK-RUN-1" });
  await storage.memory.put(["shared"], "s", { content: "MARK-SHARED" });
  return storage;
}

async function recalled(scope: MemoryScope, task: string, runId = "run-2") {
  const storage = await seeded();
  const provider = scriptedProvider();
  const run = await new AgentSession({
    provider,
    tools: createDefaultToolkit([]),
    topology: recalling(),
    workingDir: "/tmp",
    delayMs: 0,
    memory: storage.memory,
    memoryScope: scope,
    runId,
  }).run(task);
  const prompt = provider.promptsOf("do").join("\n");
  const marks = ["MARK-TASK-A", "MARK-RUN-1", "MARK-SHARED"].filter((m) => prompt.includes(m));
  const recalls = run.steps.flatMap((s) => s.inputs.filter((i) => i.source === "memory"));
  return { marks, recalls };
}

describe("memory scope", () => {
  it("task: recalls what runs of the same task kept, and nothing from another task", async () => {
    expect((await recalled("task", "Task A")).marks).toEqual(["MARK-TASK-A"]);
    expect((await recalled("task", "  task a ")).marks).toEqual(["MARK-TASK-A"]);
    expect((await recalled("task", "Task B")).marks).toEqual([]);
  });

  it("run: recalls only what this run kept", async () => {
    expect((await recalled("run", "Task A", "run-1")).marks).toEqual(["MARK-RUN-1"]);
    expect((await recalled("run", "Task A", "run-9")).marks).toEqual([]);
  });

  it("shared: reaches across tasks, as before", async () => {
    expect((await recalled("shared", "Task B")).marks).toEqual(["MARK-SHARED"]);
  });

  it("off: recalls nothing and records no recall", async () => {
    const { marks, recalls } = await recalled("off", "Task A");
    expect(marks).toEqual([]);
    expect(recalls).toEqual([]);
  });

  it("records every recall as a written input of the role's step", async () => {
    const { recalls } = await recalled("task", "Task A");
    expect(recalls).toHaveLength(1);
    expect(recalls[0]).toMatchObject({ name: "recall", provenance: "written" });
  });

  it("puts the scope in front of the namespace", () => {
    expect(scopePrefix("off", { runId: "r", task: "t" })).toBeNull();
    expect(scopePrefix("shared", { runId: "r", task: "t" })).toEqual([]);
    expect(scopePrefix("run", { runId: "r", task: "t" })).toEqual(["run", "r"]);
    expect(scopePrefix("task", { runId: "r", task: "t" })).toEqual(["task", taskKey("t")]);
  });
});
