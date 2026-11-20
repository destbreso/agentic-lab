// What Check works from: the files Do's turn changed and a bounded diff,
// measured by the lab from the file system; a verification with the tools it
// really has, then the verdict in a turn of its own; a skip, said, when there
// is nothing to verify; the lab's correction of literal "\n" in file_write;
// and the environment block in every role's prompt.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopologyRun, type RunEvent } from "../engine/topology-run.js";
import { changes, snapshot } from "../engine/workspace-diff.js";
import { environmentBlock } from "../engine/environment.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { unescapeLiteralNewlines } from "../tools/file-write.js";
import { initialRunState, reduceRun } from "../grid/run-state.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "jig-evidence-"));
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

const PASS = JSON.stringify({ verdict: "pass", evidence: ["read it"], corrections: [], confidence: 0.9 });

async function run(script: (c: ScriptedCall) => ReturnType<Parameters<typeof scriptedProvider>[0]>, extra: Partial<ConstructorParameters<typeof TopologyRun>[0]> = {}) {
  const provider = scriptedProvider(script);
  const events: RunEvent[] = [];
  const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "exec-eval", workingDir: ws, delayMs: 0, maxRounds: 1, ...extra });
  session.on("event", (e) => events.push(e));
  const result = await session.run("Implement a function to detect palindromes");
  return { provider, events, result };
}

const writesTheFile = (c: ScriptedCall) =>
  c.role === "do" && c.turn === 1 ? { toolCalls: [{ name: "file_write", arguments: { path: "palindrome.py", content: "def is_palindrome(s):\\n    return s == s[::-1]\\n" } }] } : undefined;

describe("the workspace a turn changed", () => {
  it("is measured from snapshots: created, modified and deleted files, and a bounded diff", async () => {
    await writeFile(join(ws, "a.txt"), "one\ntwo\n");
    await writeFile(join(ws, "gone.txt"), "x\n");
    const before = await snapshot(ws);
    await writeFile(join(ws, "a.txt"), "one\nTWO\n");
    await writeFile(join(ws, "b.txt"), "new\n");
    await rm(join(ws, "gone.txt"));
    const c = changes(before, await snapshot(ws));
    expect(c.files).toEqual([
      { path: "a.txt", change: "modified" },
      { path: "b.txt", change: "created" },
      { path: "gone.txt", change: "deleted" },
    ]);
    expect(c.diff).toContain("-two\n+TWO");
    expect(changes(before, await snapshot(ws), 40).diff).toMatch(/diff cut by the lab/);
  });

  it("reaches Check as measured fields, apart from what Do claimed", async () => {
    const { result, provider } = await run((c) => writesTheFile(c) ?? (c.role === "check" ? PASS : undefined));
    const exec = result.steps.find((s) => s.role === "exec")!;
    const out = exec.outputs.find((o) => o.type === "execution_result")!.fields;
    expect(out.filesChanged).toEqual({ provenance: "measured", value: ["created palindrome.py"] });
    expect(out.diff.provenance).toBe("measured");
    expect(String(out.diff.value)).toContain("+def is_palindrome(s):");
    const prompt = provider.promptsOf("check")[0];
    expect(prompt).toMatch(/What changed in the workspace \(measured by the lab, from the file system\):\s+- created palindrome\.py/);
    expect(prompt).toContain("```diff");
  });
});

