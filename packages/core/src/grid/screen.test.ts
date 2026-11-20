// The screen a terminal shows of a run: the grid, a consulted role's rail,
// the log and the status line, pinned as text at rest, mid-run with a
// consult, finished, and in a replay rebuilt from the run's step records.
// Every number on it is one the engine reported, and a bar is drawn only for
// a count with a measured limit.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopologyRun, type RunEvent } from "../engine/topology-run.js";
import { eventsFromSteps } from "../engine/replay-events.js";
import { getRecipe } from "../loops/recipes.js";
import { BUILT_IN_TOPOLOGIES } from "../formats/builtin.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { InMemoryStorage } from "../storage/memory.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import type { Topology } from "../formats/model.js";
import { drawingOf, foldRun, footer, initialRunState, meaningsOf, screen, toText, reduceRun, type RunState } from "./index.js";

let dir: string | null = null;
const workspace = async () => (dir ??= await mkdtemp(join(tmpdir(), "screen-")));
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** A check runner that passes both checks, without running anything. */
const passingChecks = {
  capture: async () => {},
  run: async ({ label }: { label: string }) => ({ label, passed: true, results: [{ name: "a", kind: "command", passed: true, exitCode: 0, output: "", durationMs: 1 }, { name: "b", kind: "command", passed: true, exitCode: 0, output: "", durationMs: 1 }] }),
} as unknown as import("../tasks/types.js").CheckRunner;

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["the output is wrong"], corrections: ["fix it"], confidence: 0.5 });

/** A run on a scripted model: Check fails once, Decide refines once, Do consults once and writes a file. */
async function recordedRun(t: Topology, extra: { tokenBudget?: number; checks?: boolean } = {}) {
  let checkTurns = 0;
  let decides = 0;
  const provider = scriptedProvider((call) => {
    if (call.system.startsWith("You are an advisor")) return "Read the tests first, then the file.";
    if (call.role === "check") return ++checkTurns === 1 ? FAIL : undefined;
    if (call.role === "decide") return ++decides === 1 ? JSON.stringify({ decision: "refine", reason: "not yet", corrections: ["again"] }) : undefined;
    if (call.role === "do" && call.tools.includes("consult_advisor") && !call.prompt.includes("Read the tests first")) {
      return { toolCalls: [{ name: "consult_advisor", arguments: { question: "Is the hyphen the separator?" } }] };
    }
    // Do's first call of a turn asks for a tool; once it has a tool's result, it answers.
    if (call.role === "do" && !call.options.messages.some((m) => m.role === "tool")) return { toolCalls: [{ name: "glob", arguments: { pattern: "*.md" } }] };
    return undefined;
  });
  const events: RunEvent[] = [];
  const storage = new InMemoryStorage();
  await storage.init();
  const { checks, ...config } = extra;
  const session = new TopologyRun({
    provider,
    tools: createDefaultToolkit(),
    topology: t,
    workingDir: await workspace(),
    delayMs: 0,
    maxRounds: 3,
    storage,
    ...config,
    ...(checks ? { checkRunner: () => passingChecks } : {}),
  });
  session.on("event", (e) => events.push(e));
  const run = await session.run(checks ? { task: "the task", checks: [{ name: "a", kind: "command", command: "true" }, { name: "b", kind: "command", command: "true" }] } : "the task");
  return { events, run, steps: await storage.steps.getSteps(run.runId) };
}

/** The state after the first event that matches, on a clock that ticks a second an event. */
function stateAt(events: RunEvent[], until: (e: RunEvent) => boolean): RunState {
  const end = events.findIndex(until);
  let t = 0;
  return foldRun(end < 0 ? events : events.slice(0, end + 1), () => (t += 1000));
}

const section = (title: string, body: string) => `## ${title}\n\n${body}\n`;
const lines = (text: string) => text.split("\n");
const widest = (text: string) => Math.max(...lines(text).map((l) => [...l].length));

const SIZES: Array<[number, number]> = [
  [150, 47],
  [120, 30],
  [80, 24],
  [80, 12],
];
const at = (w: number, h: number) => `${w}x${h}`;

