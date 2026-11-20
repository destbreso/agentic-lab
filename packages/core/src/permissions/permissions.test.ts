// Permissions as Claude Code's: what runs, what asks and what is refused, by
// mode, rule and working directory; the guard asking with a write's diff,
// remembering a shell prefix, passing a denial and its words back to the
// role, recording every decision; and nobody to ask meaning deny.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, pathMatches, prefixOf, shellMatches, type PermissionSettings } from "./permissions.js";
import { guardTools, type PermissionAnswer, type PermissionQuestion } from "./guard.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { TopologyRun, type RunEvent } from "../engine/topology-run.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import { eventsFromSteps } from "../engine/replay-events.js";
import { getRecipe } from "../loops/recipes.js";

let ws: string;
let other: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "jig-perm-"));
  other = await mkdtemp(join(tmpdir(), "jig-perm-other-"));
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

const settings = (over: Partial<PermissionSettings> = {}): PermissionSettings => ({ mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [ws], ...over });
const sh = (command: string) => ({ tool: "Shell" as const, command, cwd: ws });

describe("deciding", () => {
  it("reads inside without asking and asks outside; writes ask, with a warning outside and in .git", () => {
    expect(decide({ tool: "Read", path: "a.txt" }, settings()).behavior).toBe("allow");
    expect(decide({ tool: "Read", path: join(other, "x") }, settings())).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/outside the working directories/) });
    expect(decide({ tool: "Write", path: "a.txt" }, settings()).behavior).toBe("ask");
    expect(decide({ tool: "Write", path: join(other, "x") }, settings({ mode: "acceptEdits" }))).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/outside/) });
    expect(decide({ tool: "Write", path: ".git/config" }, settings({ mode: "acceptEdits" }))).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/protected/) });
    expect(decide({ tool: "Read", path: join(other, "x") }, settings({ workingDirs: [ws, other] })).behavior).toBe("allow");
  });

  it("runs read-only commands, asks for the rest part by part, and offers to remember a prefix only when it names everything", () => {
    expect(decide(sh("ls -la && cat a.txt | wc -l"), settings()).behavior).toBe("allow");
    expect(decide(sh("git status"), settings()).behavior).toBe("allow");
    expect(decide(sh("npm test"), settings())).toMatchObject({ behavior: "ask", remember: ["Shell(npm test *)"] });
    expect(decide(sh("ls && npm run build && pytest -q"), settings())).toMatchObject({ behavior: "ask", remember: ["Shell(npm run build *)", "Shell(pytest *)"] });
    expect(decide(sh("echo $HOME"), settings())).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/cannot read all of it/) });
    expect(decide(sh("echo $HOME"), settings()).remember).toBeUndefined();
    expect(decide(sh("cat ../secret"), settings())).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/outside/) });
    expect(decide(sh("/usr/bin/python3 x.py"), settings())).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/by its path/) });
  });

  it("puts deny over ask over allow, in rules from every source, Bash and Edit read as Shell and Write", () => {
    const rules = { allow: ["Bash(npm test:*)", "Edit(src/**)", "Read(//etc/**)"], ask: ["Shell(npm test -- --update)"], deny: ["Shell(npm test --coverage)", "Read(./.env)"] };
    expect(decide(sh("npm test"), settings({ rules })).behavior).toBe("allow");
    expect(decide(sh("npm test -- --update"), settings({ rules })).behavior).toBe("ask");
    expect(decide(sh("npm test --coverage"), settings({ rules })).behavior).toBe("deny");
    expect(decide(sh("ls && npm test --coverage"), settings({ rules })).behavior).toBe("deny");
    expect(decide(sh("npm test && rm -rf build"), settings({ rules })).behavior).toBe("ask");
    expect(decide({ tool: "Write", path: "src/a.ts" }, settings({ rules })).behavior).toBe("allow");
    expect(decide({ tool: "Write", path: "docs/a.md" }, settings({ rules })).behavior).toBe("ask");
    expect(decide({ tool: "Read", path: ".env" }, settings({ rules })).behavior).toBe("deny");
    expect(decide({ tool: "Read", path: "/etc/hosts" }, settings({ rules })).behavior).toBe("allow");
    expect(decide({ tool: "Read", path: ".env" }, settings({ rules, mode: "bypassPermissions" })).behavior).toBe("deny");
  });

  it("runs each mode as Claude Code does", () => {
    expect(decide({ tool: "Write", path: "a.txt" }, settings({ mode: "acceptEdits" })).behavior).toBe("allow");
    expect(decide(sh("mkdir out && touch out/a"), settings({ mode: "acceptEdits" })).behavior).toBe("allow");
    expect(decide(sh("npm test"), settings({ mode: "acceptEdits" })).behavior).toBe("ask");
    expect(decide({ tool: "Write", path: "a.txt" }, settings({ mode: "plan" })).behavior).toBe("deny");
    expect(decide(sh("ls"), settings({ mode: "plan" })).behavior).toBe("allow");
    expect(decide(sh("rm a.txt"), settings({ mode: "plan" })).behavior).toBe("deny");
    expect(decide(sh("npm test"), settings({ mode: "bypassPermissions" })).behavior).toBe("allow");
    expect(decide({ tool: "Write", path: "a.txt" }, settings(), { edits: true, rules: [] }).behavior).toBe("allow");
  });

  it("asks before writing a protected path in every mode but bypass, as Claude Code's list", () => {
    for (const f of [".zshrc", ".claude/settings.json", ".vscode/settings.json", ".husky/pre-commit", ".npmrc", "sub/.git/hooks/post-commit", ".jig/x.json"]) {
      expect(decide({ tool: "Write", path: f }, settings({ mode: "acceptEdits" })), f).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/protected/) });
    }
    expect(decide({ tool: "Write", path: "src/.zshrc.md" }, settings({ mode: "acceptEdits" })).behavior).toBe("allow");
    expect(decide({ tool: "Write", path: ".zshrc" }, settings({ mode: "bypassPermissions" })).behavior).toBe("allow");
  });

  it("keeps what no mode approves on its own: an ask rule, and a removal that could take everything", () => {
    const rules = { allow: ["Shell(rm *)"], ask: ["Shell(git push *)", "Write(release/**)"], deny: [] };
    expect(decide(sh("git push origin main"), settings({ rules, mode: "bypassPermissions" })).behavior).toBe("ask");
    expect(decide({ tool: "Write", path: "release/a" }, settings({ rules, mode: "bypassPermissions" })).behavior).toBe("ask");
    expect(decide(sh("rm -rf build"), settings({ rules })).behavior).toBe("allow");
    for (const c of ["rm -rf /", "rm -rf ~", "rm -rf .", "rm -rf ..", "rmdir /usr", `rm -rf ${ws}`]) {
      expect(decide(sh(c), settings({ rules, mode: "bypassPermissions" })), c).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/no mode or rule/) });
    }
    expect(decide(sh("rm -rf $DIR/"), settings({ mode: "bypassPermissions" }))).toMatchObject({ behavior: "ask", warning: expect.stringMatching(/not ruled out/) });
    // Plan mode refuses before anything asks.
    expect(decide({ tool: "Write", path: "release/a" }, settings({ rules, mode: "plan" })).behavior).toBe("deny");
  });

  it("holds Read and Write deny rules for files a command names or redirects to, and a Read deny for writes", () => {
    const rules = { allow: [], ask: [], deny: ["Read(./.env)", "Write(dist/**)"] };
    expect(decide({ tool: "Write", path: ".env" }, settings({ rules })).behavior).toBe("deny");
    expect(decide(sh("cat .env"), settings({ rules })).behavior).toBe("deny");
    expect(decide(sh("echo x > .env"), settings({ rules })).behavior).toBe("deny");
    expect(decide(sh("ls && echo hi | tee dist/a.txt"), settings({ rules })).behavior).toBe("deny");
    // A pattern is not a file.
    expect(decide(sh("grep .env README.md"), settings({ rules })).behavior).toBe("allow");
  });

  it("does not take a read-only program's writing forms for reads", () => {
    expect(decide(sh("git branch"), settings()).behavior).toBe("allow");
    expect(decide(sh("git branch -a"), settings()).behavior).toBe("allow");
    expect(decide(sh("git branch feature"), settings()).behavior).toBe("ask");
    expect(decide(sh("sort a.txt -o b.txt"), settings()).behavior).toBe("ask");
    expect(decide(sh("uniq a.txt b.txt"), settings()).behavior).toBe("ask");
    expect(decide(sh("cd src && ls -la"), settings()).behavior).toBe("allow");
    expect(decide(sh("cd .. && ls"), settings()).behavior).toBe("ask");
    expect(decide(sh("cd sub && git status"), settings()).behavior).toBe("ask");
    expect(decide(sh("cd . && git status"), settings()).behavior).toBe("allow");
    expect(decide(sh("cd && cat .zshrc"), settings()).behavior).toBe("ask");
    expect(decide(sh("cd ~ && ls"), settings()).behavior).toBe("ask");
    // A deny rule holds for a path reached through a cd.
    expect(decide(sh("cd secrets && cat key"), settings({ rules: { allow: [], ask: [], deny: ["Read(./secrets/**)"] } })).behavior).toBe("deny");
  });

  it("matches patterns the way the rules are written", () => {
    expect(shellMatches("npm test:*", "npm test")).toBe(true);
    expect(shellMatches("npm test *", "npm test -- -u")).toBe(true);
    expect(shellMatches("npm test:*", "npm testing")).toBe(false);
    expect(pathMatches("src/**", join(ws, "src/a/b.ts"), ws)).toBe(true);
    expect(pathMatches("*.md", join(ws, "README.md"), ws)).toBe(true);
    expect(pathMatches("~/x/*", "/home/u/x/a", ws, "/home/u")).toBe(true);
    expect(prefixOf("npm run build")).toBe("npm run build");
    expect(prefixOf("npm test -- -u")).toBe("npm test");
    expect(prefixOf("pytest -q")).toBe("pytest");
    expect(prefixOf("python3 app.py --fast")).toBe("python3 app.py");
    expect(prefixOf("python3 -m pytest -q")).toBe("python3 -m pytest");
    // Code given inline has no prefix that names only it.
    expect(prefixOf("node -e 'x'")).toBeNull();
    expect(prefixOf("python3")).toBeNull();
  });
});

