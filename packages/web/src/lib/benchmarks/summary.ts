// A contender's results summed up. A judge score of -1 means the judge gave
// no score (its answer could not be read, or it failed): such a result is
// counted and shown apart, never averaged in as a score.

import type { ContenderResult } from "./types";

export interface ContenderStats {
  /** The mean of the scores the judge gave; null when it gave none. */
  avgScore: number | null;
  /** Completed results the judge scored. */
  scored: number;
  /** Completed results the judge gave no score. */
  unscored: number;
  /** Completed results, scored or not. */
  completedRuns: number;
  avgDurationMs: number;
  totalTokens: number;
}

export const hasScore = (r: Pick<ContenderResult, "qualityScore">): boolean => Number.isFinite(r.qualityScore) && r.qualityScore >= 0;

/** Summarise one contender's results; results not completed are left out of everything. */
export function contenderStats(results: ContenderResult[]): ContenderStats {
  const done = results.filter((r) => r.status === "completed");
  const scored = done.filter(hasScore);
  const avgScore = scored.length ? Math.round((scored.reduce((s, r) => s + r.qualityScore, 0) / scored.length) * 10) / 10 : null;
  const avgDurationMs = done.length ? Math.round(done.reduce((s, r) => s + r.durationMs, 0) / done.length) : 0;
  return {
    avgScore,
    scored: scored.length,
    unscored: done.length - scored.length,
    completedRuns: done.length,
    avgDurationMs,
    totalTokens: done.reduce((s, r) => s + r.tokens, 0),
  };
}
