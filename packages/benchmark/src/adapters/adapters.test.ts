// Public datasets as task sets, without the network: the seeded sample, GSM8K's answer, both conversions read
// back as valid task sets, the hidden checks judged with right, wrong and empty work (and never printing what
// they compare against), and the download kept in the cache.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { gsm8kAnswer } from "./datasets.js";
import { buildTaskSet, fetchDataset, recordsOf, sampleIndices, taskSetText } from "./fetch.js";
import { parseTaskSet } from "../taskset.js";

const HUMANEVAL = [
  {
    task_id: "HumanEval/0",
    prompt: 'def add(a: int, b: int) -> int:\n    """Return a plus b.\n    >>> add(2, 3)\n    5\n    """\n',
    entry_point: "add",
    canonical_solution: "    return a + b\n",
    test: "\n\nMETADATA = {}\n\n\ndef check(candidate):\n    assert candidate(2, 3) == 5\n    assert candidate(-1, 1) == 0\n",
  },
  {
    task_id: "HumanEval/1",
    prompt: 'def double(x):\n    return 2 * x\n\n\ndef quadruple(x):\n    """Four times x, by doubling twice."""\n',
    entry_point: "quadruple",
    canonical_solution: "    return double(double(x))\n",
    // The test calls the file's helper, as HumanEval/32 calls poly.
    test: "\n\ndef check(candidate):\n    assert candidate(3) == double(6)\n",
  },
];
const GSM8K = [
  { question: "Ana has 3 apples and buys 15 more. How many does she have?", answer: "3 + 15 = <<3+15=18>>18\n#### 18" },
  { question: "A farm sells 1,000 eggs a day. How many in a day?", answer: "#### 1,000" },
];

