// ============================================
// Execution Loop — Contextual Memory Recall
// ============================================
// Proves the execution loop auto-injects recalled memory into its prompt when
// the node's memory policy is contextual, and does not otherwise.

import { describe, it, expect, vi } from "vitest";
import { ExecutionLoop } from "./execution.js";
import { createMemoryGateway } from "../engine/memory-gateway.js";
import { InMemorySharedStore } from "../engine/capability-resolver.js";
import type { LLMProvider, ChatCompletionResult, ChatMessage } from "../types/llm.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";
import type { MemoryStore, MemoryItem } from "../types/storage.js";
import type { NodeContext, PipelineState, Signal } from "../types/pipeline.js";

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

function recordingProvider(sink: { user?: string }): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn(async (opts) => {
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

function memItem(content: string): MemoryItem {
  return { id: "1", namespace: ["shared"], key: "1", value: { content }, createdAt: "", updatedAt: "" };
}

function storeWith(content: string): MemoryStore {
  return {
    async put(ns, key, value) {
      return { id: key, namespace: ns, key, value, createdAt: "", updatedAt: "" };
    },
    async get() {
      return null;
    },
    async search() {
      return [memItem(content)];
    },
    async semanticSearch() {
      return [memItem(content)];
    },
    async delete() {
      return true;
    },
    async deleteNamespace() {},
  };
}

const taskSignal: Signal = {
  sourceNodeId: "planner",
  type: "task",
  data: { task: "fix the auth bug" },
  timestamp: new Date().toISOString(),
};

function makeContext(overrides: Partial<NodeContext>): NodeContext {
  const shared = new InMemorySharedStore();
  return {
    nodeId: "exec",
    traceId: "t",
    iteration: 1,
    workingDir: "/tmp",
    inputSignals: [taskSignal],
    emit: () => {},
    requestStop: () => {},
    pipelineState: {} as unknown as PipelineState,
    shared,
    runtime: { shared },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    ...overrides,
  };
}

describe("ExecutionLoop contextual memory", () => {
  it("injects recalled memory when the policy is contextual", async () => {
    const sink: { user?: string } = {};
    const loop = new ExecutionLoop({ provider: recordingProvider(sink), tools: emptyRegistry() });
    const memory = createMemoryGateway(storeWith("the auth token lives in .env"), { contextual: true });
    const shared = new InMemorySharedStore();

    await loop.execute(makeContext({ runtime: { shared, memory } }));

    expect(sink.user).toContain("Recalled Memory");
    expect(sink.user).toContain("the auth token lives in .env");
  });

  it("does not inject memory when the policy is not contextual", async () => {
    const sink: { user?: string } = {};
    const loop = new ExecutionLoop({ provider: recordingProvider(sink), tools: emptyRegistry() });
    const memory = createMemoryGateway(storeWith("secret"), { contextual: false });
    const shared = new InMemorySharedStore();

    await loop.execute(makeContext({ runtime: { shared, memory } }));

    expect(sink.user).not.toContain("Recalled Memory");
  });
});
