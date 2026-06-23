// ============================================
// Wire Feedback — declarative, serializable feedback rules
// ============================================
// The serializable cousin of FeedbackRuleDef. Instead of code (where/transform
// functions), a WireFeedback is plain data — predicates + static field sets —
// that survives JSON, recipe persistence, and the visual editor. This module
// compiles that data into the filter + transform closures a Wire uses at
// runtime, so a wire authored visually behaves identically to a hand-wired
// feedback rule (whenSignal + where + asSignal + set + maxFires).

import type { Signal, WireFeedback, WirePredicate } from "../types/pipeline.js";

/** Read a dot-path (e.g. "metrics.score") out of a signal data object. */
export function getByPath(data: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = data;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Evaluate a single declarative predicate against a signal's data. */
export function evaluatePredicate(
  pred: WirePredicate,
  data: Record<string, unknown>,
): boolean {
  const actual = getByPath(data, pred.field);
  const expected = pred.value;
  switch (pred.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === "string") return actual.includes(String(expected));
      return false;
    default:
      return true;
  }
}

export interface CompiledWireFeedback {
  filter?: (signal: Signal) => boolean;
  transform?: (signal: Signal) => Signal | null;
}

/**
 * Compile a declarative WireFeedback into filter + transform closures. The
 * filter enforces whenSignal + all `where` predicates (AND) + the maxFires
 * counter; the transform applies asSignal re-typing + static `set` merges.
 * Returns undefined filter/transform when the spec contributes nothing, so a
 * wire with an empty feedback object behaves exactly like a plain wire.
 */
export function compileWireFeedback(fb: WireFeedback): CompiledWireFeedback {
  const result: CompiledWireFeedback = {};

  const wheres = fb.where ?? [];
  const hasFilter =
    Boolean(fb.whenSignal) || wheres.length > 0 || fb.maxFires != null;

  if (hasFilter) {
    let fires = 0;
    result.filter = (signal: Signal) => {
      if (fb.whenSignal && signal.type !== fb.whenSignal) return false;
      for (const pred of wheres) {
        if (!evaluatePredicate(pred, signal.data)) return false;
      }
      if (fb.maxFires != null && fires >= fb.maxFires) return false;
      fires++;
      return true;
    };
  }

  const hasTransform =
    Boolean(fb.asSignal) || (fb.set != null && Object.keys(fb.set).length > 0);

  if (hasTransform) {
    result.transform = (signal: Signal): Signal => ({
      ...signal,
      type: fb.asSignal ?? signal.type,
      data: fb.set ? { ...signal.data, ...fb.set } : signal.data,
    });
  }

  return result;
}
