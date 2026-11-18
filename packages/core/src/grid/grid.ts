// ============================================
// The character grid, and its two renderers
// ============================================
// A layout fills a grid of cells, each a character and a meaning. A meaning
// is never a colour: the web maps it to the lab's tokens, a terminal to ANSI
// (CONCEPT.md, sections 5.2 and 7). Colour is only for a run's state (run,
// pass, fail, you); structure is dim, default, bold or faint.

export type Meaning = "" | "ln" | "ink" | "dim" | "faint" | "b" | "run" | "pass" | "fail" | "you";

export interface Cell {
  ch: string;
  k: Meaning;
}

/** Characters as a terminal counts them: one per code point. */
export const chars = (s: string): string[] => [...s];
export const len = (s: string): number => chars(s).length;

/** Cut a text to n characters, with an ellipsis when it is cut. */
export const fit = (s: string, n: number): string => (n <= 0 ? "" : len(s) > n ? chars(s).slice(0, Math.max(0, n - 1)).join("") + "…" : s);

export class Grid {
  c: Cell[][];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.c = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: " ", k: "" as Meaning })));
  }

  put(x: number, y: number, s: string, k: Meaning = ""): void {
    chars(s).forEach((ch, i) => {
      if (y >= 0 && y < this.h && x + i >= 0 && x + i < this.w) this.c[y][x + i] = { ch, k };
    });
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
    return Math.max(0, ...this.c.map((row) => row.map((c) => c.ch).join("").trimEnd().length));
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
