// ============================================
// A screen: fixed regions for the drawing, the log and the footer
// ============================================
// What a terminal shows of a run, live or in replay, composed from the same
// drawing and run state. With the terminal's rows known it is full screen,
// in fixed regions, like htop or less: the drawing (and a consulted role's
// rail) pinned at the top, the two-line footer pinned at the bottom, and the
// log in the rows between, showing the lines that fit and never pushing the
// drawing. When the drawing leaves room beside it, the log goes there, full
// height. When fewer than three rows are left for it, the log is one line,
// the latest event. The drawing keeps priority: a layout that does not fit
// gives way to the strip, and below the strip's minimum the screen says so in
// one line instead of drawing a broken grid.
// Without rows (a pipe, the scrollback at the end) it is one tall page.

import { Grid, fit, len } from "./grid.js";
import { draw, horizontalWidth, layoutFor, SPINNER, type LayoutName } from "./layout.js";
import { RAIL_W, footer, logPanel, rail, ticker, type LogView } from "./panels.js";
import type { Drawing, DrawnConsult } from "./drawing.js";
import { shortTokens, type RunState } from "./run-state.js";

/** The narrowest log that goes beside the drawing. */
export const LOG_BESIDE_MIN = 50;
const FOOTER_H = 2;

export interface ScreenOptions {
  width: number;
  /** The rows the terminal shows: the screen fills them, in fixed regions. */
  rows?: number;
  layout?: LayoutName | "auto";
  spin?: string;
  /** Log lines when the rows do not decide (default 8); "all" for the whole log. */
  logLines?: number | "all";
  /** The line after the last log line to show; the newest when absent. */
  logEnd?: number;
  /** Words for the log's border (the keys that scroll it). */
  logHints?: string;
  /** A dry run on a scripted model. */
  dry?: boolean;
  /** The command the footer shows, and what follows it. */
  command?: string;
  extra?: string;
}

export interface Screen {
  grid: Grid;
  layout: LayoutName;
  /** Where each consulted role's rail went. */
  rail: "beside" | "below" | "line" | "none";
  /** Where the log went, and what part of it shows. */
  log: "below" | "beside" | "ticker" | "none";
  logView: LogView | null;
  /** The terminal is too small for even the strip. */
  tooSmall?: boolean;
}

/** Rows of a grid that hold something, from the first to the last. */
function used(g: Grid): { top: number; bottom: number } {
  let top = -1;
  let bottom = -1;
  g.c.forEach((row, y) => {
    if (row.some((c) => c.ch !== " ")) {
      if (top < 0) top = y;
      bottom = y;
    }
  });
  return top < 0 ? { top: 0, bottom: -1 } : { top, bottom };
}

const heightOf = (g: Grid) => {
  const u = used(g);
  return u.bottom - u.top + 1;
};

/** Copy a grid's used rows into another at (x, y); returns the rows copied. */
function blit(into: Grid, from: Grid, x: number, y: number, keepTop = false): number {
  const { top, bottom } = keepTop ? { top: 0, bottom: from.h - 1 } : used(from);
  for (let r = top; r <= bottom; r++) {
    from.c[r].forEach((cell, i) => {
      if (cell.ch !== " " && y + r - top < into.h && y + r - top >= 0 && x + i < into.w) into.c[y + r - top][x + i] = { ...cell };
    });
  }
  return bottom - top + 1;
}

/** A consulted role in one line, for a screen with no room for its rail. */
function railLine(s: RunState, c: DrawnConsult, width: number): Grid {
  const live = Boolean(s.consult?.live && s.consult.to === c.to);
  const mine = s.consultations.filter((x) => x.to === c.to);
  const read = mine.filter((x) => x.done).reduce((n, x) => n + (x.read ?? 0), 0);
  const g = new Grid(width, 1);
  g.put(0, 0, fit(`${c.icon} ${c.name} ∙ ${c.model} ∙ ${live ? "consulting" : "on call"} ∙ ${mine.length} call${mine.length === 1 ? "" : "s"} ∙ read ${shortTokens(read)} tokens`, width), live ? "run" : "dim");
  return g;
}

interface Top {
  grid: Grid;
  width: number;
  height: number;
  rail: Screen["rail"];
}

/** The drawing and its rails, as one block: the rails beside the grid when they fit, else below it, full or in one line each. */
function topBlock(d: Drawing, s: RunState, layout: LayoutName, width: number, spin: string, railRows: "full" | "line"): Top {
  const main = draw(d, s, layout, { sight: false, spin, width, header: false });
  const mainW = Math.min(width, main.usedWidth());
  const mainH = heightOf(main);
  if (!d.consults.length) {
    const g = new Grid(width, mainH);
    blit(g, main, 0, 0);
    return { grid: g, width: mainW, height: mainH, rail: "none" };
  }
  const beside = layout !== "strip" && mainW + 3 + RAIL_W <= width && railRows === "full";
  const rails = d.consults.map((c) => (railRows === "line" ? railLine(s, c, width) : rail(d, s, c, beside ? RAIL_W : Math.min(width, 60), spin)));
  const railsH = rails.reduce((n, r) => n + r.h, 0);
  const height = beside ? Math.max(mainH, railsH) : mainH + 1 + railsH;
  const g = new Grid(width, height);
  blit(g, main, 0, 0);
  let y = beside ? 0 : mainH + 1;
  for (const r of rails) y += blit(g, r, beside ? mainW + 3 : 0, y, true);
  return { grid: g, width: beside ? mainW + 3 + RAIL_W : Math.max(mainW, ...rails.map((r) => r.usedWidth())), height, rail: beside ? "beside" : railRows === "line" ? "line" : "below" };
}

