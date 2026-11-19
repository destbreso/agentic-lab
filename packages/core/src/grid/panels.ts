// ============================================
// The panels around the grid: the consulted role's rail, the log, the status line
// ============================================
// Each is drawn from the run state alone, which is folded from the engine's
// events (live, or rebuilt from step records in a replay), so every number in
// them is one the engine reported: nothing is estimated, and a bar is drawn
// only for a count with a measured limit (rounds against the round limit,
// tokens against the budget, model calls against the tool-call cap). Models
// are text; colour stays for a run's state.

import { Grid, fit, len, type Meaning } from "./grid.js";
import { bar } from "./layout.js";
import { elapsed, shortTokens, type LogEntry, type RunState } from "./run-state.js";
import { effectiveLimit, type Drawing, type DrawnConsult } from "./drawing.js";
import type { SessionEvent } from "../engine/agent-session.js";

/** The rail's width, borders included. */
export const RAIL_W = 34;

const PROVENANCE: Record<string, string> = { measured: "■", written: "“", given: "›" };
const mm = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
};
const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

/** Split a text into at most `max` lines of `width` characters, at spaces where it can. */
function wrap(text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of oneLine(text).split(" ")) {
    const word = fit(w, width);
    if (!cur) cur = word;
    else if (len(cur) + 1 + len(word) <= width) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fit(`${kept[max - 1]} …`, width);
  return kept;
}

function faceOf(d: Drawing, id: string): string {
  return d.roles.find((r) => r.id === id)?.label ?? d.consults.find((c) => c.to === id)?.name ?? id;
}

/** The consulted role's rail: name and model, its state, its calls and the tokens it read, each consultation, the last advice. */
export function rail(d: Drawing, s: RunState, c: DrawnConsult, width = RAIL_W, spin = "⠹"): Grid {
  const inner = width - 4;
  const live = Boolean(s.consult?.live && s.consult.to === c.to);
  const mine = s.consultations.filter((x) => x.to === c.to);
  const rows: Array<[string, Meaning]> = [];
  rows.push([fit(c.model, inner), "dim"]);
  const state = s.phase === "rest" ? `on call · ${c.limit} a turn at most` : live ? "consulting" : "on call";
  rows.push([fit(live ? `${spin} ${state}` : `· ${state}`, inner), live ? "run" : "faint"]);
  const done = mine.filter((x) => x.done);
  const read = done.reduce((n, x) => n + (x.read ?? 0), 0);
  rows.push([fit(mine.length ? `${mine.length} call${mine.length > 1 ? "s" : ""} · read ${shortTokens(read)} tokens` : "no call yet", inner), "dim"]);
  if (mine.length) {
    rows.push(["┄".repeat(inner), "faint"]);
    const shown = mine.slice(-4);
    if (mine.length > shown.length) rows.push([fit(`${mine.length - shown.length} earlier`, inner), "faint"]);
    shown.forEach((x, i) => {
      const who = `${d.unit === "turn" ? "t" : "r"}${x.round} ${faceOf(d, x.from)} asked`;
      const k: Meaning = !x.done ? "run" : x.error ? "fail" : "ink";
      // The latest reason gets two lines; earlier ones one.
      const text = x.question ? `${who}: ${oneLine(x.question)}` : who;
      for (const l of wrap(text, inner, i === shown.length - 1 ? 2 : 1)) rows.push([l, k]);
    });
    const advice = s.advice[c.to];
    if (advice) {
      rows.push(["┄".repeat(inner), "faint"]);
      if (advice.error) rows.push([fit(`could not answer: ${advice.error}`, inner), "fail"]);
      else if (advice.sealed) rows.push([fit("“ sealed: the lab cannot read it", inner), "dim"]);
      else {
        rows.push([fit("“ last advice (written)", inner), "faint"]);
        for (const l of wrap(advice.text || "(no advice)", inner, 3)) rows.push([l, "ink"]);
      }
    }
  }
  const g = new Grid(width, rows.length + 2);
  const k: Meaning = live ? "run" : "ln";
  g.box(0, 0, width, rows.length + 2, k);
  g.put(2, 0, ` ${fit(`${c.icon} ${c.name}`, width - 6)} `, live ? "run" : "b");
  rows.forEach(([t, m], i) => g.put(2, i + 1, t, m));
  return g;
}

