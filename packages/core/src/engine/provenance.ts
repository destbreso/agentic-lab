// ============================================
// Provenance: where each value a role sees came from
// ============================================
// Every field of every signal type is declared as one of three kinds:
//   given     from you: the task, the operator's note, a definition's constants
//   measured  observed or computed by the lab's own code: exit codes, counts,
//             tokens, rounds, tool results, ids
//   written   written by a model: plans, answers, verdicts, critiques, advice
// A value computed from a written value stays written (a pass rate counted
// from model verdicts is written). A field whose kind depends on the run (a
// verdict follows the measured check or the model) is declared as varying and
// stamped on each signal; unstamped, it counts as written.
// See docs/FOUNDATIONS.md, H2.

import type { Provenance, Signal } from "../types/pipeline.js";

export type { Provenance };

/** A field whose kind is stamped on each signal (`signal.provenance[field]`). */
export interface VaryingField {
  varies: readonly Provenance[];
  /** When it is which, in plain words. */
  why: string;
}

/** An object, or an array of objects, whose own fields are declared. */
export interface ShapedField {
  shape: Record<string, FieldSpec>;
}

export type FieldSpec = Provenance | VaryingField | ShapedField;

const verdictSource: VaryingField = {
  varies: ["measured", "written"],
  why: "measured when Check's verdict follows the measured check, written when it is the model's",
};

const decisionField: VaryingField = {
  varies: ["measured", "written"],
  why: "measured when a rule decided on measured verdicts, written when a model decided or the verdicts were a model's",
};

const decisionShape: ShapedField = {
  shape: {
    action: decisionField,
    reason: decisionField,
    round: "measured",
    passRate: decisionField,
    failedCriteria: decisionField,
    criticFindings: { varies: ["measured", "written"], why: "measured for Critique's rule-based notes, written for its model's" },
  },
};

const checkResultShape: ShapedField = {
  shape: {
    name: "given",
    kind: "given",
    passed: "measured",
    exitCode: "measured",
    output: "measured",
    durationMs: "measured",
  },
};

/** The built-in signal types and the kind of every field they carry. */
const BUILT_IN: Record<string, Record<string, FieldSpec>> = {
  // Plan
  task: { task: "written", priority: "written", iteration: "measured" },
  plan: { plan: "written", iteration: "measured" },
  strategy: { decision: "written", reasoning: "written", iteration: "measured" },

  // Do
  execution_result: {
    responseText: "written",
    iteration: "measured",
    toolCallCount: "measured",
    truncated: "measured",
    // From snapshots of the workspace before and after the turn, never from the answer.
    filesChanged: "measured",
    diff: "measured",
    // The person's answers to the turn's permission questions, with their words.
    personSaid: { shape: { tool: "measured", target: "measured", answer: "given", words: "given" } },
  },
  tool_calls: {
    calls: { shape: { name: "measured", arguments: "written", result: "measured", durationMs: "measured" } },
    iteration: "measured",
  },
  token_usage: { inputTokens: "measured", outputTokens: "measured", totalTokens: "measured", iteration: "measured" },

  // Check
  evaluation: {
    verdict: verdictSource,
    verdictSource: "measured",
    modelVerdict: "written",
    modelError: "measured",
    parsed: "measured",
    evidence: "written",
    measuredChecks: checkResultShape,
    automatedChecks: { shape: { name: "given", passed: "measured", output: "measured" } },
    iteration: "measured",
  },
  eval_metrics: {
    verdict: verdictSource,
    verdictSource: "measured",
    parsed: "measured",
    checksTotal: "measured",
    checksPassed: "measured",
    confidence: "written",
    iteration: "measured",
  },
  corrections: {
    corrections: {
      varies: ["measured", "written"],
      why: "written when a model wrote them, measured when the lab wrote them from a failed check",
    },
    failedChecks: checkResultShape,
    verdict: verdictSource,
    failedCriteria: decisionField,
    round: "measured",
    iteration: "measured",
  },

  // Critique
  critic_feedback: {
    feedback: { varies: ["measured", "written"], why: "measured when the rules found nothing and no model was asked" },
    status: { varies: ["measured", "written"], why: "measured when the rules found nothing and no model was asked" },
    reasoning: "written",
    iteration: "measured",
  },
  stagnation_alert: { reason: "written", severity: "written", iteration: "measured" },
  intervention: { type: "written", reason: "written", iteration: "measured" },

  // Decide
  refinement_decision: decisionShape.shape,
  replan_signal: {
    reason: decisionField,
    failedCriteria: decisionField,
    round: "measured",
    history: decisionShape,
  },
  convergence: { decision: decisionShape, history: decisionShape },

  // Memory
  compressed_context: { summary: "written", previousSummary: "written", signalsProcessed: "measured", iteration: "measured" },
  milestone: { number: "measured", description: "written", timestamp: "measured", iteration: "measured" },
  memory: { content: "written", source: "measured", iteration: "measured" },

  // The lab's measured check, after the run (and, for Check, during it)
  measured_check: { label: "measured", passed: "measured", results: checkResultShape, error: "measured" },

  // A consulted role's answer: written by its model; sealed when the provider returns it encrypted
  advice: { advice: "written", sealed: "measured" },

  // The operator's note, delivered to Do mid-run
  context: { label: "measured", content: "given", priority: "given", steerId: "measured" },
};

