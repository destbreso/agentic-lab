// ============================================
// The statistics a comparison rests on
// ============================================
// Fixed at 95% two-sided and, for the sample size, power 80%: the rule is
// fixed before a run, so the levels are not a choice made after one.

/** z for 95% two-sided. */
export const Z_95 = 1.959963984540054;
/** z for power 80% (one-sided 0.2). */
export const Z_POWER_80 = 0.8416212335729143;

export interface Interval {
  lower: number;
  upper: number;
}

export interface Proportion extends Interval {
  k: number;
  n: number;
  /** k / n; NaN when n is 0. */
  rate: number;
}

/** Wilson's score interval for k successes in n, 95% unless z says otherwise. With n = 0 it is the whole of [0, 1]. */
export function wilson(k: number, n: number, z = Z_95): Proportion {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) throw new Error(`wilson: need 0 <= k <= n, integers (got ${k} of ${n})`);
  if (n === 0) return { k, n, rate: Number.NaN, lower: 0, upper: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At k = 0 and k = n the bound is exactly 0 or 1; rounding must not move it.
  return { k, n, rate: p, lower: k === 0 ? 0 : Math.max(0, centre - half), upper: k === n ? 1 : Math.min(1, centre + half) };
}

/**
 * Newcombe's hybrid score interval (his method 10) for the difference of two
 * proportions, a minus b, built from the two Wilson intervals.
 */
export function newcombe(a: { k: number; n: number }, b: { k: number; n: number }, z = Z_95): Interval & { difference: number } {
  const wa = wilson(a.k, a.n, z);
  const wb = wilson(b.k, b.n, z);
  if (a.n === 0 || b.n === 0) return { difference: Number.NaN, lower: -1, upper: 1 };
  const d = wa.rate - wb.rate;
  return {
    difference: d,
    lower: d - Math.sqrt((wa.rate - wa.lower) ** 2 + (wb.upper - wb.rate) ** 2),
    upper: d + Math.sqrt((wa.upper - wa.rate) ** 2 + (wb.rate - wb.lower) ** 2),
  };
}

/**
 * Runs per arm a two-sided test of two proportions at 95% would need to find
 * a difference of p1 against p2 with power 80% (the usual normal
 * approximation, no continuity correction). Infinity when p1 equals p2.
 */
export function runsPerArm(p1: number, p2: number, zAlpha = Z_95, zBeta = Z_POWER_80): number {
  if (!(p1 >= 0 && p1 <= 1 && p2 >= 0 && p2 <= 1)) throw new Error(`runsPerArm: rates must be in [0, 1] (got ${p1} and ${p2})`);
  if (p1 === p2) return Number.POSITIVE_INFINITY;
  const mean = (p1 + p2) / 2;
  const a = zAlpha * Math.sqrt(2 * mean * (1 - mean));
  const b = zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  // A float a hair over an integer must not round up a whole run.
  return Math.ceil((a + b) ** 2 / (p1 - p2) ** 2 - 1e-9);
}

/** The median; NaN for none. */
export function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
