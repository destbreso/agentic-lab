// ============================================
// The session: a conversation where each message is a task
// ============================================
// Everything the screen shows comes from here, and nothing here draws. Each
// message you send runs the chosen topology through TopologyRun, with the
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
  TopologyRun,
  InMemoryStorage,
  createDefaultToolkit,
  discoverLocal,
  drawingOf,
  ensureProjectDir,
  environmentBlock,
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
  type RunEvent,
  type PermissionAnswer,
  type PermissionQuestion,
  type PermissionSettings,
  type SessionGrants,
  type Storage,
  type TaskCheck,
  type TimedEvent,
  type Topology,
} from "jig-core";
import { resolveTopology } from "../topology-arg.js";
import { saveHistory, saveLocalRecord } from "../session-runner.js";
import { loadPermissions, nextMode, saveLocalRules } from "../permissions.js";
import { loadRecordedRun } from "../commands/replay.js";
import { splitRef, type Models } from "./models.js";
import type { IndicatorState } from "./theme.js";
import type { SessionKey } from "./keys.js";
import { JIG_HELP, JigHelpTool, aboutJig, offerJigHelp } from "../help/jig-help.js";
import { toolWarnings } from "../providers.js";

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
  /** Tools turned off for this session, for every role. */
  toolsOff: string[];
  /** Tools turned off for this session for one role (/tools' checklist). */
  roleToolsOff?: Record<string, string[]>;
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
      /** Nothing verified the answer, and why. */
      unverified?: string;
      /** Each role that fell back along its chain. */
      fallbacks?: Array<{ role: string; from: string; to: string; reason: string }>;
      /** The run's latest log lines while it runs. */
      activity: string[];
      events?: number;
    }
  | { kind: "note"; text: string; at: number }
  | { kind: "info"; title?: string; lines: Line[]; at: number }
  | { kind: "error"; text: string; at: number };

/** A tool call waiting for the person: what it would do, and how to answer it. */
/** One choice of a picker. */
export interface PickItem {
  value: string;
  label: string;
  /** Said after the label, dim: what the choice is or does. */
  detail?: string;
  /** The value in effect now, marked. */
  current?: boolean;
}

/**
 * The one picker every slash command opens when it is called without its
 * choice: single (arrows, Enter) or multiple (Space checks, Enter keeps),
 * Esc cancelling, typing filtering a long list.
 */
export interface Picker {
  id: string;
  title: string;
  items: PickItem[];
  multi: boolean;
  /** The cursor, an index into the filtered items. */
  at: number;
  checked: Set<string>;
  filter: string;
  hint?: string;
  resolve: (values: string[] | null) => void;
}

/** The items a picker shows through its filter. */
export const pickerItems = (p: Picker): PickItem[] => {
  const f = p.filter.toLowerCase();
  return f ? p.items.filter((i) => `${i.label} ${i.detail ?? ""}`.toLowerCase().includes(f)) : p.items;
};