describe("Check", () => {
  it("verifies with the tools it really has, then gives its verdict in a turn with no tools", async () => {
    let checks = 0;
    const { provider, result } = await run((c) => {
      if (c.role !== "check") return writesTheFile(c);
      checks++;
      if (checks === 1) return { toolCalls: [{ name: "file_read", arguments: { path: "palindrome.py" } }] };
      if (checks === 2) return "I read palindrome.py: it compares the string with its reverse.";
      return PASS;
    });
    const calls = provider.calls.filter((c) => c.role === "check");
    expect(calls).toHaveLength(3);
    expect(calls[0].tools.sort()).toEqual(["file_read", "glob", "grep"]);
    expect(calls[0].prompt).toMatch(/with your tools: (file_read|glob|grep)/);
    expect(calls[0].prompt).not.toMatch(/git diff|shell/);
    expect(calls[0].prompt).not.toMatch(/SINGLE valid JSON/);
    expect(calls[2].tools).toEqual([]);
    expect(calls[2].prompt).toMatch(/Now give your verdict/);
    expect(result.steps.find((s) => s.role === "eval")!.toolCalls.map((t) => t.name)).toEqual(["file_read"]);
    expect(result.result.verdict).toBe("pass");
  });

  it("is skipped, and says why, when nothing changed and there is no check; the run is not verified, never inconclusive", async () => {
    const { provider, events, result } = await run((c) => (c.role === "do" ? "This folder holds notes." : undefined), { skipUnverifiable: true });
    expect(provider.calls.filter((c) => c.role === "check")).toHaveLength(0);
    expect(events.find((e) => e.type === "role:end" && e.role === "eval")).toMatchObject({ skipped: "nothing changed and no checks" });
    expect(result.steps.find((s) => s.role === "eval")!.skipped).toEqual({ reason: "nothing changed and no checks", provenance: "measured" });
    const end = events.find((e) => e.type === "run:end")!;
    expect(end).toMatchObject({ outcome: "unverified", success: false, reason: "not verified: nothing changed and no checks", unverified: true, unverifiedReason: "nothing changed and no checks" });
    // Every surface reads it as "not verified": the folded state, the log line.
    const state = events.reduce((s, e) => reduceRun(s, e, 0), initialRunState(0));
    expect(state.outcome).toEqual({ outcome: "not verified", reason: "not verified: nothing changed and no checks" });
    expect(state.log.map((l) => l.e).filter((e) => JSON.stringify(e).includes("inconclusive")).map((e) => e.type)).toEqual([]);
  });

  it("is not skipped when the task has a check, nor when the skip is off", async () => {
    const off = await run((c) => (c.role === "do" ? "done" : undefined));
    expect(off.provider.calls.filter((c) => c.role === "check").length).toBeGreaterThan(0);
  });
});

describe("the lab's corrections and the environment", () => {
  it("turns literal \\n into line breaks in file_write when the content has no real one, and says so", async () => {
    expect(unescapeLiteralNewlines("def f():\\n    pass\\n")).toEqual({ text: "def f():\n    pass\n", count: 2 });
    expect(unescapeLiteralNewlines("a\nb\\n")).toBeNull();
    const { events, result } = await run((c) => writesTheFile(c) ?? (c.role === "check" ? PASS : undefined));
    expect(await readFile(join(ws, "palindrome.py"), "utf-8")).toBe("def is_palindrome(s):\n    return s == s[::-1]\n");
    expect(events.find((e) => e.type === "tool:end" && e.tool === "file_write")).toMatchObject({ note: expect.stringMatching(/the lab turned 2 literal \\n sequences into line breaks/) });
    expect(String(result.steps.find((s) => s.role === "exec")!.toolCalls[0].result)).toMatch(/the lab turned 2 literal/);
    const off = createDefaultToolkit(undefined, { unescapeNewlines: false }).get("file_write")!;
    await off.execute({ path: "raw.txt", content: "a\\nb" }, { workingDir: ws, iteration: 1, log: () => {}, verbose: false });
    expect(await readFile(join(ws, "raw.txt"), "utf-8")).toBe("a\\nb");
  });

  it("ends every role's system prompt with where it runs, inside Jig", async () => {
    const env = environmentBlock(ws, new Date("2026-11-19T12:00:00Z"), "darwin");
    expect(env).toMatch(/inside Jig/);
    expect(env).toContain(`Working directory: ${ws}`);
    expect(env).toContain("Platform: macOS");
    expect(env).toContain("Today's date: 2026-11-19");
    expect(env).toContain("A git repository: no");
    const { result } = await run((c) => (c.role === "check" ? PASS : undefined), { environment: env });
    for (const s of result.steps.filter((x) => x.calls.length)) expect(s.calls[0].messages[0].content.endsWith(env), s.role).toBe(true);
  });
});

describe("the person's words", () => {
  it("reach Check as given when the person denies with what to do instead, so Check judges the task as amended", async () => {
    const script = (c: ScriptedCall) => {
      if (c.role === "do" && c.turn === 1) return { toolCalls: [{ name: "file_write", arguments: { path: "notes.txt", content: "draft\n" } }] };
      if (c.role === "do" && c.turn === 2) return { toolCalls: [{ name: "file_write", arguments: { path: "todo.txt", content: "draft\n" } }] };
      if (c.role === "check") return PASS;
      return undefined;
    };
    const answers = [{ answer: "deny" as const, feedback: "call it todo.txt instead" }, { answer: "once" as const }];
    const { provider, result } = await run(script, {
      permissions: { settings: { mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [ws] }, grants: { edits: false, rules: [] }, ask: async () => answers.shift()! },
    });
    const check = provider.promptsOf("check").join("\n");
    expect(check).toMatch(/What the person said while the work was done \(given by the person/);
    expect(check).toContain('They said no to writing notes.txt, and added: "call it todo.txt instead"');
    expect(check).toMatch(/Do not ask for what they refused/);
    const signal = result.steps.find((st) => st.role === "exec")!;
    expect(JSON.stringify(signal)).toContain("call it todo.txt instead");
  });
});
