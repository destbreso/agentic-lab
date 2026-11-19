// ============================================
// What the session shows, as lines of styled segments
// ============================================
// Every region is computed here as plain data (lines of [text, meaning]),
// so its height is known before anything is drawn and a test can read it.
// The Ink components only print these lines.

import * as path from "node:path";
import { homedir } from "node:os";
import { logLines, shortTokens, type Drawing, type Grid, type Meaning, type PermissionAnswer, type PermissionMode, type PermissionQuestion, type RunState } from "jig-core";
import { pickerItems, type Line, type Message, type Picker, type SessionController } from "./controller.js";
import { indicatorCells, logoRows, markCells, poseOf, poseRows, theme, type IndicatorState, type Segments } from "./theme.js";

/** A grid's rows as lines, each run of cells with one meaning a segment. */
export function gridLines(g: Grid): Line[] {
  const out: Line[] = [];
  for (const row of g.c) {
    let end = row.length;
    while (end > 0 && row[end - 1].ch === " ") end--;
    const line: Line = [];
    for (const cell of row.slice(0, end)) {
      const k: Meaning = cell.ch === " " ? "" : cell.k;
      const last = line[line.length - 1];
      if (last && last[1] === k) last[0] += cell.ch;
      else line.push([cell.ch, k]);
    }
    out.push(line);
  }
  return out;
}

const widthOf = (text: string) => [...text].length;

/** A line cut into lines of at most `width` characters, at spaces where it can. */
export function wrapLine(line: Line, width: number, indent = ""): Line[] {
  const words: Array<[string, Meaning]> = [];
  for (const [text, k] of line) for (const w of text.split(/(?<=\s)/)) if (w) words.push([w, k]);
  const out: Line[] = [];
  let cur: Line = [];
  let at = 0;
  const push = (t: string, k: Meaning) => {
    const last = cur[cur.length - 1];
    if (last && last[1] === k) last[0] += t;
    else cur.push([t, k]);
    at += widthOf(t);
  };
  for (let [w, k] of words) {
    while (widthOf(w) > width - at && widthOf(w.trimEnd()) > width - widthOf(indent)) {
      // A word longer than the line is cut where the line ends.
      const room = width - at;
      if (room > 0) push([...w].slice(0, room).join(""), k);
      out.push(cur);
      cur = indent ? [[indent, ""]] : [];
      at = widthOf(indent);
      w = [...w].slice(room).join("");
    }
    if (at + widthOf(w.trimEnd()) > width && at > widthOf(indent)) {
      out.push(cur);
      cur = indent ? [[indent, ""]] : [];
      at = widthOf(indent);
    }
    push(w, k);
  }
  out.push(cur);
  return out;
}

/** A text of several lines, each wrapped. */
export function wrapText(text: string, k: Meaning, width: number, indent = "  "): Line[] {
  return text.split("\n").flatMap((l) => wrapLine([[indent + l, k]], width, indent));
}

/** The engine's state for the status line, and the words for it. */
export function statusOf(ctrl: SessionController, d: Drawing | null, s: RunState): { state: IndicatorState; words: string } {
  const state = ctrl.activity;
  const face = (id: string | null) => (id && d ? (d.roles.find((r) => r.id === id)?.label ?? d.consults.find((c) => c.to === id)?.name ?? id) : "");
  const round = `${d?.unit ?? "round"} ${Math.max(1, s.round)}`;
  switch (state) {
    case "waiting":
      return { state, words: `${face(s.asking?.role ?? s.active)} waits for you` };
    case "consulting":
      return { state, words: `${face(s.consult?.from ?? null)} consults ${s.consult?.name ?? "the advisor"} · ${round}` };
    case "tool":
      return { state, words: `${face(s.tool?.role ?? s.active)} runs ${s.tool?.tool ?? "its tools"} · ${round}` };
    case "back":
      return { state, words: `back to ${face(s.startAt)} · ${round}` };
    case "working":
      return { state, words: `${face(s.active)} at work · ${round}` };
    case "thinking":
      return { state, words: s.active ? `${face(s.active)} writes · ${round}` : "the topology has the task" };
    case "team":
      return { state, words: `the topology has the task · ${d?.roles.length ?? 0} roles` };
    case "passed":
      return { state, words: "passed" };
    case "failed":
      return { state, words: "failed" };
    default:
      return { state, words: "" };
  }
}

