// The starter task set's checks are right: a correct answer passes, the usual wrong one fails, and nothing of
// the expected answer is in the workspace a role can read. Run through the direct arm, on a scripted model.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDirect } from "./attempt.js";
import { directArm, type SpecData } from "./spec.js";
import { loadTaskSet, type TaskSet } from "./taskset.js";
import { scriptedProvider } from "./test-support/fixtures.js";

const FIZZBUZZ = `def fizzbuzz(n):
    out = []
    for i in range(1, n + 1):
        fizz = i % 3 == 0 or "3" in str(i)
        buzz = i % 5 == 0 or "5" in str(i)
        out.append("FizzBuzz" if fizz and buzz else "Fizz" if fizz else "Buzz" if buzz else str(i))
    return out
`;
const CLASSIC = `def fizzbuzz(n):
    return ["FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0 else "Buzz" if i % 5 == 0 else str(i) for i in range(1, n + 1)]
`;
const MEDIAN = `def median(values):
    if not values:
        raise ValueError("median of an empty list")
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2
`;
// Sorts a copy and averages the middle, but forgets the empty list.
const MEDIAN_HALF = `def median(values):
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2
`;

const right: Record<string, string> = {
  "pen-and-notebook": "The pen is x and the notebook x + 2.00, so 2x + 2.00 = 2.30.\n0.15",
  "fence-posts": "120 / 8 = 15 gaps, so 16 posts.\n16",
  "birthday-23": "1 - 365!/(342! 365^23)\n0.507",
  "fizzbuzz-digits": `\`\`\`python\n${FIZZBUZZ}\`\`\``,
  "median-fix": `\`\`\`python\n${MEDIAN}\`\`\``,
};
const wrong: Record<string, string> = {
  "pen-and-notebook": "0.30",
  "fence-posts": "15",
  "birthday-23": "0.5",
  "fizzbuzz-digits": `\`\`\`python\n${CLASSIC}\`\`\``,
  "median-fix": `\`\`\`python\n${MEDIAN_HALF}\`\`\``,
};

const spec = { model: "scripted/scripted", budget: { tokens: 10_000 } } as SpecData;
let set: TaskSet;
let runs: string;

beforeAll(async () => {
  set = (await loadTaskSet(new URL("../tasks/starter.yaml", import.meta.url).pathname)).set;
  runs = await mkdtemp(join(tmpdir(), "jig-benchmark-test-starter-"));
});
afterAll(() => rm(runs, { recursive: true, force: true }));

async function answer(taskId: string, reply: string) {
  const task = set.tasks.find((t) => t.id === taskId)!;
  const out = await runDirect({ spec, arm: directArm(), task, repetition: 1, provider: scriptedProvider(() => reply), runsDir: runs });
  return out.record;
}

describe("the starter task set", () => {
  it("has five tasks, each with checks and a direct block", () => {
    expect(set.tasks.map((t) => t.id)).toEqual(["pen-and-notebook", "fence-posts", "birthday-23", "fizzbuzz-digits", "median-fix"]);
    for (const t of set.tasks) {
      expect(t.checks.length).toBeGreaterThan(0);
      expect(t.direct).toBeDefined();
    }
  });

  it.each(Object.keys(right))("%s: a right answer passes its checks", async (id) => {
    const r = await answer(id, right[id]!);
    expect(r.outcome).toBe("passed");
    expect(r.checks_passed).toBe(r.checks_total);
  });

  it.each(Object.keys(wrong))("%s: the usual wrong answer fails them", async (id) => {
    expect((await answer(id, wrong[id]!)).outcome).toBe("failed");
  });

  it("keeps every expected answer and hidden test out of the files a role can read", () => {
    for (const t of set.tasks) {
      const hidden = t.checkFiles.filter((f): f is { path: string; content: string } => typeof f !== "string");
      for (const h of hidden) expect(Object.keys(t.files)).not.toContain(h.path);
      const visible = Object.values(t.files).join("\n") + t.task;
      for (const expected of ['"0.15"', '"16"', '"0.507"']) expect(visible).not.toContain(expected);
    }
  });
});
