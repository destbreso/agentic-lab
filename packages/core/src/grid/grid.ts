// ============================================
// The character grid, and its two renderers
// ============================================
// A layout fills a grid of cells, each a character and a meaning. A meaning
// is never a colour: the web maps it to the lab's tokens, a terminal to ANSI
// (CONCEPT.md, sections 5.2 and 7). Colour is only for a run's state (run,
// pass, fail, you); structure is dim, default, bold or faint.

import { eastAsianWidth } from "get-east-asian-width";

export type Meaning = "" | "ln" | "ink" | "dim" | "faint" | "b" | "run" | "pass" | "fail" | "you";

export interface Cell {
  ch: string;
  k: Meaning;
}

/** A text's code points. */
export const chars = (s: string): string[] => [...s];

/**
 * The cells a character takes in a terminal: none for a control, a combining
 * mark, a joiner or a variation selector; two for a wide one (CJK, emoji, and
 * whatever today's Unicode tables make wide); one otherwise, ambiguous ones
 * included (every terminal's default). The one width every column in Jig is
 * measured and padded by.
 */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || /^[\p{Mn}\p{Me}\p{Cf}]$/u.test(ch)) return 0;
  return eastAsianWidth(cp);
}

/** A text's width in cells. */
export const len = (s: string): number => chars(s).reduce((n, ch) => n + charWidth(ch), 0);

/** A text padded with spaces to n cells (never cut). */
export const padCells = (s: string, n: number): string => s + " ".repeat(Math.max(0, n - len(s)));

/** Cut a text to n cells, with an ellipsis when it is cut. */
export function fit(s: string, n: number): string {
  if (n <= 0) return "";
  if (len(s) <= n) return s;
  let out = "";
  let used = 0;
  for (const ch of chars(s)) {
    const w = charWidth(ch);
    if (used + w > n - 1) break;
    out += ch;
    used += w;
  }
  return `${out}⋯`;
}

export class Grid {
  c: Cell[][];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.c = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: " ", k: "" as Meaning })));
  }

  /** Write a text from (x, y): a wide character takes its cell and the next (left empty), a combining mark joins the one before. */
  put(x: number, y: number, s: string, k: Meaning = ""): void {
    if (y < 0 || y >= this.h) return;
    const row = this.c[y];
    let col = x;
    for (const ch of chars(s)) {
      const w = charWidth(ch);
      if (w === 0) {
        if (col - 1 >= 0 && col - 1 < this.w) row[col - 1] = { ch: row[col - 1].ch + ch, k: row[col - 1].k };
        continue;
      }
      // A wide character that would not fit before the edge is a space: half of it would push the line out.
      const fits = w === 1 || col + 1 < this.w;
      if (col >= 0 && col < this.w) row[col] = { ch: fits ? ch : " ", k };
      if (w === 2 && fits && col + 1 >= 0 && col + 1 < this.w) row[col + 1] = { ch: "", k };
      col += w;
    }
  }

  get(x: number, y: number): string {
    return this.c[y]?.[x]?.ch ?? " ";
  }

  box(x: number, y: number, w: number, h: number, k: Meaning = "ln"): void {
    this.put(x, y, `┌${"─".repeat(w - 2)}┐`, k);
    for (let r = 1; r < h - 1; r++) {
      this.put(x, y + r, "│", k);
      this.put(x + w - 1, y + r, "│", k);
    }
    this.put(x, y + h - 1, `└${"─".repeat(w - 2)}┘`, k);
  }

  /** Drop the empty rows at the bottom. */
  trim(): this {
    let last = 0;
    this.c.forEach((row, y) => {
      if (row.some((c) => c.ch !== " ")) last = y;
    });
    this.c = this.c.slice(0, last + 1);
    this.h = this.c.length;
    return this;
  }

  /** The widest line actually drawn. */
  usedWidth(): number {
    return Math.max(0, ...this.c.map((row) => len(row.map((c) => c.ch).join("").trimEnd())));
  }
}

/** The grid as plain text, each line's trailing spaces cut. */
export function toText(g: Grid): string {
  return g.c.map((row) => row.map((c) => c.ch).join("").trimEnd()).join("\n");
}

/** One letter per cell that carries a run's state (r run, p pass, f fail, y you), for snapshots. */
export function meaningsOf(g: Grid): string {
  const letter: Partial<Record<Meaning, string>> = { run: "r", pass: "p", fail: "f", you: "y" };
  return g.c.map((row) => row.map((c) => (c.ch !== " " ? (letter[c.k] ?? " ") : " ")).join("").trimEnd()).join("\n");
}

/** SGR codes per meaning: dim, default, bold, bright black; colour for run state only. */
export const SGR: Record<Meaning, string> = { "": "", ln: "2", ink: "", dim: "2", faint: "90", b: "1", run: "1;32", pass: "1", fail: "31", you: "33" };

/** The grid with ANSI escape codes, for a terminal that has colour. */
export function toANSI(g: Grid): string {
  return g.c
    .map((row) => {
      let out = "";
      let cur: string | null = null;
      // Trailing blanks carry no code, so a line ends where its last character does.
      let end = row.length;
      while (end > 0 && row[end - 1].ch === " ") end--;
      for (const c of row.slice(0, end)) {
        const code = c.ch === " " ? "" : SGR[c.k];
        if (code !== cur) {
          out += `\x1b[0m${code ? `\x1b[${code}m` : ""}`;
          cur = code;
        }
        out += c.ch;
      }
      return `${out}\x1b[0m`;
    })
    .join("\n");
}

/** Escape codes read back, as a terminal would show them, as plain text: for tests. */
export const stripANSI = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
