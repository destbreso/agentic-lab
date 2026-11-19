// ============================================
// Jig's identity in the terminal, as data
// ============================================
// Jig is a small topology that dances: three equal round nodes and three
// straight edges, symmetric at rest, drawn in quadrant blocks. Every
// deformation is elastic and returns to rest; a missing edge is a state (the
// base snaps on a failed check, an edge is let go while it waits for you, an
// edge stretches on a way back). The frames are the design's own, in
// jig-theme.json; this module only reads them. Swapping the design is a
// change to these two files alone.
//
// Every cell carries one of the grid's Meaning tokens as a letter, so the one
// style table below draws the logo, the character, the indicators and the
// topology alike: colour means a run's state and nothing else (CONCEPT.md,
// section 7), --plain drops every style, 16 colours and light themes follow
// the terminal's own palette, and each frame has an ASCII twin.

import type { Meaning } from "jig-core";
import data from "./jig-theme.json" with { type: "json" };

/** A frame of the character: its rows, a Meaning letter per cell, the ASCII twin, how long it shows. */
export interface CharacterFrame {
  unicode: readonly string[];
  meanings: readonly string[];
  ascii: readonly string[];
  ms: number;
}

export interface PoseData {
  /** What the pose says, in words. */
  state: string;
  /** Loops while its state lasts; otherwise plays once and holds its last frame. */
  loop: boolean;
  frames: readonly CharacterFrame[];
}

/** One frame of an indicator: three cells, their Meaning letters, how long it shows. */
export interface IndicatorFrame {
  unicode: string;
  meanings: string;
  ms: number;
}

export interface Indicator {
  state: string;
  width: number;
  loop: boolean;
  frames: readonly IndicatorFrame[];
  ascii: ReadonlyArray<{ text: string; ms: number }>;
  /** What a one-shot holds once it has played. */
  settle?: { unicode: string; meanings: string };
  asciiSettle?: string;
}

/** The engine's states a person sees in the session, each with an indicator and a pose. */
export type IndicatorState =
  /** No run. */
  | "idle"
  /** A model is writing. */
  | "thinking"
  /** A role is at work: its model call is pending. */
  | "working"
  /** A role's tool is running. */
  | "tool"
  /** A role is consulting the advisor (a consult edge). */
  | "consulting"
  /** A role is waiting for you to allow a command. */
  | "waiting"
  /** A way back was taken: one-shot. */
  | "back"
  /** The topology has the task, its roles together. */
  | "team"
  /** One-shot. */
  | "passed"
  /** One-shot. */
  | "failed";

/** The character's poses; the consult pose stands for the consulting state. */
export type Pose = "startup" | "idle" | "dance" | "thinking" | "working" | "tool" | "consult" | "waiting" | "back" | "team" | "passed" | "failed";

export const poseOf = (state: IndicatorState): Pose => (state === "consulting" ? "consult" : state);

export interface Style {
  color?: "green" | "red" | "yellow" | "gray";
  bold?: boolean;
  dim?: boolean;
}

interface ThemeData {
  name: string;
  story: string;
  clockMs: number;
  cellMeanings: Record<string, string>;
  mark: { unicode: string; meanings: string; ascii: string; width: number };
  logo: Record<"large" | "medium", { cols: number; rows: number } & CharacterFrame>;
  startup: { cols: number; rows: number; frames: CharacterFrame[] };
  character: Record<"large" | "medium", { cols: number; rows: number; poses: Record<Pose, PoseData> }>;
  indicators: Record<IndicatorState, Indicator>;
}

const d = data as unknown as ThemeData;

export const theme = {
  name: d.name,
  tagline: "joint inference graph",
  /** What a jig is, for the lore and the text; it is never drawn. */
  story: d.story,
  clockMs: d.clockMs,
  /** Each cell letter and the Meaning it stands for. */
  cellMeanings: d.cellMeanings as Record<string, Meaning>,
  /** The graph at rest in two cells. */
  mark: d.mark,
  /** The logo at rest: large (14 by 7) and medium (9 by 4). */
  logo: d.logo,
  /** The startup animation, 18 by 9, about 1.9 seconds. */
  startup: d.startup,
  /** The character's poses, large (18 by 9) and medium (9 by 4, the session's header). */
  character: d.character,
  indicators: d.indicators,
  prompt: { unicode: "›", ascii: ">" },
  cursor: { unicode: "▐", ascii: "_" },
  /** How each Meaning is drawn: colour for a run's state only. */
  styles: {
    "": {},
    ln: { dim: true },
    ink: {},
    dim: { dim: true },
    faint: { color: "gray" },
    b: { bold: true },
    run: { color: "green", bold: true },
    pass: { bold: true },
    fail: { color: "red" },
    you: { color: "yellow" },
  } as Record<Meaning, Style>,
};

export type Theme = typeof theme;

