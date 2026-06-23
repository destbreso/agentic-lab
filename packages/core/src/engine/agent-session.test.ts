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
