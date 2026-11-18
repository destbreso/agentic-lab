// ============================================
// CLI: run a topology through AgentSession
// ============================================
// `run`, `recipes --run` and `pipeline --recipe` all come here, so the CLI
// runs the same engine as the chat and the builder and prints the same
// events (as JSON lines with --json). Ctrl+C stops the run and aborts the
// calls in flight; a second Ctrl+C exits at once.

import * as fs from "fs/promises";
import { appendFileSync, writeFileSync } from "fs";
import * as path from "path";
import chalk from "chalk";
import {
  AgentSession,
  IterationLogger,
  createDefaultToolkit,
  createProvider,
  createStorage,
  loadConfig,
  loadTaskFile,
  type MemoryScope,
  type RunRequest,
  type AgentRunResult,
  type LLMProvider,
  type LoopResult,
  type SessionEvent,
  type Storage,
  type Topology,
  type LayoutName,
  describeIssue,
} from "@agentic-lab/core";
import { resolveTopology } from "./topology-arg.js";
import { LiveView } from "./live-view.js";

export interface TopologyRunOptions {
  topology?: string;
  task?: string;
  prompt?: string;
  plan?: string;
  specs?: string;
  provider?: string;
  model?: string;
  dir?: string;
  iterations?: string;
  delay?: string;
  temperature?: string;
  maxTokens?: string;
  tools?: string;
  param?: string[];
  json?: boolean;
  verbose?: boolean;
  /** A task with its checks, as JSON. */
  taskFile?: string;
  /** Commands the lab runs after the run; each passes when it exits 0. */
  check?: string[];
  /** Files the checks depend on. */
  checkFile?: string[];
  verdictFrom?: string;
  tokenBudget?: string;
  memoryScope?: string;
  /** Draw the run live on the topology's grid (default: in a terminal, unless --json or --verbose). */
  live?: boolean;
  /** Also write every frame of the live view to this file (plain), and its ANSI to <file>.ansi. */
  frames?: string;
  /** No colour. */
  plain?: boolean;
  /** Columns to draw for (default: the terminal's, or 120). */
  width?: string;
  layout?: string;
}

export interface RunnerIO {
  /** Where events and the summary go (stdout by default). */
  out: (line: string) => void;
  /** Where progress notes go (stderr by default, so --json stays clean). */
  note: (line: string) => void;
  /** Raw text, for the live view's redraws (stdout by default). */
  write?: (text: string) => void;
  /** Whether out is a terminal, and its size. */
  tty?: { columns: number; rows: number };
}

export interface RunnerDeps {
  /** Use this provider instead of building one from the configuration. */
  provider?: LLMProvider;
  /** Use this storage (null for none) instead of the configured one. */
  storage?: Storage | null;
  /** Install the Ctrl+C handler (default true). */
  handleSignals?: boolean;
  /** Called with the session once it exists, before it runs. */
  onSession?: (session: AgentSession) => void;
}

const defaultIO: RunnerIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  note: (line) => process.stderr.write(`${line}\n`),
  write: (text) => process.stdout.write(text),
  ...(process.stdout.isTTY ? { tty: { columns: process.stdout.columns, rows: process.stdout.rows } } : {}),
};

/** Parse repeated --param key=value options, with numbers and booleans typed. */
export function parseParams(pairs: string[] = []): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const key = p.slice(0, eq);
    const raw = p.slice(eq + 1);
    params[key] = raw === "true" ? true : raw === "false" ? false : raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
  }
  return params;
}

const PROVENANCE_MARK: Record<string, string> = { given: "›", measured: "■", written: "“" };