describe("the guard", () => {
  const ctx = { workingDir: ws, iteration: 1, log: () => {}, verbose: false };
  const guarded = (answer: (q: PermissionQuestion) => PermissionAnswer, over: Partial<PermissionSettings> = {}, saved: string[][] = []) => {
    const records: unknown[] = [];
    const questions: PermissionQuestion[] = [];
    const p = { settings: settings(over), grants: { edits: false, rules: [] as string[] }, ask: async (q: PermissionQuestion) => (questions.push(q), answer(q)), saveRules: (r: string[]) => saved.push(r) };
    const tools = guardTools(createDefaultToolkit(), p, { id: "exec", name: "Executor" }, (r) => records.push(r));
    return { tools, records, questions, p };
  };

  it("asks before a write, with its diff, and runs it on yes", async () => {
    await writeFile(join(ws, "a.txt"), "one\ntwo\n");
    const { tools, questions, records } = guarded(() => ({ answer: "once" }));
    const out = await tools.get("file_write")!.execute({ path: "a.txt", content: "one\nTWO\n" }, { ...ctx, workingDir: ws });
    expect(out).toMatch(/Wrote/);
    expect(questions[0]).toMatchObject({ tool: "Write", reason: "a write" });
    expect(questions[0].diff).toMatch(/-two\n\+TWO/);
    expect(records[0]).toMatchObject({ behavior: "allowed", by: "you", answer: "once", provenance: "given" });
  });

  it("allows every edit for the session after one yes for the session", async () => {
    const { tools, questions } = guarded(() => ({ answer: "session" }));
    await tools.get("file_write")!.execute({ path: "a.txt", content: "x" }, { ...ctx, workingDir: ws });
    await tools.get("file_write")!.execute({ path: "b.txt", content: "y" }, { ...ctx, workingDir: ws });
    expect(questions).toHaveLength(1);
  });

  it("keeps a shell prefix as a rule for the project and does not ask again", async () => {
    const saved: string[][] = [];
    const { tools, questions, p } = guarded(() => ({ answer: "rule" }), {}, saved);
    await writeFile(join(ws, "s.js"), "console.log(process.argv[2])\n");
    await tools.get("shell")!.execute({ command: "node s.js 1" }, { ...ctx, workingDir: ws });
    expect(await tools.get("shell")!.execute({ command: "node s.js 2" }, { ...ctx, workingDir: ws })).toBe("2\n");
    expect(questions).toHaveLength(1);
    expect(questions[0].remember).toEqual(["Shell(node s.js *)"]);
    expect(saved).toEqual([["Shell(node s.js *)"]]);
    // The next run reads the saved rule and does not ask either; another script still asks.
    const next = settings({ rules: { allow: saved.flat(), ask: [], deny: [] } });
    expect(decide(sh("node s.js 3"), next).behavior).toBe("allow");
    expect(decide(sh("node other.js"), next).behavior).toBe("ask");
    expect(p.grants.rules).toEqual(["Shell(node s.js *)"]);
  });

  it("passes a no and the person's words back to the role, and records them as given", async () => {
    const { tools, records } = guarded(() => ({ answer: "deny", feedback: "write it to out/ instead" }));
    const out = await tools.get("file_write")!.execute({ path: "a.txt", content: "x" }, { ...ctx, workingDir: ws });
    expect(out).toBe("Not done: the person did not allow writing a.txt, and said: write it to out/ instead");
    await expect(readFile(join(ws, "a.txt"), "utf-8")).rejects.toThrow();
    expect(records[0]).toMatchObject({ behavior: "denied", by: "you", feedback: "write it to out/ instead", provenance: "given" });
  });

  it("lets a yes for the session read the folder outside, and only that folder", async () => {
    await writeFile(join(other, "a.txt"), "a\n");
    await writeFile(join(other, "b.txt"), "b\n");
    const { tools, questions } = guarded(() => ({ answer: "session" }));
    await tools.get("file_read")!.execute({ path: join(other, "a.txt") }, { ...ctx, workingDir: ws });
    expect(await tools.get("file_read")!.execute({ path: join(other, "b.txt") }, { ...ctx, workingDir: ws })).toContain("b");
    expect(questions).toHaveLength(1);
    expect(decide({ tool: "Read", path: "/etc/hosts" }, settings(), { edits: false, rules: questions[0].remember! }).behavior).toBe("ask");
  });

  it("passes the words that go with a yes to the role after the result", async () => {
    const { tools, records } = guarded(() => ({ answer: "once", feedback: "and add a test next" }));
    const out = await tools.get("file_write")!.execute({ path: "a.txt", content: "x" }, { ...ctx, workingDir: ws });
    expect(out).toMatch(/Wrote[\s\S]*\(The person allowed this, and added: and add a test next\)$/);
    expect(records[0]).toMatchObject({ behavior: "allowed", feedback: "and add a test next" });
  });

  it("asks before reading outside the working directories, and reads there once allowed", async () => {
    await writeFile(join(other, "notes.txt"), "outside\n");
    const { tools, questions } = guarded(() => ({ answer: "once" }));
    expect(await tools.get("file_read")!.execute({ path: join(other, "notes.txt") }, { ...ctx, workingDir: ws })).toContain("outside");
    expect(questions[0]).toMatchObject({ tool: "Read", warning: expect.stringMatching(/outside/) });
  });

  it("denies what would ask when nobody is there to ask, and says so", async () => {
    const records: unknown[] = [];
    const tools = guardTools(createDefaultToolkit(), { settings: settings(), grants: { edits: false, rules: [] } }, { id: "exec", name: "Executor" }, (r) => records.push(r));
    expect(await tools.get("file_write")!.execute({ path: "a.txt", content: "x" }, { ...ctx, workingDir: ws })).toMatch(/nobody is there to ask/);
    expect(await tools.get("shell")!.execute({ command: "ls" }, { ...ctx, workingDir: ws })).not.toMatch(/Not done/);
    expect(records[0]).toMatchObject({ behavior: "denied", by: "nobody to ask" });
  });

  it("records every decision on the step and shows the questions as events", async () => {
    const provider = scriptedProvider((c) => (c.role === "do" && c.turn === 1 ? { toolCalls: [{ name: "file_write", arguments: { path: "a.txt", content: "hi" } }] } : undefined));
    const events: RunEvent[] = [];
    const session = new TopologyRun({
      provider,
      tools: createDefaultToolkit(),
      topology: "exec-eval",
      workingDir: ws,
      delayMs: 0,
      maxRounds: 1,
      permissions: { settings: settings(), grants: { edits: false, rules: [] }, ask: async () => ({ answer: "deny", feedback: "not now" }) },
    });
    session.on("event", (e) => events.push(e));
    const run = await session.run("t");
    expect(run.steps.find((s) => s.role === "exec")!.permissions?.[0]).toMatchObject({ tool: "Write", behavior: "denied", by: "you", feedback: "not now" });
    expect(events.find((e) => e.type === "approval:asked")).toMatchObject({ tool: "Write", diff: expect.stringContaining("+hi") });
    expect(events.find((e) => e.type === "approval:answered")).toMatchObject({ answer: "deny", feedback: "not now" });
    expect(String(run.steps.find((s) => s.role === "exec")!.toolCalls[0].result)).toMatch(/did not allow writing a\.txt, and said: not now/);
    expect(events.find((e) => e.type === "approval:asked")).toMatchObject({ command: "a.txt" });
    // A replay of the steps shows the same question and answer.
    const replayed = eventsFromSteps(run.steps, { runId: run.runId, topology: getRecipe("exec-eval")!, task: "t" }).map((t) => t.event);
    expect(replayed.find((e) => e.type === "approval:answered")).toMatchObject({ answer: "deny", feedback: "not now" });
  });

  it("puts a denial nobody was asked about on the events and in the replay", async () => {
    const provider = scriptedProvider((c) => (c.role === "do" && c.turn === 1 ? { toolCalls: [{ name: "file_write", arguments: { path: "a.txt", content: "hi" } }] } : undefined));
    const events: RunEvent[] = [];
    const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "exec-eval", workingDir: ws, delayMs: 0, maxRounds: 1, permissions: { settings: settings({ mode: "plan" }), grants: { edits: false, rules: [] } } });
    session.on("event", (e) => events.push(e));
    const run = await session.run("t");
    expect(events.find((e) => e.type === "permission:denied")).toMatchObject({ role: "exec", tool: "Write", by: "mode", reason: "plan mode: reading only, no writes" });
    const replayed = eventsFromSteps(run.steps, { runId: run.runId, topology: getRecipe("exec-eval")!, task: "t" }).map((t) => t.event);
    expect(replayed.find((e) => e.type === "permission:denied")).toMatchObject({ tool: "Write", by: "mode" });
  });
});
