// ============================================
// Agent Session — Integration Tests
// ============================================
// Proves the headline of Phase 5: given a task, the session activates the
// relevant skills (by relevance) and applies them to the running pipeline,
// and seeds the task onto the blackboard so the entry node sees it.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { AgentSession } from "./agent-session.js";
import { registerRecipe } from "../loops/recipes.js";
import type { Skill } from "../skills/types.js";
import type { LLMProvider, ChatCompletionResult, ChatMessage } from "../types/llm.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";
import type { Recipe } from "../types/pipeline.js";

function emptyRegistry(): ToolRegistry {
  const tools = new Map<string, AgentTool>();
  return {
    register: (t) => tools.set(t.definition.name, t),
    get: (n) => tools.get(n),
    getAll: () => [...tools.values()],
    getDefinitions: () => [...tools.values()].map((t) => t.definition),
    has: (n) => tools.has(n),
    remove: (n) => tools.delete(n),
  };
}

/** Records the system + user prompt seen, then stops. */
function recordingProvider(sink: { system?: string; user?: string }): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn(async (opts) => {
      sink.system = opts.messages.find((m: ChatMessage) => m.role === "system")?.content;
      sink.user = opts.messages.find((m: ChatMessage) => m.role === "user")?.content;
      return {
        message: { role: "assistant", content: "done" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
      } satisfies ChatCompletionResult;
    }),
    listModels: async () => [],
    healthCheck: async () => true,
  };
}

const sorter: Skill = {
  name: "sorter",
  description: "sort arrays and lists efficiently",
  version: "1.0.0",
  instructions: "When sorting, prefer a stable algorithm.",
  activation: "auto",
  keywords: ["sort", "ordering"],
};
const reviewer: Skill = {
  name: "reviewer",
  description: "review code for bugs",
  version: "1.0.0",
  instructions: "Look for null derefs.",
  activation: "auto",
  keywords: ["review", "bugs"],
};

// A minimal single-execution-node recipe.
const SINGLE_EXEC: Recipe = {
  id: "single-exec",
  name: "Single Exec",
  description: "one execution node",
  version: "1.0.0",
  tags: [],
  nodes: [
    {
      id: "exec",
      type: "execution",
      name: "Exec",
      category: "execution",
      description: "executor",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0 },
      ports: { inputs: [], outputs: [] },
    },
  ],
  wires: [],
  defaults: { maxCycles: 1, delayMs: 0 },
  createdAt: "",
  updatedAt: "",
};

beforeAll(() => {
  registerRecipe(SINGLE_EXEC);
});

describe("AgentSession", () => {
  it("auto-activates a relevant skill and injects it into the entry node", async () => {
    const sink: { system?: string; user?: string } = {};
    const session = new AgentSession({
      provider: recordingProvider(sink),
      tools: emptyRegistry(),
      recipe: "single-exec",
      skills: [sorter, reviewer],
      workingDir: "/tmp",
    });

    const { activatedSkills } = await session.run("please sort this list of names");

    expect(activatedSkills).toContain("sorter");
    expect(activatedSkills).not.toContain("reviewer");
    // The activated skill's instructions reach the node's system prompt.
    expect(sink.system).toContain("prefer a stable algorithm");
  });

  it("seeds the task onto the blackboard so the entry node sees it", async () => {
    const sink: { system?: string; user?: string } = {};
    const session = new AgentSession({
      provider: recordingProvider(sink),
      tools: emptyRegistry(),
      recipe: "single-exec",
      workingDir: "/tmp",
    });

    await session.run("build the login form");

    expect(sink.user).toContain("build the login form");
  });

  it("activates relevant skills semantically when an embed fn is given", async () => {
    const sink: { system?: string; user?: string } = {};
    const embed = async (text: string) => {
      const t = text.toLowerCase();
      return [t.includes("sort") ? 1 : 0, t.includes("review") ? 1 : 0];
    };
    const session = new AgentSession({
      provider: recordingProvider(sink),
      tools: emptyRegistry(),
      recipe: "single-exec",
      skills: [sorter, reviewer],
      embed,
      workingDir: "/tmp",
    });

    const { activatedSkills } = await session.run("sort these items");
    expect(activatedSkills).toContain("sorter");
    expect(activatedSkills).not.toContain("reviewer");
  });
});

// ── One engine for every surface: events, steering, stop, the run record ──────

import { getRun, steerRun, stopRun } from "./run-registry.js";
import { InMemoryStorage } from "../storage/memory.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, untilAborted, type ScriptedCall } from "../test-support/scripted-provider.js";
import type { SessionEvent } from "./agent-session.js";

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["wrong"], corrections: ["fix it"], confidence: 0.8 });

function session(script: (c: ScriptedCall) => unknown, topology = "exec-eval", extra: Record<string, unknown> = {}) {
  const provider = scriptedProvider(script as never);
  const s = new AgentSession({
    provider,
    tools: createDefaultToolkit([]),
    topology,
    workingDir: "/tmp",
    delayMs: 0,
    ...extra,
  });
  const events: SessionEvent[] = [];
  s.on("event", (e) => events.push(e));
  return { provider, s, events };
}

