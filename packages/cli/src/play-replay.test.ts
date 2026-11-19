// show --play, a dry run on the scripted model, and replay, a recorded run
// played from its step records: both draw the same screen a live run does.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryStorage } from "jig-core";
import { playTopology } from "./commands/play.js";
import { replayRun } from "./commands/replay.js";
import { runTopology, type RunnerIO } from "./session-runner.js";
import { resolveTopology } from "./topology-arg.js";
import { scriptedProvider } from "../../core/src/test-support/scripted-provider.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-play-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
function pipe(): { io: RunnerIO; text: () => string; notes: string[] } {
  const out: string[] = [];
  const notes: string[] = [];
  return { io: { out: (l) => out.push(`${l}\n`), note: (l) => notes.push(l), write: (t) => out.push(t) }, text: () => strip(out.join("")), notes };
}
function terminal(columns = 130, rows = 40) {
  const out: string[] = [];
  return { io: { out: (l: string) => out.push(`${l}\n`), note: () => {}, write: (t: string) => out.push(t), tty: { columns, rows } } as RunnerIO, text: () => out.join("") };
}

describe("show --play", () => {
  it("plays Deep Reasoning on the scripted model: a way back taken, the rounds ticking, no tokens", async () => {
    const p = pipe();
    const { runs } = await playTopology(await resolveTopology("deep-reasoning"), { speed: "100", once: true, width: "140" }, p.io);
    expect(runs).toBe(1);
    const text = p.text();
    // Off a terminal: the log as plain lines, then the final drawing once.
    expect(text).toMatch(/^00:00 run +› your task: A dry run/m);
    expect(text).toContain("round 1 ends: fail ∙ ↺ refine: back to Do");
    expect(text).toContain("round 2 starts at Do");
    expect(text).toContain("model call 1 asks for file_write");
    expect(text).toMatch(/↺ refine: back to Do\s+◉ ◉ ◦/);
    expect(text).toContain("tokens [none, dry run]");
    expect(text).toMatch(/✓ passed after 2 rounds/);
    expect(text).not.toContain("\x1b[H");
  });

  it("plays the Advisor: Do consults it, and the rail shows the consultation", async () => {
    const p = pipe();
    await playTopology(await resolveTopology("advisor"), { speed: "100", once: true, width: "140" }, p.io);
    const text = p.text();
    expect(text).toContain("⇅ asks Advisor");
    expect(text).toContain("r1 Do asked");
    expect(text).toContain("Read the file back before you answer.");
  });

  it("plays the Ralph Loop until its plan is done: two turns", async () => {
    const p = pipe();
    await playTopology(await resolveTopology("ralph-loop"), { speed: "100", once: true, width: "120" }, p.io);
    const text = p.text();
    expect(text).toContain("turn 2 starts at Do");
    expect(text).not.toContain("turn 3 starts");
  });

  it("refuses a speed that is not a positive number", async () => {
    await expect(playTopology(await resolveTopology("exec-eval"), { speed: "0", once: true }, pipe().io)).rejects.toThrow(/--speed/);
  });
});

describe("replay", () => {
  const FAIL = JSON.stringify({ verdict: "fail", evidence: ["e"], corrections: ["c"], confidence: 0.5 });
  async function record(storage: InMemoryStorage | null) {
    let checks = 0;
    const provider = scriptedProvider((c) => (c.role === "check" && ++checks === 1 ? FAIL : undefined));
    return runTopology({ topology: "exec-eval", task: "say hello", dir, delay: "0", live: false }, { out: () => {}, note: () => {} }, { provider, storage, handleSignals: false, skipUnverifiable: false });
  }

  it("plays a run whose storage was in memory, from the steps the CLI kept beside its history", async () => {
    const run = await record(null);
    expect(existsSync(join(dir, ".jig", "runs", run.runId, "steps.json"))).toBe(true);
    const p = pipe();
    const r = await replayRun(run.runId, { dir, width: "120" }, p.io, { storage: null });
    expect(r.from).toBe(join(".jig", "runs", run.runId));
    expect(r.shown).toBe(r.events);
    const text = p.text();
    const log = text.split("\n").filter((l) => /^\d\d:\d\d /.test(l));
    expect(log[0]).toMatch(/run +› your task: say hello/);
    expect(log).toContainEqual(expect.stringMatching(/round 1 ends: fail ∙ ↺ check fails: back to Do/));
    expect(log.at(-1)).toMatch(/run +▪? ?❝? ?passed/);
    expect(text).toMatch(/\$ jig replay run-\S+ ∙ event \d+ of \d+/);
    expect(p.notes.join("\n")).toMatch(/steps from \.jig/);
    const record_ = JSON.parse(await readFile(join(dir, ".jig", "runs", run.runId, "record.json"), "utf-8"));
    expect(record_).toMatchObject({ runId: run.runId, topology: "exec-eval", outcome: "passed", task: "say hello", limits: { rounds: 5 } });
  });

  it("reads the storage the run wrote, when it has the steps", async () => {
    const storage = new InMemoryStorage();
    await storage.init();
    const run = await record(storage);
    const r = await replayRun(run.runId, { dir, width: "120" }, pipe().io, { storage });
    expect(r.from).toBe("the configured storage");
    expect(r.shown).toBe(r.events);
  });

  it("pauses and steps with keys in a terminal", async () => {
    const run = await record(null);
    const t = terminal();
    let press: (k: string) => void = () => {};
    let attached: () => void = () => {};
    const ready = new Promise<void>((r) => (attached = r));
    const done = replayRun(run.runId, { dir, plain: true }, t.io, {
      storage: null,
      keys: (onKey) => {
        press = onKey;
        attached();
        return { stop: () => {} };
      },
    });
    // Paused before the first event, then three steps, then quit.
    await ready;
    press("space");
    for (let i = 0; i < 3; i++) press("right");
    await new Promise((r) => setTimeout(r, 120));
    const shown = strip(t.text());
    press("q");
    const r = await done;
    expect(r.shown).toBe(3);
    expect(shown).toMatch(/\$ jig replay run-\S+ ∙ event 3 of \d+/);
    expect(shown).toContain("¦ paused ∙ space plays");
    expect(t.text()).toContain("\x1b[?25h\x1b[?1049l");
  });

  it("says where it looked when a run left no steps", async () => {
    await expect(replayRun("run-none", { dir }, pipe().io, { storage: null })).rejects.toThrow(/No recorded steps for run-none/);
  });
});