export function screen(d: Drawing, s: RunState, options: ScreenOptions): Screen {
  const width = Math.max(20, options.width);
  const spin = options.spin ?? SPINNER[2];
  const wanted = options.layout && options.layout !== "auto" ? options.layout : null;
  const foot = footer(d, s, width, { spin, dry: options.dry, command: options.command, extra: options.extra });
  const hints = options.logHints ?? "";

  // The layout the width allows, keeping room beside the grid for a rail when there is one.
  let preferred: LayoutName = wanted ?? layoutFor(d, width, { sight: false });
  if (!wanted && preferred === "horizontal" && d.consults.length && horizontalWidth(d, { sight: false }) + 3 + RAIL_W > width && width < 100) preferred = "vertical";

  if (!options.rows) {
    // One tall page: the drawing, the log, the footer.
    const top = topBlock(d, s, preferred, width, spin, "full");
    const lines = options.logLines === "all" ? Number.MAX_SAFE_INTEGER : (options.logLines ?? 8);
    const total = lines === Number.MAX_SAFE_INTEGER ? s.log.length + 1 : lines + 1;
    const log = logPanel(d, s, width, Math.min(total, s.log.length + 1), options.logEnd, hints);
    const g = new Grid(width, top.height + 1 + log.grid.h + FOOTER_H);
    blit(g, top.grid, 0, 0, true);
    blit(g, log.grid, 0, top.height + 1, true);
    blit(g, foot, 0, top.height + 1 + log.grid.h, true);
    return { grid: g.trim(), layout: preferred, rail: top.rail, log: "below", logView: log.view };
  }

  const rows = options.rows;
  const g = new Grid(width, rows);
  const footY = rows - FOOTER_H;
  const order: LayoutName[] = preferred === "strip" ? ["strip"] : [preferred, "strip"];
  for (const layout of order) {
    for (const railRows of ["full", "line"] as const) {
      if (railRows === "line" && !d.consults.length) continue;
      const top = topBlock(d, s, layout, width, spin, railRows);
      if (top.height + FOOTER_H > rows) continue;
      blit(g, top.grid, 0, 0, true);
      if (rows >= FOOTER_H) blit(g, foot, 0, footY, true);
      // Beside the drawing, full height, when it leaves room; else in the rows left below it.
      const besideW = width - top.width - 3;
      if (layout !== "strip" && besideW >= LOG_BESIDE_MIN && footY >= 3) {
        const log = logPanel(d, s, besideW, footY, options.logEnd, hints);
        blit(g, log.grid, top.width + 3, 0, true);
        return { grid: g, layout, rail: top.rail, log: "beside", logView: log.view };
      }
      const left = footY - top.height;
      if (left >= 3) {
        // A blank row under the drawing when there is room for it.
        const gap = left >= 6 ? 1 : 0;
        const log = logPanel(d, s, width, left - gap, options.logEnd, hints);
        blit(g, log.grid, 0, top.height + gap, true);
        return { grid: g, layout, rail: top.rail, log: "below", logView: log.view };
      }
      if (left >= 1) {
        blit(g, ticker(d, s, width), 0, footY - 1, true);
        return { grid: g, layout, rail: top.rail, log: "ticker", logView: null };
      }
      return { grid: g, layout, rail: top.rail, log: "none", logView: null };
    }
  }
  // Not even the strip fits: say so, and keep the footer when there is room for it.
  const small = new Grid(width, rows);
  const strip = topBlock(d, s, "strip", width, spin, d.consults.length ? "line" : "full");
  small.put(0, 0, fit(`${d.title}: the terminal is ${width}x${rows}; drawing it needs ${strip.height + FOOTER_H} rows`, width), "b");
  if (rows >= 1 + FOOTER_H) blit(small, foot, 0, rows - FOOTER_H, true);
  return { grid: small, layout: "strip", rail: "none", log: "none", logView: null, tooSmall: true };
}

/**
 * The drawing and its rails alone, for a screen that composes its own
 * regions (jig's session): the preferred layout when it fits in `maxRows`,
 * else the strip, its rails in one line each when that is what fits.
 */
export function drawingBlock(
  d: Drawing,
  s: RunState,
  options: { width: number; maxRows: number; layout?: LayoutName | "auto"; spin?: string },
): { grid: Grid; layout: LayoutName; rail: Screen["rail"] } {
  const width = Math.max(20, options.width);
  const spin = options.spin ?? SPINNER[2];
  const wanted = options.layout && options.layout !== "auto" ? options.layout : null;
  let preferred: LayoutName = wanted ?? layoutFor(d, width, { sight: false });
  if (!wanted && preferred === "horizontal" && d.consults.length && horizontalWidth(d, { sight: false }) + 3 + RAIL_W > width && width < 100) preferred = "vertical";
  const order: LayoutName[] = preferred === "strip" ? ["strip"] : [preferred, "strip"];
  let last: Top | null = null;
  for (const layout of order) {
    for (const railRows of ["full", "line"] as const) {
      if (railRows === "line" && !d.consults.length) continue;
      const top = topBlock(d, s, layout, width, spin, railRows);
      last = top;
      if (top.height <= options.maxRows) return { grid: top.grid, layout, rail: top.rail };
    }
  }
  return { grid: last!.grid, layout: "strip", rail: last!.rail };
}

/** The width a screen's lines take, for a caller that must not wrap them. */
export const screenWidth = (sc: Screen): number => Math.max(0, ...sc.grid.c.map((row) => len(row.map((c) => c.ch).join("").trimEnd())));
