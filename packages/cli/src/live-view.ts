// ============================================
// The live view: a run drawn on its screen as it goes
// ============================================
// The core composes the screen; this puts it on a terminal. In a terminal the
// view takes the alternate screen and fills it in fixed regions (the drawing
// at the top, the log between, the two-line footer at the bottom), redrawn a
// few times a second as well as on every event, so the running role's spinner
// and the clock move while a model call is pending. A frame overwrites the
// last one row by row, inside a synchronized update, so nothing flickers. The
// log can be scrolled back while the run goes on: new lines then wait below,
// counted in its border, until End (or scrolling to the bottom) follows the
// newest again. When the view stops (at the end, on Ctrl+C, on an error, on
// any exit) the terminal gets its screen and cursor back, and the scrollback
// gets the final drawing, the whole log and the footer. Anywhere but a
// terminal there is no redraw: the log is written as plain lines as it grows,
// and the final drawing once at the end.

import {
  drawingOf,
  initialRunState,
  logText,
  reduceRun,
  screen,
  SPINNER,
  toANSI,
  toText,
  type Drawing,
  type LayoutName,
  type RunState,
  type Screen,
  type RunEvent,
  type Topology,
} from "jig-core";

export interface LiveViewOptions {
  write: (text: string) => void;
  /** Draw in place, full screen, on the alternate screen (a terminal). */
  inPlace: boolean;
  color: boolean;
  width: number;
  /** Rows the terminal shows: the screen fills them. */
  rows?: number;
  layout?: LayoutName | "auto";
  /** Each frame as text, with what made it: an event, the clock, or a scroll. */
  onFrame?: (frame: { n: number; event: string; text: string; ansi: string; at: number }) => void;
  source?: string;
  model?: string;
  /** The command the footer shows, as typed. */
  command?: string;
  /** What follows the command in the footer (a replay's position), drawn fresh on every frame. */
  extra?: () => string;
  /** The keys the log's border names. */
  logHints?: string;
  /** The time the view shows; a replay gives its own. */
  clock?: () => number;
  /** A dry run on a scripted model: no tokens. */
  dry?: boolean;
  /** Redraws a second while running (default 8). */
  fps?: number;
  /** The timer; a test gives its own. */
  every?: (fn: () => void, ms: number) => { stop(): void };
}

/** Events after which the drawing changes. */
const DRAWN = new Set(["run:start", "round:start", "role:start", "call", "role:end", "consult:start", "consult:end", "round:end", "steer:queued", "steer:delivered", "run:end"]);

export function describe(e: RunEvent): string {
  switch (e.type) {
    case "role:start":
      return `round ${e.round}: ${e.name} starts`;
    case "call":
      return `round ${e.round}: ${e.name}'s model call ${e.seq} ends${e.tools.length ? `, asking for ${e.tools.join(", ")}` : ""}`;
    case "role:end":
      return `round ${e.round}: ${e.name} ends${e.verdict ? `, verdict ${e.verdict}` : ""}${e.decision ? `, decision ${e.decision}` : ""}`;
    case "round:start":
      return `round ${e.round} starts at ${e.startAt}`;
    case "round:end":
      return `round ${e.round} ends: ${e.verdict ?? "no verdict"}${e.next ? `, next at ${e.next}` : ""}`;
    case "consult:start":
      return `${e.from} consults ${e.name}`;
    case "consult:end":
      return `${e.name} answers${e.sealed ? " (sealed)" : ""}`;
    case "run:end":
      return `run ends: ${e.outcome}`;
    default:
      return e.type;
  }
}

const ENTER = "\x1b[?1049h\x1b[?25l";
const LEAVE = "\x1b[?25h\x1b[?1049l";
const SYNC_ON = "\x1b[?2026h";
const SYNC_OFF = "\x1b[?2026l";

/** Every view drawing in place right now, so an exit of any kind gives the terminal back. */
const open = new Set<LiveView>();
let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => {
    for (const v of open) v.restore();
  });
}

export class LiveView {
  private state: RunState;
  readonly drawing: Drawing;
  private frame = 0;
  private spin = 0;
  private timer: { stop(): void } | null = null;
  private readonly clock: () => number;
  private width: number;
  private rows?: number;
  private entered = false;
  private stopped = false;
  /** The log line after the last one shown while scrolled back; null while following the newest. */
  private logEnd: number | null = null;
  private lastScreen: Screen | null = null;
  /** Log lines already written, off a terminal. */
  private printed = 0;

  constructor(
    topology: Topology,
    private readonly options: LiveViewOptions,
  ) {
    this.clock = options.clock ?? Date.now;
    this.state = initialRunState(this.clock());
    this.drawing = drawingOf(topology, { source: options.source, model: options.model });
    this.width = options.width;
    this.rows = options.rows;
  }

  /** The state drawn now. */
  get current(): RunState {
    return this.state;
  }

  /** Whether the log follows its newest lines. */
  get following(): boolean {
    return this.logEnd === null;
  }

  private render(): { text: string; ansi: string } {
    const sc = screen(this.drawing, this.state, {
      width: this.width,
      ...(this.options.inPlace && this.rows ? { rows: this.rows } : {}),
      layout: this.options.layout ?? "auto",
      spin: SPINNER[this.spin % SPINNER.length],
      dry: this.options.dry,
      ...this.footerWords(),
      ...(this.logEnd !== null ? { logEnd: this.logEnd } : {}),
      logHints: this.options.inPlace ? (this.options.logHints ?? "⇡⇣ PgUp PgDn End") : "",
    });
    this.lastScreen = sc;
    return { text: toText(sc.grid), ansi: toANSI(sc.grid) };
  }