const clock = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
};

/** One message as lines. The message under way gets the status line and its latest log lines. */
export function messageLines(m: Message, ctrl: SessionController, width: number, now: number, ascii: boolean, live: boolean): Line[] {
  switch (m.kind) {
    case "you":
      return wrapLine([[`${ascii ? theme.prompt.ascii : theme.prompt.unicode} `, "b"], [m.text.replace(/\n/g, " ⏎ "), "b"]], width, "  ");
    case "note":
      return wrapLine([["  ‖ a note for Do: ", "you"], [m.text, "ink"]], width, "    ");
    case "error":
      return wrapLine([["  ✗ ", "fail"], [m.text, "fail"]], width, "    ");
    case "info": {
      const head: Line[] = m.title ? [[[`  ── ${m.title} `, "faint"]]] : [];
      return [...head, ...m.lines.flatMap((l) => (widthOf(l.map((p) => p[0]).join("")) > width ? wrapLine(l, width, "    ") : [l]))];
    }
    case "run": {
      const out: Line[] = [];
      if (live && ctrl.drawing) {
        const s = ctrl.runState;
        const { state, words } = statusOf(ctrl, ctrl.drawing, s);
        const figures = `${shortTokens(s.tokens)} tokens${s.limits?.tokenBudget ? ` of ${shortTokens(s.limits.tokenBudget)}` : ""} · ${clock(s.now - s.startedAt)}`;
        out.push([["  ", ""], ...withWords(indicatorCells(state, now - ctrl.activitySince, ascii), words, wordsMeaning(state)), [`  ${figures}`, "faint"]]);
        const lines = logLines(ctrl.drawing, s).slice(-4);
        for (const l of lines) out.push(...wrapLine([[`    ${l.who.padEnd(8)} `, "faint"], [l.text, l.k === "ink" ? "dim" : l.k]], width, "      ").slice(0, 2));
      }
      if (m.text) out.push(...wrapText(m.text.trim(), "ink", width, "  "));
      if (m.outcome && m.unverified && m.outcome !== "stopped") {
        out.push(...wrapLine([["  · answered ", "b"], [`not verified: ${m.unverified} · ${m.tokens !== undefined ? `${shortTokens(m.tokens)} tokens · ` : ""}${m.durationMs !== undefined ? `${(m.durationMs / 1000).toFixed(1)}s` : ""}${m.runId ? ` · ${m.runId}` : ""}`, "faint"]], width, "    "));
      } else if (m.outcome) {
        const mark = m.outcome === "passed" ? "✓" : m.outcome === "failed" ? "✗" : "■";
        const k: Meaning = m.outcome === "passed" ? "pass" : m.outcome === "failed" ? "fail" : "b";
        const facts = [
          m.rounds !== undefined ? `after ${m.rounds} round${m.rounds === 1 ? "" : "s"}` : "",
          m.tokens !== undefined ? `${shortTokens(m.tokens)} tokens` : "",
          m.durationMs !== undefined ? `${(m.durationMs / 1000).toFixed(1)}s` : "",
          m.checks ? `check ■ ${m.checks.passed}/${m.checks.total}` : "",
          m.runId ? m.runId : "",
        ].filter(Boolean);
        out.push(...wrapLine([[`  ${mark} ${m.outcome} `, k], [facts.join(" · "), "faint"]], width, "    "));
        if (m.outcome !== "passed" && m.reason) out.push(...wrapLine([[`    ${m.reason}`, "faint"]], width, "    ").slice(0, 3));

      }
      // A role that fell back ran on another model than its first: the summary says so.
      if (m.outcome) for (const f of m.fallbacks ?? []) out.push(...wrapLine([["    ↪ ", "b"], [`${f.role} fell back from ${f.from} to ${f.to} (${f.reason})`, "dim"]], width, "      "));
      return out;
    }
  }
}

