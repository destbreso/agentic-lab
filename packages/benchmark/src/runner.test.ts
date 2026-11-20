// The runner end to end on jig-core's scripted model: real TopologyRuns, real measured checks, no tokens.

import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockRefused, readLock } from "./lock.js";
import { readResults, RESULTS_FILE } from "./results.js";
import { runExperiment } from "./runner.js";
import { loadSpec } from "./spec.js";
import { directPrompt, directWrite, lastCodeBlock, lastLine } from "./attempt.js";
import { helloSpec, helloTasks, scratch, scriptedProvider, untilAborted, workingModel, type Scratch } from "./test-support/fixtures.js";

let s: Scratch;
beforeEach(async () => {
  s = await scratch();
  await s.writeTasks(helloTasks);
  await s.writeSpec(helloSpec());
});
afterEach(() => s.remove());

describe("an experiment on a scripted model", () => {
  it("runs every arm on every task it applies to, records one line each, and keeps each run's steps", async () => {
    const loaded = await loadSpec(s.spec);
    const summary = await runExperiment(loaded, { outDir: s.out, provider: workingModel() });
    expect(summary.planned).toBe(5);
    expect(summary.remaining).toBe(0);
    const { records } = await readResults(s.out);
    expect(records.map((r) => [r.arm, r.task, r.outcome])).toEqual([
      ["direct", "hello", "passed"],
      ["ralph-loop", "hello", "passed"],
      ["exec-eval", "hello", "passed"],
      ["ralph-loop", "bye", "passed"],
      ["exec-eval", "bye", "passed"],
    ]);
    const evalRun = records.find((r) => r.arm === "exec-eval" && r.task === "hello")!;
    expect(evalRun).toMatchObject({ kind: "arm", topology: "exec-eval", repetition: 1, checks_passed: 1, checks_total: 1, rounds: 1, fallbacks: [], call_errors: 0, model: "scripted/scripted" });
    expect(evalRun.tokens.total).toBeGreaterThan(0);
    // The scripted model reports 15 tokens a call, so the tokens are the provider's own count.
    expect(evalRun.tokens.total % 15).toBe(0);
    const steps = JSON.parse(await readFile(join(s.out, "runs", evalRun.run_id, "steps.json"), "utf-8")) as Array<{ role: string }>;
    expect(steps.map((st) => st.role)).toEqual(["exec", "eval", "lab"]);
    const record = JSON.parse(await readFile(join(s.out, "runs", evalRun.run_id, "record.json"), "utf-8"));
    expect(record).toMatchObject({ runId: evalRun.run_id, outcome: "passed", topology: "exec-eval", task: "Write hello.txt containing hi" });
    // The workspaces are gone: nothing of the attempts is left in the temporary folder by this run.
    const lock = await readLock(s.out);
    expect(lock?.hash).toBe(loaded.hash);
    expect(lock?.arms.map((a) => a.key)).toEqual(["direct", "ralph-loop", "exec-eval"]);
  });

  it("gives the direct arm one call with the task and its files, no tools, writes its answer where the task says, and lets the checks decide", async () => {
    const loaded = await loadSpec(s.spec);
    const model = workingModel();
    await runExperiment(loaded, { outDir: s.out, provider: model });
    const direct = model.calls.filter((c) => !c.system);
    expect(direct).toHaveLength(1);
    expect(direct[0]!.tools).toEqual([]);
    expect(direct[0]!.prompt).toBe(directPrompt(loaded.taskSet.tasks[0]!));
    const { records } = await readResults(s.out);
    const r = records.find((x) => x.arm === "direct")!;
    const saved = JSON.parse(await readFile(join(s.out, "runs", r.run_id, "direct.json"), "utf-8"));
    expect(saved.written).toEqual({ path: "hello.txt", content: "hi\n" });
    expect(saved.measured.passed).toBe(true);
    expect(r.tokens.total).toBe(15);

    // A wrong answer applied the same way fails the same checks.
    const wrong = scriptedProvider((c) => (!c.system ? "```\nhello\n```" : undefined));
    await runExperiment(loaded, { outDir: join(s.dir, "out-wrong"), provider: wrong, attempt: async (input) => (await import("./attempt.js")).runAttempt(input) });
    const w = (await readResults(join(s.dir, "out-wrong"))).records.find((x) => x.arm === "direct")!;
    expect(w.outcome).toBe("failed");
    expect(w.checks_passed).toBe(0);
  });

  it("does not run the direct arm on a task without a direct block", async () => {
    const loaded = await loadSpec(s.spec);
    await runExperiment(loaded, { outDir: s.out, provider: workingModel() });
    const { records } = await readResults(s.out);
    expect(records.filter((r) => r.arm === "direct").map((r) => r.task)).toEqual(["hello"]);
  });

  it("resumes: a rerun skips what is recorded and runs only what is missing", async () => {
    const loaded = await loadSpec(s.spec);
    await runExperiment(loaded, { outDir: s.out, provider: workingModel() });
    const again = await runExperiment(loaded, { outDir: s.out, provider: workingModel() });
    expect(again.ran).toHaveLength(0);
    expect(again.skipped).toBe(5);
    expect(again.lockCreated).toBe(false);
    // Drop one line: the rerun does that attempt alone.
    const file = join(s.out, RESULTS_FILE);
    const lines = (await readFile(file, "utf-8")).trim().split("\n");
    await writeFile(file, `${lines.filter((l) => !(l.includes('"arm":"exec-eval"') && l.includes('"task":"bye"'))).join("\n")}\n`);
    const third = await runExperiment(loaded, { outDir: s.out, provider: workingModel() });
    expect(third.ran.map((r) => [r.arm, r.task])).toEqual([["exec-eval", "bye"]]);
    expect((await readResults(s.out)).records).toHaveLength(5);
  });

  it("records an attempt that could not start, counts it for nothing, and tries it again on a rerun", async () => {
    const loaded = await loadSpec(s.spec);
    let down = true;
    const first = await runExperiment(loaded, { outDir: s.out, provider: workingModel(), ready: async () => (down ? "scripted does not answer" : null) });
    expect(first.remaining).toBe(5);
    expect((await readResults(s.out)).records.every((r) => r.outcome === null && r.error === "scripted does not answer")).toBe(true);
    down = false;
    const second = await runExperiment(loaded, { outDir: s.out, provider: workingModel(), ready: async () => (down ? "down" : null) });
    expect(second.ran).toHaveLength(5);
    expect(second.remaining).toBe(0);
    // The newest line for each attempt wins.
    expect((await readResults(s.out)).records.every((r) => r.outcome === "passed")).toBe(true);
  });

  it("refuses to resume into a folder whose spec changed, and whose jig-core changed", async () => {
    const loaded = await loadSpec(s.spec);
    await runExperiment(loaded, { outDir: s.out, provider: workingModel() });
    await s.writeSpec(helloSpec({ repetitions: 2 }));
    const changed = await loadSpec(s.spec);
    await expect(runExperiment(changed, { outDir: s.out, provider: workingModel() })).rejects.toThrow(LockRefused);
    await expect(runExperiment(changed, { outDir: s.out, provider: workingModel() })).rejects.toThrow(/holds another experiment: its spec, task set or topology files have changed .*Start a new experiment in a new folder \(--out\)/);
    // The task set counts as much as the spec.
    await s.writeSpec(helloSpec());
    await s.writeTasks({ ...helloTasks, description: "Write a file, edited." });
    await expect(runExperiment(await loadSpec(s.spec), { outDir: s.out, provider: workingModel() })).rejects.toThrow(LockRefused);
    await s.writeTasks(helloTasks);
    await expect(runExperiment(await loadSpec(s.spec), { outDir: s.out, provider: workingModel(), versions: { core: "9.9.9", benchmark: "0.1.0" } })).rejects.toThrow(/started on jig-core .* and this is jig-core 9\.9\.9/);
    // A new folder starts a new experiment.
    const fresh = await runExperiment(changed, { outDir: join(s.dir, "out-2"), provider: workingModel() });
    expect(fresh.planned).toBe(10);
  });

  it("stops on an interrupt without recording the attempts it stopped", async () => {
    const loaded = await loadSpec(s.spec);
    const controller = new AbortController();
    // Do never finishes on its own: it waits until the run is stopped.
    const hanging = scriptedProvider(async (c) => {
      if (c.role === "do") {
        controller.abort();
        await untilAborted(c.signal);
      }
      return !c.system ? "```\nhi\n```" : undefined;
    });
    const summary = await runExperiment(loaded, { outDir: s.out, provider: hanging, signal: controller.signal });
    expect(summary.interrupted).toBe(true);
    const { records } = await readResults(s.out);
    // The direct attempt finished before the interrupt; the Ralph Loop's was stopped and left out.
    expect(records.map((r) => r.arm)).toEqual(["direct"]);
    expect(summary.remaining).toBe(4);
  });

  it("removes every attempt's workspace", async () => {
    const { mkdir } = await import("node:fs/promises");
    const work = join(s.dir, "work");
    await mkdir(work);
    const { readdirSync } = await import("node:fs");
    const inner = workingModel();
    let during = 0;
    // A workspace exists while its attempt's model is called, and is gone after.
    const model = { ...inner, chat: (o: Parameters<typeof inner.chat>[0]) => ((during = Math.max(during, readdirSync(work).length)), inner.chat(o)) };
    await runExperiment(await loadSpec(s.spec), { outDir: s.out, provider: model, workRoot: work });
    expect(during).toBe(1);
    expect(await readdir(work)).toEqual([]);
    expect(existsSync(join(s.out, "runs"))).toBe(true);
  });
});

describe("the direct arm's answer, applied", () => {
  it("writes the last line, trimmed, to an answer file", () => {
    expect(lastLine("Let me think.\n\nThe pen costs 0.15 dollars.\n  0.15  \n\n")).toBe("0.15");
    expect(directWrite({ answerFile: "answer.txt" }, "work\n16")).toEqual({ path: "answer.txt", content: "16\n" });
  });

  it("writes the last code block, or the whole reply when there is none, to a file", () => {
    const reply = "First try:\n```python\nx = 1\n```\nBetter:\n```python\nx = 2\n```\n";
    expect(lastCodeBlock(reply)).toBe("x = 2\n");
    expect(directWrite({ file: "a.py" }, reply)).toEqual({ path: "a.py", content: "x = 2\n" });
    expect(directWrite({ file: "a.py" }, "x = 3")).toEqual({ path: "a.py", content: "x = 3" });
  });

  it("tells the model what will be done with its answer", async () => {
    const loaded = await loadSpec(s.spec);
    const prompt = directPrompt(loaded.taskSet.tasks[0]!);
    expect(prompt).toContain("Write hello.txt containing hi");
    expect(prompt).toContain("You have no tools");
    expect(prompt).toContain("will be written to hello.txt for you");
  });
});
