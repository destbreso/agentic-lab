// The session on Ink's test renderer: a message runs as a task and its answer
// streams in under it, the grid and the footer are drawn, slash commands
// complete and act, a command off a role's list waits for your answer,
// typing during a run steers it, Esc stops it, a past run replays on the same
// screen, and a session is kept and resumed. Also the editor and the keys.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "./app.js";
import { SessionController, savedSessions } from "./controller.js";
import { edit, emptyEditor, type EditorState } from "./editor.js";
import { decode } from "./keys.js";
import { toAscii } from "./ascii.js";
import { cells, indicatorCells, poseOf, poseRows, theme, type IndicatorState } from "./theme.js";
import { headerLines } from "./lines.js";
import { startupModeFor } from "./start.js";
import data from "./jig-theme.json" with { type: "json" };
import { scriptedModels, type ScriptOptions } from "../test-support/session-models.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jig-session-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const strip = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const until = async (what: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
};

async function open(script: ScriptOptions = {}, settings: ConstructorParameters<typeof SessionController>[0]["settings"] = {}, size = { columns: 120, rows: 40 }) {
  const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(script), storage: null, settings });
  await ctrl.load();
  const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={size} fps={50} />);
  const frame = () => strip(app.lastFrame());
  const type = async (text: string) => {
    app.stdin.write(text);
    await new Promise((r) => setTimeout(r, 30));
  };
  return { ctrl, app, frame, type };
}

