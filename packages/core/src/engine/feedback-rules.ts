// ============================================
// Feedback Rules
// ============================================
// A declarative layer over wires. Instead of hand-wiring ports with custom
// filters/transforms, a FeedbackRule says: "when node A emits signal X
// (matching a condition), route it to node B's input port as signal Y, at most
// N times". This makes the feedback topology ("on eval fail, send corrections
// back to execution") explicit, configurable, and loop-safe.

import type { PipelineOrchestrator } from "./pipeline.js";

export interface FeedbackRuleDef {
  /** Optional id for logging/debugging. */
  id?: string;
  /** Source node id. */
  from: string;
  /** Source output port name. */
  fromPort: string;
  /** Target node id. */
  to: string;
  /** Target input port name. */
  toPort: string;
  /** Only route signals of this type (default: any the source port emits). */
  whenSignal?: string;
  /** Predicate on the signal's data — route only when it returns true. */
  where?: (data: Record<string, unknown>) => boolean;
  /** Re-type the routed signal (default: keep the original type). */
  asSignal?: string;
  /** Transform the signal's data before delivery. */
  transform?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** Max times this rule may route a signal — anti-loop guard. */
  maxFires?: number;
}

/**
 * Compile feedback rules into wires on the pipeline. Each rule becomes a wire
 * whose filter enforces the signal type + `where` predicate + `maxFires`
 * counter, and whose transform applies `asSignal` re-typing + `transform`.
 */
export function applyFeedbackRules(
  pipeline: PipelineOrchestrator,
  rules: FeedbackRuleDef[],
): void {
  for (const rule of rules) {
    let fires = 0;
    pipeline.connectByName(rule.from, rule.fromPort, rule.to, rule.toPort, {
      filter: (signal) => {
        if (rule.whenSignal && signal.type !== rule.whenSignal) return false;
        if (rule.where && !rule.where(signal.data)) return false;
        if (rule.maxFires != null && fires >= rule.maxFires) return false;
        fires++;
        return true;
      },
      transform: (signal) => ({
        ...signal,
        type: rule.asSignal ?? signal.type,
        data: rule.transform ? rule.transform(signal.data) : signal.data,
      }),
    });
  }
}
