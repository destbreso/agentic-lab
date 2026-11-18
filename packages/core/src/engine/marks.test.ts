// What each role sees, measured with marks: every input gets a unique mark,
// and the test reads which marks reach each role's prompt. Ways back carry
// what their target reads: Do reads the corrections, Plan the task and the
// reason to start over. Critique and Decide see no content.

import { describe, it, expect } from "vitest";
import { instantiateRecipe } from "../loops/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall, type ScriptedReply } from "../test-support/scripted-provider.js";

const fail = (mark: string) =>
  JSON.stringify({ verdict: "fail", evidence: ["observed"], corrections: [mark], confidence: 0.8 });
const PASS = JSON.stringify({ verdict: "pass", evidence: ["observed"], corrections: [], confidence: 0.9 });

async function deepReasoning(script: (c: ScriptedCall) => ScriptedReply | string | undefined, maxRounds = 4) {
  const provider = scriptedProvider(script);
  const pipeline = instantiateRecipe(
    "deep-reasoning",
    {
      provider,
      tools: createDefaultToolkit([]),
      workingDir: "/tmp",
      seedShared: { task: "MARK-TASK" },
      maxRounds,
    },
    { delayMs: 0 },
  );
  const result = await pipeline.run();
  return { provider, result };
}

const CONTENT_MARKS = /MARK-(TASK|PLAN|DO|CORR)/;

describe("marks: each role sees what the definition says", () => {
  it("Do reads the corrections sent back, and Critique and Decide see no content", async () => {
    const { provider, result } = await deepReasoning((c) => {
      if (c.role === "plan") return `STRATEGY: continue\nREASONING: r\nNEXT_TASK: MARK-PLAN-${c.turn}`;
      if (c.role === "do") return `MARK-DO-${c.turn}`;
      if (c.role === "check") return c.turn < 4 ? fail(`MARK-CORR-CHECK-${c.turn}`) : PASS;
      if (c.role === "decide") {
        return JSON.stringify({ decision: "refine", reason: "close", corrections: [`MARK-CORR-DECIDE-${c.turn}`] });
      }
      return undefined;
    });
    expect(result.outcome).toBe("passed");

    const plan = provider.promptsOf("plan");
    const doPrompts = provider.promptsOf("do");
    const check = provider.promptsOf("check");

    // Plan reads the task.
    expect(plan[0]).toContain("MARK-TASK");
    // Do reads the task and the plan in round 1.
    expect(doPrompts[0]).toContain("MARK-TASK");
    expect(doPrompts[0]).toContain("MARK-PLAN-1");
    // Round 2: Do reads both ways back's corrections, its own previous answer, and the plan still in force.
    expect(doPrompts[1]).toContain("MARK-CORR-CHECK-1");
    expect(doPrompts[1]).toContain("MARK-CORR-DECIDE-1");
    expect(doPrompts[1]).toContain("MARK-DO-1");
    expect(doPrompts[1]).toContain("MARK-PLAN-1");
    expect(doPrompts[1]).not.toContain("MARK-CORR-CHECK-2");
    // Check reads the task and Do's account.
    expect(check[0]).toContain("MARK-TASK");
    expect(check[0]).toContain("MARK-DO-1");

    // Critique called the model from round 3 on; none of its prompts carries content.
    const critique = provider.promptsOf("critique");
    expect(critique.length).toBeGreaterThan(0);
    for (const p of critique) expect(p).not.toMatch(CONTENT_MARKS);
    for (const p of provider.promptsOf("decide")) expect(p).not.toMatch(CONTENT_MARKS);
  });

  it("Plan reads the task and the reason to start over after a backtrack", async () => {
    const { provider } = await deepReasoning((c) => {
      if (c.role === "check") return c.turn === 1 ? fail("MARK-CORR-1") : PASS;
      if (c.role === "decide") return JSON.stringify({ decision: "backtrack", reason: "MARK-REPLAN-REASON", corrections: [] });
      return undefined;
    });
    const plan = provider.promptsOf("plan");
    expect(plan).toHaveLength(2);
    expect(plan[0]).not.toContain("MARK-REPLAN-REASON");
    expect(plan[1]).toContain("MARK-TASK");
    expect(plan[1]).toContain("MARK-REPLAN-REASON");
  });
});
