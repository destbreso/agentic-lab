// The session on Ink's test renderer: a message runs as a task and its answer
// streams in under it, the grid and the footer are drawn, slash commands
// complete and act, a write or a command waits for your permission (with its
// diff, a rule kept, words sent back, the modes on Shift+Tab, /permissions),
// typing during a run steers it, Esc stops it, a past run replays on the same
// screen, and a session is kept and resumed. Also the editor and the keys.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "./app.js";
import { SessionController, pickerItems, savedSessions } from "./controller.js";
import { edit, emptyEditor, type EditorState } from "./editor.js";
import { decode } from "./keys.js";
import { toAscii } from "./ascii.js";
import { cells, indicatorCells, poseOf, poseRows, theme, type IndicatorState } from "./theme.js";
import { footerHead, headerLines } from "./lines.js";
import { startupModeFor } from "./start.js";
import data from "./jig-theme.json" with { type: "json" };
import { scriptedModels, type ScriptOptions } from "../test-support/session-models.js";
import { loadPermissions } from "../permissions.js";

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
  // The person's own config is not read: a test's rules start empty, in the default mode.
  const permissions = { mode: "default" as const, rules: { allow: [], ask: [], deny: [] }, workingDirs: [dir] };
  const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(script), storage: null, settings, skipUnverifiable: false, permissions });
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
    expect(rows.at(-2)).toMatch(/^▞▚ ready · exec-eval · 2 roles · scripted\/scripted-a/);
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

  it("says a plain question was answered, not verified, when nothing changed and there is no check", async () => {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels({ answer: "This folder holds notes." }), storage: null });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 120, rows: 40 }} fps={50} />);
    await ctrl.send("what is this folder?");
    await until(() => strip(app.lastFrame()).includes("answered not verified: nothing changed and no checks"));
    expect(strip(app.lastFrame())).not.toMatch(/■ inconclusive/);
    expect(ctrl.messages.find((m) => m.kind === "run")).toMatchObject({ unverified: "nothing changed and no checks" });
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

  // A run's record is written just after its outcome shows.
  const stepOf = async (ctrl: SessionController, role = "exec") => {
    const file = join(dir, ".jig", "runs", (ctrl.messages.filter((m) => m.kind === "run").at(-1) as { runId: string }).runId, "steps.json");
    await until(() => existsSync(file));
    return JSON.parse(await readFile(file, "utf-8")).find((s: { role: string }) => s.role === role);
  };

  it("puts a write to you with its diff: 1 allows it once, and the run goes on", async () => {
    const { frame, type, ctrl, app } = await open({ write: { path: "hello.txt", content: "hi\nthere\n" } });
    await type("write hello.txt\r");
    await until(() => ctrl.approvals.length === 1);
    await until(() => /Do wants to create hello\.txt/.test(frame()));
    expect(frame()).toMatch(/\+hi\n\s*\+there/);
    expect(frame()).toMatch(/▸ 1\. Yes\n\s*2\. Yes, allow all edits during this session \(shift\+tab\)\n\s*3\. No, and tell Do what to do differently \(esc\)/);
    expect(frame()).toMatch(/\[waiting for you\]/);
    await type("1");
    await until(() => ctrl.running === null);
    expect(await readFile(join(dir, "hello.txt"), "utf-8")).toBe("hi\nthere\n");
    expect((await stepOf(ctrl)).permissions[0]).toMatchObject({ tool: "Write", behavior: "allowed", by: "you", answer: "once", provenance: "given" });
    app.unmount();
  });

  it("keeps a command's prefix as a project rule with 2, and does not ask again, in this session or the next", async () => {
    await writeFile(join(dir, "s.js"), "console.log(6 * 7)\n");
    const { frame, type, ctrl, app } = await open({ shell: "node s.js" });
    await type("first\r");
    await until(() => ctrl.approvals.length === 1);
    await until(() => /Do wants to run node s\.js/.test(frame()) && /2\. Yes, and don't ask again for node s\.js \* in this project/.test(frame()));
    await type("2");
    await until(() => ctrl.running === null);
    expect((await stepOf(ctrl)).toolCalls[0].result).toBe("42\n");
    const local = JSON.parse(await readFile(join(dir, ".jig", "settings.local.json"), "utf-8"));
    expect(local.permissions.allow).toEqual(["Shell(node s.js *)"]);
    const runs = () => ctrl.messages.filter((m) => m.kind === "run" && m.outcome).length;
    await type("second\r");
    await until(() => runs() === 2);
    expect((await stepOf(ctrl)).permissions[0]).toMatchObject({ behavior: "allowed", by: "rule", rule: "Shell(node s.js *)" });
    // The next session reads the rule from .jig/settings.local.json.
    expect(loadPermissions(dir).rules.allow).toContain("Shell(node s.js *)");
    app.unmount();
  });

  it("sends the words of a no back to the role, which goes on with them", async () => {
    const { frame, type, ctrl, app } = await open({ write: { path: "a.txt", content: "x" }, answerFromTool: true });
    await type("write a.txt\r");
    await until(() => ctrl.approvals.length === 1);
    await type("3");
    await until(() => /3\. No, and tell Do what to do differently \(esc\):/.test(frame()));
    await type("write it to out/ instead\r");
    await until(() => ctrl.running === null);
    const run = ctrl.messages.filter((m) => m.kind === "run").at(-1) as { outcome: string; text: string };
    expect(run.outcome).not.toBe("stopped");
    expect(run.text).toContain("Not done: the person did not allow writing a.txt, and said: write it to out/ instead");
    expect(existsSync(join(dir, "a.txt"))).toBe(false);
    expect((await stepOf(ctrl)).permissions[0]).toMatchObject({ behavior: "denied", by: "you", feedback: "write it to out/ instead" });
    app.unmount();
  });

  it("stops the run on a plain no (Esc), as Claude Code stops the turn", async () => {
    const { type, ctrl, app } = await open({ write: { path: "a.txt", content: "x" } });
    await type("write a.txt\r");
    await until(() => ctrl.approvals.length === 1);
    await type("\x1b");
    await until(() => ctrl.running === null, 6000);
    expect(ctrl.messages.filter((m) => m.kind === "run").at(-1)).toMatchObject({ outcome: "stopped" });
    expect(existsSync(join(dir, "a.txt"))).toBe(false);
    app.unmount();
  });

  it("cycles the mode with Shift+Tab: accept edits writes without asking, plan refuses, and the footer says which", async () => {
    const { frame, type, ctrl, app } = await open({ write: { path: "a.txt", content: "x" } });
    await type("\x1b[Z");
    await until(() => /⏵⏵ accept edits on/.test(frame()));
    await type("write a.txt\r");
    await until(() => ctrl.messages.some((m) => m.kind === "run" && m.outcome));
    expect(ctrl.approvals.length).toBe(0);
    expect(await readFile(join(dir, "a.txt"), "utf-8")).toBe("x");
    expect((await stepOf(ctrl)).permissions[0]).toMatchObject({ behavior: "allowed", by: "mode", reason: "accept-edits mode" });
    await type("\x1b[Z");
    await until(() => /⏸ plan mode on/.test(frame()));
    await rm(join(dir, "a.txt"));
    await type("write it again\r");
    await until(() => ctrl.messages.filter((m) => m.kind === "run" && m.outcome).length === 2);
    expect(existsSync(join(dir, "a.txt"))).toBe(false);
    expect((await stepOf(ctrl)).toolCalls[0].result).toMatch(/Not done: writing a\.txt is not allowed \(plan mode: reading only, no writes\)\. Nothing was written\./);
    await type("\x1b[Z");
    await until(() => ctrl.permissions.mode === "default" && !/mode on/.test(frame()));
    app.unmount();
  });

  it("asks before reading outside, offers that folder for the session, and reads there once added with /add-dir", async () => {
    const outside = await mkdtemp(join(tmpdir(), "jig-outside-"));
    try {
      await writeFile(join(outside, "notes.txt"), "far away\n");
      const { frame, type, ctrl, app } = await open({ read: join(outside, "notes.txt"), answerFromTool: true });
      await type("read it\r");
      await until(() => ctrl.approvals.length === 1);
      await until(() => /Do wants to read .*notes\.txt/.test(frame()));
      expect(frame()).toMatch(/is outside the working directories/);
      expect(frame()).toMatch(/2\. Yes, allow reading from .*jig-outside-\S+\/ during this session/);
      await type("2");
      await until(() => ctrl.running === null);
      expect((ctrl.messages.filter((m) => m.kind === "run").at(-1) as { text: string }).text).toContain("far away");
      // The folder is the session's now: the next read there does not ask.
      await type("again\r");
      await until(() => ctrl.messages.filter((m) => m.kind === "run" && m.outcome).length === 2);
      expect((await stepOf(ctrl)).permissions[0]).toMatchObject({ behavior: "allowed", by: "rule" });
      app.unmount();
      // A new session asks again, until the folder is added.
      const second = await open({ read: join(outside, "notes.txt") });
      await second.type(`/add-dir ${outside}\r`);
      await until(() => second.ctrl.permissions.workingDirs.includes(outside));
      await second.type("read it\r");
      await until(() => second.ctrl.messages.some((m) => m.kind === "run" && m.outcome));
      expect(second.ctrl.approvals.length).toBe(0);
      expect((await stepOf(second.ctrl)).permissions[0]).toMatchObject({ behavior: "allowed", reason: "reading inside the working directories" });
      second.app.unmount();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("asks before writing outside with a warning and no wider yes, and sends the words of a yes after the result", async () => {
    const outside = await mkdtemp(join(tmpdir(), "jig-outside-"));
    try {
      const { frame, type, ctrl, app } = await open({ write: { path: join(outside, "far.txt"), content: "x" }, answerFromTool: true });
      await type("write far\r");
      await until(() => ctrl.approvals.length === 1);
      await until(() => /Do wants to create .*far\.txt/.test(frame()));
      expect(frame()).toMatch(/⚠ .*is outside the working directories/);
      expect(frame()).not.toMatch(/allow all edits/);
      expect(frame()).toMatch(/2\. No, and tell Do what to do differently/);
      await type("\t");
      await until(() => /1\. Yes:/.test(frame()));
      await type("then say done\r");
      await until(() => ctrl.running === null);
      expect(await readFile(join(outside, "far.txt"), "utf-8")).toBe("x");
      expect((ctrl.messages.filter((m) => m.kind === "run").at(-1) as { text: string }).text).toContain("(The person allowed this, and added: then say done)");
      app.unmount();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("lists and changes rules with /permissions, and adds a folder with /add-dir", async () => {
    await mkdir(join(dir, "shared"));
    const { frame, type, ctrl, app } = await open();
    await type("/permissions deny Read(./.env)\r");
    await until(() => /Read\(\.\/\.env\)\s+local/.test(frame()));
    expect(JSON.parse(await readFile(join(dir, ".jig", "settings.local.json"), "utf-8")).permissions.deny).toEqual(["Read(./.env)"]);
    expect(ctrl.permissions.rules.deny).toEqual(["Read(./.env)"]);
    await type("/permissions allow nonsense\r");
    await until(() => /a rule is Shell\(<command>\)/.test(frame()));
    await type("/permissions remove Read(./.env)\r");
    await until(() => ctrl.permissions.rules.deny.length === 0);
    await type("/add-dir shared\r");
    await until(() => ctrl.permissions.workingDirs.includes(join(dir, "shared")));
    expect(frame()).toMatch(/is a working directory for this session/);
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
    await type("/runs list\r");
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
    expect(text(indicatorCells("passed", 60_000, false))).toBe(" ✓ ");
    expect(indicatorCells("passed", 60_000, false).find(([t]) => t.trim())![1]).toBe("pass");
    expect(text(indicatorCells("failed", 60_000, false))).toBe(" ✗ ");
    expect(text(indicatorCells("failed", 60_000, true))).toBe(" x ");
    const backFrames = theData.indicators.back.frames;
    expect(text(indicatorCells("back", 60_000, false))).toBe(theData.indicators.back.settle?.unicode ?? backFrames.at(-1)!.unicode);
    // Every state's indicator is three cells, settled or not, in its glyphs and in ASCII.
    for (const state of Object.keys(theData.indicators) as IndicatorState[]) for (const t of [0, 500, 60_000]) for (const ascii of [false, true]) expect([...text(indicatorCells(state, t, ascii))].length, `${state} ${t} ${ascii}`).toBe(3);
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

  it("keeps the mark and its word one space apart in the footer, a settled one too", async () => {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null });
    await ctrl.load();
    for (const [state, word] of [["passed", "✓ passed"], ["failed", "✗ failed"]] as const) {
      ctrl.activity = state;
      const line = footerHead(ctrl, ctrl.drawing, ctrl.runState, ctrl.activitySince + 60_000, false).map(([t]) => t).join("");
      expect(line, state).toMatch(new RegExp(`^ ${word} · `));
    }
    ctrl.activity = "idle";
    expect(footerHead(ctrl, ctrl.drawing, ctrl.runState, 0, false).map(([t]) => t).join("")).toMatch(/^▞▚ ready · /);
  });

  it("plays the startup alone, centred, before the session is drawn", async () => {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" startup="animate" size={{ columns: 100, rows: 30 }} fps={50} />);
    await new Promise((r) => setTimeout(r, 900));
    const rows = strip(app.lastFrame()).split("\n");
    expect(rows.join("\n")).toContain("joint inference graph");
    expect(rows.join("\n")).not.toMatch(/Execute & Evaluate|a task for the topology|\[ready\]|──────/);
    const art = rows.filter((r) => /[▄▀█▞▚▟▙▗▖▘▝]/.test(r));
    expect(art.length).toBeGreaterThan(0);
    expect(Math.min(...art.map((r) => r.length - r.trimStart().length))).toBeGreaterThan(10);
    const first = rows.findIndex((r) => /[▄▀█▞▚▟▙▗▖▘▝]/.test(r));
    expect(first).toBeGreaterThan(5);
    app.unmount();
  });

  it("shows one Jig at a time: the large logo whole until the first task, then only the header", async () => {
    const { frame, type, ctrl, app } = await open({}, {}, { columns: 120, rows: 40 });
    const logo = theme.logo.large.unicode.map((r) => r.trim());
    const logoShown = () => logo.filter((r) => frame().split("\n").some((row) => row.trim().startsWith(r) || row.includes(`  ${r}`)));
    expect(logoShown()).toHaveLength(logo.length);
    expect(frame()).not.toContain("jig 0.1.0 ·");
    // Commands before the first task never push the logo half off the screen: it is whole, or gone.
    for (let i = 0; i < 6; i++) await type("/help\r");
    await until(() => frame().includes("/quit"));
    expect([0, logo.length]).toContain(logoShown().length);
    await type("the first task\r");
    await until(() => ctrl.running === null && ctrl.messages.some((m) => m.kind === "run" && m.outcome));
    await until(() => frame().includes("jig 0.1.0 ·"));
    expect(frame()).not.toContain("▄██▄▄▄▄▄▄▄▄██▄");
    expect(frame()).not.toContain("No task yet");
    app.unmount();
  });

  it("opens a resumed session on the header alone, its logo nowhere", async () => {
    const first = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null });
    await first.load();
    await first.send("an earlier task");
    const [saved] = await savedSessions(dir);
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null, resume: saved });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} resumed size={{ columns: 120, rows: 40 }} fps={50} />);
    const f = strip(app.lastFrame());
    expect(f).toContain("jig 0.1.0 ·");
    expect(f).toContain("› an earlier task");
    expect(f).not.toContain("▄██▄▄▄▄▄▄▄▄██▄");
    app.unmount();
  });
});