/** One log line for an event, or null when the log says nothing of it. */
function logLine(d: Drawing, entry: LogEntry): { who: string; text: string; k: Meaning } | null {
  const e: SessionEvent = entry.e;
  const face = (id: string) => faceOf(d, id);
  switch (e.type) {
    case "run:start":
      return { who: "run", text: `› your task: ${oneLine(e.task)}`, k: "dim" };
    case "round:start":
      return { who: "run", text: `${d.unit} ${e.round} starts at ${face(e.startAt)}`, k: "b" };
    case "role:start":
      return { who: face(e.role), text: "starts", k: "faint" };
    case "call": {
      if (!d.roles.some((r) => r.id === e.role) && !d.consults.some((c) => c.to === e.role)) return null;
      if (e.error) return { who: face(e.role), text: `model call ${e.seq} failed: ${oneLine(e.error)}`, k: "fail" };
      const asks = e.tools.length ? `asks for ${e.tools.join(", ")}` : "answers";
      return { who: face(e.role), text: `model call ${e.seq} ${asks} · ${shortTokens(e.tokens.totalTokens)} tokens`, k: "dim" };
    }
    case "role:end": {
      if (!e.success) return { who: face(e.role), text: `✗ failed${e.errors[0] ? `: ${oneLine(e.errors[0])}` : ""}`, k: "fail" };
      const tools = e.toolCalls.length ? ` · ${e.toolCalls.map((t) => `${t.ok ? "" : "!"}${t.name}`).join(" ")}` : "";
      if (e.verdict) {
        const mark = PROVENANCE[e.verdictProvenance ?? "written"];
        const by = e.verdictProvenance === "measured" ? "measured by the lab" : "its model's verdict";
        return { who: face(e.role), text: `${mark} ${e.verdict} · ${by}${tools}`, k: e.verdict === "pass" ? "pass" : "fail" };
      }
      if (e.decision) {
        const mark = PROVENANCE[e.decisionProvenance ?? "written"];
        const rule = oneLine(e.output.replace(/^[a-z_]+:\s*/, ""));
        return { who: face(e.role), text: `${mark} ${e.decision}${rule ? `: ${rule}` : ""}`, k: "b" };
      }
      const said = oneLine(e.output);
      const mark = PROVENANCE[e.outputProvenance ?? "written"];
      return { who: face(e.role), text: `${mark} ${said || "wrote nothing"}${tools} · ${shortTokens(e.tokens.totalTokens)} tokens`, k: "ink" };
    }
    case "consult:start":
      return { who: face(e.from), text: `⇅ asks ${e.name}${e.question ? `: ${oneLine(e.question)}` : ""}${e.real ? " (the provider's advisor tool)" : ""}`, k: "run" };
    case "consult:end":
      if (e.error) return { who: face(e.to), text: `could not answer: ${oneLine(e.error)}`, k: "fail" };
      return { who: face(e.to), text: `“ ${e.sealed ? "advised, sealed" : `advised: ${oneLine(e.advice ?? "")}`} · read ${shortTokens(e.tokens.inputTokens)} tokens`, k: "ink" };
    case "round:end": {
      const back = e.next ? d.back.find((b) => b.to === e.next) : undefined;
      const way = e.next ? ` · ↺ ${back?.label ?? `back to ${face(e.next)}`}` : "";
      return { who: "run", text: `${d.unit} ${e.round} ends: ${e.verdict ?? "no verdict"}${way}`, k: e.next ? "b" : "dim" };
    }
    case "steer:queued":
      return { who: "you", text: `‖ a note for Do: ${oneLine(e.message)}`, k: "you" };
    case "steer:delivered":
      return { who: "you", text: `‖ ${face(e.role)} read the note in ${d.unit} ${e.round}`, k: "you" };
    case "steer:dropped":
      return { who: "you", text: `‖ the note was not delivered: ${e.reason}`, k: "fail" };
    case "run:end": {
      const mark = e.measured ? "■" : "“";
      return { who: "run", text: `${mark} ${e.outcome}: ${oneLine(e.reason)}`, k: e.outcome === "passed" ? "pass" : e.outcome === "failed" ? "fail" : "b" };
    }
    default:
      return null;
  }
}

