// ============================================
// Recipe Capability Wiring — Integration Tests
// ============================================
// Proves per-node capabilities flow end-to-end through recipe instantiation:
// a node's declared tool availability scopes the toolkit it actually sees.

import { describe, it, expect, vi } from "vitest";
import { instantiateRecipeFromDefinition } from "./recipes.js";
import type { Recipe } from "../types/pipeline.js";
import type { LLMProvider, ChatCompletionResult } from "../types/llm.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";
import type { Skill } from "../skills/types.js";

function makeRegistry(names: string[]): ToolRegistry {
  const tools = new Map<string, AgentTool>();
  for (const n of names) {
    tools.set(n, {
      definition: { name: n, description: n, parameters: { type: "object", properties: {} } },
      execute: async () => n,
    });
  }
  return {
    register: (t) => tools.set(t.definition.name, t),
    get: (n) => tools.get(n),
    getAll: () => [...tools.values()],
    getDefinitions: () => [...tools.values()].map((t) => t.definition),
    has: (n) => tools.has(n),
    remove: (n) => tools.delete(n),
  };
}

/** Mock provider that records the tools + system prompt offered to it, then stops. */
function recordingProvider(sink: { tools: string[]; system?: string }): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn(async (opts) => {
      sink.tools = (opts.tools ?? []).map((t) => t.name);
      sink.system = opts.messages.find((m) => m.role === "system")?.content;
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

/** A one-node recipe whose single execution node optionally scopes its tools. */
function execRecipe(enabledTools?: string[]): Recipe {
  const now = new Date().toISOString();
  return {
    id: "test-exec",
    name: "Test Exec",
    description: "single execution node",
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
        config: { maxIterations: 1, delayMs: 0, ...(enabledTools ? { enabledTools } : {}) },
        ports: { inputs: [], outputs: [] },
      },
    ],
    wires: [],
    defaults: { maxCycles: 1, delayMs: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

describe("recipe capability wiring", () => {
  it("scopes a node's toolkit to its enabledTools", async () => {
    const sink = { tools: [] as string[] };
    const pipeline = instantiateRecipeFromDefinition(execRecipe(["file_read"]), {
      provider: recordingProvider(sink),
      tools: makeRegistry(["file_read", "shell", "git"]),
      workingDir: "/tmp",
    });

    await pipeline.run();

    expect(sink.tools).toEqual(["file_read"]);
  });

  it("leaves the full toolkit available when no policy is declared", async () => {
    const sink = { tools: [] as string[] };
    const pipeline = instantiateRecipeFromDefinition(execRecipe(), {
      provider: recordingProvider(sink),
      tools: makeRegistry(["file_read", "shell", "git"]),
      workingDir: "/tmp",
    });

    await pipeline.run();

    expect(sink.tools.sort()).toEqual(["file_read", "git", "shell"]);
  });

  it("an attached skill grants its tools on top of the node's allow-list", async () => {
    const now = new Date().toISOString();
    const recipe: Recipe = {
      id: "skilled",
      name: "Skilled",
      description: "node with a tool-granting skill",
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
          config: {
            maxIterations: 1,
            delayMs: 0,
            toolPolicy: { allow: ["file_read"] },
            skills: ["git-helper"],
          },
          ports: { inputs: [], outputs: [] },
        },
      ],
      wires: [],
      defaults: { maxCycles: 1, delayMs: 0 },
      createdAt: now,
      updatedAt: now,
    };

    const gitHelper: Skill = {
      name: "git-helper",
      description: "git operations",
      version: "1.0.0",
      instructions: "Use git for version control.",
      activation: "manual",
      allowedTools: ["git"],
    };

    const sink: { tools: string[]; system?: string } = { tools: [] };
    const pipeline = instantiateRecipeFromDefinition(recipe, {
      provider: recordingProvider(sink),
      tools: makeRegistry(["file_read", "shell", "git"]),
      skills: [gitHelper],
      workingDir: "/tmp",
    });

    await pipeline.run();

    // Base allow-list (file_read) plus the skill-granted tool (git); not shell.
    expect(sink.tools.sort()).toEqual(["file_read", "git"]);
    // And the skill's instructions are injected into the node's system prompt.
    expect(sink.system).toContain("# Active Skills");
    expect(sink.system).toContain("Use git for version control.");
    // Without clobbering the loop's own default role description.
    expect(sink.system).toContain("execution loop");
  });
});