  /** Overwrite the last frame with this one, row by row, in one write. */
  private paint(frame = this.render()): void {
    const lines = (this.options.color ? frame.ansi : frame.text).split("\n");
    const plain = frame.text.split("\n");
    // A row as wide as the screen is not erased after it: the cursor sits on its last cell, which an erase would clear.
    const body = lines.map((l, i) => ([...(plain[i] ?? "")].length < this.width ? `${l}\x1b[K` : l)).join("\r\n");
    const fills = this.rows !== undefined && lines.length >= this.rows;
    this.options.write(`${SYNC_ON}\x1b[H${body}${fills ? "" : "\x1b[J"}${SYNC_OFF}`);
  }

  private record(event: string, frame: { text: string; ansi: string }): void {
    this.frame++;
    this.options.onFrame?.({ n: this.frame, event, ...frame, at: this.state.now - this.state.startedAt });
  }

  private paused = false;

  /** Hold the spinner and the clock while a replay or a dry run is paused. */
  pause(on: boolean): void {
    this.paused = on;
    this.redraw("pause");
  }

  /** Redraw now: the clock and the spinner move on. */
  tick(): void {
    if (this.stopped || this.paused || this.state.phase !== "running") return;
    this.spin++;
    this.state = { ...this.state, now: this.clock() };
    const frame = this.render();
    this.record("clock", frame);
    if (this.options.inPlace) this.paint(frame);
  }

  start(): void {
    if (!this.options.inPlace) return;
    hookExit();
    open.add(this);
    this.options.write(ENTER);
    this.entered = true;
    this.paint();
    const every =
      this.options.every ??
      ((fn, ms) => {
        const t = setInterval(fn, ms);
        return { stop: () => clearInterval(t) };
      });
    this.timer = every(() => this.tick(), Math.round(1000 / (this.options.fps ?? 8)));
  }

  /** The terminal changed size. */
  resize(width: number, rows?: number): void {
    this.width = width;
    this.rows = rows;
    if (this.options.inPlace && this.entered) this.redraw("resize");
  }

  event(e: RunEvent, at = this.clock()): void {
    this.state = reduceRun(this.state, e, at);
    if (!DRAWN.has(e.type)) return;
    const frame = this.render();
    this.record(describe(e), frame);
    if (this.options.inPlace) this.paint(frame);
    else {
      // Off a terminal, no redraw: the log's new lines, as plain lines.
      const lines = logText(this.drawing, this.state, this.printed);
      this.printed += lines.length;
      if (lines.length) this.options.write(`${lines.join("\n")}\n`);
    }
  }

  /** Draw again without anything changing in the run (a key, a pause, a resize). */
  redraw(why = "redraw"): void {
    if (!(this.options.inPlace && this.entered)) return;
    const frame = this.render();
    this.record(why, frame);
    this.paint(frame);
  }

  /** Scroll the log back by `lines` (forward when negative); reaching the newest follows it again. */
  scroll(lines: number): void {
    const view = this.lastScreen?.logView;
    if (!view) return;
    const end = Math.max(Math.min(view.visible, view.total), Math.min(view.total, (this.logEnd ?? view.total) - lines));
    this.logEnd = end >= view.total ? null : end;
    this.redraw("scroll");
  }

  /** Scroll the log a page back (1) or forward (-1). */
  page(direction: 1 | -1): void {
    this.scroll(direction * Math.max(1, (this.lastScreen?.logView?.visible ?? 10) - 1));
  }

  /** Follow the newest log lines again. */
  follow(): void {
    this.logEnd = null;
    this.redraw("scroll");
  }

  /** Scroll to the first log line. */
  top(): void {
    this.scroll(Number.MAX_SAFE_INTEGER);
  }

  private footerWords(): { command?: string; extra?: string } {
    return { ...(this.options.command ? { command: this.options.command } : {}), ...(this.options.extra ? { extra: this.options.extra() } : {}) };
  }

  /** Give the terminal back: the cursor, and the screen it had. Safe to call more than once. */
  restore(): void {
    this.timer?.stop();
    this.timer = null;
    if (this.entered) {
      this.entered = false;
      this.options.write(LEAVE);
    }
    open.delete(this);
  }

  /** Stop: the terminal is given back, and the scrollback gets the final drawing, the whole log and the footer. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const wasInPlace = this.entered;
    this.restore();
    if (wasInPlace) {
      const sc = screen(this.drawing, this.state, { width: this.width, layout: this.options.layout ?? "auto", logLines: "all", dry: this.options.dry, ...this.footerWords() });
      this.options.write(`${this.options.color ? toANSI(sc.grid) : toText(sc.grid)}\n`);
    } else if (!this.options.inPlace) {
      // Off a terminal: whatever the log has not written yet, then the final drawing, once.
      const rest = logText(this.drawing, this.state, this.printed);
      if (rest.length) this.options.write(`${rest.join("\n")}\n`);
      if (this.state.phase !== "rest") {
        const sc = screen(this.drawing, this.state, { width: this.width, layout: this.options.layout ?? "auto", logLines: 0, dry: this.options.dry, ...this.footerWords() });
        this.options.write(`${this.options.color ? toANSI(sc.grid) : toText(sc.grid)}\n`);
      }
    }
  }
}