const firstLine = (text: string, max = 100) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/** Human-readable lines for one event. */
function pretty(e: SessionEvent, verbose: boolean): string[] {
  switch (e.type) {
    case "run:start":
      return [
        chalk.cyan(`▶ ${e.topology.name}: ${e.order.join(" → ")}`),
        ...(e.wayBacks.length
          ? [chalk.gray(`  ways back: ${e.wayBacks.map((w) => `${w.from} → ${w.to}`).join(", ")}`)]
          : []),
        ...(e.activatedSkills.length ? [chalk.gray(`  skills: ${e.activatedSkills.join(", ")}`)] : []),
      ];
    case "round:start":
      return [chalk.cyan(`── round ${e.round} (starts at ${e.startAt})`)];
    case "role:start":
      return verbose ? [chalk.gray(`  ▸ ${e.name}`)] : [];
    case "role:end": {
      const head = `${e.success ? chalk.green("✓") : chalk.red("✗")} ${e.name}`;
      const facts = [
        e.verdict ? `verdict ${e.verdict}` : "",
        e.decision ? `decision ${e.decision}` : "",
        `${e.tokens.totalTokens} tok`,
        `${e.toolCalls.length} tools`,
      ].filter(Boolean);
      const lines = [`  ${head} ${chalk.gray(facts.join(" · "))}  ${chalk.white(firstLine(e.output))}`];
      for (const tc of e.toolCalls) lines.push(chalk.gray(`      ${tc.ok ? "·" : chalk.red("!")} ${tc.name} ${tc.args}`));
      for (const err of e.errors) lines.push(chalk.red(`      ${err}`));
      return lines;
    }
    case "signal":
      return verbose ? [chalk.gray(`      → ${e.signal} from ${e.from}`)] : [];
    case "step": {
      if (!verbose) return [];
      // What the role was given, each marked: › from you, ■ measured, “ written by a model.
      const seen = e.inputs.map((i) => `${PROVENANCE_MARK[i.provenance]}${i.name}${i.from === "you" || i.from === "run" ? "" : `@${i.from}`}`);
      const tools = e.tools.length ? ` · tools ${e.tools.join(",")}` : "";
      return [chalk.gray(`      saw ${seen.join(" ") || "nothing"}${tools}`)];
    }
    case "round:end":
      return [chalk.gray(`   round ${e.round}: ${e.verdict ?? "no verdict"}; ${e.reason}${e.next ? `; next starts at ${e.next}` : ""}`)];
    case "consult:start":
      return [chalk.cyan(`  ⇅ ${e.from} consults ${e.name}${e.real ? " (the provider's advisor tool)" : ""}${e.question ? `: ${firstLine(e.question)}` : ""}`)];
    case "consult:end":
      return [
        e.error
          ? chalk.red(`  ⇅ ${e.name} could not answer: ${e.error}`)
          : chalk.gray(`  ⇅ ${e.name} answered${e.sealed ? " (sealed: the lab cannot read it)" : ""} · ${e.tokens.totalTokens} tok`),
      ];
    case "steer:queued":
      return [chalk.yellow(`  ‖ note queued for Do: ${e.message}`)];
    case "steer:delivered":
      return [chalk.yellow(`  ‖ note read by ${e.role} in round ${e.round}`)];
    case "steer:dropped":
      return [chalk.red(`  ‖ note not delivered: ${e.reason}`)];
    case "run:end": {
      const mark =
        e.outcome === "passed" ? chalk.green("■ passed") : e.outcome === "failed" ? chalk.red("■ failed") : chalk.yellow(`■ ${e.outcome}`);
      // The lab's own check, each line measured: what passed, its exit code, what it printed.
      const checks = (e.measured?.results ?? []).map((r) =>
        chalk.gray(`  ${r.passed ? "✓" : "✗"} ${r.name}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}: ${firstLine(r.output)}`),
      );
      return [
        `${mark} ${chalk.gray(`after ${e.rounds} rounds, ${e.tokens.totalTokens} tokens, ${(e.durationMs / 1000).toFixed(1)}s`)}`,
        chalk.gray(`  ${e.reason}`),
        ...checks,
        ...(e.answer ? ["", chalk.white(e.answer)] : []),
      ];
    }
  }
}

