// ============================================
// The session: a conversation where each message is a task
// ============================================
// Everything the screen shows comes from here, and nothing here draws. Each
// message you send runs the chosen topology through AgentSession, with the
// conversation so far as its input and memory scoped to this session; the
// answer streams in as Do's model writes it; typing during a run steers it;
// a shell command off a role's list waits here for your answer. Settings
// (the topology, a model per role, the budget, memory, tools, the advisor)
// and the conversation are kept in .jig/sessions/<id>.json, so --resume
// opens the session again. A past run can be replayed on the same screen.

import { EventEmitter } from "eventemitter3";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { nanoid } from "nanoid";
import {
  AgentSession,
  InMemoryStorage,
  createDefaultToolkit,
  drawingOf,
  ensureProjectDir,
  eventsFromSteps,
  initialRunState,
  listProjectEntries,
  readablePaths,
  reduceRun,
  type ConsultSight,
  type Drawing,
  type MemoryScope,
  type RunInput,
  type RunOutcome,
  type RunState,
  type SessionEvent,
  type ShellAnswer,
  type Storage,
  type TaskCheck,
  type TimedEvent,
  type Topology,
} from "jig-core";
import { resolveTopology } from "../topology-arg.js";
import { saveHistory, saveLocalRecord } from "../session-runner.js";
import { loadRecordedRun } from "../commands/replay.js";
import { splitRef, type Models } from "./models.js";
import type { IndicatorState } from "./theme.js";

export interface SessionSettings {
  /** A built-in topology's id, or a definition file. */
  topology: string;
  /** Each role's model, as "<entry>/<model>"; a role not named runs on the default. */
  roleModels: Record<string, string>;
  /** The model a role runs on when nothing names one. */
  defaultModel?: string;
  /** Tokens one task may spend. */
  tokenBudget?: number;
  memoryScope: MemoryScope;
  /** Tools turned off for this session. */
  toolsOff: string[];
  /** Checks for the next task only. */
  checks: TaskCheck[];
  /** Files those checks depend on. */
  checkFiles: string[];
  /** Overrides for a consulted role: its model, its limit a turn, what it sees. */
  advisor: { model?: string; limit?: number; sees?: ConsultSight[] };
}

export type Line = Array<[string, import("jig-core").Meaning]>;

export type Message =
  | { kind: "you"; text: string; at: number }
  | {
      kind: "run";
      id: string;
      task: string;
      topology: string;
      at: number;
      runId?: string;
      /** The answer as Do's model writes it; replaced by the final answer at the end. */
      text: string;
      /** The model call of Do's turn the text belongs to. */
      seq?: number;
      outcome?: RunOutcome;
      reason?: string;
      tokens?: number;
      durationMs?: number;
      rounds?: number;
      checks?: { passed: number; total: number };
      /** The run's latest log lines while it runs. */
      activity: string[];
      events?: number;
    }
  | { kind: "note"; text: string; at: number }
  | { kind: "info"; title?: string; lines: Line[]; at: number }
  | { kind: "error"; text: string; at: number };

export interface PendingApproval {
  id: string;
  role: string;
  roleName: string;
  command: string;
  programs: string[];
  resolve: (answer: ShellAnswer) => void;
}

export interface ReplayView {
  runId: string;
  drawing: Drawing;
  state: RunState;
  events: TimedEvent[];
  next: number;
  t0: number;
  total: number;
  pos: number;
  playing: boolean;
  speed: number;
  finished: boolean;
}

export interface ControllerOptions {
  workingDir: string;
  models: Models;
  /** Where runs are kept (in memory when absent). */
  storage?: Storage | null;
  settings?: Partial<SessionSettings>;
  /** Open this saved session instead of a new one. */
  resume?: SavedSession;
  /** Write the session file after each change (default true). */
  persist?: boolean;
  /** The time, for a test. */
  clock?: () => number;
  /** A timer, for a test's replay. */
  every?: (fn: () => void, ms: number) => { stop(): void };
}

export interface SavedSession {
  id: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  workingDir: string;
  settings: SessionSettings;
  messages: Message[];
}