/** The whole conversation as lines, oldest first, a blank line between messages. */
export function conversationLines(ctrl: SessionController, width: number, now: number, ascii: boolean): Line[] {
  const out: Line[] = [];
  // The run under way is the last run message, even with notes typed after it.
  let live = -1;
  ctrl.messages.forEach((m, i) => {
    if (m.kind === "run") live = i;
  });
  if (!ctrl.running) live = -1;
  ctrl.messages.forEach((m, i) => {
    if (i > 0 && m.kind !== "run" && m.kind !== "note") out.push([]);
    out.push(...messageLines(m, ctrl, width, now, ascii, i === live));
  });
  return out;
}

/** A path with the home directory written as ~. */
const home = (p: string) => {
  const h = process.env.HOME;
  return h && p.startsWith(h) ? `~${p.slice(h.length)}` : p;
};

/** An indicator's cells and the words after it, one space apart whatever the frame leaves at its end. */
function withWords(lead: Segments, words: string, k: import("jig-core").Meaning): Line {
  const ends = lead.map(([t]) => t).join("").endsWith(" ");
  return [...lead, [`${ends ? "" : " "}${words}`, k]];
}

/** The colour a state's words take: a run's state, as its indicator says it. */
function wordsMeaning(state: IndicatorState): import("jig-core").Meaning {
  if (state === "idle") return "dim";
  if (state === "waiting") return "you";
  if (state === "failed") return "fail";
  if (state === "passed") return "pass";
  if (state === "back") return "b";
  return "run";
}

/** Rows of art and rows of text side by side, the art padded to its width. */
function beside(art: Segments[], artWidth: number, text: Line[], gap = 2): Line[] {
  const n = Math.max(art.length, text.length);
  const out: Line[] = [];
  for (let i = 0; i < n; i++) {
    const a = art[i] ?? [];
    const w = a.reduce((x, [t]) => x + [...t].length, 0);
    out.push([["  ", ""], ...a, [" ".repeat(Math.max(0, artWidth - w) + gap), ""], ...(text[i] ?? [])]);
  }
  return out;
}

/** The opening: Jig at rest, large, with its name beside it, and what to do. */
export function welcomeLines(ctrl: SessionController, version: string, ascii: boolean, resumed: boolean): Line[] {
  const art = logoRows("large", ascii);
  const text: Line[] = [[], [], [[theme.name.toLowerCase(), "b"]], [[theme.tagline, "dim"]], [[`${version} · ${ctrl.modelOf("")}`, "faint"]]];
  const runs = ctrl.topology ? ctrl.topology.nodes.map((n) => ctrl.topology!.faces[n.id]?.label ?? n.id).join(", ") : "";
  return [
    ...beside(art, theme.logo.large.cols, text),
    [],
    [[resumed ? `  resumed ${ctrl.id}: ${ctrl.messages.filter((m) => m.kind === "you").length} messages` : `  No task yet. Type one, and ${ctrl.topology?.name ?? ctrl.settings.topology} runs it: ${runs}.`, "ink"]],
    [[`  ${home(ctrl.workingDir)} · /help lists the commands`, "faint"]],
  ];
}

/** The session's header: Jig in the pose of the engine's state, beside where you are. */
export function headerLines(ctrl: SessionController, version: string, now: number, ascii: boolean, width: number): Line[] {
  const pose = poseRows("medium", poseOf(ctrl.activity), now - ctrl.activitySince, ascii);
  const t = ctrl.topology;
  const roles = t ? `${t.nodes.length} role${t.nodes.length === 1 ? "" : "s"}${t.consults.length ? ` + ${t.consults.map((c) => c.role.face.label.toLowerCase()).join(", ")}` : ""}` : "";
  const text: Line[] = [
    [[`${theme.name.toLowerCase()} ${version}`, "b"], [` · ${home(ctrl.workingDir)}`, "faint"]],
    [[`${t?.name ?? ctrl.settings.topology}`, "ink"], [` · ${roles} · ${ctrl.modelOf("")}`, "dim"]],
    [["/ commands · ctrl+t folds the grid · esc stops a run", "faint"]],
    [],
  ];
  void width;
  return beside(pose, theme.character.medium.cols, text);
}

