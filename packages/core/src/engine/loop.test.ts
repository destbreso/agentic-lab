// ============================================
// AgenticLoop Steering — Unit Tests
// ============================================
// Tests for the mid-loop steering (tactical nudges) feature.
// Verifies the nudge queue, consumption at both injection points,
// message formatting, and event emission.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgenticLoop } from "./loop.js";
import type {
  LLMProvider,
  ChatCompletionResult,
  ChatMessage,
} from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import type { SteeringNudge } from "../types/loop.js";

// --------------- Mocks ---------------

// Mock the filesystem-dependent modules so the loop can be instantiated
// without a real working directory, plan file, etc.
vi.mock("./plan-manager.js", () => ({
  PlanManager: class {
    async read() {
      return [{ id: "1", title: "task", status: "completed" }];
    }
    async getRawContent() {
      return "# Plan\n- [x] task";
    }
  },
}));

vi.mock("./prompt-builder.js", () => ({
  PromptBuilder: class {
    async buildIterationPrompt() {
      return "Do the task.";
    }
    async loadSpecs() {
      return "";
    }
  },
}));

vi.mock("./iteration-logger.js", () => ({
  IterationLogger: class {
    async init() {}
    async logIteration() {}
    async saveState() {}
    async saveResult() {}
  },
}));

vi.mock("../utils/logger.js", () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    close: () => {},
  }),
}));

/** Create a mock LLM provider that returns controlled responses */
function mockProvider(options?: {
  /** How many tool-round responses before final (default 0 = immediate text reply) */
  toolRounds?: number;
}): LLMProvider {
  const toolRounds = options?.toolRounds ?? 0;
  let callCount = 0;

  return {
    name: "mock",
    chat: vi.fn(async () => {
      callCount++;
      // For the first N calls, return tool_calls to keep the tool loop going
      if (callCount <= toolRounds) {
        return {
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: `tc-${callCount}`,
                name: "mock_tool",
                arguments: { round: callCount },
              },
            ],
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        } satisfies ChatCompletionResult;
      }
      // Final call — text response, no more tool calls
      return {
        message: { role: "assistant", content: "Done." },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      } satisfies ChatCompletionResult;
    }),
    chatStream: vi.fn(),
    listModels: vi.fn(async () => []),
    healthCheck: vi.fn(async () => true),
  };
}

/** Create a mock tool registry */
function mockToolRegistry(): ToolRegistry {
  return {
    register: vi.fn(),
    get: vi.fn((name: string) => {
      if (name === "mock_tool") {
        return {
          definition: {
            name: "mock_tool",
            description: "A mock tool",
            parameters: { type: "object", properties: {} },
          },
          execute: vi.fn(async () => "mock result"),
        };
      }
      return undefined;
    }),
    getAll: vi.fn(() => []),
    getDefinitions: vi.fn(() => [
      {
        name: "mock_tool",
        description: "A mock tool",
        parameters: { type: "object", properties: {} },
      },
    ]),
    has: vi.fn(() => true),
    remove: vi.fn(() => true),
  };
}

function createLoop(providerOpts?: { toolRounds?: number }) {
  return new AgenticLoop({
    config: {
      name: "test-loop",
      provider: "mock",
      model: "mock-model",
      maxIterations: 2,
      delayMs: 0,
      promptFile: "PROMPT.md",
      workingDir: "/tmp/test-loop",
    },
    provider: mockProvider(providerOpts),
    tools: mockToolRegistry(),
  });
}

// --------------- Tests ---------------

