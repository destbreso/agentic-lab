// ============================================
// Agent Session
// ============================================
// The one entry point for running a topology on a task. The chat, the
// builder, the CLI and the benchmarks all run through it, so they share one
// engine and one event stream. It:
//   1. activates the skills relevant to the task,
//   2. instantiates the topology (a registered recipe or a definition),
//   3. seeds the task onto the shared blackboard and runs it in rounds,
//   4. emits one event sequence every surface renders (run, round, role, signal),
//   5. takes steering mid-run as a context signal to Do, and stops on request,
//   6. records the run when given storage, with an honest outcome.

import { EventEmitter } from "eventemitter3";
import { nanoid } from "nanoid";
import { getRecipe, instantiateRecipeFromDefinition } from "../loops/recipes.js";
import { resolveActiveSkills } from "../skills/activation.js";
import { SkillRegistry } from "../skills/registry.js";
import type { Skill } from "../skills/types.js";
import type { LLMProvider } from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import type { MemoryStore, Storage } from "../types/storage.js";
import type { NudgePriority } from "../types/loop.js";
import type { EmbeddingFunction } from "../storage/qdrant.js";
import type { ProviderFactory } from "./capability-resolver.js";
import type {
  LoopCategory,
  NodeResult,
  PipelineResult,
  Recipe,
  Provenance,
  RunOutcome,
  RunInput,
  Signal,
} from "../types/pipeline.js";
import type { PipelineOrchestrator } from "./pipeline.js";
import { registerRun, unregisterRun } from "./run-registry.js";
import type { RoleRef } from "./recorder.js";
import type { StepRecord } from "../types/step.js";
import { MeasuredChecker } from "../tasks/checker.js";
import { describeFields } from "./provenance.js";
import type { CheckFile, CheckRunner, MeasuredCheckRun, TaskCheck } from "../tasks/types.js";

export interface AgentSessionConfig {
  /** Default provider (per-node brains can still override via the topology). */
  provider: LLMProvider;
  /** Tool registry available to the topology. */
  tools?: ToolRegistry;
  /** The topology: a registered recipe id or a definition (default: "ralph-loop"). */
  topology?: string | Recipe;
  /** Alias of `topology`. */
  recipe?: string | Recipe;
  /** Working directory for the agent. */
  workingDir?: string;
  /** Available skills (registry or list) considered for activation. */
  skills?: Skill[] | SkillRegistry;
  /** Skill names to always attach for this session (manual activation). */
  manualSkills?: string[];
  /** Memory store backing recall/remember. */
  memory?: MemoryStore;
  /** Embedding fn for semantic skill activation; falls back to heuristic. */
  embed?: EmbeddingFunction;
  /** Provider factory for resolving per-node brains. */
  providerFactory?: ProviderFactory;
  /** Override the topology's round limit. */
  maxRounds?: number;
  /** Alias of `maxRounds`. */
  maxCycles?: number;
  /** Override the pause between rounds (ms). */
  delayMs?: number;
  /** Extra topology parameters (planFile, convergenceThreshold, Decide's maxRounds...). */
  params?: Record<string, unknown>;
  /**
   * A provider for one role, taking precedence over the default and the
   * role's brain (a replay of recorded replies, a sight probe).
   */
  roleProvider?: (role: RoleRef) => LLMProvider | undefined;
  /**
   * Runs the task's checks in place of the lab's MeasuredChecker (a test's
   * scripted checker). Used only when the request carries checks.
   */
  checkRunner?: (request: RunRequest, workingDir: string) => CheckRunner;
  /** Where to keep the run record and its steps; without it nothing is stored. */
  storage?: Storage;
  /** The run's id (default: generated). */
  runId?: string;
  /** Labels for the run record. */
  runInfo?: {
    provider?: string;
    model?: string;
    tags?: string[];
    config?: Record<string, unknown>;
    /** Estimated cost of a token count, for the usage record. */
    costOf?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => number;
  };
}

export interface RoleInfo {
  id: string;
  name: string;
  category: LoopCategory;
}

export interface RoleToolCall {
  name: string;
  ok: boolean;
  args: string;
}