function runCheck(files: Record<string, string>, check: { path: string; content: string }, command: string): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "jig-benchmark-test-adapt-"));
  try {
    for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c);
    writeFileSync(join(dir, check.path), check.content);
    try {
      return { ok: true, out: execFileSync("sh", ["-c", command], { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type RawTask = { id: string; files?: Record<string, string>; checks: Array<{ command: string }>; check_files: Array<{ path: string; content: string }> };

describe("a seeded sample", () => {
  it("picks the same tasks for the same seed, sorted and without repeats, and every task when asked for more", () => {
    const a = sampleIndices(100, 10, 7);
    expect(sampleIndices(100, 10, 7)).toEqual(a);
    expect(new Set(a).size).toBe(10);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(a.every((i) => i >= 0 && i < 100)).toBe(true);
    expect(sampleIndices(100, 10, 8)).not.toEqual(a);
    expect(sampleIndices(5, 9, 1)).toEqual([0, 1, 2, 3, 4]);
  });
  it("reads GSM8K's answer after its last ####, without thousands separators", () => {
    expect(gsm8kAnswer("so <<2*9=18>>18\n#### 18")).toBe("18");
    expect(gsm8kAnswer("#### 1,234")).toBe("1234");
    expect(gsm8kAnswer("#### -5")).toBe("-5");
  });
});

describe("HumanEval as a task set", () => {
  const set = buildTaskSet("humaneval", HUMANEVAL, { seed: 1, sha256: "a".repeat(64), retrieved: "2026-11-20" });
  const tasks = set.tasks as RawTask[];

  it("reads back as a valid task set that says where it came from", () => {
    const parsed = parseTaskSet(taskSetText("humaneval", set, "jig-benchmark fetch humaneval --all"), "humaneval.yaml");
    expect(parsed.tasks.map((t) => t.id)).toEqual(["humaneval-0", "humaneval-1"]);
    expect(parsed.source).toMatchObject({ name: "HumanEval", license: expect.stringContaining("MIT"), fileSha256: "a".repeat(64) });
    expect(parsed.tasks[0].direct).toEqual({ file: "solution.py" });
    expect(parsed.tasks[0].files["solution.py"]).toContain("raise NotImplementedError");
    expect(parsed.tasks[0].checkFiles[0]).toMatchObject({ path: "check_solution.py" });
  });

  it("passes the dataset's own solution, fails the empty file and a wrong one, and never prints a test", () => {
    for (const [i, t] of tasks.entries()) {
      const check = t.check_files[0];
      const cmd = t.checks[0].command;
      expect(runCheck({ "solution.py": HUMANEVAL[i].prompt + HUMANEVAL[i].canonical_solution }, check, cmd).ok, t.id).toBe(true);
      expect(runCheck(t.files!, check, cmd).ok, t.id).toBe(false);
    }
    const wrong = runCheck({ "solution.py": HUMANEVAL[0].prompt + "    return a - b\n" }, tasks[0].check_files[0], tasks[0].checks[0].command);
    expect(wrong.ok).toBe(false);
    expect(wrong.out).toContain("a test of add did not pass");
    expect(wrong.out).not.toMatch(/candidate\(|== 5/);
  });

  it("fails a solution that exits early with code 0, and lets nothing the solution prints reach the output", () => {
    const run = (body: string) => runCheck({ "solution.py": HUMANEVAL[0].prompt + body }, tasks[0].check_files[0], tasks[0].checks[0].command);
    expect(run("    return a + b\nraise SystemExit(0)\n")).toMatchObject({ ok: false, out: expect.stringContaining("SystemExit") });
    expect(run("    import sys\n    sys.exit(0)\n")).toMatchObject({ ok: false, out: expect.stringContaining("add raised SystemExit at solution.py line") });
    expect(run("    exit()\n").ok).toBe(false);
    const peek = run("    print(open('check_solution.py').read())\n    import os\n    os.write(2, b'candidate(2, 3) == 5')\n    return a - b\n");
    expect(peek.ok).toBe(false);
    expect(peek.out).not.toMatch(/candidate|== 5|def check/);
    // An object that prints whatever it is compared with sees the expected value, and has nowhere to print it.
    const spy = run("    class Spy:\n        def __eq__(self, other):\n            print('EXPECTED', other)\n            return False\n    return Spy()\n");
    expect(spy).toMatchObject({ ok: false, out: "a test of add did not pass\n" });
    // A message the solution raises itself is not shown; the parser's own syntax error is.
    const raised = run("    raise ValueError(open('check_solution.py').read())\n");
    expect(raised.out).toMatch(/^add raised ValueError at solution.py line \d+\n$/);
    expect(run("    return (a +\n")).toMatchObject({ ok: false, out: expect.stringMatching(/could not be imported: SyntaxError at line \d+/) });
  });

  it("never imports a module the workspace holds in place of the standard library", () => {
    const shadow = runCheck(
      { "solution.py": HUMANEVAL[0].prompt + "    return a - b\n", "traceback.py": "import os\nos._exit(0)\n", "importlib.py": "import os\nos._exit(0)\n" },
      tasks[0].check_files[0],
      tasks[0].checks[0].command,
    );
    expect(shadow.ok).toBe(false);
  });
});

describe("GSM8K as a task set", () => {
  const set = buildTaskSet("gsm8k", GSM8K, { seed: 1, sha256: "b".repeat(64), retrieved: "2026-11-20" });
  const tasks = set.tasks as RawTask[];

  it("reads back as a valid task set whose direct answer goes to answer.txt", () => {
    const parsed = parseTaskSet(taskSetText("gsm8k", set, "jig-benchmark fetch gsm8k --all"), "gsm8k.yaml");
    expect(parsed.tasks[0].direct).toEqual({ answerFile: "answer.txt" });
    expect(parsed.tasks[0].task).toContain("Work it out step by step. Then write your final answer to answer.txt: the number alone.");
    expect(parsed.source?.name).toBe("GSM8K");
  });

  it("passes the right number however it is written, fails a wrong one or none, and never prints the answer", () => {
    const [first, second] = tasks;
    const check = (t: RawTask, text: string | null) => runCheck(text === null ? {} : { "answer.txt": text }, t.check_files[0], t.checks[0].command);
    expect(check(first, "18\n").ok).toBe(true);
    expect(check(first, "The answer is 18.").ok).toBe(true);
    expect(check(second, "1,000").ok).toBe(true);
    expect(check(second, "1000.0").ok).toBe(true);
    const wrong = check(first, "17");
    expect(wrong.ok).toBe(false);
    expect(wrong.out).not.toContain("18");
    expect(check(first, null).out).toContain("answer.txt was not written");
    expect(check(first, "no idea").out).toContain("holds no number");
  });

  it("reads a decimal that starts at its point, and never takes misplaced commas for thousands", () => {
    const half = buildTaskSet("gsm8k", [{ question: "Half of one?", answer: "#### 0.5" }], { seed: 1, sha256: "c".repeat(64), retrieved: "2026-11-20" }).tasks as RawTask[];
    const run = (t: RawTask, text: string) => runCheck({ "answer.txt": text }, t.check_files[0], t.checks[0].command);
    expect(run(half[0], ".5").ok).toBe(true);
    expect(run(tasks[1], "1,000").ok).toBe(true);
    expect(run(tasks[1], "10,00").ok).toBe(false);
  });

  it("never imports a decimal.py the answer folder holds", () => {
    const shadow = runCheck({ "answer.txt": "17", "decimal.py": "import os\nos._exit(0)\n" }, tasks[0].check_files[0], tasks[0].checks[0].command);
    expect(shadow.ok).toBe(false);
  });
});

describe("fetching from the authors' repository", () => {
  it("downloads once into the cache and reads the cache after, with the same sha256; a gzip file is read through", async () => {
    const cache = mkdtempSync(join(tmpdir(), "jig-benchmark-test-cache-"));
    try {
      const body = gzipSync(Buffer.from(HUMANEVAL.map((r) => JSON.stringify(r)).join("\n") + "\n"));
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(body, { status: 200 });
      }) as unknown as typeof fetch;
      const first = await fetchDataset("humaneval", { cache, fetchImpl });
      const again = await fetchDataset("humaneval", { cache, fetchImpl });
      expect(calls).toBe(1);
      expect([first.cached, again.cached]).toEqual([false, true]);
      expect(again.sha256).toBe(first.sha256);
      expect(readdirSync(cache)).toEqual(["humaneval-HumanEval.jsonl.gz"]);
      expect(recordsOf("humaneval", again.bytes).map((r) => r.entry_point)).toEqual(["add", "quadruple"]);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