/** The log's lines as the engine reported them, oldest first: time, who, what. */
export function logLines(d: Drawing, s: RunState): Array<{ at: number; who: string; text: string; k: Meaning }> {
  const out: Array<{ at: number; who: string; text: string; k: Meaning }> = [];
  for (const entry of s.log) {
    const line = logLine(d, entry);
    if (line) out.push({ at: entry.at, ...line });
  }
  return out;
}

/** The log as plain text, one line each: for the scrollback and for output that is not a terminal. */
export function logText(d: Drawing, s: RunState, from = 0): string[] {
  const all = logLines(d, s);
  const whoW = Math.min(10, Math.max(4, ...all.map((x) => len(x.who))));
  return all.slice(from).map((x) => `${mm(x.at)} ${fit(x.who, whoW).padEnd(whoW)} ${x.text}`);
}

export interface LogView {
  /** Lines in the log. */
  total: number;
  /** The line after the last one shown; total when it follows the newest. */
  end: number;
  /** Lines the region shows at once. */
  visible: number;
}

/**
 * The log region: `height` rows, its border on top, and the lines that end at
 * `end` (the newest when it is absent, or past the last). When it does not
 * show the newest, its border says how many came after.
 */
export function logPanel(d: Drawing, s: RunState, width: number, height: number, end?: number, hints = ""): { grid: Grid; view: LogView } {
  const all = logLines(d, s);
  const visible = Math.max(0, height - 1);
  const last = Math.max(0, Math.min(all.length, end ?? all.length));
  const first = Math.max(0, last - visible);
  const shown = all.slice(first, last);
  const g = new Grid(width, Math.max(1, height));
  const below = all.length - last;
  const where = below > 0 ? ` log · lines ${first + 1} to ${last} of ${all.length} · ${below} new below ` : all.length > shown.length ? ` log · last ${shown.length} of ${all.length} ` : " log ";
  const hint = hints ? ` ${hints} ` : "";
  const room = width - len(where) - 2;
  const right = len(hint) + 2 <= room ? hint : "";
  g.put(0, 0, `──${where}${"─".repeat(Math.max(0, room - len(right)))}${right}`.slice(0, width * 2), below > 0 ? "b" : "faint");
  const whoW = Math.min(10, Math.max(4, ...shown.map((x) => len(x.who))));
  shown.forEach((x, i) => {
    g.put(0, i + 1, mm(x.at), "faint");
    g.put(6, i + 1, fit(x.who, whoW), "b");
    g.put(7 + whoW, i + 1, fit(x.text, width - 7 - whoW), x.k);
  });
  return { grid: g, view: { total: all.length, end: last, visible } };
}

/** One line with the latest event, for a terminal too short for the log. */
export function ticker(d: Drawing, s: RunState, width: number): Grid {
  const all = logLines(d, s);
  const g = new Grid(width, 1);
  const x = all.at(-1);
  if (!x) return g;
  g.put(0, 0, `${mm(x.at)} `, "faint");
  g.put(6, 0, `${x.who} `, "b");
  g.put(7 + len(x.who), 0, fit(x.text, width - 7 - len(x.who)), x.k);
  return g;
}

export interface FooterOptions {
  spin?: string;
  /** A dry run with a scripted model: no tokens are spent. */
  dry?: boolean;
  /** The command the view shows, as typed: its first line. */
  command?: string;
  /** What follows the command on its line (a replay's position). */
  extra?: string;
}

type Part = Array<[string, Meaning]>;
const widthOf = (p: Part) => p.reduce((n, [t]) => n + len(t), 0);
const lower = (t: string) => t.toLowerCase();
const shortModel = (m: string) => m.split(":")[0];
/** A role's name when room is short: the first word of its label, whole. */
const shortName = (label: string) => lower(label.split(/[\s_-]+/)[0] || label);

interface RoleState {
  icon: string;
  name: string;
  /** A readable short name: the label's first word, never cut. */
  short: string;
  model: string;
  /** What goes in the brackets, and how it is drawn. */
  state: string;
  k: Meaning;
  /** A finished role, which a narrow footer folds into one group. */
  done: boolean;
  waiting: boolean;
}