describe("the session screen", () => {
  it("opens on the topology's grid, Jig at rest with its name, and the two-line footer with the idle mark", async () => {
    const { frame, app } = await open();
    expect(frame()).toMatch(/Do\b/);
    expect(frame()).toContain(theme.logo.large.unicode[0].trim());
    expect(frame()).toContain("joint inference graph");
    expect(frame()).toMatch(/No task yet\. Type one, and Execute & Evaluate runs it: Do, Check\./);
    const rows = frame().split("\n");
    expect(rows.at(-2)).toMatch(/^▞▚  ready · exec-eval · 2 roles · scripted\/scripted-a/);
    expect(rows.at(-1)).toMatch(/> do \S* ?\[ready\]/);
    expect(rows.length).toBeLessThanOrEqual(39);
    app.unmount();
  });

  it("runs a message as a task: the answer streams in, the run ends with its outcome, and the grid shows where it is", async () => {
    const { frame, type, ctrl, app } = await open({ answer: "Written word by word, the answer.", delayMs: 40 });
    await type("write hello.txt\r");
    await until(() => ctrl.running !== null);
    await until(() => /Written word/.test(frame()));
    await until(() => ctrl.running === null);
    await until(() => /✓ passed|■ inconclusive|✗ failed/.test(frame()));
    expect(frame()).toContain("› write hello.txt");
    expect(frame()).toContain("Written word by word, the answer.");
    expect(ctrl.messages.at(-1)).toMatchObject({ kind: "run", outcome: expect.any(String), text: "Written word by word, the answer." });
    expect(existsSync(join(dir, ".jig", "runs", (ctrl.messages.at(-1) as { runId: string }).runId, "steps.json"))).toBe(true);
    app.unmount();
  });

  it("passes the conversation so far to the next task", async () => {
    const models = scriptedModels({ answer: "first answer" });
    const seen: string[] = [];
    const wrapped = { ...models, provider: (ref: string) => {
      const p = models.provider(ref);
      return { ...p, chat: (o: Parameters<typeof p.chat>[0]) => (seen.push(o.messages.map((m) => m.content).join("\n")), p.chat(o)) };
    } };
    const ctrl = new SessionController({ workingDir: dir, models: wrapped, storage: null });
    await ctrl.load();
    await ctrl.send("the first task");
    seen.length = 0;
    await ctrl.send("the second task");
    expect(seen.some((s) => s.includes("Earlier in this conversation") && s.includes("you: the first task") && s.includes("first answer"))).toBe(true);
  });

  it("completes slash commands and their arguments with Tab, and /help lists them", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("/to");
    await until(() => /▸ topology/.test(frame()));
    await type("\t");
    await until(() => /› \/topology\s*$/m.test(frame()));
    await type("advi");
    await until(() => /▸ advisor/.test(frame()));
    await type("\t\r");
    await until(() => ctrl.topology?.id === "advisor");
    await until(() => /✦ Advisor/.test(frame()));
    await type("/help\r");
    await until(() => /\/checks/.test(frame()) && /\/replay/.test(frame()));
    app.unmount();
  });

  it("switches a role's model with /models, and the box and the footer say it", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("/models exec scripted/scripted-b\r");
    await until(() => ctrl.settings.roleModels.exec === "scripted/scripted-b");
    await until(() => /scripted-b/.test(frame()));
    await type("/models exec nowhere/x\r");
    await until(() => /no provider named nowhere/.test(frame()));
    app.unmount();
  });

  it("puts a command off Do's list to you: 1 allows it once, and the run goes on", async () => {
    const { frame, type, ctrl, app } = await open({ shell: "node -e 'console.log(6 * 7)'" });
    await type("compute it\r");
    await until(() => ctrl.approvals.length === 1);
    await until(() => /asks to run node -e/.test(frame()) && /1 allow once/.test(frame()));
    expect(frame()).toMatch(/\[waiting for you\]/);
    await type("1");
    await until(() => ctrl.running === null);
    const exec = JSON.parse(await readFile(join(dir, ".jig", "runs", (ctrl.messages.at(-1) as { runId: string }).runId, "steps.json"), "utf-8")).find((s: { role: string }) => s.role === "exec");
    expect(exec.toolCalls[0].result).toBe("42\n");
    expect(ctrl.allowed.size).toBe(0);
    app.unmount();
  });

  it("allows a command for the session with 2, and denies with 3", async () => {
    const { type, ctrl, app } = await open({ shell: "node -e 'console.log(1)'" });
    await type("first\r");
    await until(() => ctrl.approvals.length === 1);
    await type("2");
    await until(() => ctrl.running === null);
    expect([...ctrl.allowed]).toEqual(["node -e 'console.log(1)'"]);
    const runs = () => ctrl.messages.filter((m) => m.kind === "run" && m.outcome).length;
    await type("second\r");
    await until(() => runs() === 2).catch((e) => {
      throw new Error(`${e.message}: ${JSON.stringify(ctrl.messages.map((m) => [m.kind, "outcome" in m ? m.outcome : ""]))} approvals ${ctrl.approvals.length}`);
    });
    expect(ctrl.approvals.length).toBe(0);
    ctrl.allowed.clear();
    await type("third\r");
    await until(() => ctrl.approvals.length === 1).catch((e) => {
      throw new Error(`third: ${e.message}: ${JSON.stringify(ctrl.messages.map((m) => [m.kind, "outcome" in m ? m.outcome : "", "text" in m ? m.text.slice(0, 40) : ""]))}`);
    });
    await type("3");
    await until(() => ctrl.running === null);
    const runId = (ctrl.messages.at(-1) as { runId: string }).runId;
    const exec = JSON.parse(await readFile(join(dir, ".jig", "runs", runId, "steps.json"), "utf-8")).find((s: { role: string }) => s.role === "exec");
    expect(exec.toolCalls[0].result).toMatch(/did not allow it/);
    app.unmount();
  });

  it("steers a run with what is typed during it, and Esc stops it", async () => {
    const { frame, type, ctrl, app } = await open({ delayMs: 300 });
    await type("a long task\r");
    await until(() => ctrl.running !== null);
    await type("use the short form\r");
    await until(() => /a note for Do: use the short form/.test(frame()));
    await type("\x1b");
    await until(() => ctrl.running === null, 6000);
    expect(ctrl.messages.filter((m) => m.kind === "run").at(-1)).toMatchObject({ kind: "run", outcome: "stopped" });
    app.unmount();
  });

  it("folds the topology to its strip with Ctrl+T", async () => {
    const { frame, type, app } = await open();
    expect(frame()).toMatch(/┌/);
    await type("\x14");
    await until(() => /\[> Do\]/.test(frame()));
    app.unmount();
  });

  it("replays a past run on the same screen, and /runs lists it", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("a task to keep\r");
    await until(() => ctrl.running === null && Boolean((ctrl.messages.at(-1) as { runId?: string }).runId));
    const runId = (ctrl.messages.at(-1) as { runId: string }).runId;
    await type("/runs\r");
    await until(() => frame().includes(runId));
    await type(`/replay ${runId} 50\r`);
    await until(() => ctrl.replay !== null);
    await until(() => Boolean(ctrl.replay?.finished));
    await until(() => /replay run-.* · the end/.test(frame()));
    await type("\x1b");
    await until(() => ctrl.replay === null);
    app.unmount();
  });

  it("keeps the session, and a new controller resumes it with its conversation and settings", async () => {
    const { type, ctrl, app } = await open();
    await type("/budget 40k\r");
    await type("remember this task\r");
    await until(() => ctrl.running === null && ctrl.messages.some((m) => m.kind === "run" && m.outcome));
    app.unmount();
    const [saved] = await savedSessions(dir);
    expect(saved.id).toBe(ctrl.id);
    expect(saved.settings.tokenBudget).toBe(40000);
    const again = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null, resume: saved });
    await again.load();
    expect(again.id).toBe(ctrl.id);
    expect(again.messages.some((m) => m.kind === "you" && m.text === "remember this task")).toBe(true);
    await expect(readFile(join(dir, ".jig", ".gitignore"), "utf-8")).resolves.toMatch(/^\*$/m);
  });

  it("draws in ASCII and with no styles when asked", async () => {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 100, rows: 30 }} ascii plain />);
    const raw = app.lastFrame() ?? "";
    expect(raw).not.toMatch(/\x1b\[/);
    expect([...raw].filter((ch) => ch.charCodeAt(0) >= 128).join("")).toBe("");
    app.unmount();
  });
});

