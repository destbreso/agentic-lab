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
  outcome: { outcome: string; reason: string } | null;
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
    outcome: null,
  };
}

const VERDICT: Record<string, { txt: string; k: Meaning }> = {
  pass: { txt: "✓ pass", k: "pass" },
  fail: { txt: "✗ fail", k: "fail" },
  partial: { txt: "✗ partial", k: "fail" },
  inconclusive: { txt: "? no verdict", k: "dim" },
};

/** Fold one event into the state; returns a new state. */
export function reduceRun(prev: RunState, e: SessionEvent, now = Date.now()): RunState {
  const s: RunState = { ...prev, now, results: { ...prev.results }, tokensByRole: { ...prev.tokensByRole }, rounds: prev.rounds.map((r) => ({ ...r })), done: [...prev.done], notes: [...prev.notes] };
  const current = () => s.rounds[s.rounds.length - 1];
  switch (e.type) {
    case "run:start":
      return { ...initialRunState(now), phase: "running" };
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
      return s;
    case "role:end": {
      s.active = null;
      if (!s.done.includes(e.role)) s.done.push(e.role);
      s.lastFinished = e.role;
      s.tokens += e.tokens.totalTokens;
      s.tokensByRole[e.role] = (s.tokensByRole[e.role] ?? 0) + e.tokens.totalTokens;
      if (!e.success) s.results[e.role] = { txt: "✗ failed", k: "fail" };
      else if (e.verdict) s.results[e.role] = VERDICT[e.verdict] ?? { txt: e.verdict, k: "dim" };
      else if (e.decision) s.results[e.role] = { txt: `→ ${e.decision}`, k: "b" };
      if (e.category === "critic" && /^(warning|critical):/.test(e.output) && current()) current().flag = true;
      return s;
    }
    case "signal":
      if (e.signal === "intervention" && current()) current().flag = true;
      return s;
    case "consult:start":
      s.consult = { from: e.from, to: e.to, name: e.name, live: true, ...(e.question ? { question: e.question } : {}) };
      return s;
    case "consult:end":
      s.consult = { from: e.from, to: e.to, name: e.name, live: false };
      s.consults += 1;
      s.tokens += e.tokens.totalTokens;
      s.tokensByRole[e.to] = (s.tokensByRole[e.to] ?? 0) + e.tokens.totalTokens;
      return s;
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
    case "run:end":
      s.phase = "done";
      s.active = null;
      s.consult = s.consult ? { ...s.consult, live: false } : null;
      s.outcome = { outcome: e.outcome, reason: e.reason };
      s.tokens = e.tokens.totalTokens;
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
  const secs = Math.max(0, Math.round((s.now - s.startedAt) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}
