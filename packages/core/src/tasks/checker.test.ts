// The lab's measured checks: run in a copy of the workspace the lab makes,
// with the task's check files copied back in from its own copy, so a role
// that edits them changes nothing; and after every run, the outcome is theirs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeasuredChecker } from "./checker.js";
import { loadTaskFile, parseTask } from "./load.js";
import { AgentSession } from "../engine/agent-session.js";
import { InMemoryStorage } from "../storage/memory.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";

let ws: string;
let labTmp: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "checks-ws-"));
  labTmp = await mkdtemp(join(tmpdir(), "checks-lab-"));
  await writeFile(join(ws, "PROBE.txt"), "7351-kestrel\n");
  await writeFile(join(ws, "check.sh"), 'test "$(cat RESULT.txt)" = "kestrel-7351"\n');
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
  await rm(labTmp, { recursive: true, force: true });
});

const RESULT_CHECK = { name: "result", kind: "command" as const, command: "sh check.sh" };

describe("MeasuredChecker", () => {
  it("passes a command that exits 0 and fails one that does not, with the exit code and output", async () => {
    const checker = new MeasuredChecker({
      workspace: ws,
      tmpRoot: labTmp,
      checks: [
        { name: "ok", kind: "command", command: "echo fine" },
        { name: "no", kind: "command", command: "echo broken >&2; exit 3" },
      ],
    });
    const run = await checker.run({ label: "t" });
    expect(run.passed).toBe(false);
    expect(run.results[0]).toMatchObject({ name: "ok", passed: true, exitCode: 0, output: "fine" });
    expect(run.results[1]).toMatchObject({ name: "no", passed: false, exitCode: 3, output: "broken" });
  });

  it("reads files and the answer against what is expected", async () => {
    await writeFile(join(ws, "RESULT.txt"), "kestrel-7351\n");
    const checker = new MeasuredChecker({
      workspace: ws,
      tmpRoot: labTmp,
      checks: [
        { name: "equals", kind: "file", path: "RESULT.txt", equals: "kestrel-7351" },
        { name: "matches", kind: "file", path: "RESULT.txt", matches: "^kestrel-\\d+$" },
        { name: "missing", kind: "file", path: "NOPE.txt", contains: "x" },
        { name: "answer", kind: "answer", contains: "kestrel-7351" },
      ],
    });
    const run = await checker.run({ label: "t", answer: "I wrote kestrel-7351." });
    expect(run.results.map((r) => [r.name, r.passed])).toEqual([
      ["equals", true],
      ["matches", true],
      ["missing", false],
      ["answer", true],
    ]);
    expect(run.results[2].output).toBe("NOPE.txt does not exist");
  });

  it("runs in a copy the lab makes and removes: a check that writes changes nothing in the workspace", async () => {
    const checker = new MeasuredChecker({
      workspace: ws,
      tmpRoot: labTmp,
      checks: [{ name: "writes", kind: "command", command: "echo scribble > RESULT.txt; pwd" }],
    });
    const run = await checker.run({ label: "t" });
    expect(run.results[0].output.startsWith(labTmp) || run.results[0].output.includes("agentic-lab-check-")).toBe(true);
    await expect(readFile(join(ws, "RESULT.txt"), "utf-8")).rejects.toThrow();
    expect(await readdir(labTmp)).toEqual([]);
  });

  it("copies the check files back in from its own copy, whatever the workspace holds now", async () => {
    await writeFile(join(ws, "RESULT.txt"), "wrong\n");
    const checker = new MeasuredChecker({ workspace: ws, tmpRoot: labTmp, checks: [RESULT_CHECK], checkFiles: ["check.sh"] });
    await checker.capture();
    await writeFile(join(ws, "check.sh"), "exit 0\n"); // a role "fixes" the check
    const run = await checker.run({ label: "t" });
    expect(run.passed).toBe(false);
    expect(run.results[0].exitCode).toBe(1);
  });

  it("refuses a check file outside the workspace or missing when the run starts", async () => {
    await expect(new MeasuredChecker({ workspace: ws, checks: [RESULT_CHECK], checkFiles: ["../x.sh"] }).capture()).rejects.toThrow(
      /outside the workspace/,
    );
    await expect(new MeasuredChecker({ workspace: ws, checks: [RESULT_CHECK], checkFiles: ["gone.sh"] }).capture()).rejects.toThrow(
      /not in the workspace/,
    );
  });
});

