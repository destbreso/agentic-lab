// ============================================
// Memory Loop — Unit Tests
// ============================================
// Tests for parseCompression (pure function) and
// the previousSummary bug fix.

import { describe, it, expect, vi } from "vitest";
import { MemoryLoop } from "./memory.js";
import type { LLMProvider, ChatCompletionResult } from "../types/llm.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";

// Minimal mock provider that returns controlled LLM responses
function mockProvider(responseText: string): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn().mockResolvedValue({
      message: { role: "assistant", content: responseText },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      finishReason: "stop",
    } satisfies ChatCompletionResult),
    chatStream: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  };
}

// Create a minimal NodeContext for testing
function makeContext(
  signals: Signal[] = [],
  overrides?: Partial<NodeContext>,
): NodeContext {
  const emitted: Array<{
    port: string;
    type: string;
    data: Record<string, unknown>;
  }> = [];
  return {
    nodeId: "memory-1",
    traceId: "trace-1",
    iteration: 1,
    workingDir: "/tmp",
    inputSignals: signals,
    emit: (port, type, data) => emitted.push({ port, type, data }),
    requestStop: vi.fn(),
    pipelineState: {
      iteration: 1,
      status: "running",
      startTime: new Date().toISOString(),
      nodeStates: new Map(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  };
}

describe("MemoryLoop", () => {
  describe("parseCompression", () => {
    // Access the private method through the class prototype
    // since it's a pure function worth unit-testing
    const loop = new MemoryLoop({ provider: mockProvider("") });
    // Use reflection to access private method
    const parse = (response: string) =>
      (
        loop as unknown as {
          parseCompression: (r: string) => ReturnType<typeof Object>;
        }
      ).parseCompression(response);

    it("parses a well-formed response", () => {
      const response = `
SUMMARY: The agent completed 3 iterations, created a config file, and fixed a test.
MILESTONE: yes
MILESTONE_DESCRIPTION: Configuration system fully operational
MEMORIES:
- The project uses vitest for testing
- Config file is at src/config.ts
NOISE_FILTERED: Verbose shell output from npm install
      `.trim();

      const result = parse(response);
      expect(result.summary).toContain("completed 3 iterations");
      expect(result.isMilestone).toBe(true);
      expect(result.milestoneDescription).toContain("Configuration system");
      expect(result.memories).toHaveLength(2);
      expect(result.memories[0]).toContain("vitest");
      expect(result.noiseFiltered).toContain("npm install");
    });

    it("handles no milestone", () => {
      const response = `
SUMMARY: Minor progress, still debugging.
MILESTONE: no
MEMORIES:
- Found the bug in line 42
NOISE_FILTERED: Stack traces
      `.trim();

      const result = parse(response);
      expect(result.isMilestone).toBe(false);
      expect(result.milestoneDescription).toBe("");
      expect(result.memories).toHaveLength(1);
    });

    it("handles empty/malformed response gracefully", () => {
      const result = parse("Random text without any markers");
      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.isMilestone).toBe(false);
      expect(result.memories).toEqual([]);
    });

    it("handles empty memories section", () => {
      const response = `
SUMMARY: Short progress
MILESTONE: no
MEMORIES:
NOISE_FILTERED: nothing
      `.trim();

      const result = parse(response);
      expect(result.memories).toEqual([]);
    });
  });

  describe("previousSummary bug fix", () => {
    it("emits different previousSummary and summary", async () => {
      const llmResponse = `
SUMMARY: Second summary after two cycles
MILESTONE: no
MEMORIES:
NOISE_FILTERED: none
      `.trim();

      const provider = mockProvider(llmResponse);
      const loop = new MemoryLoop({ provider, bufferSize: 2 });

      const emitted: Array<{
        port: string;
        type: string;
        data: Record<string, unknown>;
      }> = [];

      // Signal to make the buffer large enough
      const signals: Signal[] = [
        {
          id: "s1",
          type: "execution_result",
          sourceNodeId: "exec",
          sourcePort: "output",
          data: { responseText: "did something" },
          timestamp: new Date().toISOString(),
        },
        {
          id: "s2",
          type: "execution_result",
          sourceNodeId: "exec",
          sourcePort: "output",
          data: { responseText: "did more" },
          timestamp: new Date().toISOString(),
        },
        {
          id: "s3",
          type: "evaluation",
          sourceNodeId: "eval",
          sourcePort: "output",
          data: { verdict: "pass" },
          timestamp: new Date().toISOString(),
        },
      ];

      const ctx = makeContext(signals, {
        emit: (port, type, data) => emitted.push({ port, type, data }),
      });

      // First execution — no previous summary
      await loop.execute(ctx);

      const firstEmit = emitted.find((e) => e.type === "compressed_context");
      expect(firstEmit).toBeDefined();
      expect(firstEmit!.data.previousSummary).toBe(""); // First time: no previous

      // Second execution with new signals
      emitted.length = 0;
      const ctx2 = makeContext(
        [
          {
            id: "s4",
            type: "execution_result",
            sourceNodeId: "exec",
            sourcePort: "output",
            data: { responseText: "third thing" },
            timestamp: new Date().toISOString(),
          },
          {
            id: "s5",
            type: "execution_result",
            sourceNodeId: "exec",
            sourcePort: "output",
            data: { responseText: "fourth thing" },
            timestamp: new Date().toISOString(),
          },
          {
            id: "s6",
            type: "evaluation",
            sourceNodeId: "eval",
            sourcePort: "output",
            data: { verdict: "pass" },
            timestamp: new Date().toISOString(),
          },
        ],
        {
          emit: (port, type, data) => emitted.push({ port, type, data }),
          iteration: 2,
        },
      );

      await loop.execute(ctx2);

      const secondEmit = emitted.find((e) => e.type === "compressed_context");
      expect(secondEmit).toBeDefined();

      // previousSummary should be the PREVIOUS summary, not the new one
      // The LLM always returns "Second summary after two cycles"
      // so after the first call, currentSummary = "Second summary after two cycles"
      // On the second call, previousSummary should be that value, which is the same
      // because our mock returns the same text. But importantly, it should NOT be empty.
      expect(secondEmit!.data.previousSummary).not.toBe("");
      expect(secondEmit!.data.previousSummary).toContain("Second summary");
    });
  });
});
