// ============================================
// The layouts: horizontal, vertical, one-line strip
// ============================================
// A drawing and a run state in, a character grid out. Horizontal: roles left
// to right, ways back as arcs above with their condition and their limit,
// also edges dotted below, a consulted role hanging under its caller, the
// walls as a matrix. Vertical, for narrow screens: roles top to bottom, ways
// back numbered on the right margin, the walls one line per role. Strip: one
// line for a run, or for a terminal too narrow for the rest. Ported from the
// design's prototype (docs/design/2026-11/html/topogrid.js).

import { Grid, chars, fit, len, type Meaning } from "./grid.js";
import { elapsed, initialRunState, shortTokens, type RunState } from "./run-state.js";
import type { Drawing } from "./drawing.js";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface LayoutOptions {
  /** The spinner frame to draw (a terminal advances it; snapshots fix it). */
  spin?: string;
  /** Draw the walls when the drawing has them (default true). */
  sight?: boolean;
  /** Draw the status line above the drawing (default true); a screen puts its own at the bottom. */
  header?: boolean;
}

/** A bar of n of `of`, in `cells` cells: only for a count with a measured limit. */
export function bar(n: number, of: number, cells: number): string {
  if (!(of > 0) || cells <= 0) return "";
  const full = Math.max(0, Math.min(cells, Math.round((n / of) * cells)));
  return "▰".repeat(full) + "▱".repeat(cells - full);
}

/** What an active role's box says: asking, its model calls against its cap, or working. */
function activeNote(s: RunState, id: string, spin: string, room: number): string {
  if (s.asking?.role === id) return "‖ asks you";
  if (s.consult?.live && s.consult.from === id) return `${spin} asking`;
  const cap = s.caps[id];
  const calls = s.turns[id]?.calls ?? 0;
  if (cap && calls > 0) {
    const count = `${calls}/${cap}`;
    const cells = Math.max(0, Math.min(5, room - len(count) - 4));
    return cells >= 3 ? `${spin} ${bar(calls, cap, cells)} ${count}` : `${spin} ${count} calls`;
  }
  return `${spin} working`;
}

const BOX_W = 15;
const GAP = 4;
const BOX_H = 5;

interface Status {
  lead: string;
  leadK: Meaning;
  text: string;
  /** Waiting for you: notes queued for Do. */
  you?: string;
}

function status(d: Drawing, s: RunState, spin: string): Status | null {
  if (s.phase === "rest") return null;
  const tok = `${shortTokens(s.tokens)} tokens`;
  const consults = s.consults ? ` · ${s.consults} consult${s.consults > 1 ? "s" : ""}` : "";
  if (s.phase === "running") {
    const of = d.limit > 0 ? ` of ${d.limit}` : "";
    const you = s.notes.length ? `‖ ${s.notes.length} note${s.notes.length > 1 ? "s" : ""} for Do` : undefined;
    return { lead: `${spin} running`, leadK: "run", text: `${d.unit} ${Math.max(1, s.round)}${of} · ${elapsed(s)} · ${tok}${consults}`, ...(you ? { you } : {}) };
  }
  const o = s.outcome?.outcome ?? "ended";
  const lead = o === "passed" ? "✓ passed" : o === "failed" ? "✗ failed" : `■ ${o}`;
  return { lead, leadK: o === "passed" ? "pass" : o === "failed" ? "fail" : "b", text: `after ${s.round} ${d.unit}${s.round === 1 ? "" : "s"} · ${tok}${consults} · ${elapsed(s)}` };
}

/** What a role's box says during a run, when it has no result of its own this round. */
function idleNote(d: Drawing, s: RunState, id: string): string {
  if (s.done.includes(id)) {
    const t = s.tokensByRole[id];
    return `· done${t ? ` ${shortTokens(t)}` : ""}`;
  }
  const at = d.roles.findIndex((r) => r.id === s.startAt);
  // A round that a way back started further on does not run the roles before its start.
  if (at > 0 && d.roles.findIndex((r) => r.id === id) < at) return s.phase === "done" ? "· not run" : "· not now";
  return s.phase === "done" ? "· not run" : "· waiting";
}

