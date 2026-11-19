// ============================================
// What the viewer draws of a topology
// ============================================
// A Drawing is built from the topology model, never by hand: the roles in
// their drawn order, the ways back with their conditions and their limit, the
// also edges, the consulted roles, the exit, and, when it was measured, the
// sight matrix. Every layout draws from it.

import type { SightMatrix, SightRow } from "../engine/sight.js";
import type { ConsultSight, Topology } from "../formats/model.js";

export interface DrawnRole {
  id: string;
  icon: string;
  label: string;
  /** The engine that runs it, in small type. */
  engine: string;
  /** The model it runs on, when known. */
  model: string;
}

export interface DrawnBack {
  id: string;
  from: string;
  to: string;
  label: string;
  /** The round limit as dots on the arc, when it is short enough to draw. */
  dots?: number;
  /** The limit as a counter instead ("turn 4 · at most 20"). */
  counter?: boolean;
  /** "at most 3". */
  max: string;
  /** Whether the dots or counter belong to this arc (the first way back carries them). */
  carriesRounds: boolean;
}

export interface DrawnConsult {
  from: string;
  to: string;
  label: string;
  icon: string;
  name: string;
  /** The model it answers on. */
  model: string;
  /** At most this many consultations a turn. */
  limit: number;
  /** Beside the consulted role's box: its model and what it sees. */
  note: string;
}

export interface DrawnSight {
  rows: Array<{ key: string; mark: string; label: string; cells: string[] }>;
  /** Short lines per role, for narrow layouts: what reaches its prompt. */
  short: Array<{ role: string; parts: Array<{ mark: string; label: string }> }>;
  legend: string;
}

export interface Drawing {
  id: string;
  title: string;
  summary: string[];
  restLine: string;
  roles: DrawnRole[];
  back: DrawnBack[];
  also: Array<{ from: string; to: string; label: string }>;
  consults: DrawnConsult[];
  exit: { label: string; when: string[] };
  sight?: DrawnSight;
  /** "round" or, for a topology that repeats until its plan is done, "turn". */
  unit: "round" | "turn";
  /** The rounds a run may take, as drawn: Decide's own limit when it is lower. */
  limit: number;
  /** Decide's own round limit, when it has one: a run stops there whatever its round limit says. */
  deciderLimit?: number;
}