describe("Enter with the completions open", () => {
  async function menuApp() {
    const ctrl = new SessionController({ workingDir: dir, models: scriptedModels(), storage: null, persist: false });
    await ctrl.load();
    const sent: string[] = [];
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 120, rows: 40 }} fps={50} onSubmit={(t) => sent.push(t)} />);
    const frame = () => strip(app.lastFrame());
    const key = async (k: string, wait = 60) => {
      app.stdin.write(k);
      await new Promise((r) => setTimeout(r, wait));
    };
    const titles = () => ctrl.messages.filter((m) => m.kind === "info").map((m) => (m as { title?: string }).title);
    return { ctrl, app, frame, key, sent, titles };
  }

  it("takes the item walked to with the arrows: /, Down, Enter runs the second command", async () => {
    const { key, frame, sent, titles, app } = await menuApp();
    await key("/");
    await until(() => /▸ help/.test(frame()));
    await key("\x1b[B");
    await until(() => /▸ topology/.test(frame()));
    await key("\r");
    await until(() => /The topology the next task runs through/.test(frame()));
    expect(sent).toEqual(["/topology"]);
    app.unmount();
  });

  it("completes an unfinished command name with its first match: /he and Enter runs /help", async () => {
    const { key, frame, sent, titles, app } = await menuApp();
    await key("/he");
    await until(() => /▸ help/.test(frame()));
    await key("\r");
    await until(() => titles().includes("help"));
    expect(sent).toEqual(["/help"]);
    app.unmount();
  });

  it("runs an exact command as typed", async () => {
    const { key, frame, sent, titles, app } = await menuApp();
    await key("/runs");
    await until(() => /▸ runs/.test(frame()));
    await key("\r");
    await until(() => titles().includes("runs"));
    expect(sent).toEqual(["/runs"]);
    app.unmount();
  });

  it("keeps the typed argument unless the arrows moved", async () => {
    const { key, frame, sent, ctrl, app } = await menuApp();
    await key("/topology ad");
    await until(() => /▸ adversarial-duel/.test(frame()));
    await key("\r");
    await until(() => ctrl.messages.some((m) => m.kind === "error"));
    expect(sent).toEqual(["/topology ad"]);
    expect(ctrl.topology?.id).toBe("exec-eval");
    await key("/topology ad");
    await until(() => /▸ adversarial-duel/.test(frame()));
    await key("\x1b[B");
    await until(() => /▸ advisor/.test(frame()));
    await key("\r");
    await until(() => ctrl.topology?.id === "advisor");
    expect(sent).toEqual(["/topology ad", "/topology advisor"]);
    app.unmount();
  });

  it("leaves Tab completing only, and Esc closing the menu with the text kept", async () => {
    const { key, frame, sent, app } = await menuApp();
    await key("/he");
    await until(() => /▸ help/.test(frame()));
    await key("\t");
    await until(() => /› \/help\s*$/m.test(frame()));
    expect(sent).toEqual([]);
    await key("\x7f".repeat(6));
    await key("/to");
    await until(() => /▸ topology/.test(frame()));
    await key("\x1b", 120);
    await until(() => !/▸ topology/.test(frame()));
    expect(frame()).toMatch(/› \/to/);
    expect(sent).toEqual([]);
    app.unmount();
  });
});