export interface Tokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** The events every surface renders, in the order the engine produces them. */
export type SessionEvent =
  | {
      type: "run:start";
      runId: string;
      topology: { id: string; name: string };
      task: string;
      roles: RoleInfo[];
      order: string[];
      wayBacks: Array<{ from: string; to: string }>;
      activatedSkills: string[];
      /** The task's checks, which the lab runs after the run. */
      checks: Array<{ name: string; kind: string }>;
    }
  | { type: "round:start"; round: number; startAt: string }
  | { type: "role:start"; round: number; role: string; name: string; category: LoopCategory }
  | {
      type: "role:end";
      round: number;
      role: string;
      name: string;
      category: LoopCategory;
      success: boolean;
      tokens: Tokens;
      toolCalls: RoleToolCall[];
      errors: string[];
      /** What the role wrote, in short. */
      output: string;
      verdict?: string;
      decision?: string;
      durationMs: number;
    }
  | { type: "signal"; round: number; from: string; signal: string }
  | {
      /** A role's turn, recorded. The full record (prompts included) is in storage and the run's result. */
      type: "step";
      seq: number;
      round: number | null;
      role: string;
      name: string;
      /** What the role was given, each with where it came from. */
      inputs: Array<{ source: string; name: string; from: string; provenance: Provenance }>;
      /** Model calls made in the turn, and the tools offered on them. */
      calls: number;
      tools: string[];
      tokens: Tokens;
    }
  | { type: "round:end"; round: number; verdict: string | null; next: string | null; reason: string }
  | { type: "steer:queued"; id: string; message: string; priority: NudgePriority }
  | { type: "steer:delivered"; id: string; role: string; round: number }
  | { type: "steer:dropped"; id: string; reason: string }
  | {
      type: "run:end";
      runId: string;
      /** How the run ended: the measured check's result when the task has checks. */
      outcome: RunOutcome;
      success: boolean;
      reason: string;
      /** How the topology itself ended, from its own verdicts. */
      topologyOutcome: RunOutcome;
      /** The last verdict a Check role gave, null when none did. */
      verdict: string | null;
      /** The lab's final measured check, when the task has checks. */
      measured?: MeasuredCheckRun;
      rounds: number;
      tokens: Tokens;
      durationMs: number;
      answer: string;
      errors: string[];
    };

/** What a run is asked to do. */
export interface RunRequest {
  /** The task as you gave it. */
  task: string;
  /**
   * The run's other inputs (the conversation, recalled memories), each with
   * its provenance. A role reads the ones its definition lists, after the task.
   */
  inputs?: RunInput[];
  /**
   * How the lab knows the task was done. When there are checks, the lab runs
   * them after the run, where no role can write, and the run's outcome is theirs.
   */
  checks?: TaskCheck[];
  /** Files the checks depend on, copied back in before every check. */
  checkFiles?: CheckFile[];
}

export interface AgentRunResult {
  /** The topology's own result: its outcome follows its own verdicts. */
  result: PipelineResult;
  runId: string;
  /** How the run ended: the measured check's result when the task has checks, else the topology's. */
  outcome: RunOutcome;
  success: boolean;
  /** Why it ended, in plain words. */
  reason: string;
  /** The lab's final measured check, when the task has checks. */
  measured?: MeasuredCheckRun;
  /** What Do wrote in its last turn (empty when it wrote nothing). */
  answer: string;
  /** Skills activated for this task (names). */
  activatedSkills: string[];
  /** Every role's turn: its inputs with their provenance, its model calls, its outputs. */
  steps: StepRecord[];
}

export interface SteeringNote {
  id: string;
  message: string;
  priority: NudgePriority;
  createdAt: string;
}

