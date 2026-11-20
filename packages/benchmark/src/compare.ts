// ============================================
// The rule, and what the counts support
// ============================================
// Fixed in the spec before the first run and locked by its hash. Per arm:
// k passed of n, with a 95% Wilson interval. Against another arm: "supports"
// when the arm's interval lies wholly above the other's, "against" when
// wholly below, or, with a margin of no practical difference, when the 95%
// Newcombe interval of the difference lies inside plus or minus the margin;
// "inconclusive" otherwise, with the runs per arm that would likely decide it.
// Every attempt counts once; attempts on one task are treated as independent,
// which the report says.

import { median, newcombe, runsPerArm, wilson, type Interval, type Proportion } from "./stats.js";
import { counts, type AttemptRecord } from "./results.js";
import type { ArmInfo } from "./spec.js";
import type { TaskSet } from "./taskset.js";

export type Verdict = "supports" | "against" | "inconclusive";
export type Why = "above" | "below" | "no-practical-difference" | "overlap" | "no-attempts";

export interface Decision {
  verdict: Verdict;
  why: Why;
  a: Proportion;
  b: Proportion;
  /** a's rate minus b's, with its 95% Newcombe interval. */
  difference: Interval & { difference: number };
  /** For an inconclusive result: the runs per arm a difference of the observed size would need; null when the rates are equal or nothing ran. */
  runsPerArm: number | null;
}

