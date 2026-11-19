// ============================================
// The grid in ASCII, for a terminal that cannot show its glyphs
// ============================================
// One character for one: the grid's alignment holds because every cell keeps
// its width. A glyph with no twin here becomes "?", so nothing outside ASCII
// reaches the terminal.

const TWINS: Record<string, string> = {
  "┌": "+", "┐": "+", "└": "+", "┘": "+", "├": "+", "┤": "+", "┬": "+", "┴": "+", "┼": "+",
  "─": "-", "│": "|", "┄": "-", "╌": "-", "┆": ":", "═": "=", "║": "|",
  "▶": ">", "◀": "<", "▲": "^", "▼": "v", "→": ">", "←": "<", "↑": "^", "↓": "v", "⇅": "^", "↺": "@",
  "●": "*", "◉": "@", "○": "o", "◇": "*", "◆": "#", "■": "#", "□": "o", "▣": "#", "▤": "#", "✦": "*",
  "☰": "=", "⊢": "T", "✓": "v", "✗": "x", "⚑": "!", "‖": "|", "›": ">", "“": '"', "”": '"', "…": "~",
  "▰": "=", "▱": "-", "·": ".", "█": "#", "×": "x", "⠋": "-", "⠙": "\\", "⠹": "|", "⠸": "/", "⠼": "-",
  "⠴": "\\", "⠦": "|", "⠧": "/", "⠇": "-", "⠏": "\\",
};

/** A text with every character outside ASCII replaced by its one-character twin. */
export function toAscii(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code < 128 ? ch : (TWINS[ch] ?? "?");
  }
  return out;
}

/** Whether the session should draw in ASCII: asked for, or a console known to lack the glyphs. */
export function wantsAscii(flag: boolean | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (flag) return true;
  if (env.JIG_ASCII === "1") return true;
  return env.TERM === "linux" || env.TERM === "dumb";
}