export const DEFAULT_SETTINGS: SessionSettings = {
  topology: "exec-eval",
  roleModels: {},
  memoryScope: "session",
  toolsOff: [],
  checks: [],
  checkFiles: [],
  advisor: {},
};

const ACTIVITY = 5;
/** The earlier messages a run reads, as the conversation. */
const CONVERSATION_TURNS = 8;

export class SessionController extends EventEmitter<{ change: []; exit: [] }> {
  readonly id: string;
  readonly createdAt: string;
  readonly workingDir: string;
  readonly models: Models;
  settings: SessionSettings;
  messages: Message[] = [];
  topology: Topology | null = null;
  topologySource = "";
  drawing: Drawing | null = null;
  runState: RunState;
  running: AgentSession | null = null;
  approvals: PendingApproval[] = [];
  /** Commands allowed for the rest of this session (exact command lines). */
  readonly allowed = new Set<string>();
  replay: ReplayView | null = null;
  folded = false;
  /** What the engine is doing now, for the status line. */
  activity: IndicatorState = "idle";
  /** The last model each role answered on, as the engine reported it. */
  private storage: Storage;
  /** The run under way, and whether its run:end has arrived. */
  private current: Promise<void> | null = null;
  private ended = false;
  private readonly clock: () => number;
  private readonly every: NonNullable<ControllerOptions["every"]>;
  private replayTimer: { stop(): void } | null = null;
  private readonly persist: boolean;