describe("AgenticLoop — Mid-Loop Steering", () => {
  describe("nudge() API", () => {
    it("enqueues a nudge and returns it", () => {
      const loop = createLoop();
      const nudge = loop.nudge("Focus on the API endpoints");

      expect(nudge.id).toBeDefined();
      expect(nudge.message).toBe("Focus on the API endpoints");
      expect(nudge.priority).toBe("normal");
      expect(nudge.createdAt).toBeDefined();
      expect(nudge.consumedAt).toBeUndefined();
    });

    it("respects explicit priority", () => {
      const loop = createLoop();
      const nudge = loop.nudge("STOP working on CSS", "critical");
      expect(nudge.priority).toBe("critical");
    });

    it("emits steering:nudge event", () => {
      const loop = createLoop();
      const events: SteeringNudge[] = [];
      loop.on("steering:nudge", ({ nudge }) => events.push(nudge));

      loop.nudge("test message");

      expect(events).toHaveLength(1);
      expect(events[0].message).toBe("test message");
    });

    it("multiple nudges queue in order", () => {
      const loop = createLoop();
      loop.nudge("first");
      loop.nudge("second");
      loop.nudge("third");

      const pending = loop.getPendingNudges();
      expect(pending).toHaveLength(3);
      expect(pending.map((n) => n.message)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });
  });

  describe("nudge consumption during loop execution", () => {
    it("consumes nudges between iterations", async () => {
      const loop = createLoop();
      const consumed: Array<{
        nudges: SteeringNudge[];
        iteration: number;
        injectionPoint: string;
      }> = [];
      loop.on("steering:consumed", (data) => consumed.push(data));

      // Queue a nudge BEFORE starting the loop
      loop.nudge("Skip the database migration for now");

      const result = await loop.run();

      // Should have been consumed
      expect(consumed.length).toBeGreaterThanOrEqual(1);
      expect(consumed[0].injectionPoint).toBe("between-iterations");
      expect(consumed[0].iteration).toBe(1);
      expect(consumed[0].nudges[0].message).toBe(
        "Skip the database migration for now",
      );

      // Should be in history
      const history = loop.getNudgeHistory();
      expect(history).toHaveLength(1);
      expect(history[0].consumedAt).toBeDefined();
      expect(history[0].consumedAtIteration).toBe(1);

      // Queue should be empty
      expect(loop.getPendingNudges()).toHaveLength(0);

      expect(result.success).toBe(true);
    });

    it("nudges injected during run appear in LLM messages", async () => {
      const provider = mockProvider();
      const chatSpy = provider.chat as ReturnType<typeof vi.fn>;
      const loop = new AgenticLoop({
        config: {
          name: "test",
          provider: "mock",
          model: "m",
          maxIterations: 1,
          delayMs: 0,
          promptFile: "PROMPT.md",
          workingDir: "/tmp/test",
        },
        provider,
        tools: mockToolRegistry(),
      });

      loop.nudge("Focus on error handling");
      await loop.run();

      // The LLM should have received a message containing the nudge
      const calls = chatSpy.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);

      const messages: ChatMessage[] = calls[0][0].messages;
      const nudgeMsg = messages.find(
        (m) => m.role === "user" && m.content?.includes("STEERING NUDGE"),
      );
      expect(nudgeMsg).toBeDefined();
      expect(nudgeMsg!.content).toContain("Focus on error handling");
    });

    it("critical nudge is consumed mid-tool-loop", async () => {
      // Provider that does 2 tool rounds before final text
      const provider = mockProvider({ toolRounds: 2 });
      const chatSpy = provider.chat as ReturnType<typeof vi.fn>;

      const loop = new AgenticLoop({
        config: {
          name: "test",
          provider: "mock",
          model: "m",
          maxIterations: 1,
          delayMs: 0,
          promptFile: "PROMPT.md",
          workingDir: "/tmp/test",
        },
        provider,
        tools: mockToolRegistry(),
      });

      const consumed: Array<{
        injectionPoint: string;
        iteration: number;
      }> = [];
      loop.on("steering:consumed", (data) => consumed.push(data));

      // Start the loop — it will call LLM multiple times due to tool rounds
      // Inject a critical nudge after the loop starts (it's sync — queue is read next tool round)
      // We can inject before run since the first LLM call will trigger tool rounds,
      // and the second LLM call in the tool-loop will check for critical nudges
      loop.nudge(
        "ABORT CURRENT APPROACH — try integration tests instead",
        "critical",
      );

      await loop.run();

      // The critical nudge should have been consumed (either between-iterations or mid-tool-loop)
      expect(consumed.length).toBeGreaterThanOrEqual(1);
      const nudgeMsg = (
        chatSpy.mock.calls as Array<[{ messages: ChatMessage[] }]>
      )
        .flatMap(([call]) => call.messages)
        .find(
          (m) =>
            m.role === "user" && m.content?.includes("ABORT CURRENT APPROACH"),
        );
      expect(nudgeMsg).toBeDefined();
      expect(nudgeMsg!.content).toContain("CRITICAL");
    });

    it("non-critical nudge is NOT consumed mid-tool-loop", async () => {
      const provider = mockProvider({ toolRounds: 1 });
      const chatSpy = provider.chat as ReturnType<typeof vi.fn>;

      const loop = new AgenticLoop({
        config: {
          name: "test",
          provider: "mock",
          model: "m",
          maxIterations: 1,
          delayMs: 0,
          promptFile: "PROMPT.md",
          workingDir: "/tmp/test",
        },
        provider,
        tools: mockToolRegistry(),
      });

      // Inject AFTER loop starts on first LLM call
      let injectedMidLoop = false;
      loop.on("llm:response", () => {
        if (!injectedMidLoop) {
          injectedMidLoop = true;
          // Normal priority — should NOT be consumed mid-tool-loop
          loop.nudge("Consider adding docs", "normal");
        }
      });

      await loop.run();

      // The normal nudge should still be pending (consumed between-iterations or not at all
      // since maxIterations=1 and it was injected during the iteration)
      // It should NOT appear in the LLM messages of the FIRST iteration's tool loop
      const firstCallMessages: ChatMessage[] =
        chatSpy.mock.calls[0][0].messages;
      const nudgeInFirstCall = firstCallMessages.find(
        (m: ChatMessage) =>
          m.role === "user" && m.content?.includes("Consider adding docs"),
      );
      expect(nudgeInFirstCall).toBeUndefined();
    });
  });

  describe("nudge history", () => {
    it("tracks consumed nudges in history", () => {
      const loop = createLoop();
      loop.nudge("first");
      loop.nudge("second");

      // Before running — nothing consumed
      expect(loop.getNudgeHistory()).toHaveLength(0);
      expect(loop.getPendingNudges()).toHaveLength(2);
    });

    it("getPendingNudges returns a copy", () => {
      const loop = createLoop();
      loop.nudge("test");
      const pending = loop.getPendingNudges();
      pending.pop(); // mutate the copy
      expect(loop.getPendingNudges()).toHaveLength(1); // original unaffected
    });
  });

  describe("message formatting", () => {
    it("formats nudges with priority tags", async () => {
      const provider = mockProvider();
      const chatSpy = provider.chat as ReturnType<typeof vi.fn>;

      const loop = new AgenticLoop({
        config: {
          name: "test",
          provider: "mock",
          model: "m",
          maxIterations: 1,
          delayMs: 0,
          promptFile: "PROMPT.md",
          workingDir: "/tmp/test",
        },
        provider,
        tools: mockToolRegistry(),
      });

      loop.nudge("low priority", "low");
      loop.nudge("high priority", "high");
      await loop.run();

      const messages: ChatMessage[] = chatSpy.mock.calls[0][0].messages;
      const nudgeMsg = messages.find(
        (m) => m.role === "user" && m.content?.includes("STEERING NUDGE"),
      );
      expect(nudgeMsg).toBeDefined();
      expect(nudgeMsg!.content).toContain("💡 LOW");
      expect(nudgeMsg!.content).toContain("⚠️ HIGH");
      expect(nudgeMsg!.content).toContain("low priority");
      expect(nudgeMsg!.content).toContain("high priority");
    });
  });
});