const MARK: Record<SightRow["provenance"], string> = { given: "›", measured: "■", written: "“", "measured or written": "■“" };
const CELL: Record<string, string> = { prompt: "●", delivered: "○", none: "·", own: "own" };
const SHORT: Record<string, string> = {
  task: "task",
  conversation: "conversation",
  memories: "memories",
  note: "note",
  plan: "plan",
  account: "Do's account",
  world: "files",
  toolcalls: "tool calls",
  tokens: "tokens",
  check: "check",
  verdict: "verdicts",
  evidence: "evidence",
  corrections: "corrections",
  critique: "notes",
  decision: "reason",
  summary: "summary",
  advice: "advice",
};
const SIGHT_MARK: Record<ConsultSight, string> = {
  task: "› task",
  question: "“ question",
  transcript: "“ transcript",
  tool_results: "■ tool results",
  checks: "■ check",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface DrawingOptions {
  /** The measured sight matrix, to draw the walls. */
  sight?: SightMatrix;
  /** Where the definition came from, for the line at rest. */
  source?: string;
  /** The model the run uses, for roles that name none. */
  model?: string;
  /** Whether the topology is one of the lab's own. */
  builtIn?: boolean;
}

/** The round limit a run of the topology meets first: the run's, or Decide's own when lower. */
export function roundLimit(t: Topology): number {
  const run = t.defaults.maxCycles ?? 0;
  const decider = t.waysBack[0]?.from;
  const own = t.nodes.find((n) => n.id === decider && n.category === "refinement")?.metadata?.maxRounds;
  if (typeof own === "number" && own > 0) return run > 0 ? Math.min(run, own) : own;
  return run;
}

function deciderLimitOf(t: Topology): number | undefined {
  const decider = t.waysBack[0]?.from;
  const own = t.nodes.find((n) => n.id === decider && n.category === "refinement")?.metadata?.maxRounds;
  return typeof own === "number" && own > 0 ? own : undefined;
}

/** The rounds a run meets first: the run's limit (0 for none), or Decide's own when lower. */
export function effectiveLimit(d: Pick<Drawing, "limit" | "deciderLimit">, runLimit?: number): number {
  if (runLimit === undefined) return d.limit;
  if (!d.deciderLimit) return runLimit;
  return runLimit > 0 ? Math.min(runLimit, d.deciderLimit) : d.deciderLimit;
}

export function drawingOf(t: Topology, options: DrawingOptions = {}): Drawing {
  const order = t.nodes.map((n) => n.id);
  const face = (id: string) => t.faces[id] ?? { label: id, icon: "◇", sentence: "" };
  const repeat = Boolean(t.defaults.repeat);
  const unit = repeat ? "turn" : "round";
  const limit = roundLimit(t);
  const roles: DrawnRole[] = t.nodes.map((n) => ({
    id: n.id,
    icon: face(n.id).icon,
    label: face(n.id).label,
    engine: n.type,
    // The role's own model; else the model the caller says it runs on; else its brain's name, until a call says which model answered.
    model: n.config.brain?.model ?? options.model ?? n.config.brain?.chain?.[0]?.replace(/^[^/]*\//, "") ?? n.config.brain?.brain ?? "",
  }));
  const back: DrawnBack[] = t.waysBack.map((w, i) => {
    const carries = i === 0 && limit > 0;
    const dots = carries && !repeat && limit <= 6 ? limit : undefined;
    return {
      id: w.id,
      from: w.from,
      to: w.to,
      label: w.label,
      ...(dots ? { dots } : {}),
      ...(carries && dots === undefined ? { counter: true } : {}),
      max: limit > 0 ? `at most ${limit}` : "no limit",
      carriesRounds: carries,
    };
  });
  const consults: DrawnConsult[] = t.consults.map((c) => {
    const measured = options.sight?.roles.some((r) => r.id === c.role.id)
      ? options.sight.rows.filter((row) => options.sight!.cells[row.key][c.role.id] === "prompt").map((row) => `${MARK[row.provenance]} ${SHORT[row.key] ?? row.label}`)
      : null;
    const sees = measured ? measured.join(" ") : c.sees.map((s) => SIGHT_MARK[s]).join(" ");
    const model = c.role.brain?.model ?? options.model ?? c.role.brain?.brain ?? "the run's model";
    return { from: c.from, to: c.role.id, label: c.label, icon: c.role.face.icon, name: c.role.face.label, model, limit: c.limit, note: `${model} · sees ${sees}` };
  });

  const summary = [
    `${options.builtIn === false ? "yours" : "built in"} · v${t.version}`,
    `${plural(t.nodes.length, "role")}${t.consults.length ? ` + ${t.consults.map((c) => c.role.face.label.toLowerCase()).join(", ")}` : ""}`,
    t.waysBack.length ? `${t.waysBack.length} way${t.waysBack.length > 1 ? "s" : ""} back` : "no way back",
    limit > 0 ? `${plural(limit, unit)} at most` : `no ${unit} limit`,
  ];

  let sight: DrawnSight | undefined;
  if (options.sight) {
    const m = options.sight;
    const rows = m.rows.map((row) => ({
      key: row.key,
      mark: MARK[row.provenance],
      label: row.label,
      cells: order.map((id) => CELL[m.cells[row.key]?.[id] ?? "none"] ?? "·"),
    }));
    const short = order.map((id) => ({
      role: id,
      parts: m.rows.filter((row) => m.cells[row.key]?.[id] === "prompt").map((row) => ({ mark: MARK[row.provenance], label: SHORT[row.key] ?? row.label })),
    }));
    sight = { rows, short, legend: "■ measured by the lab   “ written by a model   › from you" };
  }

  return {
    id: t.id,
    title: t.name,
    summary,
    restLine: `at rest · ${options.source ?? "drawn from its definition"} · no tokens spent`,
    roles,
    back,
    also: t.also.map((a) => ({ from: a.from, to: a.to, label: a.label })),
    consults,
    exit: t.exit,
    ...(sight ? { sight } : {}),
    unit,
    limit,
    ...(deciderLimitOf(t) ? { deciderLimit: deciderLimitOf(t) } : {}),
  };
}
