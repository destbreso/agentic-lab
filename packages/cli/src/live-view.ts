// ============================================
// The live view: a run drawn on the topology's grid as its events arrive
// ============================================
// The core's layout engine draws; this only chooses a layout for the
// terminal's width and puts the grid on screen. In a terminal the grid is
// redrawn in place and its spinner turns; anywhere else (a pipe, a file) each
// event that changes the drawing adds a frame, so the output reads as a film
// strip. Colour, used only for a run's state, is off in plain mode.

import {
  draw,
  drawingOf,
  initialRunState,
  layoutFor,
  reduceRun,
  SPINNER,
  toANSI,
  toText,
  type Drawing,
  type LayoutName,
  type RunState,
  type SessionEvent,
  type Topology,
} from "@agentic-lab/core";

export interface LiveViewOptions {
  write: (text: string) => void;
  /** Redraw in place and turn the spinner (a terminal). */
  inPlace: boolean;
  color: boolean;
  width: number;
  /** Rows the terminal shows; a taller grid falls back to the strip when drawn in place. */
  rows?: number;
  layout?: LayoutName | "auto";
  /** Each frame as plain text, with the event that made it. */
  onFrame?: (frame: { n: number; event: string; text: string; ansi: string }) => void;
  source?: string;
  model?: string;
  clock?: () => number;
}

/** Events after which the drawing changes. */
const DRAWN = new Set(["run:start", "round:start", "role:start", "role:end", "consult:start", "consult:end", "round:end", "steer:queued", "steer:delivered", "run:end"]);

function describe(e: SessionEvent): string {
  switch (e.type) {
    case "role:start":
      return `round ${e.round}: ${e.name} starts`;
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

export class LiveView {
  private state: RunState;
  private readonly drawing: Drawing;
  private drawnLines = 0;
  private frame = 0;
  private spin = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly clock: () => number;

  constructor(
    topology: Topology,
    private readonly options: LiveViewOptions,
  ) {
    this.clock = options.clock ?? Date.now;
    this.state = initialRunState(this.clock());
    this.drawing = drawingOf(topology, { source: options.source, model: options.model });
  }

  private layout(): LayoutName {
    const chosen = this.options.layout && this.options.layout !== "auto" ? this.options.layout : layoutFor(this.drawing, this.options.width, { sight: false });
    return chosen;
  }

  private render(): { text: string; ansi: string } {
    let layout = this.layout();
    let grid = draw(this.drawing, this.state, layout, { sight: false, spin: SPINNER[this.spin % SPINNER.length], width: this.options.width });
    // Redrawn in place, a grid taller than the screen would scroll away: the strip fits.
    if (this.options.inPlace && this.options.rows && grid.h > this.options.rows - 2 && layout !== "strip") {
      layout = "strip";
      grid = draw(this.drawing, this.state, layout, { sight: false, spin: SPINNER[this.spin % SPINNER.length], width: this.options.width });
    }
    return { text: toText(grid), ansi: toANSI(grid) };
  }

  private paint(): void {
    const { text, ansi } = this.render();
    const body = this.options.color ? ansi : text;
    const lines = body.split("\n");
    let out = "";
    if (this.drawnLines > 0) out += `\x1b[${this.drawnLines}A`;
    out += lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n";
    // Lines left over from a taller frame are cleared.
    for (let i = lines.length; i < this.drawnLines; i++) out += "\x1b[2K\n";
    const extra = Math.max(0, this.drawnLines - lines.length);
    if (extra) out += `\x1b[${extra}A`;
    this.options.write(out);
    this.drawnLines = lines.length;
  }

  start(): void {
    if (this.options.inPlace) {
      this.options.write("\x1b[?25l");
      this.paint();
      this.timer = setInterval(() => {
        if (this.state.phase !== "running") return;
        this.spin++;
        this.state = { ...this.state, now: this.clock() };
        this.paint();
      }, 120);
    }
  }

  event(e: SessionEvent): void {
    this.state = reduceRun(this.state, e, this.clock());
    if (!DRAWN.has(e.type)) return;
    const frame = this.render();
    this.frame++;
    this.options.onFrame?.({ n: this.frame, event: describe(e), ...frame });
    if (this.options.inPlace) this.paint();
    else this.options.write(`── ${this.frame} · ${describe(e)}\n${this.options.color ? frame.ansi : frame.text}\n\n`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.options.inPlace) {
      this.paint();
      this.options.write("\x1b[?25h");
    }
  }
}