describe("the input", () => {
  const keys = (s: EditorState, ...ks: Parameters<typeof edit>[1][]) => ks.reduce((st, k) => edit(st, k).state, s);
  it("sends on Enter, starts a new line on Alt+Enter, Ctrl+J or a backslash, and keeps a paste whole", () => {
    let s = keys(emptyEditor(), { kind: "text", text: "one" }, { kind: "newline" }, { kind: "text", text: "two\\" }, { kind: "enter" }, { kind: "paste", text: "three\r\nfour" });
    expect(s.text).toBe("one\ntwo\nthree\nfour");
    const r = edit(s, { kind: "enter" });
    expect(r.submitted).toBe("one\ntwo\nthree\nfour");
    s = r.state;
    expect(s.text).toBe("");
    expect(s.history).toEqual(["one\ntwo\nthree\nfour"]);
  });

  it("walks the history past the first and last lines, and keeps the draft", () => {
    let s = emptyEditor(["first", "second"]);
    s = keys(s, { kind: "text", text: "draft" }, { kind: "up" });
    expect(s.text).toBe("second");
    s = keys(s, { kind: "up" });
    expect(s.text).toBe("first");
    s = keys(s, { kind: "down" }, { kind: "down" });
    expect(s.text).toBe("draft");
  });

  it("edits as a shell does: home, end, words, kills", () => {
    let s = keys(emptyEditor(), { kind: "text", text: "hello big world" }, { kind: "word-left" }, { kind: "kill-word" });
    expect(s.text).toBe("hello world");
    s = keys(s, { kind: "home" }, { kind: "kill-end" });
    expect(s.text).toBe("");
  });

  it("decodes what a terminal sends: a bracketed paste, a paste without it, Alt+Enter, Ctrl keys", () => {
    expect(decode("\x1b[200~")).toEqual([{ kind: "paste-start" }]);
    expect(decode("line one\rline two", true)).toEqual([{ kind: "paste", text: "line one\rline two" }]);
    expect(decode("line one\rline two")).toEqual([{ kind: "paste", text: "line one\rline two" }]);
    expect(decode("\r")).toEqual([{ kind: "enter" }]);
    expect(decode("\x1b\r")).toEqual([{ kind: "newline" }]);
    expect(decode("\x14")).toEqual([{ kind: "ctrl", letter: "t" }]);
    expect(decode("ab\x7f")).toEqual([{ kind: "text", text: "ab" }, { kind: "backspace" }]);
  });

  it("has an ASCII twin for every glyph the grid draws", () => {
    const glyphs = "┌─┐│└┘▶◉●○⇅↺✓✗■“›‖⚑▰▱☰⊢◆✦";
    expect([...toAscii(glyphs)].every((ch) => ch.charCodeAt(0) < 128 && ch !== "?")).toBe(true);
  });
});