/** The locked rule applied to two counts. */
export function decide(a: { k: number; n: number }, b: { k: number; n: number }, margin?: number): Decision {
  const wa = wilson(a.k, a.n);
  const wb = wilson(b.k, b.n);
  const difference = newcombe(a, b);
  const base = { a: wa, b: wb, difference };
  if (a.n === 0 || b.n === 0) return { ...base, verdict: "inconclusive", why: "no-attempts", runsPerArm: null };
  if (wa.lower > wb.upper) return { ...base, verdict: "supports", why: "above", runsPerArm: null };
  if (wa.upper < wb.lower) return { ...base, verdict: "against", why: "below", runsPerArm: null };
  if (margin !== undefined && difference.lower > -margin && difference.upper < margin) return { ...base, verdict: "against", why: "no-practical-difference", runsPerArm: null };
  const runs = runsPerArm(wa.rate, wb.rate);
  return { ...base, verdict: "inconclusive", why: "overlap", runsPerArm: Number.isFinite(runs) ? runs : null };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const points = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.abs(Math.round(x * 100))} points`;
export const countText = (p: Proportion) => (p.n === 0 ? "no attempts" : `${p.k} of ${p.n} (${pct(p.lower)} to ${pct(p.upper)})`);

/** The decision in plain words: what the counts show, and no more. */
export function sentence(d: Decision, a: string, b: string, margin?: number): string {
  const both = `${a} passed ${countText(d.a)} and ${b} ${countText(d.b)}`;
  switch (d.why) {
    case "no-attempts":
      return `inconclusive: ${d.a.n === 0 ? a : b} has no attempts that count yet, so there is nothing to compare.`;
    case "above":
      return `supports: on these tasks and this model, ${a} passed more often than ${b}. ${both}, and the two 95% intervals do not overlap.`;
    case "below":
      return `against: on these tasks and this model, ${a} passed less often than ${b}. ${both}, and ${a}'s 95% interval lies wholly below ${b}'s.`;
    case "no-practical-difference":
      return `against: no practical difference between ${a} and ${b} on these tasks and this model. ${both}; the difference, ${points(d.difference.difference)}, has a 95% interval of ${points(d.difference.lower)} to ${points(d.difference.upper)}, inside the margin of ${Math.round(margin! * 100)} points either way.`;
    case "overlap": {
      const more =
        d.runsPerArm === null
          ? " They passed equally often here, so these counts give no difference to size a longer run by."
          : ` Finding a difference of this size (${points(d.difference.difference)}) would take about ${d.runsPerArm} runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.`;
      return `inconclusive: ${both}. The 95% intervals overlap, so these counts do not tell the two apart.${more}`;
    }
  }
}

export interface ArmSummary {
  arm: ArmInfo;
  /** k passed of n counted, over the tasks the arm ran on. */
  count: Proportion;
  /** The tasks it ran on: every task, or for the direct arm those that say where its answer goes. */
  tasks: string[];
  recorded: number;
  /** Recorded but not counted: could not start, or fell back to another model. */
  notStarted: number;
  fellBack: number;
  /** Counted, ended without a verdict of the checks (stopped, inconclusive): counted as not passed. */
  noVerdict: number;
  callErrors: number;
  medianTokens: number;
  medianMs: number;
}

export interface Comparison {
  arm: ArmInfo;
  against: ArmInfo;
  /** The tasks compared on: both arms ran on each. */
  tasks: string[];
  /** Fewer tasks than the set has (the direct arm does not apply to every task). */
  subset: boolean;
  decision: Decision;
  sentence: string;
}

export interface Summary {
  arms: ArmSummary[];
  comparisons: Comparison[];
}

function countOn(records: AttemptRecord[], arm: string, tasks: Set<string>, countFallbacks: boolean): { k: number; n: number } {
  const counted = records.filter((r) => r.arm === arm && tasks.has(r.task) && counts(r, countFallbacks));
  return { k: counted.filter((r) => r.outcome === "passed").length, n: counted.length };
}

export function summarise(arms: ArmInfo[], taskSet: TaskSet, records: AttemptRecord[], rule: { margin?: number }, countFallbacks: boolean): Summary {
  const allTasks = taskSet.tasks.map((t) => t.id);
  const directTasks = taskSet.tasks.filter((t) => t.direct !== undefined).map((t) => t.id);
  const tasksOf = (a: ArmInfo) => (a.kind === "direct" ? directTasks : allTasks);
  const summaries: ArmSummary[] = arms.map((arm) => {
    const tasks = tasksOf(arm);
    const mine = records.filter((r) => r.arm === arm.key && tasks.includes(r.task));
    const counted = mine.filter((r) => counts(r, countFallbacks));
    const { k, n } = countOn(records, arm.key, new Set(tasks), countFallbacks);
    return {
      arm,
      count: wilson(k, n),
      tasks,
      recorded: mine.length,
      notStarted: mine.filter((r) => r.outcome === null || r.error).length,
      fellBack: countFallbacks ? 0 : mine.filter((r) => r.outcome !== null && !r.error && r.fallbacks.length > 0).length,
      noVerdict: counted.filter((r) => r.outcome !== "passed" && r.outcome !== "failed").length,
      callErrors: mine.reduce((s, r) => s + r.call_errors, 0),
      medianTokens: median(counted.map((r) => r.tokens.total)),
      medianMs: median(counted.map((r) => r.duration_ms)),
    };
  });
  const direct = arms.find((a) => a.kind === "direct");
  const baselines = arms.filter((a) => a.kind === "baseline");
  const comparisons: Comparison[] = [];
  const compare = (arm: ArmInfo, against: ArmInfo) => {
    const tasks = against.kind === "direct" || arm.kind === "direct" ? directTasks : allTasks;
    const set = new Set(tasks);
    const decision = decide(countOn(records, arm.key, set, countFallbacks), countOn(records, against.key, set, countFallbacks), rule.margin);
    const subset = tasks.length < allTasks.length;
    const said = sentence(decision, arm.label, against.label, rule.margin);
    const scoped = subset ? said.replace(/^(\w+): /, `$1 (on the ${tasks.length} of ${allTasks.length} tasks the direct arm applies to): `) : said;
    comparisons.push({ arm, against, tasks, subset, decision, sentence: scoped });
  };
  for (const arm of arms) {
    if (arm.kind === "direct") continue;
    if (direct) compare(arm, direct);
    if (arm.kind === "arm") for (const b of baselines) compare(arm, b);
  }
  return { arms: summaries, comparisons };
}
