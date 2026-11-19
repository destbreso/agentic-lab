// ============================================
// A run's state, as the viewer draws it
// ============================================
// Folded from the session's events, in order: which role is active, which
// have finished this round and with what, the rounds taken and how each
// ended, a consultation in progress, Critique's flags and the operator's
// notes, the tokens spent, and how the run ended. The same events give the
// same state, on the web or in a terminal.

import type { SessionEvent } from "../engine/agent-session.js";
import type { Meaning } from "./grid.js";

export interface RoundMark {
  state: "now" | "fail" | "pass" | "done";
  /** Critique flagged something this round, or a role asked to intervene. */
  flag: boolean;
}

/** A role's turn so far: its model calls (against its cap, when it has one), the tools its model asked for, its tokens. */
export interface RoleTurn {
  calls: number;
  tools: number;
  tokens: number;
}

/** One consultation through a consult edge, as the engine reported it. */
export interface Consultation {
  round: number;
  /** The role that asked, and the role it asked. */
  from: string;
  to: string;
  /** The reason the asking role gave, when it gave one. */
  question?: string;
  /** Milliseconds since the run started. */
  at: number;
  done: boolean;
  /** Input tokens the consulted role read to answer. */
  read?: number;
  tokens?: number;
  sealed?: boolean;
  error?: string;
}

/** An event the log shows, kept as the engine sent it (long texts cut), with its time since the run started. */
export interface LogEntry {
  at: number;
  e: SessionEvent;
}

export interface RunState {
  phase: "rest" | "running" | "done";
  startedAt: number;
  /** When the state was last folded, for the elapsed time. */
  now: number;
  round: number;
  /** Where the current round started: its first role, or the target of the way back taken. */
  startAt: string | null;
  active: string | null;
  /** Roles that finished in the current round. */
  done: string[];
  /** The last role to finish, after which the task's token is drawn. */
  lastFinished: string | null;
  /** What a role's box says once it finished this round. */
  results: Record<string, { txt: string; k: Meaning }>;
  tokensByRole: Record<string, number>;
  tokens: number;
  rounds: RoundMark[];
  consult: { from: string; to: string; name: string; live: boolean; question?: string } | null;
  consults: number;
  /** Notes for Do queued and not yet read. */
  notes: string[];
  /** The model each role actually answered on, when a chain says so, and whether it fell back. */
  models: Record<string, { ref: string; fellBack: boolean }>;
  /** A tool running now, and whose. */
  tool: { role: string; tool: string; args: string } | null;
  /** A role waiting for you to allow a shell command, and the command. */
  asking: { role: string; command: string; programs: string[] } | null;
  outcome: { outcome: string; reason: string } | null;
  /** The limits the run runs with, from its start. */
  limits: { rounds: number; tokenBudget?: number } | null;
  /** Each role's tool-call cap: the most model calls one of its turns may make. */
  caps: Record<string, number>;
  /** Each role's current or last turn in this round. */
  turns: Record<string, RoleTurn>;
  /** Every consultation, in order. */
  consultations: Consultation[];
  /** The last advice each consulted role gave: its text when the lab can read it. */
  advice: Record<string, { text?: string; sealed?: boolean; error?: string }>;
  /** The events the log shows. */
  log: LogEntry[];
  /** The lab's measured checks: how many the task has, and the latest result, from Check's turn or the final check. */
  checks: { total: number; passed?: number; ran?: number } | null;
}

export function initialRunState(now = Date.now()): RunState {
  return {
    phase: "rest",
    startedAt: now,
    now,
    round: 0,
    startAt: null,
    active: null,
    done: [],
    lastFinished: null,
    results: {},
    tokensByRole: {},
    tokens: 0,
    rounds: [],
    consult: null,
    consults: 0,
    notes: [],
    models: {},
    tool: null,
    asking: null,
    outcome: null,
    limits: null,
    caps: {},
    turns: {},
    consultations: [],
    advice: {},
    log: [],
    checks: null,
  };
}