function roundMarks(g: Grid, x: number, y: number, total: number, s: RunState): number {
  for (let r = 1; r <= total; r++) {
    const rs = s.rounds[r - 1];
    const ch = !rs ? "○" : rs.state === "now" ? "◉" : "●";
    const k: Meaning = !rs ? "faint" : rs.state === "now" ? "run" : rs.state === "fail" ? "fail" : "ink";
    g.put(x, y, ch, k);
    x += 1;
    if (rs?.flag) {
      g.put(x, y, "⚑", "b");
      x += 1;
    }
    g.put(x, y, " ", "");
    x += 1;
  }
  return x;
}

/** The width the horizontal layout needs. */
export function horizontalWidth(d: Drawing, options: LayoutOptions = {}): number {
  return horizontal(d, initialRunState(0), { ...options }).usedWidth();
}

export function horizontal(d: Drawing, s: RunState = initialRunState(0), options: LayoutOptions = {}): Grid {
  const spin = options.spin ?? SPINNER[2];
  const withSight = options.sight !== false && Boolean(d.sight);
  const longest = withSight ? Math.max(...d.sight!.rows.map((r) => len(r.label))) + 4 : 0;
  const LW = Math.min(26, Math.max(20, longest, ...d.summary.map((l) => len(l) + 2), len(d.title) + 2));
  const n = d.roles.length;
  const idx = new Map(d.roles.map((r, i) => [r.id, i]));
  const bx = (i: number) => LW + i * (BOX_W + GAP);
  const span = (a: { from: string; to: string }) => (idx.get(a.from)! - idx.get(a.to)!);
  const back = [...d.back].sort((a, b) => span(a) - span(b));
  const R0 = 2 + 2 * back.length;
  const Rb = R0 + BOX_H - 1;
  const also = [...d.also].filter((a) => idx.has(a.from) && idx.has(a.to)).sort((a, b) => span(a) - span(b));
  const alsoBottom = also.length ? Rb + 2 + 2 * (also.length - 1) : Rb;
  const consultTop = alsoBottom + 1;
  const consultRows = d.consults.length ? 7 : 0;
  const matrixTop = (d.consults.length ? consultTop + consultRows : alsoBottom + 3) + (also.length && !d.consults.length ? 0 : 0);
  const st = status(d, s, spin);
  const noteLen = Math.max(0, ...d.consults.map((c) => bx(idx.get(c.from) ?? 0) + BOX_W + 2 + len(c.note)));
  const backLen = Math.max(0, ...back.map((a) => bx(Math.min(idx.get(a.to)!, idx.get(a.from)!)) + 12 + len(a.label) + (a.dots ?? 0) * 3 + 12));
  const exitLen = bx(n - 1) + BOX_W + 5 + Math.max(len(d.exit.label), ...d.exit.when.map(len));
  // The status line is cut to the drawing's width; it never widens it.
  const width = Math.max(exitLen, noteLen, backLen, LW + 60);
  const rows = withSight ? d.sight!.rows.length + 2 : 0;
  const g = new Grid(width, matrixTop + rows + 4);

  // The status line, or the line at rest.
  if (options.header === false) {
    // A screen draws its own status line.
  } else if (st) {
    g.put(LW, 0, st.lead, st.leadK);
    const text = fit(st.text, width - LW - len(st.lead) - 1);
    g.put(LW + len(st.lead) + 1, 0, text, "dim");
    if (st.you) g.put(LW + len(st.lead) + len(text) + 4, 0, fit(st.you, width - LW - len(st.lead) - len(text) - 4), "you");
  } else g.put(LW, 0, fit(d.restLine, width - LW), "faint");

  // The gutter: name and summary.
  g.put(0, R0 + 1, fit(d.title, LW - 1), "b");
  d.summary.forEach((l, i) => g.put(0, R0 + 2 + i, fit(l, LW - 1), "dim"));

  // Ways back as arcs above, each from its deciding role down to where the next round starts.
  const exitUsed = new Map<number, number>();
  const entryUsed = new Map<number, number>();
  const exitX = new Map<string, number>();
  back.forEach((a, j) => {
    const sI = idx.get(a.from)!;
    const tI = idx.get(a.to)!;
    const lane = R0 - 2 - 2 * j;
    const ei = (exitUsed.get(sI) ?? -1) + 1;
    exitUsed.set(sI, ei);
    const ni = (entryUsed.get(tI) ?? -1) + 1;
    entryUsed.set(tI, ni);
    const self = sI === tI;
    const xs = self ? bx(sI) + 11 : bx(sI) + 6 + 3 * ei;
    const xt = self ? bx(tI) + 3 : bx(tI) + 9 - 3 * ni;
    // The way back just taken: the round started at its target, and nothing has finished yet.
    const live = s.phase === "running" && s.round > 1 && s.startAt === a.to && s.done.length === 0;
    const k: Meaning = live ? "run" : "ln";
    for (let y = lane + 1; y < R0; y++) g.put(xs, y, "│", k);
    g.put(xs, lane, "╮", k);
    for (let x = xt + 1; x < xs; x++) g.put(x, lane, "─", k);
    g.put(xt, lane, "╭", k);
    for (let y = lane + 1; y < R0 - 1; y++) g.put(xt, y, "│", k);
    g.put(xt, R0 - 1, "▼", k);
    exitX.set(a.id, xs);
    let lx = self ? xs + 2 : xt + 2;
    const label = ` ↺ ${a.label} `;
    g.put(lx, lane, label, live ? "run" : "ink");
    lx += len(label);
    if (a.dots) {
      g.put(lx, lane, " ", "");
      lx += 1;
      lx = roundMarks(g, lx, lane, a.dots, s);
      g.put(lx, lane, `${a.max} `, "dim");
    } else if (a.counter) {
      const running = s.phase === "running" && s.round > 0;
      g.put(lx, lane, "· ", "dim");
      lx += 2;
      if (running) {
        const now = `${d.unit} ${s.round} · `;
        g.put(lx, lane, now, "run");
        lx += len(now);
      }
      g.put(lx, lane, `${a.max} `, running ? "run" : "dim");
    } else if (!a.carriesRounds && d.limit === 0) {
      g.put(lx, lane, `${a.max} `, "dim");
    }
  });

  // The boxes, in the drawn order.
  d.roles.forEach((r, i) => {
    const x = bx(i);
    const isA = r.id === s.active;
    const res = s.results[r.id];
    const k: Meaning = isA ? "run" : res?.k === "fail" ? "fail" : "ln";
    g.box(x, R0, BOX_W, BOX_H, k);
    g.put(x + 2, R0 + 1, fit(`${r.icon} ${r.label}`, BOX_W - 3), isA ? "run" : "b");
    // At rest the box says its engine, then its model; during a run, its model, then what it is doing.
    if (s.phase === "rest" || !r.model) g.put(x + 2, R0 + 2, fit(r.engine, BOX_W - 3), "faint");
    else g.put(x + 2, R0 + 2, fit(r.model, BOX_W - 3), "dim");
    if (res) g.put(x + 2, R0 + 3, fit(res.txt, BOX_W - 3), res.k);
    else if (isA) g.put(x + 2, R0 + 3, fit(activeNote(s, r.id, spin, BOX_W - 3), BOX_W - 3), s.asking?.role === r.id ? "you" : "run");
    else if (s.phase !== "rest") g.put(x + 2, R0 + 3, fit(idleNote(d, s, r.id), BOX_W - 3), "faint");
    else g.put(x + 2, R0 + 3, fit(r.model, BOX_W - 3), "dim");
    back.forEach((a) => {
      if (idx.get(a.from) === i) g.put(exitX.get(a.id)!, R0, "┴", k);
    });
    if (i < n - 1) {
      const ax = x + BOX_W;
      g.put(ax, R0 + 1, `${"─".repeat(GAP - 1)}▶`, "ln");
      if (s.phase === "running" && s.lastFinished === r.id && !s.active) g.put(ax + 1, R0 + 1, "▣", "run");
    }
  });

  // The exit, with its stop condition.
  const ex = bx(n - 1) + BOX_W;
  const finalK: Meaning = s.outcome ? (s.outcome.outcome === "passed" ? "pass" : s.outcome.outcome === "failed" ? "fail" : "b") : "b";
  g.put(ex, R0 + 1, "──▶ ", "ln");
  g.put(ex + 4, R0 + 1, s.outcome ? `${d.exit.label} ${s.outcome.outcome === "passed" ? "✓" : s.outcome.outcome === "failed" ? "✗" : "■"}` : d.exit.label, finalK);
  d.exit.when.forEach((l, i) => g.put(ex + 1, R0 + 2 + i, l, "dim"));

  // Also edges below, dotted: wires back that start no round.
  also.forEach((a, j) => {
    const sI = idx.get(a.from)!;
    const tI = idx.get(a.to)!;
    const lane = Rb + 2 + 2 * j;
    const xs = bx(sI) + 5 + 2 * j;
    const xt = bx(tI) + 3 + 2 * j;
    if (xs <= xt) return;
    g.put(xs, Rb, "┬", "faint");
    for (let y = Rb + 1; y < lane; y++) g.put(xs, y, "┆", "faint");
    g.put(xs, lane, "╯", "faint");
    for (let x = xt + 1; x < xs; x++) g.put(x, lane, "┄", "faint");
    g.put(xt, lane, "╰", "faint");
    for (let y = Rb + 2; y < lane; y++) g.put(xt, y, "┆", "faint");
    g.put(xt, Rb + 1, "▲", "faint");
    g.put(xt + 2, lane, ` ${a.label} `, "faint");
  });

  // A consulted role hangs under its caller.
  d.consults.forEach((c) => {
    const i = idx.get(c.from);
    if (i === undefined) return;
    const x = bx(i);
    const cx = x + 7;
    const live = Boolean(s.consult?.live && s.consult.to === c.to);
    const k: Meaning = live ? "run" : "dim";
    g.put(cx, Rb, "┬", k);
    for (let y = Rb + 1; y < consultTop + 1; y++) g.put(cx, y, live ? "┃" : "┆", k);
    g.put(cx, consultTop + 1, "⇅", k);
    g.put(cx + 2, consultTop + 1, live ? `${spin} consulting${s.consult?.question ? `: ${fit(s.consult.question, 50)}` : ""}` : c.label, live ? "run" : "dim");
    g.put(cx, consultTop + 2, live ? "┃" : "┆", k);
    g.box(x, consultTop + 3, BOX_W, 3, live ? "run" : "ln");
    g.put(cx, consultTop + 3, "┴", k);
    g.put(x + 2, consultTop + 4, fit(`${c.icon} ${c.name}`, BOX_W - 3), live ? "run" : "b");
    g.put(x + BOX_W + 1, consultTop + 4, c.note, "dim");
  });

  // The walls: one column per role, what reaches its prompt.
  if (withSight) {
    const y0 = matrixTop;
    g.put(0, y0, "what each role sees", "faint");
    d.roles.forEach((r, i) => g.put(bx(i) + 2, y0, fit(r.label, BOX_W), r.id === s.active ? "run" : "faint"));
    d.sight!.rows.forEach((row, ri) => {
      const y = y0 + 1 + ri;
      g.put(0, y, `${row.mark} `, "ink");
      g.put(len(row.mark) + 1, y, fit(row.label, LW - 3 - len(row.mark)), "dim");
      row.cells.forEach((cell, i) => {
        g.put(bx(i) + 2, y, cell, cell === "●" ? "ink" : "faint");
        if (i < n - 1) g.put(bx(i) + BOX_W + 1, y, "┊", "faint");
      });
    });
    g.put(0, y0 + 1 + d.sight!.rows.length, d.sight!.legend, "faint");
  }
  return g.trim();
}