/** The footer's first line: the state's indicator and its words, then what the keys do. */
/** The permission mode as Claude Code's status bar says it. */
export function modeSegment(mode: PermissionMode, ascii: boolean): Array<[string, Meaning]> {
  const play = ascii ? ">>" : "⏵⏵";
  const pause = ascii ? "||" : "⏸";
  switch (mode) {
    case "acceptEdits":
      return [[` · ${play} accept edits on`, "you"]];
    case "plan":
      return [[` · ${pause} plan mode on`, "you"]];
    case "bypassPermissions":
      return [[` · ${play} bypass permissions on`, "fail"]];
    default:
      // Manual is the quiet default: the footer names a mode only when it changes what runs without asking.
      return [];
  }
}

export function footerHead(ctrl: SessionController, d: Drawing | null, s: RunState, now: number, ascii: boolean): Line {
  const { state, words } = statusOf(ctrl, d, s);
  const mode = modeSegment(ctrl.permissions.mode, ascii);
  if (state === "idle" || !ctrl.running) {
    const t = ctrl.topology;
    const roles = t ? `${t.nodes.length} role${t.nodes.length === 1 ? "" : "s"}${t.consults.length ? " + advisor" : ""}` : "";
    // The indicator is three cells wide in every state; the words follow it after its own trailing space.
    const lead: Segments = state === "idle" ? [...markCells(ascii, "dim"), [ascii ? "" : " ", ""]] : indicatorCells(state, now - ctrl.activitySince, ascii);
    return [...withWords(lead, state === "idle" ? "ready" : words, wordsMeaning(state)), ...mode, [` · ${t?.id ?? ctrl.settings.topology} · ${roles} · ${ctrl.modelOf("")} · /help`, "faint"]];
  }
  const figures = `${shortTokens(s.tokens)}${s.limits?.tokenBudget ? ` of ${shortTokens(s.limits.tokenBudget)}` : ""} tokens · ${clock(s.now - s.startedAt)}`;
  return [...withWords(indicatorCells(state, now - ctrl.activitySince, ascii), words, wordsMeaning(state)), ...mode, [` · ${figures} · esc stops · type to steer`, "faint"]];
}

export interface ApprovalChoice {
  label: string;
  answer: PermissionAnswer["answer"];
  /** Whether Tab opens a field for words to go with it (a yes once, or a no). */
  words: boolean;
}

const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

