// Task sets and specs are refused with every problem at its path and line.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileProblems } from "./document.js";
import { loadSpec } from "./spec.js";
import { parseTaskSet } from "./taskset.js";
import { helloSpec, helloTasks, scratch, type Scratch } from "./test-support/fixtures.js";

const problems = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof FileProblems) return e.problems;
    throw e;
  }
  throw new Error("no problem was found");
};

const asyncProblems = async (fn: () => Promise<unknown>): Promise<string[]> => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof FileProblems) return e.problems;
    throw e;
  }
  throw new Error("no problem was found");
};

describe("a task set", () => {
  it("reads checks as commands, check files and the direct arm's convention", () => {
    const set = parseTaskSet(
      [
        "name: s",
        "description: d",
        "tasks:",
        "  - id: one",
        "    task: do it",
        "    files: {a.py: 'x = 1'}",
        "    checks: ['python3 a.py', {name: tests, command: 'python3 -m unittest', timeout_ms: 5000}]",
        "    check_files: [a.py, {path: .checks/t.py, content: 'pass'}]",
        "    direct: {answer_file: answer.txt}",
      ].join("\n"),
    );
    expect(set.tasks[0]).toEqual({
      id: "one",
      task: "do it",
      files: { "a.py": "x = 1" },
      checks: [
        { name: "check 1", kind: "command", command: "python3 a.py" },
        { name: "tests", kind: "command", command: "python3 -m unittest", timeoutMs: 5000 },
      ],
      checkFiles: ["a.py", { path: ".checks/t.py", content: "pass" }],
      direct: { answerFile: "answer.txt" },
      tags: [],
    });
  });

  it("names each problem by its path and its line", () => {
    const found = problems(() =>
      parseTaskSet(
        [
          "name: s",
          "description: d",
          "tasks:",
          "  - id: one",
          "    task: do it",
          "    checks: []",
          "  - id: one",
          "    task: again",
          "    checks: ['true']",
          "    files: {'../out.txt': x}",
          "    check_files: [missing.py]",
          "    direct: {answer_file: a.txt, file: b.py}",
          "    colour: blue",
        ].join("\n"),
        "tasks.yaml",
      ),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "tasks[0].checks (line 6): a task needs at least one check: the lab measures whether it was done, it does not judge",
        "tasks[1].files.../out.txt (line 10): must be a path inside the workspace: relative, without ..",
        "tasks[1].direct (line 12): give answer_file or file, one of the two",
        "tasks[1] (line 7): Unrecognized key(s) in object: 'colour'",
      ]),
    );
  });

  it("finds a duplicate id, a check file that is not a task file, and a direct answer that a check file would overwrite", () => {
    const found = problems(() =>
      parseTaskSet(
        [
          "name: s",
          "description: d",
          "tasks:",
          "  - {id: one, task: a, checks: ['true']}",
          "  - id: one",
          "    task: b",
          "    checks: ['true']",
          "    files: {t.py: x}",
          "    check_files: [t.py, gone.py]",
          "    direct: {file: t.py}",
        ].join("\n"),
      ),
    );
    expect(found).toEqual([
      'tasks[1].id (line 5): "one" is already the id of tasks[0]',
      'tasks[1].check_files[1] (line 9): "gone.py" is not one of the task\'s files: give it as { path, content } for a file only the checks see',
      'tasks[1].direct (line 10): the direct arm\'s answer goes to "t.py", a check file: the lab puts check files back before it checks, so the answer would be lost',
    ]);
  });

  it("says where a file is not even YAML", () => {
    expect(problems(() => parseTaskSet("name: [unclosed", "bad.yaml"))[0]).toMatch(/^line 1: /);
  });
});

describe("a spec", () => {
  let s: Scratch;
  beforeEach(async () => {
    s = await scratch();
    await s.writeTasks(helloTasks);
  });
  afterEach(() => s.remove());

  it("adds the direct arm and the Ralph Loop on its own, in that order before the arms", async () => {
    await s.writeSpec(helloSpec());
    const loaded = await loadSpec(s.spec);
    expect(loaded.arms.map((a) => [a.key, a.kind, a.label])).toEqual([
      ["direct", "direct", "Direct"],
      ["ralph-loop", "baseline", "Ralph Loop"],
      ["exec-eval", "arm", "Execute & Evaluate"],
    ]);
    expect(loaded.data.permissions).toEqual({ mode: "acceptEdits", allow: [], deny: [] });
    expect(loaded.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the direct arm when the baselines are removed, and refuses to remove the direct arm", async () => {
    await s.writeSpec(helloSpec({ baselines: [] }));
    expect((await loadSpec(s.spec)).arms.map((a) => a.key)).toEqual(["direct", "exec-eval"]);
    await s.writeSpec(helloSpec({ direct: false }));
    const found = await asyncProblems(() => loadSpec(s.spec));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^direct \(line \d+\): the direct arm is part of every experiment, and a spec cannot remove or configure it$/);
    await s.writeSpec(helloSpec({ arms: ["direct"] }));
    expect((await asyncProblems(() => loadSpec(s.spec)))[0]).toMatch(/^arms\[0\] \(line \d+\): the direct arm is always there; it is not listed among the arms$/);
  });

  it("names each problem by its path", async () => {
    await s.writeSpec(helloSpec({ model: "qwen", repetitions: 0, budget: {}, permissions: { allow: ["Run(everything)"] }, arms: ["no-such-topology"] }));
    const found = await asyncProblems(() => loadSpec(s.spec));
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^model \(line \d+\): a model is <provider>\/<model>, as ollama\/qwen2.5:7b$/),
        expect.stringMatching(/^repetitions \(line \d+\): /),
        expect.stringMatching(/^budget.tokens \(line \d+\): Required$/),
        expect.stringMatching(/^permissions.allow\[0\] \(line \d+\): a rule looks like Shell\(python3 \*\)/),
      ]),
    );
  });

  it("refuses an unknown topology, an arm listed twice, and a task subset naming a task the set lacks", async () => {
    await s.writeSpec(helloSpec({ arms: ["no-such-topology"] }));
    expect((await asyncProblems(() => loadSpec(s.spec)))[0]).toMatch(/^arms\[0\] \(line \d+\): "no-such-topology" is not a built-in topology/);
    await s.writeSpec(helloSpec({ arms: ["ralph-loop"] }));
    expect((await asyncProblems(() => loadSpec(s.spec)))[0]).toMatch(/ralph-loop is listed twice/);
    await s.writeSpec(helloSpec({ tasks: { file: "tasks.yaml", only: ["hello", "nope"] } }));
    expect((await asyncProblems(() => loadSpec(s.spec)))[0]).toMatch(/^tasks.only \(line \d+\): "nope" is not a task of hello/);
  });

  it("hashes what runs: defaults written out change nothing, a changed rule changes the hash", async () => {
    await s.writeSpec(helloSpec());
    const a = (await loadSpec(s.spec)).hash;
    await s.writeSpec(helloSpec({ baselines: ["ralph-loop"], concurrency: 1, rule: {} }));
    expect((await loadSpec(s.spec)).hash).toBe(a);
    await s.writeSpec(helloSpec({ rule: { margin: 0.1 } }));
    expect((await loadSpec(s.spec)).hash).not.toBe(a);
  });
});