  constructor(private readonly options: ControllerOptions) {
    super();
    this.clock = options.clock ?? Date.now;
    this.every =
      options.every ??
      ((fn, ms) => {
        const t = setInterval(fn, ms);
        return { stop: () => clearInterval(t) };
      });
    this.workingDir = options.workingDir;
    this.models = options.models;
    this.storage = options.storage ?? new InMemoryStorage();
    this.persist = options.persist ?? true;
    const saved = options.resume;
    this.id = saved?.id ?? `session-${new Date(this.clock()).toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${nanoid(4)}`;
    this.createdAt = saved?.createdAt ?? new Date(this.clock()).toISOString();
    this.settings = { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}), ...(options.settings ?? {}) };
    // Checks are for the next task only, so a resumed session starts without them.
    if (saved) this.settings = { ...this.settings, checks: options.settings?.checks ?? [], checkFiles: options.settings?.checkFiles ?? [] };
    this.messages = saved ? saved.messages.filter((m) => m.kind !== "info") : [];
    this.runState = initialRunState(this.clock());
  }

  /** Read the topology the settings name; an error goes into the conversation. */
  async load(): Promise<void> {
    try {
      const resolved = await resolveTopology(this.settings.topology, this.workingDir);
      this.topology = resolved.topology;
      this.topologySource = resolved.source;
      this.drawing = this.drawingFor(resolved.topology);
      for (const w of resolved.warnings) this.say("error", `${w.path}: ${w.message}`);
    } catch (e) {
      this.say("error", (e as Error).message);
      if (this.settings.topology !== DEFAULT_SETTINGS.topology) {
        this.settings.topology = DEFAULT_SETTINGS.topology;
        await this.load();
        return;
      }
    }
    this.changed();
  }

  /** The drawing of a topology with the models this session gives its roles. */
  drawingFor(t: Topology): Drawing {
    return drawingOf(this.configured(t), { source: this.topologySource, model: this.modelOf("") });
  }

  /** The model a role runs on in this session. */
  modelOf(roleId: string): string {
    return this.settings.roleModels[roleId] ?? this.settings.defaultModel ?? this.models.defaultRef;
  }

  /** The topology as this session runs it: each role's model, the advisor's overrides. */
  configured(t: Topology): Topology {
    const copy = structuredClone(t);
    const def = splitRef(this.models.defaultRef, "").entry;
    for (const node of copy.nodes) {
      // A role the session names, else the session's default, else the definition's own model, else the default.
      const ref = this.settings.roleModels[node.id] ?? this.settings.defaultModel ?? (node.config.brain?.model ? undefined : this.models.defaultRef);
      if (ref) node.config = { ...node.config, brain: { ...(node.config.brain ?? {}), provider: splitRef(ref, def).entry, model: splitRef(ref, def).model } };
    }
    for (const c of copy.consults) {
      const ref = this.settings.advisor.model ?? this.settings.roleModels[c.role.id];
      if (ref) c.role.brain = { ...(c.role.brain ?? {}), provider: splitRef(ref, def).entry, model: splitRef(ref, def).model };
      if (this.settings.advisor.limit) {
        c.limit = this.settings.advisor.limit;
        c.label = c.label.replace(/\d+ a turn/, `${c.limit} a turn`);
      }
      if (this.settings.advisor.sees?.length) c.sees = [...this.settings.advisor.sees];
    }
    return copy;
  }

  changed(): void {
    this.emit("change");
  }

  say(kind: "error" | "note", text: string): void {
    this.messages.push({ kind, text, at: this.clock() });
    this.changed();
  }

  info(lines: Line[], title?: string): void {
    this.messages.push({ kind: "info", lines, at: this.clock(), ...(title ? { title } : {}) });
    this.changed();
  }

  /** A message from the input: a task, a note for a run, or a slash command (the caller sends those to commands). */
  async send(text: string): Promise<void> {
    const task = text.trim();
    if (!task) return;
    // A run that has ended but not yet been put away takes no notes: the task waits for it.
    if (this.running && this.ended) await this.current;
    if (this.running) {
      this.running.steer(task);
      this.messages.push({ kind: "note", text: task, at: this.clock() });
      this.changed();
      return;
    }
    this.current = this.runTask(task);
    await this.current;
  }

  /** What the conversation so far gives the next run: your turns and the answers, which a model wrote. */
  private conversation(): RunInput[] {
    const turns: string[] = [];
    for (const m of this.messages) {
      if (m.kind === "you") turns.push(`you: ${m.text.slice(0, 1500)}`);
      else if (m.kind === "run" && m.outcome && m.text) turns.push(`jig (${m.outcome}): ${m.text.slice(0, 1500)}`);
    }
    const recent = turns.slice(-CONVERSATION_TURNS * 2);
    if (!recent.length) return [];
    return [{ name: "conversation", provenance: "written", content: `## Earlier in this conversation\n\n${recent.join("\n\n")}` }];
  }

  /** Run a task through the topology. Resolves when the run ends. */
  async runTask(task: string): Promise<void> {
    if (!this.topology) await this.load();
    const base = this.topology;
    if (!base) return;
    const topology = this.configured(base);
    this.drawing = this.drawingFor(base);
    const inputs = this.conversation();
    this.messages.push({ kind: "you", text: task, at: this.clock() });
    const msg: Extract<Message, { kind: "run" }> = { kind: "run", id: nanoid(6), task, topology: topology.id, at: this.clock(), text: "", activity: [] };
    this.messages.push(msg);
    const checks = this.settings.checks;
    const checkFiles = this.settings.checkFiles;
    // Checks are for the next task: they go with this one and are cleared.
    this.settings = { ...this.settings, checks: [], checkFiles: [] };

    let session: AgentSession;
    try {
      const provider = this.models.provider(this.modelOf(""));
      session = new AgentSession({
        provider,
        providerFactory: (brain) => this.models.provider(`${brain.provider ?? splitRef(this.models.defaultRef, "").entry}/${brain.model ?? splitRef(this.models.defaultRef, "").model}`),
        tools: createDefaultToolkit(this.enabledTools()),
        topology,
        workingDir: this.workingDir,
        delayMs: 0,
        tokenBudget: this.settings.tokenBudget,
        memoryScope: this.settings.memoryScope,
        memory: this.storage.memory,
        sessionId: this.id,
        storage: this.storage,
        streamText: true,
        approve: (r) => this.ask(r),
        runInfo: { provider: splitRef(this.modelOf(""), "").entry, model: splitRef(this.modelOf(""), "").model, tags: [topology.id, "jig", "session"], config: { source: "jig", sessionId: this.id } },
      });
    } catch (e) {
      msg.outcome = "failed";
      msg.reason = (e as Error).message;
      this.changed();
      await this.save();
      return;
    }
    this.running = session;
    this.ended = false;
    this.runState = initialRunState(this.clock());
    this.activity = "thinking";
    const drawing = this.drawing!;
    session.on("event", (e) => this.onEvent(e, msg, drawing));
    this.changed();
    try {
      const run = await session.run({ task, ...(inputs.length ? { inputs } : {}), ...(checks.length ? { checks } : {}), ...(checkFiles.length ? { checkFiles } : {}) });
      msg.runId = run.runId;
      msg.text = run.answer || msg.text;
      await saveLocalRecord(this.workingDir, run, {
        topology: topology.id,
        ...(this.topologySource.startsWith("topologies/") || this.topologySource === "registered in code" ? {} : { definition: path.resolve(this.workingDir, this.settings.topology) }),
        task,
        provider: splitRef(this.modelOf(""), "").entry,
        model: splitRef(this.modelOf(""), "").model,
        sessionId: this.id,
        ...(this.runState.limits ? { limits: this.runState.limits } : {}),
      }).catch(() => {});
      await saveHistory(this.workingDir, run, { topology: topology.id }, splitRef(this.modelOf(""), "").entry, splitRef(this.modelOf(""), "").model).catch(() => {});
      // The task and its answer, kept where a role recalling within this session finds them.
      if (run.answer && this.settings.memoryScope !== "off") {
        await this.storage.memory.put(["session", this.id], `task-${run.runId}`, { text: task, role: "user", messageType: "task" }).catch(() => {});
        await this.storage.memory.put(["session", this.id], `result-${run.runId}`, { text: run.answer.slice(0, 4000), role: "agent", messageType: "result", outcome: run.outcome }).catch(() => {});
      }
    } catch (e) {
      msg.outcome = "failed";
      msg.reason = (e as Error).message;
    } finally {
      this.running = null;
      for (const a of this.approvals.splice(0)) a.resolve("deny");
      this.activity = msg.outcome === "passed" ? "passed" : msg.outcome === "failed" ? "failed" : "idle";
      this.changed();
      await this.save();
    }
  }

  private onEvent(e: SessionEvent, msg: Extract<Message, { kind: "run" }>, drawing: Drawing): void {
    const now = this.clock();
    if (e.type === "text") {
      // Do's answer as it is written; a later call of the turn starts it again.
      const doer = drawing.roles.find((r) => r.id === e.role);
      if (doer && this.topology?.nodes.find((n) => n.id === e.role)?.category === "execution") {
        if (msg.seq !== e.seq) {
          msg.text = "";
          msg.seq = e.seq;
        }
        msg.text += e.delta;
        this.activity = "thinking";
        this.changed();
      }
      return;
    }
    this.runState = reduceRun(this.runState, e, now);
    switch (e.type) {
      case "role:start":
        this.activity = "working";
        break;
      case "call":
        this.activity = e.tools.length ? "tool" : "working";
        break;
      case "consult:start":
        this.activity = "consulting";
        break;
      case "consult:end":
        this.activity = "working";
        break;
      case "tool:start":
        this.activity = "tool";
        break;
      case "tool:end":
        this.activity = "working";
        break;
      case "approval:asked":
        this.activity = "waiting";
        break;
      case "approval:answered":
        this.activity = "tool";
        break;
      case "round:start":
        if (e.round > 1 && drawing.roles[0]?.id !== e.startAt) this.activity = "back";
        break;
      case "round:end":
        if (e.next) this.activity = "back";
        break;
      case "run:end":
        this.ended = true;
        msg.outcome = e.outcome;
        msg.reason = e.reason;
        msg.tokens = e.tokens.totalTokens;
        msg.durationMs = e.durationMs;
        msg.rounds = e.rounds;
        msg.runId = e.runId;
        if (e.answer) msg.text = e.answer;
        if (e.measured) msg.checks = { passed: e.measured.results.filter((r) => r.passed).length, total: e.measured.results.length };
        this.activity = e.outcome === "passed" ? "passed" : e.outcome === "failed" ? "failed" : "idle";
        break;
    }
    msg.events = this.runState.log.length;
    this.changed();
  }

  /** The person's answer to the oldest open question. */
  answer(choice: ShellAnswer): void {
    const a = this.approvals.shift();
    if (!a) return;
    if (choice === "session") this.allowed.add(a.command);
    a.resolve(choice);
    this.changed();
  }

  private ask(r: { role: string; roleName: string; command: string; programs: string[] }): Promise<ShellAnswer> {
    // A command allowed for the session runs without asking again; the log still says it was allowed.
    if (this.allowed.has(r.command)) return Promise.resolve("session");
    return new Promise((resolve) => {
      this.approvals.push({ id: nanoid(6), ...r, resolve });
      this.changed();
    });
  }

  /** Esc: deny an open question, else stop the run, else close a replay. Returns whether it did something. */
  interrupt(): boolean {
    if (this.approvals.length) {
      this.answer("deny");
      return true;
    }
    if (this.running) {
      this.running.stop("interrupted with Esc");
      return true;
    }
    if (this.replay) {
      this.closeReplay();
      return true;
    }
    return false;
  }

  toggleFold(): void {
    this.folded = !this.folded;
    this.changed();
  }

  enabledTools(): string[] | undefined {
    if (!this.settings.toolsOff.length) return undefined;
    return createDefaultToolkit()
      .getAll()
      .map((t) => t.definition.name)
      .filter((n) => !this.settings.toolsOff.includes(n));
  }

  /** Switch the topology; it takes effect on the next task. */
  async useTopology(arg: string): Promise<boolean> {
    const before = this.settings.topology;
    this.settings = { ...this.settings, topology: arg };
    try {
      const resolved = await resolveTopology(arg, this.workingDir);
      this.topology = resolved.topology;
      this.topologySource = resolved.source;
      this.drawing = this.drawingFor(resolved.topology);
      this.runState = initialRunState(this.clock());
      for (const w of resolved.warnings) this.say("error", `${w.path}: ${w.message}`);
      await this.save();
      this.changed();
      return true;
    } catch (e) {
      this.settings = { ...this.settings, topology: before };
      this.say("error", (e as Error).message);
      return false;
    }
  }

  /** Settings changed: redraw with them, and keep them. */
  async update(patch: Partial<SessionSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    if (this.topology) this.drawing = this.drawingFor(this.topology);
    await this.save();
    this.changed();
  }

  /** Forget the conversation; settings stay. */
  async clear(): Promise<void> {
    this.messages = [];
    this.runState = initialRunState(this.clock());
    this.activity = "idle";
    await this.save();
    this.changed();
  }

  // ---- Replay ----

  async openReplay(runId: string, speed = 4): Promise<void> {
    const loaded = await loadRecordedRun(runId, this.workingDir, this.storage);
    const resolved = await resolveTopology(loaded.topology || this.settings.topology, this.workingDir);
    const events = eventsFromSteps(loaded.steps, {
      runId,
      topology: resolved.topology,
      ...(loaded.task ? { task: loaded.task } : {}),
      ...(loaded.outcome ? { outcome: loaded.outcome } : {}),
      ...(loaded.reason ? { reason: loaded.reason } : {}),
      ...(loaded.limits ? { limits: loaded.limits } : {}),
    });
    this.closeReplay();
    const t0 = events[0]?.at ?? this.clock();
    this.replay = {
      runId,
      drawing: drawingOf(resolved.topology, { source: loaded.from, model: loaded.model ?? "" }),
      state: initialRunState(t0),
      events,
      next: 0,
      t0,
      total: (events.at(-1)?.at ?? t0) - t0,
      pos: t0,
      playing: true,
      speed,
      finished: events.length === 0,
    };
    this.info([[[`replaying ${runId}: ${loaded.steps.length} steps from ${loaded.from}, ${events.length} events · space pauses · → steps · esc closes`, "dim"]]], "replay");
    let last = this.clock();
    this.replayTimer = this.every(() => {
      const r = this.replay;
      if (!r) return;
      const now = this.clock();
      if (r.playing && !r.finished) r.pos += (now - last) * r.speed;
      last = now;
      let moved = false;
      while (r.playing && r.next < r.events.length && r.events[r.next].at <= r.pos) {
        this.replayStep(false);
        moved = true;
      }
      if (r.next >= r.events.length && !r.finished) {
        r.finished = true;
        r.pos = r.t0 + r.total;
        moved = true;
      }
      if (moved || r.playing) this.changed();
    }, 40);
    this.changed();
  }

  /** The next recorded event, now. */
  replayStep(pause = true): void {
    const r = this.replay;
    if (!r || r.next >= r.events.length) return;
    const { at, event } = r.events[r.next++];
    r.pos = Math.max(r.pos, at);
    r.state = reduceRun(r.state, event, at);
    if (pause) r.playing = false;
    this.changed();
  }

  toggleReplay(): void {
    if (!this.replay || this.replay.finished) return;
    this.replay.playing = !this.replay.playing;
    this.changed();
  }

  closeReplay(): void {
    this.replayTimer?.stop();
    this.replayTimer = null;
    if (this.replay) {
      this.replay = null;
      this.changed();
    }
  }

  /** Past runs in this working directory, newest first: from .jig/runs and .agentic-lab/runs. */
  async pastRuns(limit = 15): Promise<Array<{ runId: string; topology: string; outcome?: string; task?: string; at: number }>> {
    const entries = await listProjectEntries(this.workingDir, "runs");
    const out: Array<{ runId: string; topology: string; outcome?: string; task?: string; at: number }> = [];
    for (const e of entries) {
      const rec = path.join(e.dir, "record.json");
      if (!existsSync(rec) || !existsSync(path.join(e.dir, "steps.json"))) continue;
      try {
        const r = JSON.parse(await readFile(rec, "utf-8")) as Record<string, unknown>;
        const stamp = /^run-(\d+)-/.exec(e.name);
        out.push({ runId: e.name, topology: String(r.topology ?? ""), ...(typeof r.outcome === "string" ? { outcome: r.outcome } : {}), ...(typeof r.task === "string" ? { task: r.task } : {}), at: stamp ? Number(stamp[1]) : 0 });
      } catch {
        /* an unreadable record is skipped */
      }
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  // ---- Persistence ----

  get file(): string {
    return path.join(readablePaths(this.workingDir, "sessions")[0], `${this.id}.json`);
  }

  async save(): Promise<void> {
    if (!this.persist) return;
    const saved: SavedSession = {
      id: this.id,
      version: 1,
      createdAt: this.createdAt,
      updatedAt: new Date(this.clock()).toISOString(),
      workingDir: this.workingDir,
      settings: this.settings,
      // What a person wrote and what the runs answered; command output is not kept.
      messages: this.messages.filter((m) => m.kind !== "info").map((m) => (m.kind === "run" ? { ...m, activity: [] } : m)),
    };
    await ensureProjectDir(this.workingDir, "sessions");
    await writeFile(this.file, JSON.stringify(saved, null, 1));
  }

  /** Stop what runs, close a replay. */
  shutdown(): void {
    this.running?.stop("the session was closed");
    for (const a of this.approvals.splice(0)) a.resolve("deny");
    this.closeReplay();
  }

  /** The run's latest log lines, for the message under way. */
  recentActivity(lines: string[]): string[] {
    return lines.slice(-ACTIVITY);
  }
}

/** The saved sessions in a working directory, newest first. */
export async function savedSessions(workingDir: string): Promise<SavedSession[]> {
  const entries = await listProjectEntries(workingDir, "sessions");
  const out: SavedSession[] = [];
  for (const e of entries.filter((x) => x.name.endsWith(".json"))) {
    try {
      out.push(JSON.parse(await readFile(e.dir, "utf-8")) as SavedSession);
    } catch {
      /* skipped */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