/** The task and its checks: a task file, then --task or the prompt file, with any --check added. */
async function readRequest(options: TopologyRunOptions, workingDir: string): Promise<RunRequest> {
  const fromFile = options.taskFile ? await loadTaskFile(path.resolve(options.taskFile)) : null;
  const task = options.task ?? fromFile?.task ?? (await readTask(options, workingDir));
  const checks = [
    ...(fromFile?.checks ?? []),
    ...(options.check ?? []).map((command, i) => ({ name: `check ${i + 1}`, kind: "command" as const, command })),
  ];
  const checkFiles = [...(fromFile?.checkFiles ?? []), ...(options.checkFile ?? [])];
  return { task, ...(checks.length ? { checks } : {}), ...(checkFiles.length ? { checkFiles } : {}) };
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

async function readTask(options: TopologyRunOptions, workingDir: string): Promise<string> {
  if (options.task) return options.task;
  const promptFile = path.resolve(workingDir, options.prompt || "PROMPT.md");
  try {
    const text = (await fs.readFile(promptFile, "utf-8")).trim();
    if (text) return text;
  } catch {
    /* no prompt file */
  }
  throw new Error(`No task: pass --task "..." or write ${path.relative(workingDir, promptFile) || "PROMPT.md"}`);
}

/** Keep a result the `history` command can list. */
async function saveHistory(workingDir: string, run: AgentRunResult, options: TopologyRunOptions, providerName: string, model: string): Promise<void> {
  const logger = new IterationLogger(workingDir, run.runId);
  await logger.init();
  const totals = run.result.finalState.totalTokens;
  const result = {
    state: {
      config: {
        id: run.runId,
        name: options.topology ?? "ralph-loop",
        provider: providerName,
        model,
        maxIterations: run.result.totalCycles,
        delayMs: 0,
        promptFile: options.prompt || "PROMPT.md",
        workingDir,
      },
      status: run.outcome === "stopped" ? "stopped" : run.outcome === "failed" ? "failed" : "completed",
      iterations: [],
      currentIteration: run.result.totalCycles,
      totalTokenUsage: totals,
      totalToolCalls: {},
      plan: [],
      errors: run.result.errors,
    },
    totalDurationMs: run.result.totalDurationMs,
    totalIterations: run.result.totalCycles,
    success: run.success,
    summary: `${run.outcome}: ${run.reason}`,
  } as unknown as LoopResult;
  await logger.saveResult(result);
}

/** The live view, on screen or only into a frames file. */
function liveView(topology: Topology, source: string, model: string, options: TopologyRunOptions, io: RunnerIO, onScreen: boolean): LiveView {
  if (options.layout && !["auto", "horizontal", "vertical", "strip"].includes(options.layout)) {
    throw new Error("--layout must be one of: auto, horizontal, vertical, strip");
  }
  const width = options.width ? parseInt(options.width, 10) : (io.tty?.columns ?? 120);
  const color = Boolean(io.tty) && !options.plain && !process.env.NO_COLOR;
  if (options.frames) {
    writeFileSync(options.frames, "");
    writeFileSync(`${options.frames}.ansi`, "");
  }
  return new LiveView(topology, {
    write: onScreen ? (io.write ?? ((t) => io.out(t.replace(/\n$/, "")))) : () => {},
    inPlace: onScreen && Boolean(io.tty),
    color,
    width,
    rows: io.tty?.rows,
    layout: (options.layout as LayoutName | "auto" | undefined) ?? "auto",
    source,
    model,
    onFrame: options.frames
      ? (f) => {
          appendFileSync(options.frames!, `── ${f.n} · ${f.event}\n${f.text}\n\n`);
          appendFileSync(`${options.frames}.ansi`, `── ${f.n} · ${f.event}\n${f.ansi}\n\n`);
        }
      : undefined,
  });
}

/** Run a topology from the CLI. Throws on configuration errors; returns the run otherwise. */
export async function runTopology(
  options: TopologyRunOptions,
  io: RunnerIO = defaultIO,
  deps: RunnerDeps = {},
): Promise<AgentRunResult> {
  const workingDir = path.resolve(options.dir || ".");
  // A built-in id, or a definition file read through the formats module.
  const resolved = await resolveTopology(options.topology || "ralph-loop");
  for (const w of resolved.warnings) io.note(chalk.yellow(describeIssue(w)));
  const topology = resolved.topology;

  const appConfig = await loadConfig(workingDir);
  const providerName = options.provider || (appConfig.loop.provider as string) || "ollama";
  const providerConfig = appConfig.providers[providerName] || {};
  const model = options.model || providerConfig.defaultModel || appConfig.loop.model || "llama3.1";

  const provider =
    deps.provider ??
    createProvider(providerName, {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: options.temperature ? parseFloat(options.temperature) : undefined,
      maxTokens: options.maxTokens ? parseInt(options.maxTokens, 10) : undefined,
    });
  if (!deps.provider && !(await provider.healthCheck())) {
    throw new Error(`Provider "${providerName}" is not reachable. Check your configuration.`);
  }

  const request = await readRequest(options, workingDir);
  const verdictFrom = oneOf(options.verdictFrom, ["measured", "model"] as const, "--verdict-from");
  const memoryScope = oneOf(options.memoryScope, ["off", "run", "task", "shared"] as const, "--memory-scope") as MemoryScope | undefined;
  const tokenBudget = options.tokenBudget ? parseInt(options.tokenBudget, 10) : undefined;
  if (tokenBudget !== undefined && !(tokenBudget > 0)) throw new Error("--token-budget must be a positive number");
  const enabledTools = options.tools?.split(",").map((t) => t.trim()).filter(Boolean);
  const tools = createDefaultToolkit(enabledTools);

  let storage: Storage | null = null;
  if (deps.storage !== undefined) storage = deps.storage;
  else {
    try {
      storage = await createStorage(appConfig.storage);
    } catch {
      storage = null;
    }
  }

  const params = parseParams(options.param);
  if (options.plan) params.planFile = options.plan;
  if (options.specs) params.specsDir = options.specs;

  // Say the context window the provider asks for, where it chooses one (Ollama's num_ctx).
  const contextWindow = (provider as { contextWindow?: unknown }).contextWindow;
  const ctx = typeof contextWindow === "number" ? ` · num_ctx ${contextWindow}` : "";
  io.note(chalk.gray(`  ${providerName} · ${model}${ctx} · ${workingDir}`));
  io.note(chalk.gray(`  tools: ${tools.getAll().map((t) => t.definition.name).join(", ")}`));

  const session = new AgentSession({
    provider,
    tools,
    topology,
    workingDir,
    maxRounds: options.iterations ? parseInt(options.iterations, 10) : undefined,
    delayMs: options.delay ? parseInt(options.delay, 10) : undefined,
    tokenBudget,
    verdictFrom,
    memoryScope,
    params,
    storage: storage ?? undefined,
    runInfo: { provider: providerName, model, tags: [topology.id, providerName, "cli"], config: { source: "cli", definition: resolved.source } },
  });
  const live = options.live ?? Boolean(io.tty && !options.json && !options.verbose);
  const view = live || options.frames ? liveView(topology, resolved.source, model, options, io, live) : null;
  session.on("event", (e) => {
    if (options.json) io.out(JSON.stringify(e));
    else if (view && live) {
      view.event(e);
      // The drawing says where the run is; the summary and the answer follow it.
      if (e.type === "run:end") {
        view.stop();
        for (const line of pretty(e, false)) io.out(line);
      }
    } else for (const line of pretty(e, Boolean(options.verbose))) io.out(line);
    if (view && !live) view.event(e);
  });
  if (view && live) view.start();
  deps.onSession?.(session);

  let interrupts = 0;
  const onSigint = () => {
    interrupts++;
    if (interrupts > 1) process.exit(130);
    io.note(chalk.yellow("\n  Stopping (Ctrl+C again to quit at once)..."));
    session.stop("interrupted with Ctrl+C");
  };
  const handleSignals = deps.handleSignals ?? true;
  if (handleSignals) process.on("SIGINT", onSigint);

  try {
    if (request.checks?.length) io.note(chalk.gray(`  checks: ${request.checks.map((c) => c.name).join(", ")}`));
    const run = await session.run(request);
    await saveHistory(workingDir, run, options, providerName, model).catch(() => {});
    return run;
  } finally {
    view?.stop();
    if (handleSignals) process.off("SIGINT", onSigint);
    await storage?.close().catch(() => {});
  }
}

/** Commander action: run, print, and exit non-zero unless the run passed. */
export async function runTopologyCommand(options: TopologyRunOptions): Promise<void> {
  // The events are the output; the engine's own log only when asked for.
  if (!options.verbose) process.env.AGENTIC_LAB_LOG_LEVEL ??= "warn";
  try {
    const run = await runTopology(options);
    process.exitCode = run.success ? 0 : run.outcome === "stopped" ? 130 : 1;
  } catch (e) {
    process.stderr.write(chalk.red(`\n  ✗ ${(e as Error).message}\n\n`));
    process.exitCode = 2;
  }
}
