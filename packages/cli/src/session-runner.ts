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
import { shown } from "./display-path.js";
import {
  AgentSession,
  IterationLogger,
  prefixOf,
  createDefaultToolkit,
  createStorage,
  loadConfig,
  loadTaskFile,
  type MemoryScope,
  type RunRequest,
  type AgentRunResult,
  type LLMProvider,
  type ProviderFactory,
  ENTRY_KINDS,
  createProvider,
  getAvailableProviders,
  type LoopResult,
  type SessionEvent,
  type Storage,
  type Topology,
  type LayoutName,
  describeIssue,
  ensureProjectDir,
  environmentBlock,
  PostgresStorage,
} from "jig-core";
import { resolveTopology } from "./topology-arg.js";
import { LiveView, type LiveViewOptions } from "./live-view.js";
import { readKeys, scrollKey } from "./keys.js";
import { MODE_LABEL, loadPermissions } from "./permissions.js";
import { loadModels, toolWarnings, type LoadedModels } from "./providers.js";
import { ambiguousIsWide } from "./terminal-width.js";
import { JIG_HELP, JigHelpTool, aboutJig, offerJigHelp } from "./help/jig-help.js";
import { toAscii, wantsAscii } from "./session/ascii.js";

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
  /** Write every frame drawn, clock ticks included, as JSON lines with its time (for a recording). */
  record?: string;
  /** No colour. */
  plain?: boolean;
  /** Columns to draw for (default: the terminal's, or 120). */
  width?: string;
  layout?: string;
  /** default, acceptEdits or plan; nobody is there to ask, so what would ask is denied. */
  permissionMode?: string;
  /** Bypass for this run only, except deny rules, ask rules and dangerous removals (which are denied: nobody to ask). */
  dangerouslySkipPermissions?: boolean;
  addDir?: string[];
  /** Rules for this run only, as Shell(npm test *) or Write(src/**). */
  allow?: string[];
  deny?: string[];
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
  /** Skip a Check with nothing to verify (default true, as jig runs); a test of other plumbing turns it off. */
  skipUnverifiable?: boolean;
}

export const defaultIO: RunnerIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  note: (line) => process.stderr.write(`${line}\n`),
  write: (text) => process.stdout.write(text),
  // A pseudo-terminal with no size set reports 0: the view then assumes 120 columns and 24 rows.
  ...(process.stdout.isTTY ? { tty: { columns: process.stdout.columns || 120, rows: process.stdout.rows || 24 } } : {}),
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

const PROVENANCE_MARK: Record<string, string> = { given: "›", measured: "▪", written: "❝" };

