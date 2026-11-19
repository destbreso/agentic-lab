// ============================================
// Keys, decoded from what the terminal sends
// ============================================
// Ink splits stdin into events: a run of text, one escape sequence, or a
// lone Escape once it has waited for more. This turns each into a key the
// session understands. A bracketed paste (the session turns the mode on)
// arrives between ESC[200~ and ESC[201~ and goes in whole; a terminal
// without the mode sends a paste as one run of text with newlines in it,
// which goes in whole too, so a pasted newline never sends.

import type { EditorKey } from "./editor.js";

export type SessionKey =
  | EditorKey
  | { kind: "escape" }
  | { kind: "ctrl"; letter: string }
  | { kind: "tab" }
  | { kind: "shift-tab" }
  | { kind: "pageup" }
  | { kind: "pagedown" }
  | { kind: "paste-start" }
  | { kind: "paste-end" }
  | { kind: "ignore" };

const SEQUENCES: Record<string, SessionKey> = {
  "\x1b[A": { kind: "up" },
  "\x1b[B": { kind: "down" },
  "\x1b[C": { kind: "right" },
  "\x1b[D": { kind: "left" },
  "\x1bOA": { kind: "up" },
  "\x1bOB": { kind: "down" },
  "\x1bOC": { kind: "right" },
  "\x1bOD": { kind: "left" },
  "\x1b[H": { kind: "home" },
  "\x1b[F": { kind: "end" },
  "\x1bOH": { kind: "home" },
  "\x1bOF": { kind: "end" },
  "\x1b[1~": { kind: "home" },
  "\x1b[4~": { kind: "end" },
  "\x1b[3~": { kind: "delete" },
  "\x1b[5~": { kind: "pageup" },
  "\x1b[6~": { kind: "pagedown" },
  "\x1b[Z": { kind: "shift-tab" },
  "\x1b[1;3D": { kind: "word-left" },
  "\x1b[1;3C": { kind: "word-right" },
  "\x1b[1;5D": { kind: "word-left" },
  "\x1b[1;5C": { kind: "word-right" },
  "\x1bb": { kind: "word-left" },
  "\x1bf": { kind: "word-right" },
  "\x1b\r": { kind: "newline" },
  "\x1b\n": { kind: "newline" },
  "\x1b\x7f": { kind: "kill-word" },
  "\x1b[200~": { kind: "paste-start" },
  "\x1b[201~": { kind: "paste-end" },
  "\x1b": { kind: "escape" },
  "\x1b\x1b": { kind: "escape" },
};

/** The keys in one input event; `pasting` says a bracketed paste is open, so text goes in as it is. */
export function decode(event: string, pasting = false): SessionKey[] {
  if (event.startsWith("\x1b")) {
    if (event === "\x1b[201~") return [{ kind: "paste-end" }];
    if (pasting) return [{ kind: "paste", text: "" }];
    return [SEQUENCES[event] ?? { kind: "ignore" }];
  }
  if (pasting) return [{ kind: "paste", text: event }];
  // A run of text with a newline in it is a paste from a terminal without bracketed paste.
  if (event.length > 1 && /[\r\n]/.test(event.replace(/[\r\n]+$/, ""))) return [{ kind: "paste", text: event }];
  const out: SessionKey[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  for (const ch of event) {
    const code = ch.codePointAt(0)!;
    if (ch === "\r") {
      flush();
      out.push({ kind: "enter" });
    } else if (ch === "\n") {
      flush();
      out.push({ kind: "newline" });
    } else if (ch === "\x7f" || ch === "\b") {
      flush();
      out.push({ kind: "backspace" });
    } else if (ch === "\t") {
      flush();
      out.push({ kind: "tab" });
    } else if (code < 32) {
      flush();
      const letter = String.fromCharCode(code + 96);
      out.push(
        letter === "a" ? { kind: "home" } : letter === "e" ? { kind: "end" } : letter === "u" ? { kind: "kill-start" } : letter === "k" ? { kind: "kill-end" } : letter === "w" ? { kind: "kill-word" } : { kind: "ctrl", letter },
      );
    } else text += ch;
  }
  flush();
  return out;
}

export const BRACKETED_PASTE_ON = "\x1b[?2004h";
export const BRACKETED_PASTE_OFF = "\x1b[?2004l";