const PREVIEW = 4000;
const clip = (text: string, max = PREVIEW) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** What a role wrote, read from the signals it emitted. */
function summarise(category: LoopCategory, signals: Signal[]): { output: string; verdict?: string; decision?: string } {
  const of = (type: string) => signals.filter((s) => s.type === type).at(-1)?.data;
  switch (category) {
    case "execution":
      return { output: String(of("execution_result")?.responseText ?? "") };
    case "evaluation": {
      const ev = of("evaluation");
      if (!ev) return { output: "" };
      const verdict = ev.parsed === false ? "inconclusive" : String(ev.verdict);
      const evidence = Array.isArray(ev.evidence) ? (ev.evidence as unknown[]).map(String) : [];
      return { output: [`verdict: ${verdict}${ev.parsed === false ? " (unparsed)" : ""}`, ...evidence].join("\n"), verdict };
    }
    case "planning":
      return { output: String(of("plan")?.plan ?? of("task")?.task ?? "") };
    case "critic": {
      const fb = of("critic_feedback");
      return { output: fb ? `${String(fb.status ?? "ok")}: ${String(fb.feedback ?? "")}` : "" };
    }
    case "refinement": {
      const d = of("refinement_decision");
      return d
        ? { output: `${String(d.action)}: ${String(d.reason ?? "")}`, decision: String(d.action) }
        : { output: "" };
    }
    case "memory":
      return { output: String(of("compressed_context")?.summary ?? "") };
    default: {
      const last = signals.at(-1)?.data;
      return { output: last ? JSON.stringify(last) : "" };
    }
  }
}

export class AgentSession extends EventEmitter<{ event: [SessionEvent] }> {
  readonly runId: string;
  private pipeline: PipelineOrchestrator | null = null;
  private pendingSteers: SteeringNote[] = [];
  private undelivered = new Map<string, SteeringNote>();
  private stopReason: string | null = null;
  private running = false;

  constructor(private readonly config: AgentSessionConfig) {
    super();
    this.runId = config.runId ?? `run-${Date.now()}-${nanoid(6)}`;
  }

  private skillList(): Skill[] {
    const s = this.config.skills;
    if (!s) return [];
    if (s instanceof SkillRegistry) return s.list();
    return s;
  }

  private topology(): Recipe {
    const t = this.config.topology ?? this.config.recipe ?? "ralph-loop";
    if (typeof t !== "string") return t;
    const recipe = getRecipe(t);
    if (!recipe) throw new Error(`Unknown topology "${t}"`);
    return recipe;
  }

  /**
   * Resolve which skills to activate for a task. Always/manual skills are
   * included; auto skills are matched by relevance (semantic or heuristic).
   */
  async activateSkills(task: string): Promise<string[]> {
    const skills = this.skillList();
    if (skills.length === 0) return [];
    const active = await resolveActiveSkills(
      skills,
      { query: task, manualSkills: this.config.manualSkills },
      { embed: this.config.embed },
    );
    return active.map((a) => a.skill.name);
  }

  /** Steer the run: a note Do reads on its next turn, as a context signal. */
  steer(message: string, priority: NudgePriority = "normal"): SteeringNote {
    const note: SteeringNote = {
      id: `steer-${nanoid(8)}`,
      message,
      priority,
      createdAt: new Date().toISOString(),
    };
    this.publish({ type: "steer:queued", id: note.id, message, priority });
    if (this.pipeline) this.deliverSteer(note);
    else this.pendingSteers.push(note);
    return note;
  }

  /** Stop the run: aborts the calls in flight. */
  stop(reason = "stopped by the user"): void {
    this.stopReason ??= reason;
    if (this.pipeline && this.running) this.pipeline.stop(reason);
  }

  private deliverSteer(note: SteeringNote): void {
    const pipeline = this.pipeline!;
    const doers = pipeline.getGraph().nodes.filter((n) => n.category === "execution");
    let delivered = false;
    for (const role of doers) {
      delivered =
        pipeline.deliverSignal(role.id, {
          sourceNodeId: "operator",
          type: "context",
          data: { label: "operator", content: note.message, priority: note.priority, steerId: note.id },
          timestamp: note.createdAt,
        }) || delivered;
    }
    if (delivered) this.undelivered.set(note.id, note);
    else this.publish({ type: "steer:dropped", id: note.id, reason: "no Do role in this topology reads context" });
  }

  private publish(event: SessionEvent): void {
    this.emit("event", event);
  }

