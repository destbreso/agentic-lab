// Benchmarks run in this process: the baseline is one direct call to the
// model, a recipe runs through TopologyRun, and the judge is a model the
// suite names apart from the contenders'. Nothing goes over HTTP.

import { describe, it, expect, vi, afterEach } from "vitest";
import { registerProvider } from "jig-core";
import { runBenchmarkSuite, buildRun, judgeOf } from "./runner";
import type { BenchmarkProblem, BenchmarkSuite } from "./types";
import { scriptedProvider, type ScriptedProvider } from "../../../../core/src/test-support/scripted-provider";

const made: Array<{ name: string; model: string; provider: ScriptedProvider }> = [];

registerProvider(
  "bench-mock",
  class {
    constructor(config: { model: string }) {
      const provider = scriptedProvider((c) => (c.role === "do" || c.role === "other" ? "ENGINE-ANSWER 0.05" : undefined));
      made.push({ name: "bench-mock", model: config.model, provider });
      return provider;
    }
  } as never,
);
registerProvider(
  "judge-mock",
  class {
    constructor(config: { model: string }) {
      const provider = scriptedProvider(() => '{"score": 90, "notes": "ok"}');
      made.push({ name: "judge-mock", model: config.model, provider });
      return provider;
    }
  } as never,
);

afterEach(() => {
  vi.unstubAllGlobals();
  made.length = 0;
});

const problem = {
  id: "p1",
  title: "Bat and ball",
  category: "logic",
  prompt: "A bat and a ball cost 1.10; the bat costs 1.00 more. What does the ball cost?",
  trap: "0.10",
  expectedInsight: "0.05",
} as BenchmarkProblem;

function suiteOf(judge?: BenchmarkSuite["judge"]): BenchmarkSuite {
  const contenders = [
    { id: "b", label: "Baseline", type: "baseline" as const },
    { id: "c1", label: "Exec & Eval", type: "recipe" as const, recipeId: "exec-eval" },
  ];
  return {
    id: "s1",
    name: "t",
    description: "",
    model: "contender-model",
    provider: "bench-mock",
    ...(judge ? { judge } : {}),
    status: "pending",
    runs: [buildRun(problem, contenders, "contender-model", "bench-mock")],
    createdAt: new Date().toISOString(),
  };
}

describe("benchmark runner", () => {
  it("runs the baseline and a recipe in process, and asks the suite's own judge, with no HTTP call", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(String(url));
      throw new Error("no HTTP in a benchmark");
    });

    const done = await runBenchmarkSuite(suiteOf({ provider: "judge-mock", model: "judge-model" }), [problem]);
    const [baseline, recipe] = done.runs[0].results;

    expect(fetched).toEqual([]);
    expect(baseline).toMatchObject({ status: "completed", answer: "ENGINE-ANSWER 0.05", qualityScore: 90 });
    expect(recipe).toMatchObject({ status: "completed", answer: "ENGINE-ANSWER 0.05", qualityScore: 90 });
    expect(recipe.inputTokens).toBeGreaterThan(0);

    // The baseline is the question alone, one call.
    const baselineProvider = made.find((m) => m.name === "bench-mock")!.provider;
    expect(baselineProvider.calls).toHaveLength(1);
    expect(baselineProvider.calls[0].prompt).toBe(problem.prompt);

    // The judge is its own model, and it was shown the answer.
    const judges = made.filter((m) => m.name === "judge-mock");
    expect(judges.map((j) => j.model)).toEqual(["judge-model", "judge-model"]);
    expect(judges[0].provider.calls[0].prompt).toContain("ENGINE-ANSWER 0.05");
  });

  it("falls back to the contenders' model as judge only when the suite names none", () => {
    expect(judgeOf(suiteOf())).toEqual({ provider: "bench-mock", model: "contender-model" });
    expect(judgeOf(suiteOf({ provider: "judge-mock", model: "j" }))).toEqual({ provider: "judge-mock", model: "j" });
  });
});
