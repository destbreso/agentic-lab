// ============================================
// The input: a multi-line editor, as a pure function of keys
// ============================================
// Enter sends; Alt+Enter, Ctrl+J or a backslash before Enter start a new
// line; a paste goes in whole, newlines and all, and never sends. Up and down
// move between lines, and past the first or last line walk the history.
// Ctrl+A, Ctrl+E, Ctrl+U, Ctrl+K, Ctrl+W and Alt+arrows edit as a shell does.

export interface EditorState {
  text: string;
  /** The cursor, as an index into text (code units). */
  cursor: number;
  /** Earlier inputs, oldest first. */
  history: string[];
  /** The history entry shown, or null while editing a new input. */
  historyAt: number | null;
  /** What was being written before the history was walked. */
  draft: string;
}

export type EditorKey =
  | { kind: "text"; text: string }
  | { kind: "paste"; text: string }
  | { kind: "enter" }
  | { kind: "newline" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "word-left" }
  | { kind: "word-right" }
  | { kind: "kill-start" }
  | { kind: "kill-end" }
  | { kind: "kill-word" };

export const emptyEditor = (history: string[] = []): EditorState => ({ text: "", cursor: 0, history, historyAt: null, draft: "" });

/** The line and column of the cursor. */
export function cursorAt(s: Pick<EditorState, "text" | "cursor">): { line: number; col: number } {
  const before = s.text.slice(0, s.cursor);
  const line = before.split("\n").length - 1;
  return { line, col: before.length - before.lastIndexOf("\n") - 1 };
}

const lineStarts = (text: string): number[] => {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
};

const insert = (s: EditorState, t: string): EditorState => ({ ...s, text: s.text.slice(0, s.cursor) + t + s.text.slice(s.cursor), cursor: s.cursor + t.length, historyAt: null });

function moveLine(s: EditorState, dir: -1 | 1): EditorState | null {
  const starts = lineStarts(s.text);
  const { line, col } = cursorAt(s);
  const target = line + dir;
  if (target < 0 || target >= starts.length) return null;
  const end = target + 1 < starts.length ? starts[target + 1] - 1 : s.text.length;
  return { ...s, cursor: Math.min(starts[target] + col, end) };
}

function walkHistory(s: EditorState, dir: -1 | 1): EditorState {
  if (!s.history.length) return s;
  if (dir === -1) {
    const at = s.historyAt === null ? s.history.length - 1 : Math.max(0, s.historyAt - 1);
    const text = s.history[at];
    return { ...s, text, cursor: text.length, historyAt: at, draft: s.historyAt === null ? s.text : s.draft };
  }
  if (s.historyAt === null) return s;
  if (s.historyAt >= s.history.length - 1) return { ...s, text: s.draft, cursor: s.draft.length, historyAt: null };
  const text = s.history[s.historyAt + 1];
  return { ...s, text, cursor: text.length, historyAt: s.historyAt + 1 };
}

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** The editor after a key; `submitted` holds the text when the key sends it. */
export function edit(s: EditorState, key: EditorKey): { state: EditorState; submitted?: string } {
  switch (key.kind) {
    case "text":
      return { state: insert(s, key.text.replace(/\r\n?/g, "\n")) };
    case "paste":
      return { state: insert(s, key.text.replace(/\r\n?/g, "\n")) };
    case "newline":
      return { state: insert(s, "\n") };
    case "enter": {
      // A backslash right before the cursor at the end of a line means a new line, as in a shell.
      if (s.text[s.cursor - 1] === "\\" && (s.cursor === s.text.length || s.text[s.cursor] === "\n")) {
        const without = { ...s, text: s.text.slice(0, s.cursor - 1) + s.text.slice(s.cursor), cursor: s.cursor - 1 };
        return { state: insert(without, "\n") };
      }
      const text = s.text;
      if (!text.trim()) return { state: { ...s, text: "", cursor: 0 } };
      const history = s.history.at(-1) === text ? s.history : [...s.history, text];
      return { state: { text: "", cursor: 0, history, historyAt: null, draft: "" }, submitted: text };
    }
    case "backspace":
      if (s.cursor === 0) return { state: s };
      return { state: { ...s, text: s.text.slice(0, s.cursor - 1) + s.text.slice(s.cursor), cursor: s.cursor - 1 } };
    case "delete":
      return { state: { ...s, text: s.text.slice(0, s.cursor) + s.text.slice(s.cursor + 1) } };
    case "left":
      return { state: { ...s, cursor: Math.max(0, s.cursor - 1) } };
    case "right":
      return { state: { ...s, cursor: Math.min(s.text.length, s.cursor + 1) } };
    case "up":
      return { state: moveLine(s, -1) ?? walkHistory(s, -1) };
    case "down":
      return { state: moveLine(s, 1) ?? walkHistory(s, 1) };
    case "home": {
      const starts = lineStarts(s.text);
      return { state: { ...s, cursor: starts[cursorAt(s).line] } };
    }
    case "end": {
      const starts = lineStarts(s.text);
      const line = cursorAt(s).line;
      return { state: { ...s, cursor: line + 1 < starts.length ? starts[line + 1] - 1 : s.text.length } };
    }
    case "word-left": {
      let i = s.cursor;
      while (i > 0 && !isWord(s.text[i - 1])) i--;
      while (i > 0 && isWord(s.text[i - 1])) i--;
      return { state: { ...s, cursor: i } };
    }
    case "word-right": {
      let i = s.cursor;
      while (i < s.text.length && !isWord(s.text[i])) i++;
      while (i < s.text.length && isWord(s.text[i])) i++;
      return { state: { ...s, cursor: i } };
    }
    case "kill-start": {
      const start = lineStarts(s.text)[cursorAt(s).line];
      return { state: { ...s, text: s.text.slice(0, start) + s.text.slice(s.cursor), cursor: start } };
    }
    case "kill-end": {
      const starts = lineStarts(s.text);
      const line = cursorAt(s).line;
      const end = line + 1 < starts.length ? starts[line + 1] - 1 : s.text.length;
      return { state: { ...s, text: s.text.slice(0, s.cursor) + s.text.slice(end) } };
    }
    case "kill-word": {
      let i = s.cursor;
      while (i > 0 && !isWord(s.text[i - 1])) i--;
      while (i > 0 && isWord(s.text[i - 1])) i--;
      return { state: { ...s, text: s.text.slice(0, i) + s.text.slice(s.cursor), cursor: i } };
    }
  }
}
