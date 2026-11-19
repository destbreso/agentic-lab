// ============================================
// What the session shows, as lines of styled segments
// ============================================
// Every region is computed here as plain data (lines of [text, meaning]),
// so its height is known before anything is drawn and a test can read it.
// The Ink components only print these lines.

import { logLines, shortTokens, type Drawing, type Grid, type Meaning, type RunState } from "jig-core";
import type { Line, Message, SessionController } from "./controller.js";
import { indicatorFrame, theme, type IndicatorState } from "./theme.js";

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
        const ind = theme.indicators[state];
        const figures = `${shortTokens(s.tokens)} tokens${s.limits?.tokenBudget ? ` of ${shortTokens(s.limits.tokenBudget)}` : ""} · ${clock(s.now - s.startedAt)}`;
        out.push([[`  ${indicatorFrame(state, now, ascii)} `, ind.meaning], [`${words}`, ind.meaning === "faint" ? "dim" : ind.meaning], [`  ${figures}`, "faint"]]);
        const lines = logLines(ctrl.drawing, s).slice(-4);
        for (const l of lines) out.push(...wrapLine([[`    ${l.who.padEnd(8)} `, "faint"], [l.text, l.k === "ink" ? "dim" : l.k]], width, "      ").slice(0, 2));
      }
      if (m.text) out.push(...wrapText(m.text.trim(), "ink", width, "  "));
      if (m.outcome) {
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
      return out;
    }
  }
}

/** The whole conversation as lines, oldest first, a blank line between messages. */
export function conversationLines(ctrl: SessionController, width: number, now: number, ascii: boolean): Line[] {
  const out: Line[] = [];
  const last = ctrl.messages.length - 1;
  ctrl.messages.forEach((m, i) => {
    if (i > 0 && m.kind !== "run" && m.kind !== "note") out.push([]);
    out.push(...messageLines(m, ctrl, width, now, ascii, i === last && m.kind === "run" && Boolean(ctrl.running)));
  });
  return out;
}

/** The logo and the welcome, as the first lines of a session. */
export function welcomeLines(ctrl: SessionController, version: string, ascii: boolean, resumed: boolean): Line[] {
  const logo = (ascii ? theme.logo.ascii : theme.logo.unicode).map((l): Line => [[`  ${l}`, "b"]]);
  return [
    ...logo,
    [[`  ${theme.name} ${version} · ${theme.tagline}`, "dim"]],
    [
      ["  ", ""],
      [ctrl.topology?.name ?? ctrl.settings.topology, "b"],
      [` · ${ctrl.modelOf("")} · ${ctrl.workingDir}`, "dim"],
    ],
    [[resumed ? `  resumed ${ctrl.id}: ${ctrl.messages.filter((m) => m.kind === "you").length} messages` : "  each message is a task the topology runs · /help lists the commands", "faint"]],
  ];
}
