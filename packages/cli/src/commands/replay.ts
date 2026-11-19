// ============================================
// CLI: replay <run-id>, a recorded run played on its screen
// ============================================
// The run's step records are read from the storage the run wrote: Postgres
// when it is configured and has them, otherwise the run's folder in the
// working directory, where the CLI keeps the steps of a run whose storage
// was in memory. The core rebuilds the events from them, and the same screen
// a live run uses plays them at the speed they happened (or --speed times
// faster), the log growing up to the current step. Space pauses, the right
// arrow or n steps to the next event, the up and down arrows, PgUp, PgDn and
// End scroll the log, q quits. Anywhere but a terminal the replay writes its
// log as plain lines, and the final drawing.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  createStorage,
  eventsFromSteps,
  existingProjectPath,
  projectPath,
  grid,
  loadConfig,
  PostgresStorage,
  type RecordedRun,
  type RunOutcome,
  type StepRecord,
  type Storage,
  type TimedEvent,
} from "jig-core";
import { readKeys, scrollKey, type Key } from "../keys.js";
import { asciiView, commandLine, defaultIO, followResize, liveView, type RunnerIO, type ViewOptions } from "../session-runner.js";
import { resolveTopology } from "../topology-arg.js";
import { speedOf } from "./play.js";

export interface ReplayOptions extends ViewOptions {
  dir?: string;
  speed?: string;
  /** Draw it with this topology instead of the one the record names. */
  topology?: string;
}

export interface LoadedRun {
  steps: StepRecord[];
  /** Where the steps were read: "Postgres", or the run's folder. */
  from: string;
  topology: string;
  task?: string;
  outcome?: RunOutcome;
  reason?: string;
  limits?: { rounds: number; tokenBudget?: number };
  model?: string;
}

const OUTCOMES = new Set(["passed", "failed", "inconclusive", "stopped"]);

