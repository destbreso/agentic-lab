// The CLI runs topologies through AgentSession: every built-in recipe runs
// (no "requires parameter tools"), --json prints the engine's events, and
// Ctrl+C stops a run waiting on the model.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listRecipes, type SessionEvent } from "@agentic-lab/core";
import { runTopology, type RunnerIO } from "./session-runner.js";
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

describe("agentic-lab run --topology", () => {
  it("prints the engine's events as JSON lines and ends honestly", async () => {
    const { io, lines } = capture();
    const run = await runTopology(
      { topology: "exec-eval", task: "say hello", dir, json: true, delay: "0" },
      io,
      { provider: scriptedProvider(), storage: null, handleSignals: false },
    );
    const events = lines.map((l) => JSON.parse(l) as SessionEvent);
    expect(events[0].type).toBe("run:start");
    expect(events.at(-1)).toMatchObject({ type: "run:end", outcome: "passed", success: true });
    expect(run.success).toBe(true);
  });

  it.each(listRecipes().map((r) => r.id))("runs the %s recipe without crashing", async (id) => {
    const { io } = capture();
    const run = await runTopology(
      { topology: id, task: "say hello", dir, json: true, iterations: "1", delay: "0" },
      io,
      { provider: scriptedProvider(), storage: null, handleSignals: false },
    );
    expect(["passed", "failed", "inconclusive"]).toContain(run.outcome);
  });

  it("refuses an unknown topology with the list of real ones", async () => {
    const { io } = capture();
    await expect(
      runTopology({ topology: "nope", task: "t", dir }, io, { provider: scriptedProvider(), storage: null, handleSignals: false }),
    ).rejects.toThrow(/Unknown topology "nope". Available: ralph-loop/);
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
      req.on("close", () => (chatClosed = true));
      chatSeen();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1" };
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