/** Roles top to bottom, ways back numbered on the right margin, the walls one line per role. */
export function vertical(d: Drawing, s: RunState = initialRunState(0), options: LayoutOptions & { width?: number } = {}): Grid {
  const spin = options.spin ?? SPINNER[2];
  const n = d.roles.length;
  const idx = new Map(d.roles.map((r, i) => [r.id, i]));
  const back = [...d.back].sort((a, b) => (idx.get(a.from)! - idx.get(a.to)!) - (idx.get(b.from)! - idx.get(b.to)!));
  const maxWidth = options.width ?? 80;
  const BW = Math.max(18, Math.min(30, maxWidth - 4 - 3 * back.length - 2));
  const exits = new Map<string, number>();
  back.forEach((a) => exits.set(a.from, (exits.get(a.from) ?? 0) + 1));
  const BH = 2 + Math.max(1, ...exits.values());
  const STEP = BH + 2;
  const top = 2;
  const by = (i: number) => top + i * STEP;
  const width = Math.max(BW + 4 + 3 * back.length + 2, maxWidth);
  const sightLines = options.sight !== false && d.sight ? d.sight.short.length + 2 : 0;
  const g = new Grid(width, top + n * STEP + 6 + back.length * 2 + d.consults.length * 2 + sightLines + d.exit.when.length + 2);
  const st = status(d, s, spin);
  if (options.header === false) {
    // A screen draws its own status line.
  } else if (st) {
    g.put(0, 0, st.lead, st.leadK);
    g.put(len(st.lead) + 1, 0, fit(st.text, width - len(st.lead) - 1), "dim");
  } else g.put(0, 0, fit(`${d.title} · ${d.summary.slice(1).join(" · ")}`, width), "faint");

  d.roles.forEach((r, i) => {
    const y = by(i);
    const isA = r.id === s.active;
    const res = s.results[r.id];
    const k: Meaning = isA ? "run" : res?.k === "fail" ? "fail" : "ln";
    g.box(0, y, BW, BH, k);
    g.put(2, y + 1, fit(`${r.icon} ${r.label}`, BW - 4), isA ? "run" : "b");
    const right = res
      ? res.txt
      : isA
        ? activeNote(s, r.id, spin, 14)
        : s.phase !== "rest"
          ? idleNote(d, s, r.id).replace(/ \d[\d.]*[kM]?$/, "")
          : "";
    const rightK: Meaning = res ? res.k : isA ? (s.asking?.role === r.id ? "you" : "run") : "faint";
    if (right) g.put(BW - 2 - len(right), y + 1, right, rightK);
    // The model, beside the label during a run (or below it, when the box has room), the engine at rest.
    const head = len(`${r.icon} ${r.label}`) + 2;
    if (BH > 3) g.put(2, y + 2, fit(s.phase === "rest" || !r.model ? r.engine : r.model, BW - 4), s.phase === "rest" || !r.model ? "faint" : "dim");
    else if (s.phase !== "rest" && r.model && BW - 2 - len(right) - head - 2 >= 4) g.put(head + 1, y + 1, fit(r.model, BW - 2 - len(right) - head - 2), "dim");
    if (i < n - 1) {
      g.put(Math.floor(BW / 2), y + BH, "│", "ln");
      const token = s.phase === "running" && s.lastFinished === r.id && !s.active;
      g.put(Math.floor(BW / 2), y + BH + 1, token ? "▣" : "▼", token ? "run" : "ln");
    }
  });
  const used = new Map<string, number>();
  back.forEach((a, j) => {
    const ei = (used.get(a.from) ?? -1) + 1;
    used.set(a.from, ei);
    const yt = by(idx.get(a.to)!) + 1;
    const x = BW + 2 + 3 * j;
    const yS = by(idx.get(a.from)!) + 1 + ei;
    const k: Meaning = "ln";
    if (yS === yt) {
      // A role that sends the work back to itself: a small loop on its right side.
      g.put(BW - 1, yS, "├", k);
      g.put(BW, yS, "─╮", k);
      g.put(BW, yS + 1, "◀╯", k);
      g.put(BW + 3, yS, String(j + 1), "b");
      return;
    }
    g.put(BW - 1, yS, "├", k);
    for (let xx = BW; xx < x; xx++) g.put(xx, yS, "─", k);
    g.put(x, yS, "╯", k);
    for (let y = yt + 1; y < yS; y++) g.put(x, y, "│", k);
    g.put(x, yt, "╮", k);
    for (let xx = BW; xx < x; xx++) g.put(xx, yt, "─", k);
    g.put(BW, yt, "◀", k);
    g.put(x, Math.floor((yt + yS) / 2), String(j + 1), "b");
  });

  let y = top + n * STEP - 1;
  g.put(0, y, `└▶ ${d.exit.label}${s.outcome ? (s.outcome.outcome === "passed" ? " ✓" : s.outcome.outcome === "failed" ? " ✗" : " ■") : ""}: ${d.exit.when.join(" ")}`, s.outcome ? (s.outcome.outcome === "passed" ? "pass" : s.outcome.outcome === "failed" ? "fail" : "b") : "dim");
  y += 2;
  back.forEach((a, j) => {
    g.put(0, y, fit(`${j + 1} ↺ ${a.label}`, width), "ink");
    if (a.dots || a.counter) {
      let x = 2;
      y += 1;
      if (a.dots) x = roundMarks(g, x, y, a.dots, s);
      else if (s.phase === "running") {
        const now = `${d.unit} ${s.round} · `;
        g.put(x, y, now, "run");
        x += len(now);
      }
      g.put(x, y, a.max, "dim");
    }
    y += 1;
  });
  d.consults.forEach((c) => {
    const live = Boolean(s.consult?.live && s.consult.to === c.to);
    const caller = d.roles.find((r) => r.id === c.from)?.label ?? c.from;
    g.put(0, y, fit(`⇅ ${caller} asks ${c.icon} ${c.name} · ${c.label}`, width), live ? "run" : "dim");
    y += 1;
    g.put(2, y, fit(c.note, width - 2), "faint");
    y += 1;
  });
  if (options.sight !== false && d.sight) {
    y += 1;
    g.put(0, y, "what each role sees", "faint");
    y += 1;
    for (const line of d.sight.short) {
      const r = d.roles.find((x) => x.id === line.role)!;
      let x = 0;
      const head = `${r.icon} ${r.label} `;
      g.put(x, y, head, r.id === s.active ? "run" : "b");
      x += len(head);
      for (const p of line.parts) {
        const part = `${p.mark} ${p.label} `;
        if (x + len(part) > width) {
          y += 1;
          x = len(head);
        }
        g.put(x, y, p.mark, "ink");
        g.put(x + len(p.mark) + 1, y, p.label, "dim");
        x += len(part);
      }
      if (line.parts.length === 0) g.put(x, y, "nothing of the run", "faint");
      y += 1;
    }
  }
  return g.trim();
}