export interface PendingApproval {
  id: string;
  question: PermissionQuestion;
  resolve: (answer: PermissionAnswer) => void;
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
  /** Skip a Check with nothing to verify (default true); a test of other behaviour turns it off. */
  skipUnverifiable?: boolean;
  /** file_write's correction of literal "\n" escapes (the config's tools.unescapeNewlines; on by default). */
  unescapeNewlines?: boolean;
  /** The permissions the session starts with (loadPermissions); default: the project's rules, the default mode. */
  permissions?: PermissionSettings;
  /** Read the providers and brains again, after /providers or /brains changed them. */
  reloadModels?: () => Promise<Models>;
  /** How discovery asks this machine's model servers (tests give fake ones). */
  discovery?: import("jig-core").DiscoverOptions;
  /** Open the guided picker when no model is found (default true). */
  guide?: boolean;
  /** The guided picker's ways that write the configuration: a cloud key, a server's address. */
  addKey?: (ctrl: SessionController) => Promise<void>;
  addServer?: (ctrl: SessionController) => Promise<void>;
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

/** A role's brain config for a choice: a brain's name, a chain ("a/x,b/y"), or one model. */
function brainFor(choice: string, defaultEntry: string, keep?: import("jig-core").NodeBrainConfig): import("jig-core").NodeBrainConfig {
  const { provider: _p, model: _m, brain: _b, chain: _c, ...rest } = keep ?? {};
  if (choice.includes(",")) return { ...rest, chain: choice.split(",").map((c) => c.trim()) };
  if (!choice.includes("/")) return { ...rest, brain: choice };
  return { ...rest, provider: splitRef(choice, defaultEntry).entry, model: splitRef(choice, defaultEntry).model };
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
  models: Models;
  /** A key being typed for the keychain: what it is for, and where it goes. */
  secret: { label: string; hidden: boolean; resolve: (value: string | null) => void } | null = null;
  /** The picker open now, if any (pick). */
  picker: Picker | null = null;
  settings: SessionSettings;
  messages: Message[] = [];
  topology: Topology | null = null;
  topologySource = "";
  drawing: Drawing | null = null;
  runState: RunState;
  running: TopologyRun | null = null;
  approvals: PendingApproval[] = [];
  /** The person's permissions: the mode (Shift+Tab), the rules, the working directories. */
  permissions: PermissionSettings;
  /** What the person allowed for the rest of this session: every edit, or shell rules kept for the project. */
  readonly grants: SessionGrants = { edits: false, rules: [] };
  /** Only a session started with --dangerously-skip-permissions has bypass in its cycle. */
  private bypassAvailable = false;
  replay: ReplayView | null = null;
  folded = false;
  /** What the engine is doing now, for the header's pose, the status line and the footer. */
  private state: IndicatorState = "idle";
  /** When the current activity began: a one-shot pose plays from here, then holds. */
  activitySince = 0;
  get activity(): IndicatorState {
    return this.state;
  }

  /** A new state starts its pose and indicator from their first frame; the same state goes on. */
  set activity(next: IndicatorState) {
    if (next === this.state) return;
    this.state = next;
    this.activitySince = this.clock();
  }

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
    this.permissions = options.permissions ?? loadPermissions(this.workingDir);
    this.bypassAvailable = this.permissions.mode === "bypassPermissions";
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
    // The boxes are narrow: they name the model, and the footer and /models say which entry serves it.
    // A role on a brain is drawn with the model its brain would try first.
    const shown = this.configured(t);
    for (const n of shown.nodes) {
      const b = n.config.brain;
      const first = b?.brain && !b.model ? this.models.chain?.(b.brain)[0] : b?.chain?.[0];
      if (first && !b?.model) n.config = { ...n.config, brain: { ...b, model: splitRef(first, "").model } };
    }
    for (const c of shown.consults) {
      const b = c.role.brain;
      const first = b?.brain && !b.model ? this.models.chain?.(b.brain)[0] : undefined;
      if (first) c.role.brain = { ...b, model: splitRef(first, "").model };
    }
    return drawingOf(shown, { source: this.topologySource, model: splitRef(this.modelOf(""), "").model });
  }

  /** The model a role runs on in this session. */
  modelOf(roleId: string): string {
    return this.settings.roleModels[roleId] ?? this.settings.defaultModel ?? this.models.defaultRef;
  }