  /** Run the topology on a task: a string, or a request with the run's other inputs. */
  async run(
    request: string | RunRequest,
    onPipeline?: (pipeline: PipelineOrchestrator) => void,
  ): Promise<AgentRunResult> {
    const req: RunRequest = typeof request === "string" ? { task: request } : request;
    const task = req.task;
    const workingDir = this.config.workingDir ?? process.cwd();
    // The check files' originals are kept now, before any role can touch them.
    const checker = req.checks?.length
      ? (this.config.checkRunner?.(req, workingDir) ??
        new MeasuredChecker({ workspace: workingDir, checks: req.checks, checkFiles: req.checkFiles }))
      : null;
    await checker?.capture();
    const activatedSkills = await this.activateSkills(task);
    const recipe = this.topology();
    const maxRounds = this.config.maxRounds ?? this.config.maxCycles;
    const overrides: Record<string, unknown> = {};
    if (maxRounds != null) overrides.maxCycles = maxRounds;
    if (this.config.delayMs != null) overrides.delayMs = this.config.delayMs;

    const pipeline = instantiateRecipeFromDefinition(
      recipe,
      {
        ...(this.config.params ?? {}),
        provider: this.config.provider,
        tools: this.config.tools,
        skills: this.skillList(),
        sessionSkills: activatedSkills,
        memory: this.config.memory,
        providerFactory: this.config.providerFactory,
        workingDir,
        task,
        inputs: req.inputs ?? [],
        // Only a role whose definition asks for the blackboard reads it.
        seedShared: { task },
        roleProvider: this.config.roleProvider,
      },
      overrides,
    );
    this.pipeline = pipeline;

    const graph = pipeline.getGraph();
    const roles = new Map<string, RoleInfo>(
      graph.nodes.map((n) => [n.id, { id: n.id, name: n.name, category: n.category as LoopCategory }]),
    );
    const { order, wayBacks } = pipeline.getRunOrder();
    const wires = new Map(graph.wires.map((w) => [w.id, w]));
    const nodeOf = (portId: string) => portId.split(/:(?:in|out):/)[0];

    let round = 0;
    let answer = "";
    const startedAt = Date.now();
    const recorder = this.config.storage ? new RunRecorder(this.config, this.runId, task, recipe, order.length) : null;

    pipeline.on("pipeline:start", () => {
      if (this.stopReason) pipeline.stop(this.stopReason);
    });
    pipeline.on("pipeline:round:start", (e) => {
      round = e.round;
      this.publish({ type: "round:start", round: e.round, startAt: e.startAt });
    });
    pipeline.on("pipeline:cycle:start", (e) => {
      round = e.cycle;
    });
    pipeline.on("node:start", ({ nodeId }) => {
      const role = roles.get(nodeId)!;
      this.publish({ type: "role:start", round, role: nodeId, name: role.name, category: role.category });
    });
    pipeline.on("node:inputs", ({ nodeId, signals }) => {
      for (const s of signals) {
        const id = s.data.steerId;
        if (typeof id === "string" && this.undelivered.has(id)) {
          this.undelivered.delete(id);
          this.publish({ type: "steer:delivered", id, role: nodeId, round });
        }
      }
    });
    pipeline.on("signal:sent", ({ signal }) => {
      this.publish({ type: "signal", round, from: signal.sourceNodeId, signal: signal.type });
    });
    const endRole = (nodeId: string, result: NodeResult | null, error?: Error) => {
      const role = roles.get(nodeId)!;
      const signals = result?.outputSignals ?? [];
      const summary = summarise(role.category, signals);
      // Do's last turn is the answer, even when it said nothing: an older answer would be stale.
      if (role.category === "execution" && result) answer = summary.output;
      const event: SessionEvent = {
        type: "role:end",
        round,
        role: nodeId,
        name: role.name,
        category: role.category,
        success: error ? false : (result?.success ?? false),
        tokens: { ...(result?.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) },
        toolCalls: (result?.toolCalls ?? []).map((tc) => ({
          name: tc.name,
          ok: !String(tc.result ?? "").startsWith("Error"),
          args: clip(JSON.stringify(tc.arguments ?? {}), 200),
        })),
        errors: error ? [error.message] : [...(result?.errors ?? [])],
        output: clip(summary.output),
        ...(summary.verdict ? { verdict: summary.verdict } : {}),
        ...(summary.decision ? { decision: summary.decision } : {}),
        durationMs: result?.durationMs ?? 0,
      };
      this.publish(event);
      recorder?.role(event);
    };
    pipeline.on("node:end", ({ nodeId, result }) => endRole(nodeId, result));
    pipeline.on("node:error", ({ nodeId, error }) => endRole(nodeId, null, error));
    const steps: StepRecord[] = [];
    const saving: Promise<unknown>[] = [];
    pipeline.on("node:step", ({ step }: { step: StepRecord }) => {
      step.runId = this.runId;
      steps.push(step);
      this.publish({
        type: "step",
        seq: step.seq,
        round: step.round,
        role: step.role,
        name: step.roleName,
        inputs: step.inputs.map((i) => ({ source: i.source, name: i.name, from: i.from, provenance: i.provenance })),
        calls: step.calls.length,
        tools: [...new Set(step.calls.flatMap((c) => c.tools))],
        tokens: { ...step.tokens },
      });
      // A storage failure never fails the run.
      if (this.config.storage?.steps) saving.push(this.config.storage.steps.saveStep(step).catch(() => {}));
    });
    pipeline.on("pipeline:round:end", (e) => {
      this.publish({ type: "round:end", round: e.round, verdict: e.verdict, next: e.next, reason: e.reason });
    });

    for (const note of this.pendingSteers.splice(0)) this.deliverSteer(note);

    registerRun(this.runId, this);
    this.publish({
      type: "run:start",
      runId: this.runId,
      topology: { id: recipe.id, name: recipe.name },
      task,
      roles: order.map((id) => roles.get(id)!),
      order,
      wayBacks: wayBacks.map((id) => {
        const w = wires.get(id)!;
        return { from: nodeOf(w.sourcePortId), to: nodeOf(w.targetPortId) };
      }),
      activatedSkills,
      checks: (req.checks ?? []).map((c) => ({ name: c.name, kind: c.kind })),
    });
    await recorder?.start();

    onPipeline?.(pipeline);
    let result: PipelineResult;
    this.running = true;
    try {
      result = await pipeline.run();
    } finally {
      this.running = false;
      unregisterRun(this.runId);
    }

    // The lab's final measured check: in its own copy of the workspace, after
    // every role has finished. When the task has checks, the run's outcome is theirs.
    let outcome = result.outcome;
    let reason = result.reason;
    let measured: MeasuredCheckRun | undefined;
    if (checker) {
      const checkStarted = new Date();
      let checkError: string | undefined;
      try {
        measured = await checker.run({ label: "final", answer });
      } catch (error) {
        checkError = (error as Error).message;
      }
      const topology = `the topology ended ${result.outcome}: ${result.reason}`;
      if (outcome !== "stopped") {
        if (measured) {
          outcome = measured.passed ? "passed" : "failed";
          const failed = measured.results.filter((r) => !r.passed).map((r) => r.name);
          reason = measured.passed
            ? `the measured check passed (${measured.results.length} of ${measured.results.length}); ${topology}`
            : `the measured check failed (${failed.join(", ")}); ${topology}`;
        } else {
          outcome = "inconclusive";
          reason = `the measured check could not run: ${checkError}; ${topology}`;
        }
      }
      const labStep = this.measuredStep(steps.length, measured, checkError, checkStarted);
      steps.push(labStep);
      if (this.config.storage?.steps) saving.push(this.config.storage.steps.saveStep(labStep).catch(() => {}));
      this.publish({
        type: "step",
        seq: labStep.seq,
        round: null,
        role: labStep.role,
        name: labStep.roleName,
        inputs: [],
        calls: 0,
        tools: [],
        tokens: { ...labStep.tokens },
      });
    }

    await Promise.all(saving);
    const tokens = { ...result.finalState.totalTokens };
    const end: SessionEvent = {
      type: "run:end",
      runId: this.runId,
      outcome,
      success: outcome === "passed",
      reason,
      topologyOutcome: result.outcome,
      verdict: result.verdict,
      ...(measured ? { measured } : {}),
      rounds: result.totalCycles,
      tokens,
      durationMs: Date.now() - startedAt,
      answer,
      errors: result.errors,
    };
    await recorder?.finish(end);
    this.publish(end);

    return {
      result,
      runId: this.runId,
      outcome,
      success: outcome === "passed",
      reason,
      ...(measured ? { measured } : {}),
      answer,
      activatedSkills,
      steps,
    };
  }