/** The most log entries a state keeps: enough for a whole run, so the scrollback gets every line. */
export const LOG_KEEP = 20_000;

/** Events the log shows; long texts are cut so a state stays small. */
const LOGGED = new Set(["run:start", "round:start", "role:start", "call", "role:end", "consult:start", "consult:end", "round:end", "steer:queued", "steer:delivered", "steer:dropped", "approval:asked", "approval:answered", "permission:denied", "run:end"]);

function forLog(e: SessionEvent): SessionEvent {
  const cut = (t: string, n = 300) => (t.length > n ? `${t.slice(0, n)}…` : t);
  switch (e.type) {
    case "run:start":
      return { ...e, task: cut(e.task) };
    case "role:end":
      return { ...e, output: cut(e.output), toolCalls: e.toolCalls.slice(0, 20) };
    case "run:end":
      return { ...e, answer: cut(e.answer) };
    default:
      return e;
  }
}

const VERDICT: Record<string, { txt: string; k: Meaning }> = {
  pass: { txt: "✓ pass", k: "pass" },
  fail: { txt: "✗ fail", k: "fail" },
  partial: { txt: "✗ partial", k: "fail" },
  inconclusive: { txt: "? no verdict", k: "dim" },
};

/** Fold one event into the state; returns a new state. */
export function reduceRun(prev: RunState, e: SessionEvent, now = Date.now()): RunState {
  const s: RunState = {
    ...prev,
    now,
    results: { ...prev.results },
    tokensByRole: { ...prev.tokensByRole },
    rounds: prev.rounds.map((r) => ({ ...r })),
    done: [...prev.done],
    notes: [...prev.notes],
    turns: { ...prev.turns },
    consultations: prev.consultations.map((c) => ({ ...c })),
    advice: { ...prev.advice },
    log: LOGGED.has(e.type) || (e.type === "tool:end" && e.note) ? [...prev.log.slice(-(LOG_KEEP - 1)), { at: Math.max(0, now - (e.type === "run:start" ? now : prev.startedAt)), e: forLog(e) }] : prev.log,
  };
  const current = () => s.rounds[s.rounds.length - 1];
  switch (e.type) {
    case "run:start":
      return {
        ...initialRunState(now),
        phase: "running",
        limits: { ...e.limits },
        caps: Object.fromEntries(e.roles.filter((r) => r.callCap !== undefined).map((r) => [r.id, r.callCap!])),
        log: [{ at: 0, e: forLog(e) }],
        checks: e.checks.length ? { total: e.checks.length } : null,
      };
    case "call": {
      if (e.route) s.models = { ...s.models, [e.role]: { ref: e.route.answeredBy, fellBack: e.route.fallbacks.length > 0 } };
      // Tokens count as each call ends; the turn's end adds only what no call reported.
      const t = s.turns[e.role] ?? { calls: 0, tools: 0, tokens: 0 };
      s.turns[e.role] = { calls: Math.max(t.calls, e.seq), tools: t.tools + e.tools.length, tokens: t.tokens + e.tokens.totalTokens };
      s.tokens += e.tokens.totalTokens;
      s.tokensByRole[e.role] = (s.tokensByRole[e.role] ?? 0) + e.tokens.totalTokens;
      return s;
    }
    case "round:start":
      s.round = e.round;
      s.startAt = e.startAt;
      s.done = [];
      s.results = {};
      s.tokensByRole = {};
      s.lastFinished = null;
      s.rounds.push({ state: "now", flag: false });
      return s;
    case "role:start":
      s.active = e.role;
      s.turns[e.role] = { calls: 0, tools: 0, tokens: 0 };
      return s;
    case "role:end": {
      s.active = null;
      s.tool = null;
      if (!s.done.includes(e.role)) s.done.push(e.role);
      s.lastFinished = e.role;
      const counted = s.turns[e.role]?.tokens ?? 0;
      const rest = Math.max(0, e.tokens.totalTokens - counted);
      s.tokens += rest;
      s.tokensByRole[e.role] = (s.tokensByRole[e.role] ?? 0) + rest;
      if (e.skipped) s.results[e.role] = { txt: "· skipped", k: "dim" };
      else if (!e.success) s.results[e.role] = { txt: "✗ failed", k: "fail" };
      else if (e.verdict) s.results[e.role] = VERDICT[e.verdict] ?? { txt: e.verdict, k: "dim" };
      else if (e.decision) s.results[e.role] = { txt: `→ ${e.decision}`, k: "b" };
      if (e.category === "critic" && /^(warning|critical):/.test(e.output) && current()) current().flag = true;
      if (e.checks) s.checks = { total: Math.max(s.checks?.total ?? 0, e.checks.total), passed: e.checks.passed, ran: e.checks.total };
      return s;
    }
    case "signal":
      if (e.signal === "intervention" && current()) current().flag = true;
      return s;
    case "consult:start":
      s.consult = { from: e.from, to: e.to, name: e.name, live: true, ...(e.question ? { question: e.question } : {}) };
      s.consultations.push({ round: e.round, from: e.from, to: e.to, ...(e.question ? { question: e.question } : {}), at: Math.max(0, now - s.startedAt), done: false });
      s.turns[e.to] = { calls: 0, tools: 0, tokens: 0 };
      return s;
    case "consult:end": {
      s.consult = { from: e.from, to: e.to, name: e.name, live: false };
      s.consults += 1;
      const counted = s.turns[e.to]?.tokens ?? 0;
      const rest = Math.max(0, e.tokens.totalTokens - counted);
      s.tokens += rest;
      s.tokensByRole[e.to] = (s.tokensByRole[e.to] ?? 0) + rest;
      const open = [...s.consultations].reverse().find((c) => c.to === e.to && !c.done);
      if (open) Object.assign(open, { done: true, read: e.tokens.inputTokens, tokens: e.tokens.totalTokens, ...(e.sealed ? { sealed: true } : {}), ...(e.error ? { error: e.error } : {}) });
      s.advice[e.to] = e.error ? { error: e.error } : e.sealed ? { sealed: true } : { text: e.advice ?? "" };
      return s;
    }
    case "round:end":
      if (current()) current().state = e.verdict === "pass" ? "pass" : e.verdict ? "fail" : "done";
      return s;
    case "steer:queued":
      s.notes.push(e.message);
      return s;
    case "steer:delivered":
    case "steer:dropped":
      s.notes.shift();
      return s;
    case "tool:start":
      s.tool = { role: e.role, tool: e.tool, args: e.args };
      return s;
    case "tool:end":
      s.tool = null;
      return s;
    case "approval:asked":
      s.asking = { role: e.role, command: e.command, programs: [...e.programs] };
      return s;
    case "approval:answered":
      s.asking = null;
      return s;
    case "run:end":
      s.phase = "done";
      s.active = null;
      s.asking = null;
      s.consult = s.consult ? { ...s.consult, live: false } : null;
      // A run nothing verified answered; it is not an inconclusive verdict.
      s.outcome = e.unverified && e.outcome !== "stopped" ? { outcome: "answered", reason: `not verified: ${e.unverifiedReason}` } : { outcome: e.outcome, reason: e.reason };
      s.tokens = e.tokens.totalTokens;
      if (e.measured) s.checks = { total: e.measured.results.length, passed: e.measured.results.filter((r) => r.passed).length, ran: e.measured.results.length };
      return s;
    default:
      return s;
  }
}

export function foldRun(events: SessionEvent[], clock: () => number = Date.now): RunState {
  return events.reduce((s, e) => reduceRun(s, e, clock()), initialRunState(clock()));
}

/** Tokens in short: 980, 9.8k, 1.2M. */
export function shortTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function elapsed(s: RunState): string {
  // A clock: a second shows once it has passed.
  const secs = Math.max(0, Math.floor((s.now - s.startedAt) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}