describe("the picker", () => {
  // Walks the open picker to an item with the arrows, then Enter.
  const choose = async (ctrl: SessionController, type: (t: string) => Promise<void>, value: string) => {
    await until(() => ctrl.picker !== null);
    const p = ctrl.picker!;
    const to = pickerItems(p).findIndex((i) => i.value === value);
    if (to < 0) throw new Error(`no ${value} in ${pickerItems(p).map((i) => i.value).join(", ")}`);
    for (let n = p.at; n < to; n++) await type("\x1b[B");
    for (let n = p.at; n > to; n--) await type("\x1b[A");
    await type("\r");
  };

  it("moves with the arrows, marks the current item, chooses with Enter or a number, and cancels with Esc", async () => {
    const { frame, type, ctrl, app } = await open();
    const items = [{ value: "a", label: "alpha", detail: "the first" }, { value: "b", label: "beta", current: true }, { value: "c", label: "gamma" }];
    let got = ctrl.pick("Pick a letter", items);
    await until(() => /‖ Pick a letter/.test(frame()));
    expect(frame()).toMatch(/▸ 2\. beta\s+← now/);
    expect(frame()).toMatch(/1\. alpha\s+the first/);
    await type("\x1b[B");
    await until(() => /▸ 3\. gamma/.test(frame()));
    await type("\r");
    expect(await got).toEqual(["c"]);
    got = ctrl.pick("Again", items);
    await until(() => ctrl.picker !== null);
    await type("1");
    expect(await got).toEqual(["a"]);
    got = ctrl.pick("Once more", items);
    await until(() => ctrl.picker !== null);
    await type("\x1b");
    expect(await got).toBeNull();
    await until(() => !/Once more/.test(frame()));
    app.unmount();
  });

  it("checks several with Space in a multi-choice list, keeps them with Enter, and filters a long list as you type", async () => {
    const { frame, type, ctrl, app } = await open();
    const got = ctrl.pick("Tools", ["read", "write", "shell"].map((x) => ({ value: x, label: x })), { multi: true, checked: ["read"] });
    await until(() => /▸ \[x\] read/.test(frame()));
    await type("\x1b[B");
    await type(" ");
    await until(() => /▸ \[x\] write/.test(frame()));
    await type("\x1b[B");
    await type("\r");
    expect(await got).toEqual(["read", "write"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ value: `m${i}`, label: `model-${i}` }));
    const one = ctrl.pick("Models", many);
    await until(() => /↓ \d+ more/.test(frame()));
    await type("l-2");
    await until(() => /filter: l-2/.test(frame()));
    expect(pickerItems(ctrl.picker!).map((i) => i.value)).toEqual(["m2", "m20", "m21", "m22", "m23", "m24", "m25", "m26", "m27", "m28", "m29"]);
    await type("7");
    await type("\r");
    expect(await one).toEqual(["m27"]);
    app.unmount();
  });

  it("/topology opens the picker without an argument and switches with one", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("/topology\r");
    await until(() => /The topology the next task runs through/.test(frame()));
    expect(frame()).toMatch(/exec-eval\s+2 roles · Execute & Evaluate\s+← now/);
    await choose(ctrl, type, "advisor");
    await until(() => ctrl.topology?.id === "advisor");
    await type("/topology ralph-loop\r");
    await until(() => ctrl.topology?.id === "ralph-loop");
    expect(ctrl.picker).toBeNull();
    await type("/topology list\r");
    await until(() => /\/topology picks one/.test(frame()));
    app.unmount();
  });

  it("/models picks a role, then a model from the live list; with arguments it sets one at once", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("/models\r");
    await until(() => /Whose model/.test(frame()));
    await choose(ctrl, type, "exec");
    await until(() => /The model or brain for Do/.test(frame()));
    expect(frame()).toMatch(/scripted\/scripted-a\s+← now/);
    await choose(ctrl, type, "scripted/scripted-b");
    await until(() => ctrl.settings.roleModels.exec === "scripted/scripted-b");
    await type("/models eval scripted/scripted-b\r");
    await until(() => ctrl.settings.roleModels.eval === "scripted/scripted-b");
    app.unmount();
  });

  it("/memory, /permissions and /sight pick without an argument and act with one", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("/memory\r");
    await until(() => /How far recall reaches/.test(frame()) && /session\s+this session's runs.*← now/.test(frame()));
    await choose(ctrl, type, "task");
    await until(() => ctrl.settings.memoryScope === "task");
    await type("/memory off\r");
    await until(() => ctrl.settings.memoryScope === "off");

    await type("/permissions\r");
    await until(() => /‖ Permissions/.test(frame()));
    await choose(ctrl, type, "mode");
    await until(() => /The permission mode/.test(frame()));
    await choose(ctrl, type, "plan");
    await until(() => ctrl.permissions.mode === "plan");
    await type("/permissions mode default\r");
    await until(() => ctrl.permissions.mode === "default");
    await type("/permissions deny Read(./.env)\r");
    await type("/permissions allow Shell(npm test *)\r");
    await until(() => ctrl.permissions.rules.allow.length === 1);
    await type("/permissions\r");
    await until(() => ctrl.picker !== null);
    await choose(ctrl, type, "remove");
    await until(() => /Rules to remove/.test(frame()));
    await type(" ");
    await type("\r");
    await until(() => ctrl.permissions.rules.deny.length === 0);
    expect(ctrl.permissions.rules.allow).toEqual(["Shell(npm test *)"]);

    await type("/sight\r");
    await until(() => /Whose sight/.test(frame()));
    await choose(ctrl, type, "eval");
    await until(() => /what Check sees/.test(frame()) || /what \S+ sees/.test(frame()));
    await type("/sight exec\r");
    await until(() => ctrl.messages.filter((m) => m.kind === "info" && /^what .* sees$/.test(m.title ?? "")).length === 2);
    app.unmount();
  });

  it("/tools opens a checklist per role, and turns a tool off for that role only", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("/tools\r");
    await until(() => /Whose tools/.test(frame()));
    await choose(ctrl, type, "exec");
    await until(() => /tools for this session/.test(frame()));
    const p = ctrl.picker!;
    const at = pickerItems(p).findIndex((i) => i.value === "shell");
    for (let n = 0; n < at; n++) await type("\x1b[B");
    await type(" ");
    await type("\r");
    await until(() => (ctrl.settings.roleToolsOff?.exec ?? []).includes("shell"));
    const conf = ctrl.configured(ctrl.topology!);
    expect(conf.nodes.find((n) => n.id === "exec")!.config.toolPolicy?.deny).toContain("shell");
    // Check's own policy is untouched.
    expect(conf.nodes.find((n) => n.id === "eval")!.config.toolPolicy).toEqual(ctrl.topology!.nodes.find((n) => n.id === "eval")!.config.toolPolicy);
    await type("/tools off git\r");
    await until(() => ctrl.settings.toolsOff.includes("git"));
    app.unmount();
  });

  it("/runs and /replay pick a past run, newest first, and /replay <id> plays one at once", async () => {
    const { frame, type, ctrl, app } = await open();
    await type("first task\r");
    await until(() => ctrl.running === null && Boolean((ctrl.messages.at(-1) as { runId?: string }).runId));
    await type("second task\r");
    await until(() => ctrl.running === null && ctrl.messages.filter((m) => m.kind === "run" && m.runId).length === 2);
    const ids = ctrl.messages.filter((m) => m.kind === "run").map((m) => (m as { runId: string }).runId);
    await until(async () => (await ctrl.pastRuns()).length === 2 as never);
    await type("/runs\r");
    await until(() => /A past run to replay, newest first/.test(frame()));
    expect(pickerItems(ctrl.picker!).map((i) => i.value)).toEqual([ids[1], ids[0]]);
    expect(frame()).toMatch(/second task/);
    await choose(ctrl, type, ids[0]);
    await until(() => ctrl.replay !== null);
    await type("\x1b");
    await until(() => ctrl.replay === null);
    await type("/replay\r");
    await until(() => ctrl.picker !== null);
    await type("\x1b");
    await until(() => ctrl.picker === null);
    expect(ctrl.replay).toBeNull();
    await type(`/replay ${ids[1]} 50\r`);
    await until(() => ctrl.replay !== null);
    app.unmount();
  });

  it("/brains, /providers and /advisor open their pickers, and act with an argument", async () => {
    const models = Object.assign(scriptedModels(), {
      brainsNow: { fast: ["nowhere/x"] },
      states: [{ entry: { name: "scripted", kind: "openai-compatible", baseUrl: "http://127.0.0.1:9" }, source: "none", warnings: [] }],
      warnings: [],
    });
    const ctrl = new SessionController({ workingDir: dir, models, storage: null, permissions: { mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [dir] } });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 120, rows: 40 }} fps={50} />);
    const frame = () => strip(app.lastFrame());
    const type = async (t: string) => {
      app.stdin.write(t);
      await new Promise((r) => setTimeout(r, 30));
    };
    await type("/brains\r");
    await until(() => /Which brain to test/.test(frame()));
    await choose(ctrl, type, "fast");
    await until(() => /nothing in it answers now/.test(frame()));
    await type("/brains list\r");
    await until(() => ctrl.messages.filter((m) => m.kind === "info" && m.title === "brains").length === 2);

    await type("/providers\r");
    await until(() => /Which provider entry/.test(frame()));
    await choose(ctrl, type, "scripted");
    await until(() => /‖ scripted/.test(frame()));
    await choose(ctrl, type, "remove");
    await until(() => /Remove scripted from your config\?/.test(frame()));
    await choose(ctrl, type, "no");
    await until(() => ctrl.picker === null);
    await type("/providers list\r");
    await until(() => ctrl.messages.some((m) => m.kind === "info" && m.title === "providers"));

    await type("/topology advisor\r");
    await until(() => ctrl.topology?.id === "advisor");
    await type("/advisor\r");
    await until(() => /consulted by/.test(frame()) && ctrl.picker !== null);
    await choose(ctrl, type, "sees");
    await until(() => /What .* sees/.test(frame()));
    await type(" ");
    await type("\r");
    await until(() => ctrl.picker === null);
    await type("/advisor limit 2\r");
    await until(() => ctrl.settings.advisor.limit === 2);
    app.unmount();
  });
});
