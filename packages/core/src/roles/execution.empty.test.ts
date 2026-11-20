// An empty reply is not an answer: the turn asks the model to go on, twice at most, and a model that writes
// after being asked finishes the task (what qwen2.5:7b needed on HumanEval: it read the file, then went silent).

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_REPLY_NUDGE, ExecutionEngine, MAX_EMPTY_NUDGES } from "./execution.js";
import { InMemorySharedStore } from "../engine/capability-resolver.js";
import type { ChatCompletionResult, ChatMessage, LLMProvider } from "../types/llm.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";
import type { NodeContext, PipelineState } from "../types/pipeline.js";

function registry(tools: AgentTool[]): ToolRegistry {
  const map = new Map(tools.map((t) => [t.definition.name, t]));
  return {
    register: (t) => map.set(t.definition.name, t),
    get: (n) => map.get(n),
    getAll: () => [...map.values()],
    getDefinitions: () => [...map.values()].map((t) => t.definition),
    has: (n) => map.has(n),
    remove: (n) => map.delete(n),
  };
}

/** A read or write tool; the write really writes in `dir`, so the workspace's snapshot sees it. */
const tool = (name: string, calls: string[], dir?: string): AgentTool => ({
  definition: { name, description: name, parameters: { type: "object", properties: {} } },
  execute: async () => {
    calls.push(name);
    if (name === "file_write" && dir) writeFileSync(join(dir, "solution.py"), "def f():\n    return 1\n");
    return name === "file_read" ? "def f():\n    raise NotImplementedError\n" : "written";
  },
});

/** A provider that answers from a script, and keeps every request's messages. */
function scripted(replies: Array<Partial<ChatCompletionResult["message"]> & { finish?: ChatCompletionResult["finishReason"] }>, seen: ChatMessage[][]): LLMProvider {
  let i = 0;
  return {
    name: "scripted",
    chat: async (opts) => {
      seen.push([...opts.messages]);
      const r = replies[Math.min(i++, replies.length - 1)];
      return {
        message: { role: "assistant", content: r.content ?? "", ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}) },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: r.finish ?? (r.toolCalls ? "tool_calls" : "stop"),
      };
    },
    listModels: async () => [],
    healthCheck: async () => true,
  };
}

function context(dir: string): NodeContext {
  const shared = new InMemorySharedStore();
  return {
    nodeId: "exec",
    traceId: "t",
    iteration: 1,
    workingDir: dir,
    inputSignals: [{ sourceNodeId: "task", type: "task", data: { task: "complete f in solution.py" }, timestamp: new Date().toISOString() }],
    emit: () => {},
    requestStop: () => {},
    pipelineState: {} as unknown as PipelineState,
    shared,
    runtime: { shared },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  } as NodeContext;
}

describe("an empty reply in Do's turn", () => {
  it("is answered by asking the model to go on, and a model that then writes finishes the task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jig-empty-reply-"));
    try {
      const calls: string[] = [];
      const seen: ChatMessage[][] = [];
      const provider = scripted(
        [
          { toolCalls: [{ id: "1", name: "file_read", arguments: { path: "solution.py" } }] },
          { content: "" },
          { toolCalls: [{ id: "2", name: "file_write", arguments: { path: "solution.py", content: "def f():\n    return 1\n" } }] },
          { content: "Done: f returns 1." },
        ],
        seen,
      );
      const engine = new ExecutionEngine({ provider, tools: registry([tool("file_read", calls), tool("file_write", calls, dir)]) });
      await engine.execute(context(dir));
      expect(calls).toEqual(["file_read", "file_write"]);
      expect(seen).toHaveLength(4);
      expect(seen[2].at(-1)).toEqual({ role: "user", content: EMPTY_REPLY_NUDGE });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(`ends the turn when the model stays silent after ${MAX_EMPTY_NUDGES} requests`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "jig-empty-reply-"));
    try {
      const seen: ChatMessage[][] = [];
      const engine = new ExecutionEngine({ provider: scripted([{ content: "" }], seen), tools: registry([]) });
      await engine.execute(context(dir));
      expect(seen).toHaveLength(1 + MAX_EMPTY_NUDGES);
      expect(seen.at(-1)!.filter((m) => m.content === EMPTY_REPLY_NUDGE)).toHaveLength(MAX_EMPTY_NUDGES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