/** Each role's state as the footer writes it: measured counts only (model calls against the cap, consults against their limit). */
function roleStates(d: Drawing, s: RunState): RoleState[] {
  const out: RoleState[] = d.roles.map((r) => {
    const base = { icon: r.icon, name: lower(r.label), short: shortName(r.label), model: r.model };
    if (s.phase === "rest") return { ...base, state: "ready", k: "faint" as Meaning, done: false, waiting: true };
    if (s.active === r.id) {
      if (s.consult?.live && s.consult.from === r.id) return { ...base, state: "asking", k: "run" as Meaning, done: false, waiting: false };
      const cap = s.caps[r.id];
      const calls = s.turns[r.id]?.calls ?? 0;
      return { ...base, state: cap ? `running ${calls}/${cap}` : "running", k: "run" as Meaning, done: false, waiting: false };
    }
    const res = s.results[r.id];
    if (res?.txt === "✗ failed") return { ...base, state: "failed", k: "fail" as Meaning, done: false, waiting: false };
    if (res) {
      const word = res.txt.replace(/^[✓✗?→]\s*/, "");
      return { ...base, state: word, k: res.k, done: res.k !== "fail", waiting: false };
    }
    if (s.done.includes(r.id)) return { ...base, state: "done", k: "dim" as Meaning, done: true, waiting: false };
    const note = idleWord(d, s, r.id);
    return { ...base, state: note, k: "faint" as Meaning, done: false, waiting: true };
  });
  for (const c of d.consults) {
    const live = Boolean(s.consult?.live && s.consult.to === c.to);
    // Consultations this round, against the edge's limit a turn.
    const used = s.consultations.filter((x) => x.to === c.to && x.round === s.round).length;
    const state = s.phase === "rest" ? `on call 0/${c.limit}` : `${live ? "consulting" : "on call"} ${used}/${c.limit}`;
    out.push({ icon: c.icon, name: lower(c.name), short: shortName(c.name), model: c.model, state, k: live ? "run" : "dim", done: false, waiting: !live });
  }
  return out;
}

function idleWord(d: Drawing, s: RunState, id: string): string {
  const at = d.roles.findIndex((r) => r.id === s.startAt);
  if (at > 0 && d.roles.findIndex((r) => r.id === id) < at) return s.phase === "done" ? "not run" : "not now";
  return s.phase === "done" ? "not run" : "waiting";
}

/**
 * The footer pinned at the bottom: the command on its first line; on its
 * second, each role with its model and its state in brackets, then the run's
 * figures (the round against its limit, the tokens against the budget, the
 * lab's check, how it ended, the time). Each role is its glyph and its name.
 * It never wraps: when the width is short it drops the models (keeping the
 * running role's, and a model other than most roles'), then all of them, then
 * keeps only the first word of each name (never a word cut short), then folds
 * the finished roles into one group under their glyphs, then leaves the
 * glyph alone for every role but the one at work.
 */
