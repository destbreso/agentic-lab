// ============================================
// Configurable Loop + Blueprint — Unit Tests
// ============================================

import { describe, it, expect, vi } from "vitest";
import { ConfigurableLoop, type LoopBlueprint } from "./configurable-loop.js";
import { registerBlueprint } from "./blueprint.js";
import { createNode, getNodeType } from "./registry.js";
import { InMemorySharedStore } from "../engine/capability-resolver.js";
import type { LLMProvider, ChatCompletionResult, ChatMessage } from "../types/llm.js";
import type { NodeContext, PipelineState, Signal } from "../types/pipeline.js";

function provider(text: string, sink?: { system?: string }): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn(async (opts) => {
      if (sink) sink.system = opts.messages.find((m: ChatMessage) => m.role === "system")?.content;
      return {
        message: { role: "assistant", content: text },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
      } satisfies ChatCompletionResult;
    }),
    listModels: async () => [],
    healthCheck: async () => true,
  };
}

const inputSignal: Signal = {
  sourceNodeId: "src",
  type: "text",
  data: { content: "raw text to process" },
  timestamp: new Date().toISOString(),
};

function makeContext(emitted: Array<{ port: string; type: string; data: Record<string, unknown> }>): NodeContext {
  const shared = new InMemorySharedStore();
  return {
    nodeId: "cfg",
    traceId: "t",
    iteration: 1,
    workingDir: "/tmp",
    inputSignals: [inputSignal],
    emit: (port, type, data) => emitted.push({ port, type, data }),
    requestStop: () => {},
    pipelineState: {} as unknown as PipelineState,
    shared,
    runtime: { shared },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
}

const baseBlueprint: LoopBlueprint = {
  type: "summarizer",
  name: "Summarizer",
  category: "custom",
  description: "summarizes input",
  systemPrompt: "Summarize the provided input.",
  inputPorts: [{ name: "in", direction: "input", signalTypes: ["text"], description: "text in" }],
  outputPort: "result",
  outputSignalType: "summary",
};

describe("ConfigurableLoop", () => {
  it("emits the LLM text on the configured output port/type", async () => {
    const loop = new ConfigurableLoop({ blueprint: baseBlueprint, provider: provider("THE SUMMARY") });
    const emitted: Array<{ port: string; type: string; data: Record<string, unknown> }> = [];
    await loop.execute(makeContext(emitted));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].port).toBe("result");
    expect(emitted[0].type).toBe("summary");
    expect(emitted[0].data.text).toBe("THE SUMMARY");
  });

  it("emits extracted JSON when emitJson is set", async () => {
    const bp: LoopBlueprint = { ...baseBlueprint, emitJson: true };
    const loop = new ConfigurableLoop({ blueprint: bp, provider: provider('{"label":"bug","score":3}') });
    const emitted: Array<{ port: string; type: string; data: Record<string, unknown> }> = [];
    await loop.execute(makeContext(emitted));

    expect(emitted[0].data).toMatchObject({ label: "bug", score: 3 });
  });

  it("appends attached-skill instructions to the system prompt", async () => {
    const sink: { system?: string } = {};
    const loop = new ConfigurableLoop({
      blueprint: baseBlueprint,
      provider: provider("x", sink),
      skillPrompt: "# Active Skills\nUse the house style.",
    });
    await loop.execute(makeContext([]));

    expect(sink.system).toContain("Summarize the provided input.");
    expect(sink.system).toContain("Use the house style.");
  });
});

describe("registerBlueprint", () => {
  it("registers a blueprint as a usable node type", async () => {
    registerBlueprint(baseBlueprint);
    expect(getNodeType("summarizer")?.category).toBe("custom");

    const node = createNode("summarizer", "n1", { maxIterations: 1, delayMs: 0 }, {
      provider: provider("DONE"),
    });
    const emitted: Array<{ port: string; type: string; data: Record<string, unknown> }> = [];
    await node.execute(makeContext(emitted));

    expect(emitted[0].type).toBe("summary");
    expect(emitted[0].data.text).toBe("DONE");
  });
});