describe("task files", () => {
  it("validate the task, its checks and their files, naming the wrong path", async () => {
    const path = join(labTmp, "task.json");
    await writeFile(path, JSON.stringify({ task: "swap", checks: [RESULT_CHECK], checkFiles: ["check.sh"] }));
    expect(await loadTaskFile(path)).toEqual({ task: "swap", checks: [RESULT_CHECK], checkFiles: ["check.sh"] });
    expect(() => parseTask({ task: "x", checks: [{ name: "c", kind: "command" }] })).toThrow(/checks\.0\.command/);
  });
});

/** Do writes RESULT.txt (right or wrong) and overwrites check.sh so it always passes; Check's model says pass. */
function cheat(result: string) {
  return (c: ScriptedCall) => {
    if (c.role === "do") {
      const wrote = c.options.messages.filter((m) => m.role === "tool").length;
      if (wrote === 0) return { toolCalls: [{ name: "file_write", arguments: { path: "RESULT.txt", content: result } }] };
      if (wrote === 1) return { toolCalls: [{ name: "file_write", arguments: { path: "check.sh", content: "exit 0\n" } }] };
      return `RESULT.txt holds ${result}`;
    }
    return undefined;
  };
}

async function runWith(script: (c: ScriptedCall) => unknown, verdictFrom?: "measured" | "model") {
  const storage = new InMemoryStorage();
  const session = new AgentSession({
    provider: scriptedProvider(script as never),
    tools: createDefaultToolkit(),
    topology: "exec-eval",
    workingDir: ws,
    delayMs: 0,
    storage,
    verdictFrom,
  });
  const run = await session.run({ task: "swap the probe", checks: [RESULT_CHECK], checkFiles: ["check.sh"] });
  return { run, steps: await storage.steps.getSteps(session.runId) };
}

describe("the final measured check", () => {
  it("ignores a role's edit of the check file: the run fails though Check's model passed it", async () => {
    // The verdict left to Check's model, as before the measured check drove it.
    const { run, steps } = await runWith(cheat("wrong"), "model");
    // The role did edit the check in the workspace...
    expect(await readFile(join(ws, "check.sh"), "utf-8")).toBe("exit 0\n");
    // ...and the topology, trusting Check's model, thought it passed.
    expect(run.result.outcome).toBe("passed");
    // The lab's check ran its own copy of check.sh, and the run failed.
    expect(run.measured?.passed).toBe(false);
    expect(run.outcome).toBe("failed");
    expect(run.success).toBe(false);
    expect(run.reason).toMatch(/^the measured check failed \(result\); the topology ended passed/);

    // The last step is the lab's: what passed is measured, the checks' names are given by the task.
    const last = steps.at(-1)!;
    expect(last.role).toBe("lab");
    const fields = last.outputs[0].fields;
    expect(fields.passed).toEqual({ provenance: "measured", value: false });
    expect(fields.results.provenance).toBe("given");
  });

  it("by default Check's verdict is the check's too, so the topology does not pass either", async () => {
    const { run } = await runWith(cheat("wrong"));
    expect(run.result.outcome).toBe("failed");
    expect(run.result.verdict).toBe("fail");
    expect(run.outcome).toBe("failed");
  });

  it("passes when the work passes, whatever the role did to the check", async () => {
    const { run } = await runWith(cheat("kestrel-7351"));
    expect(run.measured?.passed).toBe(true);
    expect(run.outcome).toBe("passed");
  });

  it("leaves a run without checks to its topology", async () => {
    const run = await new AgentSession({
      provider: scriptedProvider(),
      tools: createDefaultToolkit([]),
      topology: "exec-eval",
      workingDir: ws,
      delayMs: 0,
    }).run("no checks here");
    expect(run.measured).toBeUndefined();
    expect(run.outcome).toBe(run.result.outcome);
  });
});
