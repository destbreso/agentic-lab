// Step records: every role's turn is kept with its inputs and their
// provenance, the exact messages sent to its model and the replies. Replaying
// a recorded run, each role answered with its own recorded replies, sends the
// same prompts byte for byte: the records hold everything a run depends on.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopologyRun } from "./topology-run.js";
import { replayProviders } from "./recorder.js";
import { InMemoryStorage } from "../storage/memory.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";
import type { StepRecord } from "../types/step.js";

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["RESULT.txt is wrong"], corrections: ["swap the parts"], confidence: 0.6 });

/**
 * Do reads the probe and writes a result; Check reads it and fails its first
 * turn (its second call: the first reads the file); Decide refines; round 2 passes.
 */
function script(c: ScriptedCall) {
  const last = c.options.messages.at(-1);
  if (c.role === "do") {
    if (last?.role !== "tool") return { toolCalls: [{ name: "file_read", arguments: { path: "PROBE.txt" } }] };
    if (!c.options.messages.some((m) => m.toolCalls?.some((t) => t.name === "file_write"))) {
      return { toolCalls: [{ name: "file_write", arguments: { path: "RESULT.txt", content: `try ${c.turn}` } }] };
    }
    return `wrote try ${c.turn}`;
  }
  if (c.role === "check") {
    if (last?.role !== "tool") return { toolCalls: [{ name: "file_read", arguments: { path: "RESULT.txt" } }] };
    return c.turn === 2 ? FAIL : undefined;
  }
  if (c.role === "decide") return JSON.stringify({ decision: "refine", reason: "not yet", corrections: ["swap them"] });
  return undefined;
}

let root: string;
let ws: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "steps-"));
  ws = join(root, "ws");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The same workspace, at the same path, for the recording and the replay. */
async function freshWorkspace() {
  await rm(ws, { recursive: true, force: true });
  await mkdir(ws, { recursive: true });
  await writeFile(join(ws, "PROBE.txt"), "probe value: 7351-kestrel\n");
}

function session(opts: { storage?: InMemoryStorage; replay?: StepRecord[] }) {
  return new TopologyRun({
    provider: scriptedProvider(script),
    tools: createDefaultToolkit(),
    topology: "deep-reasoning",
    workingDir: ws,
    delayMs: 0,
    storage: opts.storage,
    roleProvider: opts.replay ? replayProviders(opts.replay) : undefined,
  });
}

const TASK = "Read PROBE.txt and write the two parts swapped into RESULT.txt.";

describe("step records", () => {
  it("keep every role's turn with its inputs, their provenance, and the exact calls", async () => {
    await freshWorkspace();
    const storage = new InMemoryStorage();
    const s = session({ storage });
    const run = await s.run({ task: TASK, inputs: [{ name: "memories", content: "## Recalled\n\nan old note", provenance: "written" }] });
    expect(run.outcome).toBe("passed");

    const stored = await storage.steps.getSteps(s.runId);
    expect(stored.map((x) => x.seq)).toEqual(run.steps.map((x) => x.seq));
    expect(stored.map((x) => `${x.round}:${x.role}`)).toEqual([
      "1:plan", "1:exec", "1:eval", "1:critic", "1:refine",
      "2:exec", "2:eval", "2:critic", "2:refine",
    ]);

    const doRound2 = stored.find((x) => x.role === "exec" && x.round === 2)!;
    const kinds = Object.fromEntries(doRound2.inputs.map((i) => [`${i.source}:${i.name}:${i.from}`, i.provenance]));
    expect(kinds["run:task:you"]).toBe("given");
    expect(kinds["run:memories:run"]).toBe("written");
    expect(kinds["signal:corrections:eval"]).toBe("written");
    expect(kinds["signal:corrections:refine"]).toBe("written");
    const fromCheck = doRound2.inputs.find((i) => i.name === "corrections" && i.from === "eval")!;
    expect(fromCheck.fields?.iteration.provenance).toBe("measured");

    // Do's turn: three calls, the tools offered, its tool calls and its output's kinds.
    const doRound1 = stored.find((x) => x.role === "exec" && x.round === 1)!;
    expect(doRound1.calls).toHaveLength(3);
    expect(doRound1.calls[0].messages[0].role).toBe("system");
    expect(doRound1.calls[0].tools).toContain("file_write");
    expect(doRound1.toolCalls.map((t) => t.name)).toEqual(["file_read", "file_write"]);
    const result = doRound1.outputs.find((o) => o.type === "execution_result")!;
    expect(result.fields.responseText.provenance).toBe("written");
    expect(result.fields.toolCallCount).toEqual({ provenance: "measured", value: 2 });

    // Critique's inputs carry no written field: only counts and verdicts reach it.
    for (const step of stored.filter((x) => x.role === "critic")) {
      for (const input of step.inputs) {
        for (const [name, field] of Object.entries(input.fields ?? {})) {
          if (name !== "verdict") expect(field.provenance, `${input.name}.${name}`).not.toBe("written");
        }
      }
    }
  });

  it("replaying a recorded run sends the same prompts, byte for byte", async () => {
    await freshWorkspace();
    const storage = new InMemoryStorage();
    const recorded = session({ storage });
    await recorded.run(TASK);
    const steps = await storage.steps.getSteps(recorded.runId);

    await freshWorkspace();
    const replayed = await session({ replay: steps }).run(TASK);

    expect(replayed.steps.map((x) => `${x.round}:${x.role}`)).toEqual(steps.map((x) => `${x.round}:${x.role}`));
    let calls = 0;
    for (const [i, step] of steps.entries()) {
      const again = replayed.steps[i];
      expect(again.calls.length, `${step.round}:${step.role}`).toBe(step.calls.length);
      for (const [j, call] of step.calls.entries()) {
        expect(JSON.stringify(again.calls[j].messages), `${step.round}:${step.role} call ${j + 1}`).toBe(
          JSON.stringify(call.messages),
        );
        expect(again.calls[j].tools).toEqual(call.tools);
        calls++;
      }
    }
    expect(calls).toBeGreaterThan(10);
    expect(replayed.outcome).toBe("passed");
  });

  it("a replay that goes past its recording fails loudly", async () => {
    const provider = replayProviders([])({ id: "exec", name: "Do", category: "execution", type: "execution" });
    await expect(provider.chat({ messages: [] })).rejects.toThrow(/no recorded reply left for exec/);
  });
});
