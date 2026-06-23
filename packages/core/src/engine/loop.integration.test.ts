// ============================================
// AgenticLoop — Integration Tests
// ============================================
// Exercises the core loop mechanics (not steering, which lives in
// loop.test.ts) with a mock provider and mock tools: iteration counting,
// token/tool aggregation, tool execution, early-stop on plan completion,
// external stop(), and a long tool-loop (context-window pruning integrated).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgenticLoop } from "./loop.js";
import type {
  LLMProvider,
  ChatCompletionResult,
} from "../types/llm.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";

// Shared mutable plan state so individual tests can control completion.
const h = vi.hoisted(() => ({
  planItems: [{ id: "1", title: "task", status: "pending" }] as Array<{
    id: string;
    title: string;
    status: string;
  }>,
  rawContent: "# Plan\n- [ ] task",
}));

vi.mock("./plan-manager.js", () => ({
  PlanManager: class {
    async read() {
      return h.planItems;
    }
    async getRawContent() {
      return h.rawContent;
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

/** Mock provider: returns `toolRounds` tool-call responses, then plain text. */
function mockProvider(toolRounds = 0): LLMProvider {
  let callCount = 0;
  return {
    name: "mock",
    chat: vi.fn(async () => {
      callCount++;
      if (callCount <= toolRounds) {
        return {
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: `tc-${callCount}`, name: "mock_tool", arguments: { round: callCount } },
            ],
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        } satisfies ChatCompletionResult;
      }
      return {
        message: { role: "assistant", content: "Done." },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      } satisfies ChatCompletionResult;
    }),
    listModels: vi.fn(async () => []),
    healthCheck: vi.fn(async () => true),
  };
}

/** Mock tool registry with a single `mock_tool`, exposing its execute spy. */
function mockToolRegistry(): { registry: ToolRegistry; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => "mock result");
  const tool: AgentTool = {
    definition: { name: "mock_tool", description: "A mock tool", parameters: { type: "object", properties: {} } },
    execute,
  };
  const registry: ToolRegistry = {
    register: vi.fn(),
    get: vi.fn((name: string) => (name === "mock_tool" ? tool : undefined)),
    getAll: vi.fn(() => [tool]),
    getDefinitions: vi.fn(() => [tool.definition]),
    has: vi.fn(() => true),
    remove: vi.fn(() => true),
  };
  return { registry, execute };
}

function makeLoop(opts: {
  toolRounds?: number;
  maxIterations?: number;
  tools?: ToolRegistry;
}) {
  return new AgenticLoop({
    config: {
      name: "test",
      provider: "mock",
      model: "m",
      maxIterations: opts.maxIterations ?? 3,
      delayMs: 0,
      promptFile: "PROMPT.md",
      workingDir: "/tmp/loop-int",
    },
    provider: mockProvider(opts.toolRounds ?? 0),
    tools: opts.tools ?? mockToolRegistry().registry,
  });
}

describe("AgenticLoop — integration", () => {
  beforeEach(() => {
    // Reset to a non-completed plan before each test.
    h.planItems = [{ id: "1", title: "task", status: "pending" }];
  });

  it("runs maxIterations and aggregates token usage", async () => {
    const loop = makeLoop({ maxIterations: 3 });
    const result = await loop.run();

    expect(result.totalIterations).toBe(3);
    expect(result.success).toBe(true);
    // 3 iterations × 15 tokens each.
    expect(result.state.totalTokenUsage.totalTokens).toBe(45);
  });

  it("executes tools requested by the LLM and records them", async () => {
    const { registry, execute } = mockToolRegistry();
    const loop = makeLoop({ toolRounds: 1, maxIterations: 1, tools: registry });

    const result = await loop.run();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.state.totalToolCalls["mock_tool"]).toBe(1);
    expect(result.state.iterations[0].toolCalls[0].result).toBe("mock result");
  });

  it("stops early when all plan items are completed", async () => {
    h.planItems = [{ id: "1", title: "task", status: "completed" }];
    const loop = makeLoop({ maxIterations: 5 });

    const result = await loop.run();

    // Plan complete after the first iteration → loop breaks early.
    expect(result.totalIterations).toBe(1);
    expect(result.success).toBe(true);
  });

  it("halts when stop() is called during the run", async () => {
    const loop = makeLoop({ maxIterations: 5 });
    loop.on("iteration:end", () => loop.stop("test stop"));

    const result = await loop.run();

    expect(result.totalIterations).toBe(1);
    expect(result.state.status).toBe("stopped");
    expect(result.success).toBe(false);
  });

  it("survives a long tool-loop beyond maxToolRounds (pruning integrated)", async () => {
    const { registry, execute } = mockToolRegistry();
    // 25 tool rounds requested, internal safety cap is 20.
    const loop = makeLoop({ toolRounds: 25, maxIterations: 1, tools: registry });

    const result = await loop.run();

    expect(result.totalIterations).toBe(1);
    expect(result.state.iterations[0].errors).toEqual([]);
    // Capped at the internal maxToolRounds (20), not the 25 requested.
    expect(execute).toHaveBeenCalledTimes(20);
  });
});