/** One line: the roles in order, the active one and the failed ones marked, the rounds. */
export function strip(d: Drawing, s: RunState = initialRunState(0), options: LayoutOptions & { width?: number } = {}): Grid {
  const spin = options.spin ?? SPINNER[2];
  const parts: Array<[string, Meaning]> = [];
  d.roles.forEach((r, i) => {
    if (i) parts.push(["─▶", "ln"]);
    const isA = r.id === s.active;
    const res = s.results[r.id];
    const note = isA ? ` ${spin}` : res ? ` ${chars(res.txt)[0]}` : "";
    parts.push(["[", isA ? "run" : "ln"], [`${r.icon} ${r.label}${note}`, isA ? "run" : res?.k === "fail" ? "fail" : s.done.includes(r.id) ? "dim" : "b"], ["]", isA ? "run" : "ln"]);
  });
  if (d.back.length) {
    const rounds = s.phase === "rest" ? ` ↺ ${d.limit || "∞"}` : ` ↺ ${s.round}/${d.limit || "∞"}`;
    parts.push([rounds, s.phase === "running" ? "run" : "dim"]);
  }
  if (d.consults.length) parts.push([` ⇅ ${d.consults.map((c) => c.name).join(", ")}`, s.consult?.live ? "run" : "dim"]);
  if (s.outcome) parts.push([` ${s.outcome.outcome === "passed" ? "✓" : s.outcome.outcome === "failed" ? "✗" : "■"} ${s.outcome.outcome}`, s.outcome.outcome === "passed" ? "pass" : s.outcome.outcome === "failed" ? "fail" : "b"]);
  // Wrapped at the arrows when the line is wider than the screen.
  const width = options.width ?? Infinity;
  const lines: Array<Array<[string, Meaning]>> = [[]];
  let at = 0;
  for (const p of parts) {
    if (p[0] === "─▶" && at + 2 + 20 > width && at > 0) {
      lines.push([]);
      at = 0;
    }
    lines[lines.length - 1].push(p);
    at += len(p[0]);
  }
  const st = options.header === false ? null : status(d, s, spin);
  const head = st ? [`${st.lead} ${st.text}`] : [];
  const w = Math.max(...lines.map((l) => l.reduce((a, [t]) => a + len(t), 0)), ...head.map(len));
  const g = new Grid(Math.min(w, Number.isFinite(width) ? Math.max(width, 10) : w), lines.length + head.length);
  if (st) {
    g.put(0, 0, st.lead, st.leadK);
    g.put(len(st.lead) + 1, 0, fit(st.text, g.w - len(st.lead) - 1), "dim");
  }
  lines.forEach((line, y) => {
    let x = 0;
    for (const [t, k] of line) {
      g.put(x, y + head.length, t, k);
      x += len(t);
    }
  });
  return g;
}

export type LayoutName = "horizontal" | "vertical" | "strip";

/** The layout a width allows: horizontal when it fits, vertical down to 80 columns, the strip below that. */
export function layoutFor(d: Drawing, width: number, options: LayoutOptions = {}): LayoutName {
  if (horizontalWidth(d, options) <= width) return "horizontal";
  return width >= 80 ? "vertical" : "strip";
}

export function draw(d: Drawing, s: RunState, layout: LayoutName, options: LayoutOptions & { width?: number } = {}): Grid {
  if (layout === "horizontal") return horizontal(d, s, options);
  if (layout === "vertical") return vertical(d, s, options);
  return strip(d, s, options);
}
