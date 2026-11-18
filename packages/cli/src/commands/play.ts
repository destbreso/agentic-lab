// ============================================
// CLI: show <topology> --play, a dry run drawn live
// ============================================
// The topology runs on the core's scripted model (playProvider) in a scratch
// directory, drawn on the same screen a real run uses: the task travels from
// role to role, the rounds tick on the arcs, a consult happens where the
// topology has one. No model, no tokens. Space pauses it, the arrows, PgUp,
// PgDn and End scroll its log, and it plays again until any other key or
// Ctrl+C; --once plays it once, and anywhere but a terminal it plays once,
// writing its log as plain lines.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession, createDefaultToolkit, playProvider } from "@agentic-lab/core";
import { readKeys, scrollKey } from "../keys.js";
import { commandLine, defaultIO, followResize, liveView, type RunnerIO, type ViewOptions } from "../session-runner.js";
import type { ResolvedTopology } from "../topology-arg.js";

export interface PlayOptions extends ViewOptions {
  /** How fast: 1 (each model call takes 0.7 s), 2 twice as fast. */
  speed?: string;
  /** Play once, then stop. */
  once?: boolean;
}

export function speedOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const speed = Number(value);
  if (!(speed > 0) || !Number.isFinite(speed)) throw new Error("--speed must be a number above 0 (1 is real time, 4 four times as fast)");
  return speed;
}

const pause = (ms: number, stop: () => boolean) =>
  new Promise<void>((resolve) => {
    const started = Date.now();
    const t = setInterval(() => {
      if (stop() || Date.now() - started >= ms) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });

export async function playTopology(resolved: ResolvedTopology, options: PlayOptions, io: RunnerIO = defaultIO): Promise<{ runs: number }> {
  const speed = speedOf(options.speed);
  const topology = resolved.topology;
  let quit = false;
  let session: AgentSession | null = null;
  // Paused, the scripted model holds its next answer and the clock stops.
  let pausedAt: number | null = null;
  let pausedFor = 0;
  let release: (() => void) | null = null;
  const gate = () => (pausedAt === null ? Promise.resolve() : new Promise<void>((r) => (release = r)));
  const clock = () => Date.now() - pausedFor - (pausedAt === null ? 0 : Date.now() - pausedAt);
  const stopAll = () => {
    quit = true;
    release?.();
    session?.stop("the dry run was stopped");
  };
  const onScreen = Boolean(io.tty);
  const extra = () => (pausedAt === null ? "▶ dry run · space pauses · q quits" : "‖ paused · space plays · q quits");
  const command = commandLine(["show", topology.id, "--play", ...(speed !== 1 ? ["--speed", String(speed)] : []), ...(options.once ? ["--once"] : [])]);
  const view = liveView(topology, resolved.source, "dry run", options, io, true, { dry: true, clock, extra, command, logHints: "↑↓ PgUp PgDn End" });
  const keys = readKeys((k) => {
    if (scrollKey(k, view)) return;
    if (k === "space") {
      if (pausedAt === null) {
        pausedAt = Date.now();
        view.pause(true);
      } else {
        pausedFor += Date.now() - pausedAt;
        pausedAt = null;
        release?.();
        release = null;
        view.pause(false);
        // Playing again follows the newest lines.
        view.follow();
      }
      return;
    }
    // Any other key stops it, as Ctrl+C does.
    stopAll();
  });
  const onSigint = () => stopAll();
  process.on("SIGINT", onSigint);
  const unfollow = followResize(view, io);
  view.start();
  let runs = 0;
  try {
    while (!quit) {
      const dir = await mkdtemp(join(tmpdir(), "agentic-lab-play-"));
      try {
        // A topology that repeats while its plan is open gets one open item, which Do ticks on its second turn.
        if (topology.defaults.repeat) await writeFile(join(dir, topology.defaults.repeat.planFile ?? "PLAN.md"), "- [ ] the task\n");
        session = new AgentSession({ provider: playProvider({ delayMs: Math.round(700 / speed), gate }), tools: createDefaultToolkit(), topology, workingDir: dir, delayMs: 0 });
        session.on("event", (e) => view.event(e));
        await session.run("A dry run: a scripted model answers, and no tokens are spent.");
        runs++;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      if (options.once || !onScreen) break;
      await pause(Math.round(2000 / speed), () => quit);
    }
  } finally {
    keys.stop();
    unfollow();
    process.off("SIGINT", onSigint);
    view.stop();
  }
  return { runs };
}