  /** The topology as this session runs it: each role's model, the advisor's overrides. */
  configured(t: Topology): Topology {
    // Every role may ask Jig's own documentation, whatever its tool list says.
    const copy = offerJigHelp(t);
    const def = splitRef(this.models.defaultRef, "").entry;
    for (const node of copy.nodes) {
      // A role the session names, else the session's default, else the definition's own model or brain, else the default.
      const own = node.config.brain;
      const ref = this.settings.roleModels[node.id] ?? this.settings.defaultModel ?? (own?.model || own?.brain || own?.chain?.length ? undefined : this.models.defaultRef);
      if (ref) node.config = { ...node.config, brain: brainFor(ref, def, own) };
      // Tools turned off for this role in the session join its policy's deny list.
      const off = this.settings.roleToolsOff?.[node.id] ?? [];
      if (off.length) {
        const policy = node.config.toolPolicy ?? (node.config.enabledTools?.length ? { allow: node.config.enabledTools } : {});
        node.config = { ...node.config, toolPolicy: { ...policy, deny: [...new Set([...(policy.deny ?? []), ...off])] } };
      }
    }
    for (const c of copy.consults) {
      const ref = this.settings.advisor.model ?? this.settings.roleModels[c.role.id] ?? this.settings.defaultModel ?? (c.role.brain?.model ? undefined : this.models.defaultRef);
      if (ref) c.role.brain = brainFor(ref, def, c.role.brain);
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
    // The models are found in the background; a task sent at once waits for them, a little.
    if (this.preparing) await Promise.race([this.preparing, new Promise((r) => setTimeout(r, 5000))]);
    const base = this.topology;
    if (!base) return;
    const topology = this.configured(base);
    const warnings = this.toolWarnings(topology);
    if (warnings.length) this.info(warnings.map((w): Line => [["  ", ""], [w, "you"]]), "tools");
    this.drawing = this.drawingFor(base);
    const inputs = this.conversation();
    this.messages.push({ kind: "you", text: task, at: this.clock() });
    const msg: Extract<Message, { kind: "run" }> = { kind: "run", id: nanoid(6), task, topology: topology.id, at: this.clock(), text: "", activity: [] };
    this.messages.push(msg);
    const checks = this.settings.checks;
    const checkFiles = this.settings.checkFiles;
    // Checks are for the next task: they go with this one and are cleared.
    this.settings = { ...this.settings, checks: [], checkFiles: [] };

    let session: TopologyRun;
    try {
      const provider = this.models.provider(this.modelOf(""));
      session = new TopologyRun({
        provider,
        // A role's brain or chain falls back along its models; a model is itself.
        providerFactory: (brain) =>
          this.models.provider(
            brain.chain?.length ? brain.chain.join(",") : brain.brain ? brain.brain : `${brain.provider ?? splitRef(this.models.defaultRef, "").entry}/${brain.model ?? splitRef(this.models.defaultRef, "").model}`,
          ),
        tools: this.toolkit(),
        environment: `${environmentBlock(this.workingDir)}\n\n${aboutJig()}`,
        skipUnverifiable: this.options.skipUnverifiable ?? true,
        topology,
        workingDir: this.workingDir,
        delayMs: 0,
        tokenBudget: this.settings.tokenBudget,
        memoryScope: this.settings.memoryScope,
        memory: this.storage.memory,
        sessionId: this.id,
        storage: this.storage,
        streamText: true,
        permissions: {
          settings: this.permissions,
          grants: this.grants,
          ask: (q) => this.ask(q),
          saveRules: (rules) => {
            saveLocalRules(this.workingDir, { add: { list: "allow", rules } });
            this.permissions.rules.allow.push(...rules.filter((r) => !this.permissions.rules.allow.includes(r)));
          },
        },
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
    this.activity = "team";
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
      // The session is written before the run is put away, so whoever waits for the run's end reads it whole.
      await this.save();
      this.running = null;
      for (const a of this.approvals.splice(0)) a.resolve({ answer: "deny" });
      // A note reaches Do on its next turn; when the run ends first, say so.
      if (this.runState.notes.length) {
        this.info([[[`  ¦ ${this.runState.notes.length === 1 ? "the note was" : `${this.runState.notes.length} notes were`} not read: Do had no turn after it`, "you"]]]);
      }
      this.activity = msg.outcome === "passed" ? "passed" : msg.outcome === "failed" ? "failed" : "idle";
      this.changed();
    }
  }

  private onEvent(e: RunEvent, msg: Extract<Message, { kind: "run" }>, drawing: Drawing): void {
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
        // Do's new turn writes a new answer: the text of its last turn gives way to it.
        if (this.topology?.nodes.find((n) => n.id === e.role)?.category === "execution") {
          msg.text = "";
          msg.seq = undefined;
        }
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
        if (e.fallbacks?.length) msg.fallbacks = e.fallbacks;
        if (e.unverified) msg.unverified = e.unverifiedReason ?? "nothing to verify";
        this.activity = e.outcome === "passed" ? "passed" : e.outcome === "failed" ? "failed" : "idle";
        break;
    }
    msg.events = this.runState.log.length;
    this.changed();
  }

  /** The person's answer to the oldest open question; a no can carry what to do instead. */
  answer(choice: PermissionAnswer["answer"], feedback?: string): void {
    const a = this.approvals.shift();
    if (!a) return;
    const words = feedback?.trim();
    a.resolve({ answer: choice, ...(words ? { feedback: words } : {}) });
    // A plain no stops the run, as Claude Code stops the turn; a no with words lets the role go on with them.
    if (choice === "deny" && !words && this.running) {
      for (const b of this.approvals.splice(0)) b.resolve({ answer: "deny" });
      this.running.stop("you said no");
    }
    this.changed();
  }

  private ask(q: PermissionQuestion): Promise<PermissionAnswer> {
    return new Promise((resolve) => {
      this.approvals.push({ id: nanoid(6), question: q, resolve });
      this.changed();
    });
  }

  /** Shift+Tab: default, accept edits, plan, and round (bypass after plan, in a session started with it). */
  cycleMode(): void {
    this.permissions.mode = nextMode(this.permissions.mode, this.bypassAvailable);
    this.changed();
  }

  /** Open a picker; resolves with the values chosen, in the list's order, or null on Esc. */
  pick(title: string, items: PickItem[], o: { multi?: boolean; checked?: string[]; hint?: string } = {}): Promise<string[] | null> {
    this.picker?.resolve(null);
    return new Promise((resolve) => {
      this.picker = {
        id: nanoid(6),
        title,
        items,
        multi: Boolean(o.multi),
        at: Math.max(0, items.findIndex((i) => i.current)),
        checked: new Set(o.checked ?? []),
        filter: "",
        ...(o.hint ? { hint: o.hint } : {}),
        resolve: (values) => {
          this.picker = null;
          this.changed();
          resolve(values);
        },
      };
      this.changed();
    });
  }

  /** One choice, or null on Esc. */
  async pickOne(title: string, items: PickItem[], o: { hint?: string } = {}): Promise<string | null> {
    return (await this.pick(title, items, o))?.[0] ?? null;
  }

  /** A key while a picker is open: move, check, choose, cancel, or filter. */
  pickerKey(key: SessionKey): void {
    const p = this.picker;
    if (!p) return;
    const shown = pickerItems(p);
    const move = (to: number) => {
      p.at = Math.max(0, Math.min(shown.length - 1, to));
    };
    // Digits choose in a short single list with no filter, as numbered; elsewhere they filter.
    const numbered = !p.multi && !p.filter && shown.length <= 9;
    if (key.kind === "escape" || (key.kind === "ctrl" && key.letter === "c")) return p.resolve(null);
    if (key.kind === "up") move(p.at - 1);
    else if (key.kind === "down") move(p.at + 1);
    else if (key.kind === "pageup") move(p.at - 8);
    else if (key.kind === "pagedown") move(p.at + 8);
    else if (key.kind === "home") move(0);
    else if (key.kind === "end") move(shown.length - 1);
    else if (key.kind === "enter") {
      if (p.multi) return p.resolve(p.items.filter((i) => p.checked.has(i.value)).map((i) => i.value));
      if (shown[p.at]) return p.resolve([shown[p.at].value]);
    } else if (key.kind === "text" && key.text === " " && p.multi) {
      const v = shown[p.at]?.value;
      if (v !== undefined) p.checked.has(v) ? p.checked.delete(v) : p.checked.add(v);
    } else if (key.kind === "text" && numbered && /^[1-9]$/.test(key.text)) {
      const item = shown[Number(key.text) - 1];
      if (item) return p.resolve([item.value]);
    } else if (key.kind === "backspace") {
      p.filter = p.filter.slice(0, -1);
      p.at = 0;
    } else if (key.kind === "text" || key.kind === "paste") {
      p.filter += key.text.replace(/[\r\n]+/g, "");
      p.at = 0;
    }
    this.changed();
  }

  /** Ask for a key without showing it; null when the person cancels. */
  askSecret(label: string): Promise<string | null> {
    return this.askText(label, true);
  }

  /** Ask for a line of text (shown, or hidden for a key); null when the person cancels. */
  askText(label: string, hidden = false): Promise<string | null> {
    return new Promise((resolve) => {
      this.secret = {
        label,
        hidden,
        resolve: (v) => {
          this.secret = null;
          this.changed();
          resolve(v);
        },
      };
      this.changed();
    });
  }

  async reload(): Promise<void> {
    const found = (this.models as Partial<import("../providers.js").LoadedModels>).discovery?.found;
    if (this.options.reloadModels) this.models = await this.options.reloadModels();
    // What discovery found stays for the session: a reload keeps it until /providers discover asks again.
    await this.prepare(found ? { found } : {});
  }

  /** The models being prepared (discovery, the catalog, the default); a task waits for it, a little. */
  private preparing: Promise<void> | null = null;

  /**
   * Find what there is, in the background: this machine's model servers, every entry's models and what they
   * can do; then the default and the shipped brains are chosen from it. The header and /providers say what
   * answered. With no model anywhere, the person is guided to one.
   */
  prepare(o: { found?: import("jig-core").Discovered[]; fresh?: boolean } = {}): Promise<void> {
    const m = this.models as Partial<import("../providers.js").LoadedModels>;
    if (!m.prepare) return Promise.resolve();
    this.preparing = (async () => {
      const notes = await m.prepare!({ ...(this.options.discovery ? { discovery: this.options.discovery } : {}), ...o });
      if (notes.length) this.info(notes.map((n): Line => [["  ", ""], [n, "you"]]), "models");
      if (this.topology) this.drawing = this.drawingFor(this.topology);
      this.changed();
      if (!m.catalog?.length && this.options.guide !== false) void this.guide();
    })().catch((e) => this.say("error", `finding models: ${(e as Error).message}`));
    return this.preparing;
  }

  /**
   * A role with tools on a model that cannot use them answers without acting, and says nothing of it: each such
   * role is named before the run. Only the work tools count (every role may ask jig_help).
   */
  toolWarnings(topology: Topology): string[] {
    return toolWarnings(topology, this.models as Partial<import("../providers.js").LoadedModels>, this.models.defaultRef);
  }

  /** /providers discover: ask this machine again. */
  discover(): Promise<void> {
    return this.prepare({ fresh: true });
  }

  /** No model anywhere: the three ways to get one, as a picker. */
  async guide(): Promise<void> {
    const way = await this.pickOne("Jig found no model to run on. How do you want to get one?", [
      { value: "ollama", label: "install Ollama", detail: "free, runs on this computer: https://ollama.com/download, then ollama pull qwen2.5:7b" },
      { value: "key", label: "add a cloud key", detail: "Anthropic, OpenAI, Gemini or OpenRouter; typed hidden, kept in your keychain" },
      { value: "url", label: "give a server's address", detail: "an Ollama or OpenAI-compatible server, here or on another machine" },
      { value: "later", label: "not now", detail: "/providers and /models are there when you are ready" },
    ]);
    if (way === "ollama") {
      this.info(
        [
          [["  1. Install Ollama from ", "ink"], ["https://ollama.com/download", "b"]],
          [["  2. In a terminal: ", "ink"], ["ollama pull qwen2.5:7b", "b"], ["  (a small model that can use tools)", "faint"]],
          [["  3. Here: ", "ink"], ["/providers discover", "b"], [" finds it, and Jig is ready", "faint"]],
        ],
        "getting a model",
      );
    } else if (way === "key") await this.options.addKey?.(this);
    else if (way === "url") await this.options.addServer?.(this);
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

  /** The tools a run gets: the defaults the session leaves on, and jig_help unless it is turned off. */
  toolkit(): import("jig-core").ToolRegistry {
    const tools = createDefaultToolkit(this.enabledTools(), { unescapeNewlines: this.options.unescapeNewlines !== false });
    if (!this.settings.toolsOff.includes(JIG_HELP)) tools.register(new JigHelpTool());
    return tools;
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
    const steps = `${loaded.steps.length} step${loaded.steps.length === 1 ? "" : "s"}`;
    this.info([[[`replaying ${runId}: ${steps} from ${loaded.from}, ${events.length} events ∙ space pauses ∙ ⇢ steps ∙ esc closes`, "dim"]]], "replay");
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

  /** Saves one at a time, in order: two writes of the same file at once could interleave. */
  private saving: Promise<void> = Promise.resolve();

  save(): Promise<void> {
    if (!this.persist) return Promise.resolve();
    this.saving = this.saving.then(() => this.write()).catch(() => {});
    return this.saving;
  }

  private async write(): Promise<void> {
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
    for (const a of this.approvals.splice(0)) a.resolve({ answer: "deny" });
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
