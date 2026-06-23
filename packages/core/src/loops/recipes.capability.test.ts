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

/** Mock provider that records the tool names offered to it, then stops. */
function recordingProvider(sink: { tools: string[] }): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn(async (opts) => {
      sink.tools = (opts.tools ?? []).map((t) => t.name);
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
});
