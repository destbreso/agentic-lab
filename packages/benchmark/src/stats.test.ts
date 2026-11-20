// The statistics against values published elsewhere, not against this code's own output.

import { describe, expect, it } from "vitest";
import { median, newcombe, runsPerArm, wilson } from "./stats.js";

const at4 = (x: number) => Number(x.toFixed(4));

describe("Wilson's interval", () => {
  // Newcombe (1998), "Two-sided confidence intervals for the single proportion", Statistics in Medicine 17, table I, method 3.
  it.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ])("%i of %i is %f to %f", (k, n, lower, upper) => {
    const w = wilson(k, n);
    expect(at4(w.lower)).toBe(lower);
    expect(at4(w.upper)).toBe(upper);
  });

  it("is exactly 0 or 1 at the ends, and the whole range with no attempts", () => {
    expect(wilson(0, 5).lower).toBe(0);
    expect(wilson(5, 5).upper).toBe(1);
    expect(wilson(0, 0)).toMatchObject({ lower: 0, upper: 1, n: 0 });
    expect(Number.isNaN(wilson(0, 0).rate)).toBe(true);
  });

  it("refuses counts that are not counts", () => {
    expect(() => wilson(3, 2)).toThrow(/0 <= k <= n/);
    expect(() => wilson(1.5, 2)).toThrow();
  });
});

describe("Newcombe's interval for a difference", () => {
  // Newcombe (1998), "Interval estimation for the difference between independent proportions", Statistics in Medicine 17, table II, method 10.
  it.each([
    [56, 70, 48, 80, 0.0524, 0.3339],
    [9, 10, 3, 10, 0.1705, 0.809],
  ])("%i/%i minus %i/%i is %f to %f", (k1, n1, k2, n2, lower, upper) => {
    const d = newcombe({ k: k1, n: n1 }, { k: k2, n: n2 });
    expect(at4(d.lower)).toBe(lower);
    expect(at4(d.upper)).toBe(upper);
  });
});

describe("runs per arm for two proportions (95% two-sided, power 80%)", () => {
  // The usual normal approximation without continuity correction (Fleiss), as tables of it give.
  it.each([
    [0.4, 0.6, 97],
    [0.5, 0.7, 93],
    [0.05, 0.1, 435],
  ])("%f against %f needs %i per arm", (p1, p2, n) => {
    expect(runsPerArm(p1, p2)).toBe(n);
    expect(runsPerArm(p2, p1)).toBe(n);
  });

  it("is infinite when the rates are equal", () => {
    expect(runsPerArm(0.3, 0.3)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("median", () => {
  it("takes the middle, or the mean of the two middles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});