describe("the screen", () => {
  it("draws the Advisor in fixed regions at every size: its rail, its log, its footer", async () => {
    // The Advisor sees the caller's question too, so the rail has a reason to show.
    const t = structuredClone(getRecipe("advisor")!) as Topology;
    t.consults[0].sees = [...t.consults[0].sees, "question"];
    const d = drawingOf(t, { model: "qwen2.5:7b", source: "topologies/advisor.yaml" });
    const { events } = await recordedRun(t);
    const asking = stateAt(events, (e) => e.type === "consult:start");
    const end = stateAt(events, () => false);
    const command = "jig run --topology advisor --model qwen2.5:7b";
    const out: string[] = [];
    for (const [w, h] of SIZES) {
      const rest = screen(d, initialRunState(0), { width: w, rows: h, command: "jig show advisor" });
      out.push(section(`at rest, ${at(w, h)}: rail ${rest.rail}, log ${rest.log}`, toText(rest.grid)));
      const mid = screen(d, asking, { width: w, rows: h, command, logHints: "⇡⇣ PgUp PgDn End" });
      out.push(section(`consulting, ${at(w, h)}: rail ${mid.rail}, log ${mid.log}`, toText(mid.grid)), section("its run colours", meaningsOf(mid.grid)));
      out.push(section(`finished, ${at(w, h)}`, toText(screen(d, end, { width: w, rows: h, command }).grid)));
    }
    out.push(section("finished, the scrollback: the drawing, the whole log, the footer", toText(screen(d, end, { width: 120, logLines: "all", command }).grid)));
    await expect(out.join("\n")).toMatchFileSnapshot("./__screen__/advisor.txt");

    // The rail says only what the engine reported: who asked, why, what it read, the advice marked as written.
    const rail = toText(screen(d, stateAt(events, (e) => e.type === "consult:end"), { width: 150, rows: 47 }).grid);
    expect(rail).toContain("r1 Do asked: Is the hyphen the");
    expect(rail).toContain("separator?");
    expect(rail).toMatch(/1 call ∙ read \d+ tokens/);
    expect(rail).toContain("❝ last advice (written)");
    expect(rail).toContain("Read the tests first, then");
  });

  it("draws Deep Reasoning mid-run at every size, with the log beside a wide drawing and a ticker in a short one", async () => {
    const t = getRecipe("deep-reasoning")!;
    const d = drawingOf(t, { model: "qwen2.5:7b" });
    const { events } = await recordedRun(t);
    let seen = 0;
    const mid = stateAt(events, (e) => e.type === "role:start" && e.round === 2 && ++seen === 1);
    const command = "jig run --topology deep-reasoning --model qwen2.5:7b";
    const out: string[] = [];
    for (const [w, h] of [...SIZES, [210, 40] as [number, number], [80, 5] as [number, number], [80, 2] as [number, number]]) {
      const sc = screen(d, mid, { width: w, rows: h, command });
      const text = toText(sc.grid);
      expect(widest(text), at(w, h)).toBeLessThanOrEqual(w);
      expect(lines(text).length, at(w, h)).toBeLessThanOrEqual(h);
      out.push(section(`round 2, ${at(w, h)}: ${sc.layout}, log ${sc.log}${sc.tooSmall ? ", too small" : ""}`, text));
    }
    await expect(out.join("\n")).toMatchFileSnapshot("./__screen__/deep-reasoning.txt");
    expect(screen(d, mid, { width: 210, rows: 40 }).log).toBe("beside");
    expect(screen(d, mid, { width: 80, rows: 5 }).log).toBe("ticker");
    const small = screen(d, mid, { width: 80, rows: 2 });
    expect(small.tooSmall).toBe(true);
    expect(lines(toText(small.grid))[0]).toBe("Deep Reasoning: the terminal is 80x2; drawing it needs 3 rows");
  });

  it("keeps the drawing where it is, whatever the log holds or shows: the log never pushes it", async () => {
    for (const id of BUILT_IN_TOPOLOGIES) {
      const t = getRecipe(id)!;
      const d = drawingOf(t, { model: "m" });
      const { events } = await recordedRun(t);
      const s = stateAt(events, (e) => e.type === "role:start");
      // The same state, with a long log: hundreds of lines more.
      const long: RunState = { ...s, log: [...s.log, ...Array.from({ length: 300 }, (_, i) => ({ at: 1000 * i, e: { type: "round:start" as const, round: 1, startAt: d.roles[0].id } }))] };
      for (const [w, h] of SIZES) {
        const a = screen(d, s, { width: w, rows: h });
        const b = screen(d, long, { width: w, rows: h });
        const scrolled = screen(d, long, { width: w, rows: h, logEnd: 40 });
        for (const sc of [a, b, scrolled]) expect(lines(toText(sc.grid)).length, `${id} ${at(w, h)}`).toBe(h);
        const top = (sc: typeof a) => lines(toText(sc.grid)).slice(0, h - 2).filter((l) => !/^\d\d:\d\d |^── log|^$/.test(l) && !l.includes("── log"));
        // Every row above the footer that is not the log's is the same in all three.
        if (a.log === "below") {
          const rows = (sc: typeof a) => lines(toText(sc.grid)).slice(0, lines(toText(sc.grid)).findIndex((l) => l.startsWith("── log")));
          expect(rows(b), `${id} ${at(w, h)}`).toEqual(rows(a));
          expect(rows(scrolled), `${id} ${at(w, h)}`).toEqual(rows(a));
        } else expect(top(b).length).toBeGreaterThan(0);
        // The footer is the last two rows.
        expect(lines(toText(b.grid)).at(-2)).toMatch(/^\$ jig/);
      }
    }
  });

  it("scrolls the log back without moving the drawing, and counts the lines that came after", async () => {
    const t = getRecipe("deep-reasoning")!;
    const d = drawingOf(t, { model: "m" });
    const { events } = await recordedRun(t);
    const s = stateAt(events, () => false);
    const following = screen(d, s, { width: 150, rows: 40 });
    const back = screen(d, s, { width: 150, rows: 40, logEnd: 10 });
    expect(back.logView).toMatchObject({ end: 10 });
    const border = lines(toText(back.grid)).find((l) => l.startsWith("── log"))!;
    expect(border).toMatch(new RegExp(`lines 1 to 10 of ${following.logView!.total} ∙ ${following.logView!.total - 10} new below`));
    const drawing = (sc: typeof back) => lines(toText(sc.grid)).slice(0, lines(toText(sc.grid)).findIndex((l) => l.startsWith("── log")));
    expect(drawing(back)).toEqual(drawing(following));
  });

  it("pins a two-line footer: the command, then each role's state in brackets and the run's figures", async () => {
    const t = getRecipe("advisor")!;
    const d = drawingOf(t, { model: "qwen2.5:7b" });
    const dr = getRecipe("deep-reasoning")!;
    const dd = drawingOf(dr, { model: "qwen2.5:7b" });
    const advisor = await recordedRun(t, { checks: true });
    const deep = await recordedRun(dr, { tokenBudget: 40_000 });
    const out: string[] = [];
    const cases: Array<[string, typeof d, RunState, Parameters<typeof footer>[3]]> = [
      ["at rest", dd, initialRunState(0), { command: "jig show deep-reasoning" }],
      ["live, Do working", dd, stateAt(deep.events, (e) => e.type === "call" && e.role === "exec"), { command: "jig run --topology deep-reasoning.yaml --model qwen2.5:7b --token-budget 40000" }],
      ["live, the Advisor consulted", d, stateAt(advisor.events, (e) => e.type === "consult:start"), { command: "jig run --topology advisor --task-file task.json" }],
      ["live, finished with its checks", d, stateAt(advisor.events, () => false), { command: "jig run --topology advisor --task-file task.json" }],
      ["play", dd, stateAt(deep.events, (e) => e.type === "role:end" && e.role === "eval"), { command: "jig show deep-reasoning --play", dry: true, extra: "▸ dry run ∙ space pauses ∙ q quits" }],
      ["replay, paused", dd, stateAt(deep.events, (e) => e.type === "round:end"), { command: "jig replay run-1795038574182-ZGVTR1 --speed 4", extra: "event 12 of 21 ∙ 00:30 of 00:42 ▰▰▰▰▰▰▰▱▱▱ ∙ ¦ paused ∙ space plays ∙ ⇢ steps" }],
    ];
    for (const [name, dr_, s, o] of cases) {
      for (const w of [150, 80]) {
        const text = toText(footer(dr_, s, w, o));
        expect(widest(text), `${name} at ${w}`).toBeLessThanOrEqual(w);
        expect(lines(text)).toHaveLength(2);
        out.push(section(`${name}, ${w} columns`, text));
      }
    }
    await expect(out.join("\n")).toMatchFileSnapshot("./__screen__/footer.txt");
    const live = toText(footer(dd, stateAt(deep.events, (e) => e.type === "call" && e.role === "exec"), 150, {}));
    // Measured counts only: Do's model calls against its cap, the budget, the round against its limit.
    expect(live).toMatch(/do qwen2\.5 \[running 1\/20\]/);
    expect(live).toMatch(/round \[1\/3\]  tokens \[\d+\/40k\]/);
    const done = toText(footer(d, stateAt(advisor.events, () => false), 150, {}));
    expect(done).toMatch(/check ▪ \[2\/2 passing\]/);
    expect(done).toMatch(/advisor qwen2\.5 \[on call 1\/3\]/);
  });

  it("abbreviates the footer at 80 columns in the order the bracket form allows, and never wraps", async () => {
    for (const id of BUILT_IN_TOPOLOGIES) {
      const t = getRecipe(id)!;
      const d = drawingOf(t, { model: "a-model-with-a-long-name:70b-instruct-q4" });
      const { events } = await recordedRun(t);
      for (const s of [initialRunState(0), stateAt(events, (e) => e.type === "role:start"), stateAt(events, () => false)]) {
        for (const width of [80, 60, 40]) {
          const text = toText(footer(d, s, width, { command: `jig run --topology ${id} --model a-model-with-a-long-name:70b-instruct-q4` }));
          expect(widest(text), `${id} at ${width}`).toBeLessThanOrEqual(width);
          expect(lines(text)[1]).toMatch(/\[/);
          // A name is whole or absent, never cut to a stub, and every role shown has its glyph.
          expect(lines(text)[1]).not.toMatch(/\b(crit|deci|advi|chec|plan\w|memo)\b/);
          for (const r of d.roles) if (lines(text)[1].includes(` ${r.label.toLowerCase()} [`)) expect(lines(text)[1]).toContain(`${r.icon} ${r.label.toLowerCase()}`);
        }
      }
    }
  });

  it("draws a bar only for a count with a measured limit", async () => {
    const t = getRecipe("exec-eval")!;
    const d = drawingOf(t, { model: "m" });
    const plain = await recordedRun(t);
    // A turn's model calls against its cap, in its box.
    const calling = stateAt(plain.events, (e) => e.type === "call" && e.role === "exec");
    expect(toText(screen(d, calling, { width: 140, rows: 30 }).grid)).toMatch(/[▰▱]{2,} 1\/20/);
    // The Check role, which has no cap, never gets one.
    const checking = stateAt(plain.events, (e) => e.type === "call" && e.role === "eval");
    expect(toText(screen(d, checking, { width: 140, rows: 30 }).grid)).not.toMatch(/[▰▱]+ \d+\/\d+\s*│\s*$/m);
    // A topology with no round limit says so instead of a count against one.
    const unlimited = reduceRun(initialRunState(0), { ...(plain.events[0] as Extract<RunEvent, { type: "run:start" }>), limits: { rounds: 0 } }, 0);
    expect(toText(footer({ ...d, limit: 0, deciderLimit: undefined }, unlimited, 140))).toContain("round [1, no limit]");
  });
});

describe("a replay from the step records", () => {
  it.each(["advisor", "deep-reasoning", "exec-eval"])("%s: the events rebuilt from the steps fold to the state the live run reached", async (id) => {
    const t = getRecipe(id)!;
    const { events, run, steps } = await recordedRun(t);
    const timed = eventsFromSteps(steps, { runId: run.runId, topology: t, task: "the task", outcome: run.outcome, reason: run.reason });
    let n = 0;
    const live = foldRun(events, () => (n += 1000));
    const replay = timed.reduce((s, e) => reduceRun(s, e.event, e.at), initialRunState(timed[0].at));
    expect(replay.rounds).toEqual(live.rounds);
    expect(replay.results).toEqual(live.results);
    expect(replay.outcome?.outcome).toBe(live.outcome?.outcome);
    expect(replay.tokens).toBe(live.tokens);
    expect(replay.consultations.map((c) => [c.round, c.from, c.to, c.question, c.read])).toEqual(live.consultations.map((c) => [c.round, c.from, c.to, c.question, c.read]));
    expect(replay.advice).toEqual(live.advice);
    // The same turns and calls, in the same order: the log a replay shows is the live run's.
    const shape = (s: RunState) => s.log.filter((l) => ["role:start", "role:end", "call", "consult:start", "consult:end", "round:start"].includes(l.e.type)).map((l) => `${l.e.type}:${"role" in l.e ? l.e.role : "to" in l.e ? l.e.to : ""}`);
    expect(shape(replay).join("\n")).toBe(shape(live).join("\n"));
  });

  it("draws the Advisor's replay mid-way and at its end", async () => {
    const t = getRecipe("advisor")!;
    const { run, steps } = await recordedRun(t);
    // Times rebuilt from the records are real; the snapshot gives each event a second.
    const timed = eventsFromSteps(steps, { runId: run.runId, topology: t, task: "the task", outcome: run.outcome, reason: run.reason }).map((e, i) => ({ ...e, at: i * 1000 }));
    const d = drawingOf(t, { model: "qwen2.5:7b" });
    const upTo = (k: number) => timed.slice(0, k).reduce((s, e) => reduceRun(s, e.event, e.at), initialRunState(0));
    const consulted = timed.findIndex((e) => e.event.type === "consult:end") + 1;
    await expect(
      [section("replay, up to the consultation", toText(screen(d, upTo(consulted), { width: 140, logLines: 10 }).grid)), section("replay, at its end", toText(screen(d, upTo(timed.length), { width: 140, logLines: 14 }).grid))].join("\n"),
    ).toMatchFileSnapshot("./__screen__/advisor-replay.txt");
  });
});
