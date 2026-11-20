// ============================================
// A recorded run as the events it gave, rebuilt from its step records
// ============================================
// A replay draws a stored run on the same screen a live run uses. The screen
// is folded from session events, and a run's step records hold what each turn
// did and when: its start and end, each model call with the tools its model
// asked for and its tokens, its outputs, and every consultation and the lab's
// final check as steps of their own. From them this rebuilds the events in
// the order and at the times they happened. Nothing is invented: a value the
// records do not hold (a note the operator sent, the reason a round ended) is
// left out.

import type { StepRecord } from "../types/step.js";
import type { LoopCategory, RunOutcome, Signal } from "../types/pipeline.js";
import type { MeasuredCheckRun } from "../tasks/types.js";
import type { Topology } from "../formats/model.js";
import { summarise, type RunEvent, type Tokens } from "./topology-run.js";
import { DEFAULT_TOOL_ROUNDS } from "../loops/execution.js";

export interface TimedEvent {
  /** When it happened, in milliseconds since the epoch. */
  at: number;
  event: RunEvent;
}

export interface RecordedRun {
  runId: string;
  topology: Topology;
  /** The task, when the record keeps it. */
  task?: string;
  /** How the run ended, as its record says; without it, the lab's final check decides, or nothing does. */
  outcome?: RunOutcome;
  reason?: string;
  /** The limits it ran with, when the record keeps them; the topology's otherwise. */
  limits?: { rounds: number; tokenBudget?: number };
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const time = (iso: string) => new Date(iso).getTime();
const zero = (): Tokens => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

/** A step's outputs as the signals they were. */
function signalsOf(step: StepRecord): Signal[] {
  return step.outputs.map((o) => ({
    sourceNodeId: step.role,
    type: o.type,
    data: Object.fromEntries(Object.entries(o.fields).map(([k, f]) => [k, f.value])),
    provenance: Object.fromEntries(Object.entries(o.fields).map(([k, f]) => [k, f.provenance])),
    timestamp: step.endedAt,
  }));
}

const field = (step: StepRecord, type: string, name: string): unknown => step.outputs.find((o) => o.type === type)?.fields[name]?.value;

/** The events a recorded run gave, in order, each at its time. */
export function eventsFromSteps(steps: StepRecord[], run: RecordedRun): TimedEvent[] {
  const t = run.topology;
  const sorted = [...steps].sort((a, b) => a.seq - b.seq);
  const order = t.nodes.map((n) => n.id);
  const roleIds = new Set(order);
  const consults = new Map((t.consults ?? []).map((c) => [c.role.id, c]));
  const out: Array<TimedEvent & { n: number }> = [];
  let n = 0;
  // n orders events that share a millisecond: the order they are rebuilt in, or one given.
  const push = (at: number, event: RunEvent, order?: number) => out.push({ at, event, n: order ?? n++ });
  // The calls whose model asked for a consult tool, by the consulted role: a consultation goes right after its call.
  const asked = new Map<string, Array<{ n: number; at: number }>>();
  const category = (id: string) => (t.nodes.find((x) => x.id === id)?.category ?? "custom") as LoopCategory;

  const first = sorted[0];
  const startAt = first ? time(first.startedAt) : Date.now();
  push(startAt, {
    type: "run:start",
    runId: run.runId,
    topology: { id: t.id, name: t.name },
    task: run.task ?? "",
    roles: t.nodes.map((x) => ({ id: x.id, name: x.name, category: x.category, ...(x.type === "execution" ? { callCap: DEFAULT_TOOL_ROUNDS } : {}) })),
    order,
    wayBacks: t.waysBack.map((w) => ({ from: w.from, to: w.to })),
    activatedSkills: [],
    checks: [],
    consults: (t.consults ?? []).map((c) => ({ from: c.from, to: c.role.id, name: c.role.name, limit: c.limit, sees: [...c.sees] })),
    limits: run.limits ?? { rounds: t.defaults.maxCycles ?? 0, ...(t.defaults.tokenBudget ? { tokenBudget: t.defaults.tokenBudget } : {}) },
  });

  // Rounds, as the role steps tell them: a step in a new round starts it, where that step's role is.
  let round: number | null = null;
  let roundVerdict: string | null = null;
  let lastEnd = startAt;
  let answer = "";
  let measured: MeasuredCheckRun | undefined;
  const endRound = (at: number, next: string | null) => {
    if (round === null) return;
    push(at, { type: "round:end", round, verdict: roundVerdict, next, reason: "" });
  };

  for (const step of sorted) {
    const begin = time(step.startedAt);
    const end = step.endedAt ? time(step.endedAt) : begin + step.durationMs;
    lastEnd = Math.max(lastEnd, end);
    const calls = [...step.calls].sort((a, b) => a.seq - b.seq);
    const callEvents = (roleId: string, name: string, r: number, order?: (i: number) => number) =>
      calls.forEach((c, i) => {
        const at = time(c.startedAt) + c.durationMs;
        const tools = (c.reply?.toolCalls ?? []).map((x) => x.name);
        const at_n = order?.(i);
        push(at, { type: "call", round: r, role: roleId, name, seq: c.seq, tools, tokens: { ...c.usage }, durationMs: c.durationMs, ...(c.error ? { error: c.error } : {}), ...(c.reply?.model ? { model: c.reply.model } : {}), ...(c.route ? { route: c.route } : {}) }, at_n);
        for (const tool of tools) {
          if (!tool.startsWith("consult_")) continue;
          const id = tool.slice("consult_".length);
          asked.set(id, [...(asked.get(id) ?? []), { n: at_n ?? n - 1, at }]);
        }
      });

    if (step.role === "lab") {
      const passed = field(step, "measured_check", "passed");
      const results = field(step, "measured_check", "results");
      if (typeof passed === "boolean" && Array.isArray(results)) measured = { label: "final", passed, results } as MeasuredCheckRun;
      continue;
    }

    const consult = consults.get(step.role);
    if (consult) {
      const r = step.round ?? round ?? 1;
      const question = step.inputs.find((i) => i.name === "question")?.value;
      // Right after the call that asked for it, before the caller's next call, when their times tie.
      const after = asked.get(step.role)?.shift();
      const slot = (k: number) => (after ? after.n + 0.1 + k * 0.001 : undefined);
      push(Math.max(begin, after?.at ?? begin), { type: "consult:start", round: r, from: consult.from, to: step.role, name: step.roleName, ...(typeof question === "string" ? { question: clip(question, 500) } : {}), real: false }, slot(0));
      callEvents(step.role, step.roleName, r, (i) => slot(1 + i)!);
      const sealed = field(step, "advice", "sealed") === true;
      const advice = field(step, "advice", "advice");
      push(end, {
        type: "consult:end",
        round: r,
        from: consult.from,
        to: step.role,
        name: step.roleName,
        tokens: { ...step.tokens },
        sealed,
        ...(!sealed && typeof advice === "string" ? { advice: clip(advice, 600) } : {}),
        ...(step.errors[0] ? { error: step.errors[0] } : {}),
        real: false,
      }, slot(500));
      continue;
    }
    if (!roleIds.has(step.role)) continue;

    if (step.round !== null && step.round !== round) {
      endRound(begin, step.role);
      round = step.round;
      roundVerdict = null;
      push(begin, { type: "round:start", round, startAt: step.role });
    }
    const r = round ?? 1;
    const cat = category(step.role);
    push(begin, { type: "role:start", round: r, role: step.role, name: step.roleName, category: cat });
    callEvents(step.role, step.roleName, r);
    // What you allowed or denied in the turn, as it was recorded.
    (step.permissions ?? []).forEach((p, i) => {
      if (p.behavior === "denied" && p.by !== "you") {
        push(end, { type: "permission:denied", round: r, role: step.role, name: step.roleName, tool: p.tool, target: p.target, by: p.by, reason: p.reason, ...(p.rule ? { rule: p.rule } : {}) });
        return;
      }
      if (p.by !== "you" || !p.answer) return;
      const id = `${step.role}-${step.seq}-${i}`;
      push(end, { type: "approval:asked", id, round: r, role: step.role, name: step.roleName, command: p.target, programs: [], tool: p.tool, reason: p.reason });
      push(end, { type: "approval:answered", id, round: r, role: step.role, answer: p.answer, ...(p.feedback ? { feedback: p.feedback } : {}) });
    });
    const summary = summarise(cat, signalsOf(step));
    if (cat === "execution") answer = summary.output;
    if (summary.verdict) roundVerdict = summary.verdict;
    push(end, {
      type: "role:end",
      round: r,
      role: step.role,
      name: step.roleName,
      category: cat,
      success: step.success,
      tokens: { ...step.tokens },
      toolCalls: step.toolCalls.map((tc) => ({ name: tc.name, ok: !String(tc.result ?? "").startsWith("Error"), args: clip(JSON.stringify(tc.arguments ?? {}), 200) })),
      errors: [...step.errors],
      output: clip(summary.output, 4000),
      ...(summary.outputProvenance ? { outputProvenance: summary.outputProvenance } : {}),
      ...(summary.verdict ? { verdict: summary.verdict, ...(summary.verdictProvenance ? { verdictProvenance: summary.verdictProvenance } : {}) } : {}),
      ...(summary.checks ? { checks: summary.checks } : {}),
      ...(summary.decision ? { decision: summary.decision, ...(summary.decisionProvenance ? { decisionProvenance: summary.decisionProvenance } : {}) } : {}),
      durationMs: step.durationMs,
    });
  }
  endRound(lastEnd, null);

  const tokens = sorted.reduce((sum, s) => ({ inputTokens: sum.inputTokens + s.tokens.inputTokens, outputTokens: sum.outputTokens + s.tokens.outputTokens, totalTokens: sum.totalTokens + s.tokens.totalTokens }), zero());
  const outcome: RunOutcome = run.outcome ?? (measured ? (measured.passed ? "passed" : "failed") : "inconclusive");
  push(lastEnd, {
    type: "run:end",
    runId: run.runId,
    outcome,
    success: outcome === "passed",
    reason: run.reason ?? (measured ? `the measured check ${measured.passed ? "passed" : "failed"}` : "the record keeps no outcome"),
    topologyOutcome: outcome,
    verdict: roundVerdict,
    ...(measured ? { measured } : {}),
    rounds: round ?? 0,
    tokens,
    durationMs: lastEnd - startAt,
    answer,
    errors: [],
    // A role's route carries every fallback of its run so far: each one once.
    fallbacks: [
      ...new Map(
        sorted.flatMap((st) => st.calls.flatMap((c) => c.route?.fallbacks ?? []).map((f) => [`${st.role} ${f.from} ${f.to}`, { role: st.role, from: f.from, to: f.to, reason: f.reason }] as const)),
      ).values(),
    ],
  });

  // In time order; events at the same time keep the order they were rebuilt in.
  return out.sort((a, b) => a.at - b.at || a.n - b.n).map(({ at, event }) => ({ at, event }));
}