/** The choices a question offers, as Claude Code's: yes, the wider yes when it can name all it allows, and no. */
export function approvalChoices(q: PermissionQuestion, who: string): ApprovalChoice[] {
  const out: ApprovalChoice[] = [{ label: "Yes", answer: "once", words: true }];
  if (q.tool === "Write" && !q.warning) out.push({ label: "Yes, allow all edits during this session (shift+tab)", answer: "session", words: false });
  if (q.tool === "Read" && q.remember?.length) {
    const folders = q.remember.map((r) => tilde(r.replace(/^Read\(\//, "").replace(/\/\*\*\)$/, "")));
    out.push({ label: `Yes, allow reading from ${folders.join(", ")}/ during this session`, answer: "session", words: false });
  }
  if (q.tool === "Shell" && q.remember?.length) {
    const prefixes = q.remember.map((r) => r.replace(/^Shell\(/, "").replace(/\)$/, ""));
    out.push({ label: `Yes, and don't ask again for ${prefixes.join(", ")} in this project`, answer: "rule", words: false });
  }
  out.push({ label: `No, and tell ${who} what to do differently (esc)`, answer: "deny", words: true });
  return out;
}

/** The question waiting for you: who asks for what, why, a write's diff, the choices, and the words being typed. */
export function approvalLines(
  q: PermissionQuestion,
  o: { who: string; workingDir: string; at: number; words: string | null; maxDiff: number; ascii: boolean },
): Line[] {
  const shown = (t: string) => {
    if (q.tool === "Shell") return t;
    const rel = path.relative(o.workingDir, t);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : tilde(t);
  };
  const created = q.tool === "Write" && /^--- \/dev\/null/.test(q.diff ?? "");
  const verb = q.tool === "Shell" ? "wants to run" : q.tool === "Read" ? "wants to read" : created ? "wants to create" : "wants to edit";
  const out: Line[] = [[["  ‖ ", "you"], [`${o.who} ${verb} `, "you"], [shown(q.target), "b"]]];
  out.push([[`    ${q.reason}`, "faint"]]);
  if (q.warning) out.push([[`    ${o.ascii ? "!" : "⚠"} ${q.warning}`, "you"]]);
  if (q.diff) {
    const lines = q.diff.split("\n").filter((l, i) => i > 1 || !/^(---|\+\+\+) /.test(l));
    for (const l of lines.slice(0, o.maxDiff)) out.push([["    ", ""], [l || " ", l.startsWith("+") ? "b" : l.startsWith("-") ? "dim" : "faint"]]);
    if (lines.length > o.maxDiff) out.push([[`    … ${lines.length - o.maxDiff} more line${lines.length - o.maxDiff > 1 ? "s" : ""} of the diff`, "faint"]]);
  }
  const choices = approvalChoices(q, o.who);
  choices.forEach((c, i) => {
    const on = i === o.at;
    const head: Line = [[on ? (o.ascii ? "  > " : "  ▸ ") : "    ", on ? "b" : "faint"], [`${i + 1}. `, on ? "b" : "faint"], [c.label, on ? "b" : "ink"]];
    if (on && o.words !== null) head.push([": ", "b"], [o.words, "you"], [" ", "cursor" as Meaning]);
    out.push(head);
  });
  out.push([[o.words !== null ? "    enter sends · tab closes the field · esc is a no that stops the run" : "    ↑↓ or a number · enter · tab adds words to a yes or a no · esc says no and stops the run", "faint"]]);
  return out;
}

/** The open picker: its title, a window of its items around the cursor, and its keys. */
export function pickerLines(p: Picker, o: { maxRows: number; width: number; ascii: boolean }): Line[] {
  const shown = pickerItems(p);
  const numbered = !p.multi && !p.filter && shown.length <= 9;
  const out: Line[] = [[["  ‖ ", "you"], [p.title, "you"], ...(p.filter ? ([[`  filter: ${p.filter}`, "b"]] as Line) : [])]];
  const rows = Math.max(3, o.maxRows);
  const start = Math.max(0, Math.min(p.at - Math.floor(rows / 2), shown.length - rows));
  const window = shown.slice(start, start + rows);
  const labelWidth = Math.min(32, Math.max(...shown.map((i) => [...i.label].length), 4));
  if (start > 0) out.push([[`    ↑ ${start} more`, "faint"]]);
  window.forEach((item, j) => {
    const i = start + j;
    const on = i === p.at;
    const box = p.multi ? (p.checked.has(item.value) ? "[x] " : "[ ] ") : numbered ? `${i + 1}. ` : "";
    const line: Line = [[on ? (o.ascii ? "  > " : "  ▸ ") : "    ", on ? "b" : "faint"], [box, on ? "b" : "dim"], [item.label.padEnd(labelWidth), on ? "b" : "ink"]];
    if (item.detail) line.push([`  ${item.detail}`, "dim"]);
    if (item.current) line.push([o.ascii ? "  <- now" : "  ← now", "you"]);
    out.push(line);
  });
  if (!shown.length) out.push([["    nothing matches the filter", "faint"]]);
  const below = shown.length - start - window.length;
  if (below > 0) out.push([[`    ↓ ${below} more`, "faint"]]);
  const keys = p.multi ? "↑↓ move · space checks · enter keeps · esc cancels" : `↑↓ move${numbered ? " · a number or enter chooses" : " · enter chooses"} · esc cancels`;
  out.push([[`    ${keys}${shown.length > 9 || p.filter ? " · type to filter" : ""}${p.hint ? ` · ${p.hint}` : ""}`, "faint"]]);
  return out;
}