describe("AgentSession events", () => {
  it("emits one sequence: run, rounds, roles with their recorded steps, and an honest end", async () => {
    const { s, events } = session((c) => (c.role === "check" && c.turn === 1 ? FAIL : undefined));
    const run = await s.run("say hello");
    const shape = events
      .filter((e) => e.type !== "signal" && e.type !== "call")
      .map((e) => ("role" in e ? `${e.type}:${e.role}` : e.type));
    // Each model call is an event of its own, inside its role's turn.
    const withCalls = events.filter((e) => e.type !== "signal").map((e) => ("role" in e ? `${e.type}:${e.role}` : e.type));
    expect(withCalls.slice(2, 5)).toEqual(["role:start:exec", "call:exec", "role:end:exec"]);
    expect(shape).toEqual([
      "run:start",
      "round:start",
      "role:start:exec", "role:end:exec", "step:exec",
      "role:start:eval", "role:end:eval", "step:eval",
      "round:end",
      "round:start",
      "role:start:exec", "role:end:exec", "step:exec",
      "role:start:eval", "role:end:eval", "step:eval",
      "round:end",
      "run:end",
    ]);
    const start = events[0] as Extract<SessionEvent, { type: "run:start" }>;
    expect(start.order).toEqual(["exec", "eval"]);
    expect(start.wayBacks).toEqual([{ from: "eval", to: "exec" }]);
    const end = events.at(-1) as Extract<SessionEvent, { type: "run:end" }>;
    expect(end.outcome).toBe("passed");
    expect(end.rounds).toBe(2);
    expect(run.answer).toBe("done");
  });
});

describe("AgentSession answer", () => {
  it("is what Do wrote in its last turn, not an older answer", async () => {
    const { s } = session((c) => {
      if (c.role === "do") return c.turn === 1 ? "first answer" : "";
      if (c.role === "check" && c.turn === 1) return FAIL;
      return undefined;
    });
    const run = await s.run("t");
    expect(run.outcome).toBe("passed");
    expect(run.answer).toBe("");
  });
});

describe("AgentSession steering", () => {
  it("is a context signal Do reads on its next turn, and no other role sees it", async () => {
    const { provider, s, events } = session((c) => {
      if (c.role === "do" && c.turn === 1) steerRun(s.runId, "MARK-NOTE prefer short answers", "high");
      if (c.role === "check" && c.turn === 1) return FAIL;
      if (c.role === "decide") return JSON.stringify({ decision: "refine", reason: "again", corrections: [] });
      return undefined;
    }, "deep-reasoning");
    await s.run("t");
    const doPrompts = provider.promptsOf("do");
    expect(doPrompts[0]).not.toContain("MARK-NOTE");
    expect(doPrompts[1]).toContain("A note from the operator (high)");
    expect(doPrompts[1]).toContain("MARK-NOTE");
    for (const role of ["plan", "check", "critique", "decide"] as const) {
      for (const p of provider.promptsOf(role)) expect(p).not.toContain("MARK-NOTE");
    }
    expect(events.find((e) => e.type === "steer:delivered")).toMatchObject({ role: "exec", round: 2 });
  });

  it("reaches the Ralph Loop's Do too", async () => {
    const { provider, s } = session((c) => {
      if (c.role === "do" && c.turn === 1) s.steer("MARK-NOTE");
      return undefined;
    }, "ralph-loop", { workingDir: "/tmp" });
    s.steer("MARK-EARLY");
    await s.run("t");
    expect(provider.promptsOf("do")[0]).toContain("MARK-EARLY");
  });
});

describe("AgentSession stop and the run registry", () => {
  it("stops through the registry and aborts the call in flight", async () => {
    const { provider, s } = session((c) => {
      if (c.role === "do") {
        setTimeout(() => stopRun(s.runId, "user pressed stop"), 20);
        return untilAborted(c.signal);
      }
      return undefined;
    });
    const run = await s.run("t");
    expect(provider.calls[0].signal?.aborted).toBe(true);
    expect(run.outcome).toBe("stopped");
    expect(run.success).toBe(false);
    expect(getRun(s.runId)).toBeUndefined();
  });

  it("a stop before the run starts ends it before any role runs", async () => {
    const { provider, s } = session(() => undefined);
    s.stop("changed my mind");
    const run = await s.run("t");
    expect(run.outcome).toBe("stopped");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("AgentSession run record", () => {
  it("stores the run with its honest outcome and one iteration per role turn", async () => {
    const storage = new InMemoryStorage();
    await storage.init();
    const { s } = session((c) => (c.role === "check" ? FAIL : undefined), "exec-eval", {
      storage,
      maxRounds: 2,
      runInfo: { provider: "ollama", model: "m" },
    });
    await s.run("t");
    const run = await storage.runs.getRun(s.runId);
    expect(run?.status).toBe("failed");
    expect(run?.success).toBe(false);
    expect(run?.config).toMatchObject({ topology: "exec-eval", outcome: "failed", verdict: "fail", rounds: 2 });
    const iterations = await storage.runs.getIterations(run!.id);
    expect(iterations.map((i) => i.planItemTitle)).toEqual([
      "round 1 · Executor",
      "round 1 · Evaluator",
      "round 2 · Executor",
      "round 2 · Evaluator",
    ]);
  });
});
