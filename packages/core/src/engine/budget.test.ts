// A per-attempt token budget stops a run: counted per model call, so a role
// stuck in a tool loop is stopped mid-turn, not after it. The run ends like at
// a round limit, and its outcome follows what was checked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "./agent-session.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";

/** Do never stops calling a tool; every call costs the scripted 15 tokens. */
const looping = (c: ScriptedCall) =>
  c.role === "do" ? { toolCalls: [{ name: "file_read", arguments: { path: "PROBE.txt" } }] } : undefined;

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "budget-"));
  await writeFile(join(ws, "PROBE.txt"), "probe\n");
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

function session(tokenBudget?: number) {
  return new AgentSession({
    provider: scriptedProvider(looping),
    tools: createDefaultToolkit(),
    topology: "exec-eval",
    workingDir: ws,
    delayMs: 0,
    tokenBudget,
  });
}

describe("token budget", () => {
  it("stops a role mid-turn once the attempt's tokens are spent, without calling it a failure", async () => {
    const run = await session(50).run("read the probe");
    expect(run.result.reason).toBe("token budget (50) spent: 60 tokens; no Check gave a verdict");
    expect(run.result.errors).toEqual([]);
    expect(run.outcome).toBe("inconclusive");
    const doStep = run.steps.find((s) => s.role === "exec")!;
    expect(doStep.calls).toHaveLength(4);
    expect(run.steps.some((s) => s.role === "eval")).toBe(false);
  });

  it("leaves the outcome to the measured check when the task has one", async () => {
    await writeFile(join(ws, "RESULT.txt"), "done\n");
    const run = await session(50).run({
      task: "read the probe",
      checks: [{ name: "result", kind: "file", path: "RESULT.txt", equals: "done" }],
    });
    expect(run.outcome).toBe("passed");
    expect(run.reason).toMatch(/^the measured check passed \(1 of 1\); the topology ended inconclusive: token budget \(50\) spent/);
  });

  it("without a budget, the tool-call cap is what stops the loop, as a failure", async () => {
    const run = await session().run("read the probe");
    expect(run.outcome).toBe("failed");
    expect(run.result.reason).toMatch(/tool-call cap/);
  });
});