const registry = new Map<string, Record<string, FieldSpec>>(Object.entries(BUILT_IN));

/** Declare the fields of a signal type a custom loop emits. */
export function registerSignalFields(type: string, fields: Record<string, FieldSpec>): void {
  registry.set(type, { ...(registry.get(type) ?? {}), ...fields });
}

/** The declared fields of a signal type, or undefined when the type is unknown. */
export function signalFields(type: string): Readonly<Record<string, FieldSpec>> | undefined {
  return registry.get(type);
}

/** Every signal type with declared fields. */
export function declaredSignalTypes(): string[] {
  return [...registry.keys()];
}

const RANK: Record<Provenance, number> = { written: 0, given: 1, measured: 2 };

/** The weakest of several kinds: anything touched by a model is written. */
export function weakest(kinds: Iterable<Provenance>): Provenance {
  let out: Provenance | null = null;
  for (const k of kinds) if (out === null || RANK[k] < RANK[out]) out = k;
  return out ?? "measured";
}

function isVarying(spec: FieldSpec): spec is VaryingField {
  return typeof spec === "object" && "varies" in spec;
}

function isShaped(spec: FieldSpec): spec is ShapedField {
  return typeof spec === "object" && "shape" in spec;
}

/** The kind of one field of one signal: its stamp, else its declaration, else written. */
export function provenanceOf(signal: Pick<Signal, "type" | "provenance" | "originType">, field: string): Provenance {
  const stamped = signal.provenance?.[field];
  if (stamped) return stamped;
  const spec = registry.get(signal.originType ?? signal.type)?.[field];
  if (!spec) return "written";
  return kindOfSpec(spec);
}

function kindOfSpec(spec: FieldSpec): Provenance {
  if (typeof spec === "string") return spec;
  // An unstamped varying field may have been written by a model.
  if (isVarying(spec)) return "written";
  return weakest(Object.values(spec.shape).map(kindOfSpec));
}

/** Every field of a signal with its kind and value. */
export function describeFields(
  signal: Pick<Signal, "type" | "data" | "provenance" | "originType">,
): Record<string, { provenance: Provenance; value: unknown }> {
  const out: Record<string, { provenance: Provenance; value: unknown }> = {};
  for (const [field, value] of Object.entries(signal.data)) {
    out[field] = { provenance: provenanceOf(signal, field), value };
  }
  return out;
}

/** The weakest kind among a signal's fields. */
export function provenanceOfSignal(signal: Pick<Signal, "type" | "data" | "provenance" | "originType">): Provenance {
  return weakest(Object.keys(signal.data).map((f) => provenanceOf(signal, f)));
}

/**
 * Fields of a signal that nothing declares: not in the registry for its type,
 * not stamped, or (for a shaped field) a nested key the shape does not name.
 * Paths use dots, with `[]` for array items.
 */
export function undeclaredFields(signal: Pick<Signal, "type" | "data" | "provenance" | "originType">): string[] {
  const declared = registry.get(signal.originType ?? signal.type) ?? {};
  const out: string[] = [];
  for (const [field, value] of Object.entries(signal.data)) {
    if (signal.provenance?.[field]) continue;
    const spec = declared[field];
    if (!spec) {
      out.push(field);
      continue;
    }
    if (isVarying(spec) && !signal.provenance?.[field]) {
      out.push(`${field} (varying, not stamped)`);
      continue;
    }
    if (isShaped(spec)) out.push(...undeclaredInShape(spec, value, field));
  }
  return out;
}

function undeclaredInShape(spec: ShapedField, value: unknown, path: string): string[] {
  const items = Array.isArray(value) ? value : [value];
  const prefix = Array.isArray(value) ? `${path}[]` : path;
  const out = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    for (const [key, inner] of Object.entries(item as Record<string, unknown>)) {
      const child = spec.shape[key];
      if (!child) out.add(`${prefix}.${key}`);
      else if (isShaped(child)) for (const p of undeclaredInShape(child, inner, `${prefix}.${key}`)) out.add(p);
    }
  }
  return [...out];
}

/** A signal's data with only the named fields, its stamps trimmed to match. */
export function pickFields<T extends Pick<Signal, "data" | "provenance">>(signal: T, fields: readonly string[]): T {
  const keep = new Set(fields);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(signal.data)) if (keep.has(k)) data[k] = v;
  const provenance = signal.provenance
    ? Object.fromEntries(Object.entries(signal.provenance).filter(([k]) => keep.has(k)))
    : undefined;
  return { ...signal, data, ...(provenance ? { provenance } : {}) };
}