const firstLine = (text: string, max = 100) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}⋯` : line;
};

/** Human-readable lines for one event. */
function pretty(e: SessionEvent, verbose: boolean): string[] {
  switch (e.type) {
    case "run:start":
      return [
        chalk.cyan(`▸ ${e.topology.name}: ${e.order.join(" ⇢ ")}`),
        ...(e.wayBacks.length
          ? [chalk.gray(`  ways back: ${e.wayBacks.map((w) => `${w.from} ⇢ ${w.to}`).join(", ")}`)]
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
      const lines = [`  ${head} ${chalk.gray(facts.join(" ∙ "))}  ${chalk.white(firstLine(e.output))}`];
      for (const tc of e.toolCalls) lines.push(chalk.gray(`      ${tc.ok ? "∙" : chalk.red("!")} ${tc.name} ${tc.args}`));
      for (const err of e.errors) lines.push(chalk.red(`      ${err}`));
      return lines;
    }
    case "call":
      return verbose ? [chalk.gray(`      ∙ model call ${e.seq}${e.tools.length ? `: ${e.tools.join(", ")}` : ""} ∙ ${e.tokens.totalTokens} tok`)] : [];
    case "signal":
      return verbose ? [chalk.gray(`      ⇢ ${e.signal} from ${e.from}`)] : [];
    case "step": {
      if (!verbose) return [];
      // What the role was given, each marked: › from you, ▪ measured, ❝ written by a model.
      const seen = e.inputs.map((i) => `${PROVENANCE_MARK[i.provenance]}${i.name}${i.from === "you" || i.from === "run" ? "" : `@${i.from}`}`);
      const tools = e.tools.length ? ` ∙ tools ${e.tools.join(",")}` : "";
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
          : chalk.gray(`  ⇅ ${e.name} answered${e.sealed ? " (sealed: the lab cannot read it)" : ""} ∙ ${e.tokens.totalTokens} tok`),
      ];
    case "steer:queued":
      return [chalk.yellow(`  ¦ note queued for Do: ${e.message}`)];
    case "steer:delivered":
      return [chalk.yellow(`  ¦ note read by ${e.role} in round ${e.round}`)];
    case "steer:dropped":
      return [chalk.red(`  ¦ note not delivered: ${e.reason}`)];
    case "text":
    case "tool:start":
      return [];
    case "tool:end":
      return verbose ? [chalk.gray(`      ${e.ok ? "∙" : chalk.red("!")} ${e.tool} ran in ${e.durationMs} ms`)] : [];
    case "approval:asked":
      return [chalk.yellow(e.tool ? `  ¦ ${e.name} asks to ${e.tool === "Write" ? "write" : e.tool === "Read" ? "read" : "run"}: ${e.command}` : `  ¦ ${e.name} asks to run: ${e.command} (${e.programs.join(", ")} not on its list)`)];
    case "approval:answered":
      return [e.answer === "deny" ? chalk.red(`  ¦ denied${e.feedback ? `: "${e.feedback}"` : ""}`) : chalk.yellow(`  ¦ allowed ${e.answer === "session" ? "for this session" : e.answer === "rule" ? "and kept as a rule" : "once"}`)];
    case "permission:denied":
      return [chalk.red(`  ✗ ${e.name} was not allowed to ${e.tool === "Write" ? "write" : e.tool === "Read" ? "read" : "run"} ${e.target}: ${e.reason}`)];
    case "run:end": {
      if (e.outcome === "unverified") return [chalk.gray(`▪ not verified: ${e.unverifiedReason ?? e.reason} ∙ ${e.tokens.totalTokens} tokens, ${(e.durationMs / 1000).toFixed(1)}s`), ...(e.answer ? ["", chalk.white(e.answer)] : [])];
      const mark =
        e.outcome === "passed" ? chalk.green("▪ passed") : e.outcome === "failed" ? chalk.red("▪ failed") : chalk.yellow(`▪ ${e.outcome}`);
      // The lab's own check, each line measured: what passed, its exit code, what it printed.
      const checks = (e.measured?.results ?? []).map((r) =>
        chalk.gray(`  ${r.passed ? "✓" : "✗"} ${r.name}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}: ${firstLine(r.output)}`),
      );
      return [
        `${mark} ${chalk.gray(`after ${e.rounds} round${e.rounds === 1 ? "" : "s"}, ${e.tokens.totalTokens} tokens, ${(e.durationMs / 1000).toFixed(1)}s`)}`,
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
export async function saveHistory(workingDir: string, run: AgentRunResult, options: TopologyRunOptions, providerName: string, model: string): Promise<void> {
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
    summary: run.outcome === "unverified" ? run.reason : `${run.outcome}: ${run.reason}`,
  } as unknown as LoopResult;
  await logger.saveResult(result);
}

export interface ViewOptions {
  frames?: string;
  record?: string;
  plain?: boolean;
  width?: string;
  layout?: string;
}

/**
 * Whether the live view draws in ASCII: asked for (JIG_ASCII, a console known to lack the glyphs), or a
 * terminal that draws ambiguous characters two cells wide, which would push every box border out of line.
 */
export async function asciiView(io: RunnerIO): Promise<boolean> {
  if (io !== defaultIO || !io.tty) return false;
  return wantsAscii(undefined) || (await ambiguousIsWide()) === true;
}

/** The live view, on screen or only into a frames file: a run, a dry run, or a replay. */
export function liveView(
  topology: Topology,
  source: string,
  model: string,
  options: ViewOptions,
  io: RunnerIO,
  onScreen: boolean,
  extra: Partial<LiveViewOptions> = {},
  ascii = false,
): LiveView {
  if (options.layout && !["auto", "horizontal", "vertical", "strip"].includes(options.layout)) {
    throw new Error("--layout must be one of: auto, horizontal, vertical, strip");
  }
  const width = options.width ? parseInt(options.width, 10) : (io.tty?.columns ?? 120);
  const color = Boolean(io.tty) && !options.plain && !process.env.NO_COLOR;
  if (options.frames) {
    writeFileSync(options.frames, "");
    writeFileSync(`${options.frames}.ansi`, "");
  }
  if (options.record) writeFileSync(options.record, "");
  return new LiveView(topology, {
    write: onScreen ? ((w: (t: string) => void) => (ascii ? (t: string) => w(toAscii(t)) : w))(io.write ?? ((t: string) => io.out(t.replace(/\n$/, "")))) : () => {},
    inPlace: onScreen && Boolean(io.tty),
    color,
    width,
    ...(io.tty?.rows ? { rows: io.tty.rows } : {}),
    layout: (options.layout as LayoutName | "auto" | undefined) ?? "auto",
    source,
    model,
    command: commandLine(["run", "--topology", (options as { topology?: string }).topology ?? topology.id, ...(model ? ["--model", model] : [])]),
    onFrame:
      options.frames || options.record
        ? (f) => {
            // The frames file is a film strip of events; the recording keeps every frame, with its time.
            if (options.frames && f.event !== "clock") {
              appendFileSync(options.frames, `── ${f.n} ∙ ${f.event}\n${f.text}\n\n`);
              appendFileSync(`${options.frames}.ansi`, `── ${f.n} ∙ ${f.event}\n${f.ansi}\n\n`);
            }
            if (options.record) appendFileSync(options.record, `${JSON.stringify({ n: f.n, at: f.at, event: f.event, text: f.text, ansi: f.ansi })}\n`);
          }
        : undefined,
    ...extra,
  });
}

/**
 * The command as typed, for the footer, a path shortened to its file's name.
 * When the process is not the CLI (a test, a script), the command is rebuilt
 * from the words given instead.
 */
export function commandLine(fallback: string[], argv: string[] = process.argv): string {
  const isCli = /[\\/](cli[\\/](dist|src)[\\/](index|deprecated)\.(js|ts)|jig|agentic-lab|alab)$/.test(argv[1] ?? "");
  const words = isCli ? argv.slice(2) : fallback;
  const quote = (a: string) => (/[\s"']/.test(a) ? JSON.stringify(a) : a);
  return ["jig", ...words.map((a) => (a.includes("/") && !a.startsWith("-") ? path.basename(a) : a)).map(quote)].join(" ");
}

/** Keep the view's size with the terminal's. */
export function followResize(view: LiveView, io: RunnerIO): () => void {
  if (io !== defaultIO || !process.stdout.isTTY) return () => {};
  const onResize = () => view.resize(process.stdout.columns || 120, process.stdout.rows || 24);
  process.stdout.on("resize", onResize);
  return () => process.stdout.off("resize", onResize);
}

/** The run's steps, kept beside its history when its storage does not outlive the process. */
export async function saveLocalRecord(workingDir: string, run: AgentRunResult, info: Record<string, unknown>): Promise<void> {
  const dir = await ensureProjectDir(workingDir, "runs", run.runId);
  await fs.writeFile(path.join(dir, "steps.json"), JSON.stringify(run.steps, null, 1));
  await fs.writeFile(path.join(dir, "record.json"), JSON.stringify({ runId: run.runId, outcome: run.outcome, reason: run.reason, ...info }, null, 2));
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
  let providerName = options.provider || (appConfig.loop.provider as string) || "ollama";
  let model = options.model ?? "";
  let provider: LLMProvider;
  let providerFactory: ProviderFactory | undefined;
  let models: LoadedModels | null = null;
  // A provider registered in code (registerProvider, for a harness built on jig-core) and named on the command line runs as given.
  const registered = !deps.provider && options.provider && !appConfig.providers[options.provider] && !(ENTRY_KINDS as readonly string[]).includes(options.provider) && getAvailableProviders().includes(options.provider.toLowerCase());
  if (deps.provider) {
    provider = deps.provider;
    model = model || appConfig.providers[providerName]?.defaultModel || appConfig.loop.model || "scripted";
  } else if (registered) {
    model = model || appConfig.loop.model || "";
    provider = createProvider(providerName, {
      model,
      ...(options.temperature ? { temperature: parseFloat(options.temperature) } : {}),
      ...(options.maxTokens ? { maxTokens: parseInt(options.maxTokens, 10) } : {}),
    });
  } else {
    // What there is: this machine's servers, every entry's models and what they can do; the default is chosen from it.
    models = await loadModels(appConfig, {
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.temperature ? { temperature: parseFloat(options.temperature) } : {}),
      ...(options.maxTokens ? { maxTokens: parseInt(options.maxTokens, 10) } : {}),
    });
    for (const n of await models.prepare({ listTimeoutMs: 4000 })) io.note(chalk.yellow(`  ${n}`));
    if (!models.catalog?.length && !options.model) {
      throw new Error(
        "Jig found no model to run on. Install Ollama (https://ollama.com/download) and run ollama pull qwen2.5:7b, add a cloud key (jig providers add anthropic --keychain), or name a server (jig providers add <name> --base-url <url>). jig doctor shows what it found.",
      );
    }
    const m = models;
    [providerName, model] = [m.defaultRef.slice(0, m.defaultRef.indexOf("/")), m.defaultRef.slice(m.defaultRef.indexOf("/") + 1)];
    provider = m.provider(m.defaultRef);
    // A role's brain or chain falls back along its models, inside the privacy boundary; --model puts every role on it, as before.
    if (!options.model) providerFactory = (brain) => m.provider(brain.chain?.length ? brain.chain.join(",") : brain.brain ? brain.brain : `${brain.provider ?? providerName}/${brain.model ?? model}`);
  }

  const request = await readRequest(options, workingDir);
  const verdictFrom = oneOf(options.verdictFrom, ["measured", "model"] as const, "--verdict-from");
  const memoryScope = oneOf(options.memoryScope, ["off", "run", "task", "shared"] as const, "--memory-scope") as MemoryScope | undefined;
  const tokenBudget = options.tokenBudget ? parseInt(options.tokenBudget, 10) : undefined;
  if (tokenBudget !== undefined && !(tokenBudget > 0)) throw new Error("--token-budget must be a positive number");
  const enabledTools = options.tools?.split(",").map((t) => t.trim()).filter(Boolean);
  const tools = createDefaultToolkit(enabledTools, { unescapeNewlines: appConfig.tools?.unescapeNewlines !== false });
  if (!enabledTools || enabledTools.includes(JIG_HELP)) tools.register(new JigHelpTool());

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
  const ctx = typeof contextWindow === "number" ? ` ∙ num_ctx ${contextWindow}` : "";
  io.note(chalk.gray(`  ${providerName} ∙ ${model}${ctx} ∙ ${shown(workingDir)}`));
  io.note(chalk.gray(`  tools: ${tools.getAll().map((t) => t.definition.name).join(", ")}`));
  // Nobody is there to ask: what would ask is denied, unless a rule or the mode allows it (Claude Code's -p does the same).
  const permissions = loadPermissions(workingDir, { mode: options.permissionMode, skip: options.dangerouslySkipPermissions, addDirs: options.addDir, allow: options.allow, deny: options.deny });
  io.note(chalk.gray(`  permissions: ${MODE_LABEL[permissions.mode]}; what would ask is denied (--permission-mode, --allow)`));

  if (models) for (const w of toolWarnings(topology, models, models.defaultRef)) io.note(chalk.yellow(`  ${w}`));
  const session = new AgentSession({
    provider,
    ...(providerFactory ? { providerFactory } : {}),
    tools,
    topology: offerJigHelp(topology),
    workingDir,
    maxRounds: options.iterations ? parseInt(options.iterations, 10) : undefined,
    delayMs: options.delay ? parseInt(options.delay, 10) : undefined,
    tokenBudget,
    verdictFrom,
    memoryScope,
    params,
    environment: `${environmentBlock(workingDir)}\n\n${aboutJig()}`,
    skipUnverifiable: deps.skipUnverifiable ?? true,
    permissions: { settings: permissions, grants: { edits: false, rules: [] } },
    storage: storage ?? undefined,
    runInfo: {
      provider: providerName,
      model,
      tags: [topology.id, providerName, "cli"],
      config: { source: "cli", definition: resolved.source, ...(resolved.builtIn || !options.topology ? {} : { definitionPath: path.resolve(options.topology) }) },
    },
  });
  const live = options.live ?? Boolean(io.tty && !options.json && !options.verbose);
  const ascii = live && (await asciiView(io));
  const view = live || options.frames || options.record ? liveView(topology, resolved.source, model, options, io, live, {}, ascii) : null;
  const unfollow = view ? followResize(view, io) : () => {};
  let runLimits: { rounds: number; tokenBudget?: number } | null = null;
  session.on("event", (e) => {
    if (e.type === "run:start") runLimits = e.limits;
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
  const onSigterm = () => {
    view?.restore();
    process.exit(143);
  };
  const handleSignals = deps.handleSignals ?? true;
  if (handleSignals) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
  // On a terminal the keys scroll the log; in raw mode Ctrl+C is a key, so it stops the run here.
  const keys =
    view && live && io === defaultIO && handleSignals
      ? readKeys((k) => {
          if (k === "ctrl-c") onSigint();
          else scrollKey(k, view);
        })
      : { stop: () => {} };

  try {
    if (request.checks?.length) io.note(chalk.gray(`  checks: ${request.checks.map((c) => c.name).join(", ")}`));
    const run = await session.run(request);
    // Say what was denied for want of someone to ask, and how to allow it next time.
    const unasked = run.steps.flatMap((st) => st.permissions ?? []).filter((r) => r.by === "nobody to ask");
    if (unasked.length && !options.json) {
      const shown = (r: (typeof unasked)[number]) => (r.tool === "Shell" ? r.target : path.relative(workingDir, r.target).startsWith("..") ? r.target : path.relative(workingDir, r.target));
      io.note(chalk.yellow(`  ${unasked.length} call${unasked.length > 1 ? "s" : ""} denied, with nobody to ask: ${[...new Set(unasked.map((r) => `${r.tool} ${shown(r)}`))].slice(0, 4).join(" ∙ ")}`));
      // What would allow each, named for what was denied.
      const ways = new Set<string>();
      for (const r of unasked) {
        if (r.tool === "Write") ways.add(path.relative(workingDir, r.target).startsWith("..") ? `--allow 'Write(/${r.target})'` : "--permission-mode acceptEdits");
        else if (r.tool === "Read") ways.add(`--add-dir ${path.dirname(r.target)}`);
        else {
          const prefix = prefixOf(r.target.split(/\s*(?:&&|\|\||;|\|)\s*/)[0] ?? "");
          if (prefix) ways.add(`--allow 'Shell(${prefix} *)'`);
        }
      }
      io.note(chalk.gray(`  allow them with ${[...ways].slice(0, 3).join(", ") || "a rule"}, or a rule in jig.config.json or .jig/settings.local.json`));
    }
    await saveHistory(workingDir, run, options, providerName, model).catch(() => {});
    // A replay reads the storage the run wrote; an in-memory store ends with the process, so its steps go beside the history.
    if (!(storage instanceof PostgresStorage)) {
      const definition = resolved.builtIn || !options.topology ? undefined : path.resolve(options.topology);
      await saveLocalRecord(workingDir, run, {
        topology: topology.id,
        ...(definition ? { definition } : {}),
        task: request.task,
        provider: providerName,
        model,
        ...(runLimits ? { limits: runLimits } : {}),
      }).catch(() => {});
    }
    return run;
  } finally {
    keys.stop();
    view?.stop();
    unfollow();
    if (handleSignals) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
    await storage?.close().catch(() => {});
  }
}

/** Commander action: run, print, and exit non-zero unless the run passed. */
export async function runTopologyCommand(options: TopologyRunOptions): Promise<void> {
  // The events are the output; the engine's own log only when asked for.
  if (!options.verbose) process.env.JIG_LOG_LEVEL ??= "warn";
  try {
    const run = await runTopology(options);
    process.exitCode = run.success ? 0 : run.outcome === "stopped" ? 130 : 1;
  } catch (e) {
    process.stderr.write(chalk.red(`\n  ✗ ${(e as Error).message}\n\n`));
    process.exitCode = 2;
  }
}