/** A run's steps and what its record says, from the storage it was written to. */
export async function loadRecordedRun(runId: string, workingDir: string, storage: Storage | null): Promise<LoadedRun> {
  if (storage) {
    const steps = await storage.steps.getSteps(runId).catch(() => [] as StepRecord[]);
    if (steps.length) {
      const run = await storage.runs.getRun(runId).catch(() => null);
      const config = (run?.config ?? {}) as Record<string, unknown>;
      const summary = /^\[([a-z]+)\] ([^\n]*)/.exec(run?.summary ?? "");
      const outcome = typeof config.outcome === "string" && OUTCOMES.has(config.outcome) ? (config.outcome as RunOutcome) : undefined;
      return {
        steps,
        from: storage instanceof PostgresStorage ? "Postgres" : "the configured storage",
        topology: String(config.definitionPath ?? config.topology ?? ""),
        ...(run?.name ? { task: run.name } : {}),
        ...(outcome ? { outcome } : {}),
        ...(summary ? { reason: summary[2] } : {}),
        ...(config.limits ? { limits: config.limits as LoadedRun["limits"] } : {}),
        ...(run?.model ? { model: run.model } : {}),
      };
    }
  }
  // .jig/runs, or .agentic-lab/runs for a run recorded before the rename.
  const found = existingProjectPath(workingDir, "runs", runId, "steps.json");
  const file = found ?? projectPath(workingDir, "runs", runId, "steps.json");
  const dir = path.dirname(file);
  if (!found) {
    throw new Error(`No recorded steps for ${runId}: not in ${storage instanceof PostgresStorage ? "Postgres" : "the configured storage"}, and no ${path.relative(workingDir, file) || file}. The history command lists the runs in this directory.`);
  }
  const steps = JSON.parse(await readFile(file, "utf-8")) as StepRecord[];
  const record = existsSync(path.join(dir, "record.json")) ? (JSON.parse(await readFile(path.join(dir, "record.json"), "utf-8")) as Record<string, unknown>) : {};
  const outcome = typeof record.outcome === "string" && OUTCOMES.has(record.outcome) ? (record.outcome as RunOutcome) : undefined;
  return {
    steps,
    from: path.relative(workingDir, dir) || dir,
    topology: String(record.definition ?? record.topology ?? ""),
    ...(typeof record.task === "string" ? { task: record.task } : {}),
    ...(outcome ? { outcome } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    ...(record.limits ? { limits: record.limits as LoadedRun["limits"] } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
  };
}

const mm = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
};

export interface ReplayDeps {
  storage?: Storage | null;
  /** Keys to press, for a test; a terminal's keys otherwise. */
  keys?: (onKey: (k: Key) => void) => { stop(): void };
}

/** Replay a run. Resolves when it has been played to its end, or the viewer quits. */
export async function replayRun(runId: string, options: ReplayOptions, io: RunnerIO = defaultIO, deps: ReplayDeps = {}): Promise<{ events: number; shown: number; from: string }> {
  const workingDir = path.resolve(options.dir ?? ".");
  const speed = speedOf(options.speed);
  let storage: Storage | null = null;
  if (deps.storage !== undefined) storage = deps.storage;
  else {
    const appConfig = await loadConfig(workingDir);
    storage = await createStorage(appConfig.storage).catch(() => null);
  }
  let loaded: LoadedRun;
  try {
    loaded = await loadRecordedRun(runId, workingDir, storage);
  } finally {
    if (deps.storage === undefined) await storage?.close().catch(() => {});
  }
  const topologyArg = options.topology ?? loaded.topology;
  if (!topologyArg) throw new Error(`The record of ${runId} names no topology: pass --topology`);
  const resolved = await resolveTopology(topologyArg);
  const run: RecordedRun = {
    runId,
    topology: resolved.topology,
    ...(loaded.task ? { task: loaded.task } : {}),
    ...(loaded.outcome ? { outcome: loaded.outcome } : {}),
    ...(loaded.reason ? { reason: loaded.reason } : {}),
    ...(loaded.limits ? { limits: loaded.limits } : {}),
  };
  const events: TimedEvent[] = eventsFromSteps(loaded.steps, run);
  io.note(`  replaying ${runId}: ${loaded.steps.length} steps from ${loaded.from}, ${events.length} events`);

  const t0 = events[0]?.at ?? Date.now();
  const total = (events.at(-1)?.at ?? t0) - t0;
  let pos = t0;
  let next = 0;
  let playing = true;
  let quit = false;
  let finished = false;
  const onScreen = Boolean(io.tty);
  // What follows the command in the footer: where the replay is, and how it plays.
  const extra = () => {
    const where = `event ${next} of ${events.length} ∙ ${mm(pos - t0)} of ${mm(total)} ${grid.bar(pos - t0, total, 10)}`;
    if (!onScreen) return where;
    const state = finished ? "▪ the end ∙ q quits" : playing ? `▸ x${speed} ∙ space pauses` : "¦ paused ∙ space plays ∙ ⇢ steps";
    return `${where} ∙ ${state}`;
  };
  const ascii = await asciiView(io);
  const view = liveView(resolved.topology, `${loaded.from}`, loaded.model ?? "", options, io, true, {
    command: commandLine(["replay", runId, ...(speed !== 1 ? ["--speed", String(speed)] : [])]),
    clock: () => pos,
    extra,
    logHints: "⇡⇣ PgUp PgDn End ∙ q quits",
  }, ascii);
  const unfollow = followResize(view, io);

  const deliver = () => {
    const { at, event } = events[next];
    pos = Math.max(pos, at);
    next++;
    view.event(event, at);
  };
  if (!onScreen) {
    // Off a terminal: every event, in order, without waiting; the log as plain lines.
    while (next < events.length) deliver();
    view.stop();
    unfollow();
    return { events: events.length, shown: next, from: loaded.from };
  }

  let wake: (() => void) | null = null;
  const keys = (deps.keys ?? readKeys)((k) => {
    // The log scrolls back whether the replay plays or not; the drawing never moves for it.
    if (scrollKey(k, view)) return;
    if (k === "q" || k === "escape" || k === "ctrl-c") quit = true;
    else if (k === "space" && !finished) {
      playing = !playing;
      view.pause(!playing);
      // Playing again follows the newest lines.
      if (playing) view.follow();
    } else if ((k === "right" || k === "n") && next < events.length) {
      playing = false;
      view.pause(true);
      deliver();
    }
    view.redraw("key");
    wake?.();
  });
  const onSigint = () => {
    quit = true;
    wake?.();
  };
  process.on("SIGINT", onSigint);
  view.start();
  try {
    let last = Date.now();
    while (!quit) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 40);
      });
      wake = null;
      const now = Date.now();
      if (playing && !finished) pos += (now - last) * speed;
      last = now;
      while (playing && next < events.length && events[next].at <= pos) deliver();
      if (next >= events.length && !finished) {
        finished = true;
        pos = t0 + total;
        view.redraw();
      }
    }
  } finally {
    keys.stop();
    unfollow();
    process.off("SIGINT", onSigint);
    view.stop();
  }
  return { events: events.length, shown: next, from: loaded.from };
}

export async function replayCommand(runId: string, options: ReplayOptions): Promise<void> {
  process.env.JIG_LOG_LEVEL ??= "warn";
  try {
    await replayRun(runId, options);
  } catch (e) {
    process.stderr.write(`  ✗ ${(e as Error).message}\n`);
    process.exitCode = 2;
  }
}
