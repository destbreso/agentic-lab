// The live view over time, on a clock the test turns: while a model call is
// pending no event arrives, and the frames still change (the spinner, the
// clock, the elapsed time on the status line). Pinned as text frames. The
// terminal is put on the alternate screen when the view starts and given back,
// once, when it stops.

import { describe, it, expect } from "vitest";
import { getRecipe, type SessionEvent } from "@agentic-lab/core";
import { LiveView } from "./live-view.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

function view(width = 120, rows?: number) {
  let now = 1_000_000;
  let tick: (() => void) | null = null;
  const writes: string[] = [];
  const frames: Array<{ at: number; event: string; text: string }> = [];
  const v = new LiveView(getRecipe("exec-eval")!, {
    write: (t) => writes.push(t),
    inPlace: true,
    color: false,
    width,
    ...(rows ? { rows } : {}),
    model: "qwen2.5:7b",
    clock: () => now,
    every: (fn) => {
      tick = fn;
      return { stop: () => (tick = null) };
    },
    onFrame: (f) => frames.push({ at: f.at, event: f.event, text: f.text }),
  });
  return {
    v,
    writes,
    frames,
    advance(ms: number) {
      now += ms;
      tick?.();
    },
    at: () => now,
    ticking: () => tick !== null,
  };
}

const start = (_at: number): SessionEvent[] => [
  {
    type: "run:start",
    runId: "r1",
    topology: { id: "exec-eval", name: "Execute & Evaluate" },
    task: "write RESULT.txt",
    roles: [
      { id: "exec", name: "Executor", category: "execution", callCap: 20 },
      { id: "eval", name: "Evaluator", category: "evaluation" },
    ],
    order: ["exec", "eval"],
    wayBacks: [{ from: "eval", to: "exec" }],
    activatedSkills: [],
    checks: [],
    consults: [],
    limits: { rounds: 5 },
  },
  { type: "round:start", round: 1, startAt: "exec" },
  { type: "role:start", round: 1, role: "exec", name: "Executor", category: "execution" },
] as SessionEvent[];

describe("the live view over time", () => {
  it("keeps drawing while a model call is pending: the spinner turns and the clock runs", async () => {
    const t = view();
    t.v.start();
    for (const e of start(t.at())) t.v.event(e, t.at());
    const pinned: string[] = [];
    // No event for two and a half seconds: Do's first model call is pending.
    for (let i = 1; i <= 20; i++) {
      t.advance(125);
      if ([1, 4, 8, 20].includes(i)) pinned.push(`── after ${i * 125} ms\n${t.frames.at(-1)!.text}`);
    }
    // The call ends, with a tool call: the box counts it against Do's cap.
    t.v.event({ type: "call", round: 1, role: "exec", name: "Executor", seq: 1, tools: ["file_read"], tokens: { inputTokens: 900, outputTokens: 40, totalTokens: 940 }, durationMs: 2500 }, t.at());
    pinned.push(`── after the call ends\n${t.frames.at(-1)!.text}`);
    await expect(pinned.join("\n\n")).toMatchFileSnapshot("./__frames__/pending-call.txt");

    const clockFrames = t.frames.filter((f) => f.event === "clock");
    expect(clockFrames).toHaveLength(20);
    expect(new Set(clockFrames.map((f) => f.text)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(clockFrames.map((f) => / (\d\d:\d\d)$/m.exec(f.text)?.[1]))).toEqual(new Set(["00:00", "00:01", "00:02"]));
    // Every redraw went to the terminal in place: from the top, inside a synchronized update.
    const paints = t.writes.filter((w) => w.startsWith("\x1b[?2026h\x1b[H"));
    expect(paints.length).toBeGreaterThanOrEqual(24);
    expect(t.writes.join("")).not.toContain("\x1b[2J");
  });

  it("puts the terminal on the alternate screen, and gives it back once, leaving the last frame", () => {
    const t = view();
    t.v.start();
    expect(t.writes[0]).toBe("\x1b[?1049h\x1b[?25l");
    for (const e of start(t.at())) t.v.event(e, t.at());
    t.v.stop();
    t.v.stop();
    t.v.restore();
    const all = t.writes.join("");
    expect(all.split("\x1b[?25h\x1b[?1049l")).toHaveLength(2);
    expect(t.ticking()).toBe(false);
    // After the alternate screen, the last frame is written once more, so it stays in the scrollback.
    expect(strip(all.slice(all.indexOf("\x1b[?1049l")))).toContain("Execute & Evaluate");
  });

  it("gives the terminal back when the process exits without stopping the view", () => {
    const t = view();
    t.v.start();
    const before = t.writes.length;
    process.emit("exit", 1);
    expect(t.writes.slice(before).join("")).toContain("\x1b[?25h\x1b[?1049l");
  });

  it("fits the rows it is given, and follows a resize", () => {
    const t = view(100, 18);
    t.v.start();
    for (const e of start(t.at())) t.v.event(e, t.at());
    const lines = (s: string) => strip(s).split("\r\n");
    const last = () => t.writes.filter((w) => w.startsWith("\x1b[?2026h")).at(-1)!;
    // Full screen: exactly the rows it has, the footer on the last two.
    expect(lines(last())).toHaveLength(18);
    expect(lines(last()).at(-2)).toMatch(/^\$ agentic-lab/);
    t.v.resize(60, 30);
    for (const l of lines(last())) expect([...l].length).toBeLessThanOrEqual(60);
  });
});