describe("Jig's identity", () => {
  const meanings = new Set(["ink", "ln", "dim", "faint", "b", "run", "you", "fail", "pass", ""]);
  type Frame = { unicode: string[]; meanings: string[]; ascii: string[] };
  const theData = data as unknown as {
    cellMeanings: Record<string, string>;
    logo: Record<string, Frame & { cols: number }>;
    startup: { cols: number; frames: Frame[] };
    character: Record<string, { cols: number; poses: Record<string, { frames: Frame[] }> }>;
    indicators: Record<string, { width: number; frames: Array<{ unicode: string; meanings: string }>; ascii: Array<{ text: string }>; settle?: { unicode: string; meanings: string }; asciiSettle?: string }>;
  };

  it("gives every cell a letter that is one of the grid's Meanings, and every row its frame's width, in its glyphs and its ASCII twin", () => {
    for (const [letter, meaning] of Object.entries(theData.cellMeanings)) expect(meanings.has(meaning), letter).toBe(true);
    const check = (name: string, rows: string[], letters: string[], ascii: string[] | null, width: number) => {
      rows.forEach((row, i) => {
        expect([...row].length, `${name} row ${i}`).toBe(width);
        expect([...letters[i]].length, `${name} meanings ${i}`).toBe(width);
        if (ascii) expect([...ascii[i]].length, `${name} ascii ${i}`).toBe(width);
        for (const l of letters[i]) expect(l in theData.cellMeanings, `${name}: "${l}"`).toBe(true);
        if (ascii) expect([...ascii[i]].every((ch) => ch.charCodeAt(0) < 128), `${name} ascii ${i}`).toBe(true);
      });
    };
    for (const size of ["large", "medium"]) {
      const logo = theData.logo[size];
      check(`logo ${size}`, logo.unicode, logo.meanings, logo.ascii, logo.cols);
      for (const [pose, p] of Object.entries(theData.character[size].poses)) p.frames.forEach((f, j) => check(`${size} ${pose} ${j}`, f.unicode, f.meanings, f.ascii, theData.character[size].cols));
    }
    theData.startup.frames.forEach((f, j) => check(`startup ${j}`, f.unicode, f.meanings, f.ascii, theData.startup.cols));
    for (const [name, ind] of Object.entries(theData.indicators)) {
      ind.frames.forEach((f, j) => check(`${name} ${j}`, [f.unicode], [f.meanings], null, ind.width));
      ind.ascii.forEach((a, j) => expect([...a.text].length, `${name} ascii ${j}`).toBe(ind.width));
    }
  });

  it("opens with the startup, which any key skips, and the key does nothing else", async () => {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" startup="animate" size={{ columns: 100, rows: 30 }} fps={50} />);
    const frame = () => strip(app.lastFrame());
    expect(frame()).not.toContain("No task yet");
    expect(frame()).toContain("joint inference graph");
    app.stdin.write("x");
    await until(() => frame().includes("No task yet"));
    expect(frame()).toMatch(/› +a task for the topology/);
    app.unmount();
  });

  it("plays the startup only in a terminal large enough, still under --plain, and never when the config turns it off", () => {
    const base = { tty: true, plain: false, columns: 120, rows: 40, env: {} };
    expect(startupModeFor(base)).toBe("animate");
    expect(startupModeFor({ ...base, tty: false })).toBe("off");
    expect(startupModeFor({ ...base, plain: true })).toBe("static");
    expect(startupModeFor({ ...base, columns: 30 })).toBe("off");
    expect(startupModeFor({ ...base, rows: 12 })).toBe("off");
    expect(startupModeFor({ ...base, config: false })).toBe("off");
    expect(startupModeFor({ ...base, env: { JIG_STARTUP: "off" } })).toBe("off");
  });

  it("puts Jig in the header in the pose of the engine's state, once the conversation has started", async () => {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null });
    await ctrl.load();
    const states: IndicatorState[] = ["idle", "team", "thinking", "working", "tool", "consulting", "waiting", "back", "passed", "failed"];
    for (const state of states) {
      ctrl.activity = state;
      const rows = headerLines(ctrl, "0.1.0", ctrl.activitySince, false, 120).map((l) => l.map(([t]) => t).join("").slice(2, 11));
      expect(rows, state).toEqual(poseRows("medium", poseOf(state), 0, false).map((r) => r.map(([t]) => t).join("")));
    }
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 120, rows: 40 }} fps={50} />);
    await ctrl.send("a task");
    await until(() => ctrl.running === null);
    await until(() => (app.lastFrame() ?? "").includes("jig 0.1.0 ·"));
    app.unmount();
  });

  it("plays a one-shot once and holds its settle frame; a loop goes on", () => {
    const text = (s: Array<[string, string]>) => s.map(([t]) => t).join("");
    expect(text(indicatorCells("passed", 60_000, false))).toBe("✓  ");
    expect(indicatorCells("passed", 60_000, false)[0][1]).toBe("pass");
    expect(text(indicatorCells("failed", 60_000, false))).toBe("✗  ");
    expect(text(indicatorCells("failed", 60_000, true))).toBe("x  ");
    const backFrames = theData.indicators.back.frames;
    expect(text(indicatorCells("back", 60_000, false))).toBe(theData.indicators.back.settle?.unicode ?? backFrames.at(-1)!.unicode);
    for (const pose of ["passed", "failed", "back"] as const) {
      const frames = theData.character.medium.poses[pose].frames;
      expect(poseRows("medium", pose, 60_000, false).map((r) => r.map(([t]) => t).join("")), pose).toEqual(frames.at(-1)!.unicode);
    }
    const idle = theData.indicators.idle.frames;
    const total = 3680 + 160;
    expect(text(indicatorCells("idle", 0, false))).toBe(idle[0].unicode);
    expect(text(indicatorCells("idle", total * 5, false))).toBe(idle[0].unicode);
    expect(text(indicatorCells("idle", total * 5 + 3700, false))).toBe(idle[1].unicode);
  });

  it("draws every cell of the art through the one style table, its letter's Meaning", () => {
    const row = theData.logo.large;
    const segs = cells(row.unicode[5], row.meanings[5]);
    expect(segs.map(([, k]) => k)).toEqual(["ink", "ln", "ink"]);
    expect(segs.every(([, k]) => k in theme.styles)).toBe(true);
  });
});
