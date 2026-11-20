// The CLI runs topologies through TopologyRun: every built-in recipe runs
// (no "requires parameter tools"), --json prints the engine's events, and
// Ctrl+C stops a run waiting on the model.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listRecipes, type RunEvent } from "jig-core";
import { runTopology, type RunnerIO } from "./session-runner.js";
import { saveLocalRules } from "./permissions.js";
import { scriptedProvider } from "../../core/src/test-support/scripted-provider.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-run-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function capture(): { io: RunnerIO; lines: string[] } {
  const lines: string[] = [];
  return { io: { out: (l) => lines.push(l), note: () => {} }, lines };
}

describe("jig run --topology", () => {
  it("prints the engine's events as JSON lines and ends honestly", async () => {
    const { io, lines } = capture();
    const run = await runTopology(
      { topology: "exec-eval", task: "say hello", dir, json: true, delay: "0" },
      io,
      { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false },
    );
    const events = lines.map((l) => JSON.parse(l) as RunEvent);
    expect(events[0].type).toBe("run:start");
    expect(events.at(-1)).toMatchObject({ type: "run:end", outcome: "passed", success: true });
    expect(run.success).toBe(true);
  });

  it.each(listRecipes().map((r) => r.id))("runs the %s recipe without crashing", async (id) => {
    const { io } = capture();
    const run = await runTopology(
      { topology: id, task: "say hello", dir, json: true, iterations: "1", delay: "0" },
      io,
      { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false },
    );
    expect(["passed", "failed", "inconclusive", "unverified"]).toContain(run.outcome);
  });

  it("takes the task's checks from flags and a task file, and the outcome is the lab's", async () => {
    const ws = await mkdtemp(join(tmpdir(), "cli-checks-"));
    try {
      await writeFile(join(ws, "RESULT.txt"), "kestrel-7351\n");
      await writeFile(join(ws, "check.sh"), 'test "$(cat RESULT.txt)" = "kestrel-7351"\n');
      const taskFile = join(ws, "task.json");
      await writeFile(
        taskFile,
        JSON.stringify({ task: "swap it", checks: [{ name: "result", kind: "file", path: "RESULT.txt", equals: "kestrel-7351" }] }),
      );
      const { io, lines } = capture();
      const passed = await runTopology(
        { topology: "exec-eval", taskFile, check: ["sh check.sh"], checkFile: ["check.sh"], dir: ws, json: true, delay: "0" },
        io,
        { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false },
      );
      expect(passed.measured?.results.map((r) => [r.name, r.passed])).toEqual([
        ["result", true],
        ["check 1", true],
      ]);
      expect(passed.outcome).toBe("passed");
      const end = lines.map((l) => JSON.parse(l) as RunEvent).at(-1)!;
      expect(end).toMatchObject({ type: "run:end", outcome: "passed", topologyOutcome: "passed" });

      const failed = await runTopology(
        { topology: "exec-eval", task: "swap it", check: ["exit 4"], dir: ws, delay: "0", verdictFrom: "model" },
        capture().io,
        { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false },
      );
      expect(failed.outcome).toBe("failed");
      expect(failed.result.outcome).toBe("passed");
      await expect(
        runTopology({ topology: "exec-eval", task: "t", dir: ws, verdictFrom: "nobody" }, capture().io, {
          provider: scriptedProvider(),
          storage: null,
          handleSignals: false,
        }),
      ).rejects.toThrow(/--verdict-from must be one of: measured, model/);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("refuses an unknown topology with the list of real ones", async () => {
    const { io } = capture();
    await expect(
      runTopology({ topology: "nope", task: "t", dir }, io, { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false }),
    ).rejects.toThrow(/Unknown topology "nope". Available: ralph-loop/);
  });
});

describe("jig run's permissions: nobody to ask, so what would ask is denied", () => {
  const writer = () => scriptedProvider((c) => (c.role === "do" && c.turn === 1 ? { toolCalls: [{ name: "file_write", arguments: { path: "out.txt", content: "made\n" } }] } : undefined));
  const runner = () => scriptedProvider((c) => (c.role === "do" && c.turn === 1 ? { toolCalls: [{ name: "shell", arguments: { command: "node s.js" } }] } : undefined));
  let ws: string;
  let config: string;
  const saved = process.env.JIG_CONFIG_DIR;
  beforeAll(async () => {
    config = await mkdtemp(join(tmpdir(), "cli-perm-config-"));
    process.env.JIG_CONFIG_DIR = config;
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.JIG_CONFIG_DIR;
    else process.env.JIG_CONFIG_DIR = saved;
    await rm(config, { recursive: true, force: true });
  });
  const fresh = async () => {
    ws = await mkdtemp(join(tmpdir(), "cli-perm-"));
    await writeFile(join(ws, "s.js"), "console.log('ran')\n");
    return ws;
  };
  const doStep = (run: Awaited<ReturnType<typeof runTopology>>) => run.steps.find((st) => st.role === "exec")!;
  const go = (options: Parameters<typeof runTopology>[0], provider = writer()) => {
    const notes: string[] = [];
    return runTopology({ topology: "exec-eval", task: "make out.txt", delay: "0", ...options }, { out: () => {}, note: (l) => notes.push(l) }, { provider, storage: null, handleSignals: false, skipUnverifiable: false }).then((run) => ({ run, notes }));
  };

  it("denies a write in the default mode, says why, and tells how to allow it", async () => {
    const dir = await fresh();
    const { run, notes } = await go({ dir });
    expect(existsSync(join(dir, "out.txt"))).toBe(false);
    expect(doStep(run).toolCalls[0].result).toMatch(/nobody is there to ask/);
    expect(doStep(run).permissions?.[0]).toMatchObject({ tool: "Write", behavior: "denied", by: "nobody to ask" });
    expect(notes.join("\n")).toMatch(/1 call denied, with nobody to ask: Write out\.txt/);
    expect(notes.join("\n")).toMatch(/--permission-mode acceptEdits/);
  });

  it("writes with --permission-mode acceptEdits or an --allow rule, and --deny wins over both", async () => {
    let dir = await fresh();
    await go({ dir, permissionMode: "acceptEdits" });
    expect(readFileSync(join(dir, "out.txt"), "utf-8")).toBe("made\n");
    dir = await fresh();
    await go({ dir, allow: ["Write(*.txt)"] });
    expect(existsSync(join(dir, "out.txt"))).toBe(true);
    dir = await fresh();
    const { run } = await go({ dir, permissionMode: "acceptEdits", allow: ["Write(*.txt)"], deny: ["Edit(out.txt)"] });
    expect(existsSync(join(dir, "out.txt"))).toBe(false);
    expect(doStep(run).permissions?.[0]).toMatchObject({ behavior: "denied", by: "rule", rule: "Edit(out.txt)" });
  });

  it("honours a rule kept in .jig/settings.local.json, and plan mode refuses a write", async () => {
    const dir = await fresh();
    const denied = await go({ dir }, runner());
    expect(doStep(denied.run).toolCalls[0].result).toMatch(/nobody is there to ask/);
    expect(denied.notes.join("\n")).toMatch(/allow them with --allow 'Shell\(node s\.js \*\)'/);
    saveLocalRules(dir, { add: { list: "allow", rules: ["Shell(node s.js *)"] } });
    const allowed = await go({ dir }, runner());
    expect(doStep(allowed.run).toolCalls[0].result).toBe("ran\n");
    expect(doStep(allowed.run).permissions?.[0]).toMatchObject({ behavior: "allowed", by: "rule", rule: "Shell(node s.js *)" });
    const plan = await go({ dir: await fresh(), permissionMode: "plan" });
    expect(doStep(plan.run).toolCalls[0].result).toMatch(/plan mode/);
    await expect(go({ dir, permissionMode: "bypassPermissions" })).rejects.toThrow(/only ever --dangerously-skip-permissions/);
    const skipped = await go({ dir: await fresh(), dangerouslySkipPermissions: true });
    expect(doStep(skipped.run).permissions?.[0]).toMatchObject({ behavior: "allowed", by: "mode" });
    await expect(go({ dir, permissionMode: "yolo" })).rejects.toThrow(/default, acceptEdits, plan/);
  });
});

describe("jig run with nothing to run on", () => {
  it("says so, with the three ways to get a model, instead of naming one that is not there", async () => {
    const config = await mkdtemp(join(tmpdir(), "cli-nothing-config-"));
    const env = { JIG_CONFIG_DIR: process.env.JIG_CONFIG_DIR, JIG_DISCOVERY: process.env.JIG_DISCOVERY, OLLAMA_HOST: process.env.OLLAMA_HOST };
    Object.assign(process.env, { JIG_CONFIG_DIR: config, JIG_DISCOVERY: "off", OLLAMA_HOST: "127.0.0.1:9" });
    try {
      await expect(runTopology({ topology: "exec-eval", task: "hi", dir, delay: "0" }, capture().io, { storage: null, handleSignals: false })).rejects.toThrow(
        /Jig found no model to run on\. Install Ollama \(https:\/\/ollama\.com\/download\) .* add a cloud key .* or name a server/,
      );
    } finally {
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      await rm(config, { recursive: true, force: true });
    }
  });
});

describe("Ctrl+C", () => {
  it("stops a run waiting on the model and exits", async () => {
    // A model server that lists models and never answers a chat.
    let chatSeen: () => void = () => {};
    const chatStarted = new Promise<void>((r) => (chatSeen = r));
    let chatClosed = false;
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/tags")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "m" }] }));
        return;
      }
      // What the model can do, asked before the run: it can use tools.
      if (req.url?.startsWith("/api/show")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
        return;
      }
      req.on("close", () => (chatClosed = true));
      chatSeen();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1", JIG_DISCOVERY: "off" };
    env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
    env.OLLAMA_DEFAULT_MODEL = "m";
    const cliRoot = resolve(__dirname, "..");
    const child = spawn(
      resolve(cliRoot, "../../node_modules/.bin/vite-node"),
      [resolve(cliRoot, "src/index.ts"), "run", "--task", "wait", "--provider", "ollama", "--model", "m", "--dir", dir],
      { cwd: cliRoot, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));

    try {
      await chatStarted;
      const stoppedAt = Date.now();
      child.kill("SIGINT");
      const code = await exited;
      expect(Date.now() - stoppedAt).toBeLessThan(5000);
      expect(code).toBe(130);
      expect(output).toMatch(/stopped/);
      expect(chatClosed).toBe(true);
    } finally {
      child.kill("SIGKILL");
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});
