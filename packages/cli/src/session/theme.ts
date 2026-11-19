// ============================================
// Jig's identity in the terminal, as data
// ============================================
// The logo, the startup animation and one indicator per engine state live
// here and nowhere else: the session draws only what this module gives it,
// so swapping the design is a change to this file alone. What is here now is
// a neutral placeholder until the author chooses the design.
//
// Colour keeps one rule (docs/design/2026-11/CONCEPT.md, section 7): it means
// a run's state and nothing else. Running is green, failed is red, waiting
// for you is amber; passed is the brightest ink with its mark, not a colour.
// Structure is ink, dim, faint or bold. --plain drops every style, and each
// glyph has an ASCII twin for a terminal that cannot show it.

import type { Meaning } from "jig-core";

/** An animated mark: its frames, its ASCII frames, how long each frame shows, and what it means. */
export interface Indicator {
  frames: readonly string[];
  ascii: readonly string[];
  /** Milliseconds per frame; a single frame does not move. */
  interval: number;
  meaning: Meaning;
}

/** The engine's states a person sees in the session. */
export type IndicatorState =
  /** The topology has the task and no role has started, or a model is writing. */
  | "thinking"
  /** A role is at work: its model call is pending. */
  | "working"
  /** A role's model asked for tools, which are running. */
  | "tool"
  /** A role is consulting the advisor (a consult edge). */
  | "consulting"
  /** A role is waiting for you to allow a command. */
  | "waiting"
  /** A way back was taken: a round starts again further back. */
  | "back"
  | "passed"
  | "failed"
  /** No run. */
  | "idle";

export interface Style {
  color?: "green" | "red" | "yellow" | "gray";
  bold?: boolean;
  dim?: boolean;
}

export interface Theme {
  /** The product's name, as the session writes it. */
  name: string;
  /** One line under the logo. */
  tagline: string;
  /** The logo, a few lines, with its ASCII twin. */
  logo: { unicode: readonly string[]; ascii: readonly string[] };
  /** The startup animation: frames of the logo's lines, shown before the session opens. */
  startup: { frames: ReadonlyArray<{ unicode: readonly string[]; ascii: readonly string[] }>; interval: number };
  indicators: Record<IndicatorState, Indicator>;
  /** The input's prompt mark. */
  prompt: { unicode: string; ascii: string };
  /** The cursor, when the terminal's own is hidden and styles are off. */
  cursor: { unicode: string; ascii: string };
  /** How each meaning of the grid is drawn. */
  styles: Record<Meaning, Style>;
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPIN_ASCII = ["-", "\\", "|", "/"];

export const theme: Theme = {
  name: "Jig",
  tagline: "a Joint Inference Graph: your models, arranged as a graph, at work",
  logo: {
    unicode: ["┌─┐ jig", "└─┘"],
    ascii: ["+-+ jig", "+-+"],
  },
  startup: {
    frames: [
      { unicode: ["┌", "└"], ascii: ["+", "+"] },
      { unicode: ["┌─", "└─"], ascii: ["+-", "+-"] },
      { unicode: ["┌─┐", "└─┘"], ascii: ["+-+", "+-+"] },
      { unicode: ["┌─┐ j", "└─┘"], ascii: ["+-+ j", "+-+"] },
      { unicode: ["┌─┐ ji", "└─┘"], ascii: ["+-+ ji", "+-+"] },
      { unicode: ["┌─┐ jig", "└─┘"], ascii: ["+-+ jig", "+-+"] },
    ],
    interval: 90,
  },
  indicators: {
    thinking: { frames: BRAILLE, ascii: SPIN_ASCII, interval: 90, meaning: "run" },
    working: { frames: BRAILLE, ascii: SPIN_ASCII, interval: 90, meaning: "run" },
    tool: { frames: ["◇", "◆"], ascii: ["*", "+"], interval: 250, meaning: "run" },
    consulting: { frames: ["⇅"], ascii: ["^"], interval: 0, meaning: "run" },
    waiting: { frames: ["‖"], ascii: ["|"], interval: 0, meaning: "you" },
    back: { frames: ["↺"], ascii: ["@"], interval: 0, meaning: "b" },
    passed: { frames: ["✓"], ascii: ["v"], interval: 0, meaning: "pass" },
    failed: { frames: ["✗"], ascii: ["x"], interval: 0, meaning: "fail" },
    idle: { frames: ["·"], ascii: ["."], interval: 0, meaning: "faint" },
  },
  prompt: { unicode: "›", ascii: ">" },
  cursor: { unicode: "█", ascii: "_" },
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
  },
};

/** The frame of an indicator at a time, in the glyph set the terminal shows. */
export function indicatorFrame(state: IndicatorState, now: number, ascii: boolean, t: Theme = theme): string {
  const ind = t.indicators[state];
  const frames = ascii ? ind.ascii : ind.frames;
  if (frames.length <= 1 || ind.interval <= 0) return frames[0] ?? "";
  return frames[Math.floor(now / ind.interval) % frames.length];
}

/** The frames a role's box spins through while it works: the working indicator's. */
export const workingFrames = (ascii: boolean, t: Theme = theme): readonly string[] => (ascii ? t.indicators.working.ascii : t.indicators.working.frames);