  /** The final measured check as a step of the run: the lab's, after every role's. */
  private measuredStep(
    lastSeq: number,
    measured: MeasuredCheckRun | undefined,
    error: string | undefined,
    started: Date,
  ): StepRecord {
    const ended = new Date();
    const data: Record<string, unknown> = measured
      ? { label: measured.label, passed: measured.passed, results: measured.results }
      : { label: "final", passed: false, error };
    return {
      runId: this.runId,
      seq: lastSeq + 1,
      round: null,
      role: "lab",
      roleName: "measured check",
      category: "custom",
      inputs: [],
      calls: [],
      outputs: [{ type: "measured_check", fields: describeFields({ type: "measured_check", data }) }],
      toolCalls: [],
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      success: measured?.passed ?? false,
      errors: error ? [error] : [],
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationMs: ended.getTime() - started.getTime(),
    };
  }
}

/** Writes the run record, one iteration per role turn, and the usage. Best-effort: storage never fails a run. */
class RunRecorder {
  private storedId: string | null = null;
  private turn = 0;
  private readonly storage: Storage;

  constructor(
    private readonly config: AgentSessionConfig,
    private readonly runId: string,
    private readonly task: string,
    private readonly recipe: Recipe,
    private readonly roleCount: number,
  ) {
    this.storage = config.storage!;
  }