export function footer(d: Drawing, s: RunState, width: number, options: FooterOptions = {}): Grid {
  const limit = effectiveLimit(d, s.limits?.rounds);
  const budget = s.limits?.tokenBudget;
  const round = s.phase === "rest" ? 0 : Math.max(1, s.round);
  const states = roleStates(d, s);

  // The model most roles run on; a role on another one keeps its model longer.
  const counts = new Map<string, number>();
  for (const x of states) counts.set(x.model, (counts.get(x.model) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const roles = (models: boolean | "some", names: "full" | "short" | "glyph", fold: boolean): Part => {
    const out: Part = [];
    const sep = () => out.length && out.push(["  ", ""]);
    const done = states.filter((x) => x.done);
    const waiting = states.filter((x) => x.waiting && !x.state.startsWith("on call"));
    const glyphs = (xs: RoleState[]) => xs.map((x) => x.icon).join("");
    let foldedDone = false;
    let foldedWaiting = false;
    for (const x of states) {
      if (fold && x.done && done.length > 1) {
        if (!foldedDone) {
          sep();
          // The glyphs say which and how many: the count would repeat them.
          out.push([`${glyphs(done)} [done]`, "dim"]);
          foldedDone = true;
        }
        continue;
      }
      if (fold && x.waiting && waiting.length > 1 && !x.state.startsWith("on call")) {
        if (!foldedWaiting) {
          sep();
          const same = waiting.every((w) => w.state === waiting[0].state);
          out.push([`${glyphs(waiting)} [${same ? waiting[0].state : "waiting"}]`, "faint"]);
          foldedWaiting = true;
        }
        continue;
      }
      sep();
      // The role at work, waiting for you or failed keeps its name: that is where the eyes go.
      const atWork = x.k === "run" || x.k === "you" || x.k === "fail";
      const name = names === "full" ? x.name : names === "short" || atWork ? x.short : "";
      out.push([name ? `${x.icon} ${name}` : x.icon, x.k === "run" || x.k === "you" ? x.k : "ink"]);
      if (x.model && (models === true || (models === "some" && (x.k === "run" || x.model !== common)))) out.push([` ${shortModel(x.model)}`, "dim"]);
      out.push([` [${x.state}]`, x.k]);
    }
    return out;
  };
  const figures = (long: boolean, compact = false, clock = true): Part => {
    const out: Part = [];
    out.push([`${d.unit} `, "ink"], [`[${round}/${limit > 0 ? limit : "∞"}]`, s.phase === "running" ? "run" : "dim"]);
    if (options.dry) out.push(["  tokens ", "ink"], [long ? "[none, dry run]" : "[none]", "dim"]);
    else out.push(["  tokens ", "ink"], [`[${shortTokens(s.tokens)}${budget ? `/${shortTokens(budget)}` : ""}]`, budget && s.tokens >= budget ? "fail" : "dim"]);
    if (s.checks) {
      const c = s.checks;
      const word = compact ? "" : ` ${c.passed === (c.ran ?? c.total) ? "passing" : "failing"}`;
      const text = c.passed === undefined ? (compact ? `${c.total}` : `${c.total} to run`) : `${c.passed}/${c.ran ?? c.total}${word}`;
      out.push(["  check ■ ", "ink"], [`[${text}]`, c.passed === undefined ? "faint" : c.passed === (c.ran ?? c.total) ? "pass" : "fail"]);
    }
    if (s.phase === "done" && s.outcome) {
      const o = s.outcome.outcome;
      const mark = o === "passed" ? "✓ passed" : o === "failed" ? "✗ failed" : `■ ${o}`;
      out.push(["  ", ""], [`${mark}${long ? ` after ${s.round} ${d.unit}${s.round === 1 ? "" : "s"}` : ""}`, o === "passed" ? "pass" : o === "failed" ? "fail" : "b"]);
    }
    if (s.phase !== "rest" && clock) out.push(["  ", ""], [elapsed(s), "dim"]);
    return out;
  };

  const tries: Array<() => Part> = [];
  for (const [long, compact] of [[true, false], [false, false], [false, true]] as const) {
    tries.push(
      () => [...roles(true, "full", false), ["  ", ""], ...figures(long, compact)],
      () => [...roles("some", "full", false), ["  ", ""], ...figures(long, compact)],
      () => [...roles(false, "full", false), ["  ", ""], ...figures(long, compact)],
      () => [...roles(false, "short", false), ["  ", ""], ...figures(long, compact)],
      () => [...roles(false, "short", true), ["  ", ""], ...figures(long, compact)],
      () => [...roles(false, "glyph", true), ["  ", ""], ...figures(long, compact)],
    );
  }
  // The last resort before a cut: the clock goes.
  tries.push(() => [...roles(false, "glyph", true), ["  ", ""], ...figures(false, true, false)]);
  let line2 = tries[0]();
  for (const t of tries) {
    line2 = t();
    if (widthOf(line2) <= width) break;
  }

  const g = new Grid(width, 2);
  const cmd = `$ ${options.command ?? `jig show ${d.id}`}`;
  const extra = options.extra ? ` · ${options.extra}` : "";
  // The command and what follows it share a narrow line: the command keeps at least half.
  const room = Math.max(Math.min(len(cmd), Math.floor(width / 2)), width - len(extra));
  g.put(0, 0, fit(cmd, room), "dim");
  if (extra) g.put(Math.min(len(cmd), room), 0, fit(extra, width - Math.min(len(cmd), room)), "dim");
  let x = 0;
  for (const [t, k] of line2) {
    if (x >= width) break;
    g.put(x, 1, fit(t, width - x), k);
    x += len(t);
  }
  return g;
}