/** The Meaning a cell's letter stands for; a space is unstyled. */
export const cellMeaning = (letter: string): Meaning => (theme.cellMeanings[letter] ?? "") as Meaning;

export type Segments = Array<[string, Meaning]>;

/** A row of text and its Meaning letters as segments, one per run of cells with one meaning. */
export function cells(text: string, meanings: string): Segments {
  const chars = [...text];
  const letters = [...meanings];
  const out: Segments = [];
  chars.forEach((ch, i) => {
    const k = ch === " " ? "" : cellMeaning(letters[i] ?? " ");
    const last = out[out.length - 1];
    if (last && last[1] === k) last[0] += ch;
    else out.push([ch, k]);
  });
  return out;
}

/** The frame of a sequence at a time since it began: looped, or held on its last frame once played. */
function frameAt<T extends { ms: number }>(frames: readonly T[], elapsed: number, loop: boolean, clock = theme.clockMs): { frame: T; done: boolean } {
  const lengths = frames.map((f) => (f.ms > 0 ? f.ms : clock));
  const total = lengths.reduce((n, x) => n + x, 0);
  if (!loop && elapsed >= total) return { frame: frames[frames.length - 1], done: true };
  let t = loop && total > 0 ? ((elapsed % total) + total) % total : Math.max(0, elapsed);
  for (let i = 0; i < frames.length; i++) {
    if (t < lengths[i]) return { frame: frames[i], done: false };
    t -= lengths[i];
  }
  return { frame: frames[frames.length - 1], done: !loop };
}

/** An indicator's three cells at a time since its state began; a one-shot holds its settle frame. */
export function indicatorCells(state: IndicatorState, elapsed: number, ascii: boolean): Segments {
  const ind = theme.indicators[state];
  const { frame, done } = frameAt(ind.frames, elapsed, ind.loop);
  if (done && ind.settle) {
    // A settle mark sits at the right of the indicator's cells, one space before the words, at the same width.
    const text = (ascii ? (ind.asciiSettle ?? ind.settle.unicode) : ind.settle.unicode).trimEnd();
    const letters = ind.settle.meanings.trimEnd();
    const n = [...text].length;
    if (n >= ind.width) return cells([...text].slice(0, ind.width).join(""), letters.padEnd(ind.width, letters.slice(-1) || " "));
    const pad = ind.width - 1 - n;
    return cells(`${" ".repeat(pad)}${text} `, `${" ".repeat(pad)}${letters.padEnd(n, letters.slice(-1) || " ")} `);
  }
  // The ASCII twin keeps its own timing; its cells take the meanings of the frame shown at the same moment.
  return cells(ascii ? frameAt(ind.ascii, elapsed, ind.loop).frame.text : frame.unicode, frame.meanings);
}

/** An indicator's frame as plain text (no meanings), for a place that draws one character set. */
export function indicatorText(state: IndicatorState, elapsed: number, ascii: boolean): string {
  return indicatorCells(state, elapsed, ascii)
    .map(([t]) => t)
    .join("");
}

/** The character in a pose at a time since the pose began, as rows of segments. */
export function poseRows(size: "large" | "medium", pose: Pose, elapsed: number, ascii: boolean): Segments[] {
  const p = theme.character[size].poses[pose];
  const { frame } = frameAt(p.frames, elapsed, p.loop);
  return frame.unicode.map((row, i) => cells(ascii ? (frame.ascii[i] ?? "") : row, frame.meanings[i] ?? ""));
}

/** The startup frame at a time since it began, and whether it has played through. */
export function startupRows(elapsed: number, ascii: boolean): { rows: Segments[]; done: boolean } {
  const { frame, done } = frameAt(theme.startup.frames, elapsed, false);
  return { rows: frame.unicode.map((row, i) => cells(ascii ? (frame.ascii[i] ?? "") : row, frame.meanings[i] ?? "")), done };
}

/** How long the startup plays, in milliseconds. */
export const startupMs = (): number => theme.startup.frames.reduce((n, f) => n + (f.ms > 0 ? f.ms : theme.clockMs), 0);

/** The logo at rest, as rows of segments. */
export function logoRows(size: "large" | "medium", ascii: boolean): Segments[] {
  const l = theme.logo[size];
  return l.unicode.map((row, i) => cells(ascii ? (l.ascii[i] ?? "") : row, l.meanings[i] ?? ""));
}

/** The one-line mark (the graph at rest in two cells), dim when idle. */
export const markCells = (ascii: boolean, meaning: Meaning = "dim"): Segments => [[ascii ? theme.mark.ascii : theme.mark.unicode, meaning]];

/** The two cells a role's box turns through while it works: the working indicator's, trimmed. */
export const workingSpin = (elapsed: number, ascii: boolean): string => indicatorText("working", elapsed, ascii).trimEnd() || (ascii ? "*" : "▞▚");
