// A judge score of -1 is no score: counted and shown apart, never averaged in.

import { describe, it, expect } from "vitest";
import { contenderStats } from "./summary";
import type { ContenderResult } from "./types";

const result = (qualityScore: number, status: ContenderResult["status"] = "completed"): ContenderResult => ({
  contenderId: "c",
  contenderLabel: "C",
  contenderType: "recipe",
  answer: "a",
  qualityScore,
  qualityNotes: "",
  durationMs: 1000,
  tokens: 10,
  inputTokens: 6,
  outputTokens: 4,
  status,
});

describe("a contender's summary", () => {
  it("averages only the scores the judge gave, and counts the rest apart", () => {
    const stats = contenderStats([result(90), result(-1), result(60), result(-1), result(100, "error")]);
    expect(stats.avgScore).toBe(75);
    expect(stats.scored).toBe(2);
    expect(stats.unscored).toBe(2);
    expect(stats.completedRuns).toBe(4);
    expect(stats.totalTokens).toBe(40);
  });

  it("has no average when the judge scored nothing", () => {
    expect(contenderStats([result(-1), result(-1)])).toMatchObject({ avgScore: null, scored: 0, unscored: 2 });
    expect(contenderStats([])).toMatchObject({ avgScore: null, scored: 0, unscored: 0, completedRuns: 0 });
  });

  it("keeps a real score of 0", () => {
    expect(contenderStats([result(0), result(-1)])).toMatchObject({ avgScore: 0, scored: 1, unscored: 1 });
  });
});
