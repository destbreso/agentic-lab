// A benchmark's recipe contender runs in this process through AgentSession,
// the engine the chat uses, not through an HTTP call to the chat route.

import { describe, it, expect, vi, afterEach } from "vitest";
import { registerProvider } from "@agentic-lab/core";
import { runBenchmarkSuite, buildRun } from "./runner";
import type { BenchmarkProblem, BenchmarkSuite } from "./types";
import { scriptedProvider } from "../../../../core/src/test-support/scripted-provider";

registerProvider(
  "bench-mock",
  class {
    constructor() {
      return scriptedProvider((c) => (c.role === "do" ? "ENGINE-ANSWER 0.05" : undefined));
    }
  } as never,
);

afterEach(() => vi.unstubAllGlobals());

describe("benchmark runner", () => {
  it("runs a recipe contender through the session and only calls HTTP for the judge", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      // The judge answers over /api/chat/send as a stream of content chunks.
      const body = `data: ${JSON.stringify({ content: '{"score": 90, "notes": "ok"}' })}\n\n`;
      return new Response(body, { status: 200 });
    });

    const problem: BenchmarkProblem = {
      id: "p1",
      title: "Bat and ball",
      category: "logic",
      prompt: "A bat and a ball cost 1.10; the bat costs 1.00 more. What does the ball cost?",
      trap: "0.10",
      expectedInsight: "0.05",
    } as BenchmarkProblem;
    const contender = { id: "c1", label: "Exec & Eval", type: "recipe" as const, recipeId: "exec-eval" };
    const suite = {
      id: "s1",
      name: "t",
      model: "m",
      provider: "bench-mock",
      status: "pending",
      runs: [buildRun(problem, [contender] as never, "m", "bench-mock")],
      createdAt: new Date().toISOString(),
    } as unknown as BenchmarkSuite;

    const done = await runBenchmarkSuite(suite, [problem]);
    const result = done.runs[0].results[0];
    expect(result.status).toBe("completed");
    expect(result.answer).toBe("ENGINE-ANSWER 0.05");
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes("/api/chat/agent"))).toBe(false);
    expect(urls.every((u) => u.includes("/api/chat/send"))).toBe(true);
  });
});