  async start(): Promise<void> {
    try {
      const info = this.config.runInfo ?? {};
      const run = await this.storage.runs.createRun({
        externalId: this.runId,
        name: this.task.slice(0, 120),
        status: "running",
        provider: info.provider ?? this.config.provider.name,
        model: info.model ?? "",
        maxIterations: (this.config.maxRounds ?? this.recipe.defaults.maxCycles ?? 0) * this.roleCount,
        workingDir: this.config.workingDir ?? process.cwd(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        startedAt: new Date().toISOString(),
        config: { topology: this.recipe.id, recipe: this.recipe.id, schedule: "rounds", ...(info.config ?? {}) },
        success: false,
        tags: info.tags ?? [this.recipe.id],
      });
      this.storedId = run.id;
    } catch {
      this.storedId = null;
    }
  }

  role(event: Extract<SessionEvent, { type: "role:end" }>): void {
    if (!this.storedId) return;
    const now = Date.now();
    this.storage.runs
      .saveIteration({
        id: "",
        runId: this.storedId,
        number: ++this.turn,
        success: event.success,
        inputTokens: event.tokens.inputTokens,
        outputTokens: event.tokens.outputTokens,
        totalTokens: event.tokens.totalTokens,
        responseText: event.output.slice(0, 5000),
        planItemTitle: `round ${event.round} · ${event.name}`,
        startedAt: new Date(now - event.durationMs).toISOString(),
        endedAt: new Date(now).toISOString(),
        durationMs: event.durationMs,
        errors: event.errors,
      })
      .catch(() => {});
  }

  async finish(end: Extract<SessionEvent, { type: "run:end" }>): Promise<void> {
    if (!this.storedId) return;
    try {
      const current = await this.storage.runs.getRun(this.runId).catch(() => null);
      const status =
        current?.status === "cancelled" || end.outcome === "stopped"
          ? "cancelled"
          : end.outcome === "failed"
            ? "failed"
            : "completed";
      await this.storage.runs.updateRun(this.runId, {
        status,
        success: end.success,
        totalInputTokens: end.tokens.inputTokens,
        totalOutputTokens: end.tokens.outputTokens,
        totalTokens: end.tokens.totalTokens,
        endedAt: new Date().toISOString(),
        durationMs: end.durationMs,
        summary: `[${end.outcome}] ${end.reason}\n\n${end.answer}`.slice(0, 2000),
        config: {
          ...(current?.config ?? {}),
          outcome: end.outcome,
          topologyOutcome: end.topologyOutcome,
          verdict: end.verdict,
          rounds: end.rounds,
          ...(end.measured
            ? {
                measured: {
                  passed: end.measured.passed,
                  results: end.measured.results.map((r) => ({ name: r.name, passed: r.passed, exitCode: r.exitCode })),
                },
              }
            : {}),
        },
      });
      const info = this.config.runInfo ?? {};
      await this.storage.usage.record({
        runId: this.storedId,
        provider: info.provider ?? this.config.provider.name,
        model: info.model ?? "",
        inputTokens: end.tokens.inputTokens,
        outputTokens: end.tokens.outputTokens,
        totalTokens: end.tokens.totalTokens,
        estimatedCost: info.costOf?.(end.tokens) ?? 0,
        latencyMs: end.durationMs,
      });
    } catch {
      // A storage failure never fails the run.
    }
  }
}
