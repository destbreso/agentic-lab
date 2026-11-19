// Providers and brains from the console: entries read from the user's config,
// a brain that falls back from a server that is down to one that answers,
// shown in the session; /providers and /brains; no key in any file Jig writes;
// and a raw key never written by Jig.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JigConfig } from "jig-core";
import { loadModels, readUserConfig, resolveNow, saveBrain, saveEntry } from "./providers.js";
import { SessionController } from "./session/controller.js";
import { App } from "./session/app.js";

let server: Server;
let url = "";
const auths: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      auths.push(String(req.headers.authorization ?? ""));
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "m" }] }));
      const body = JSON.parse(raw || "{}");
      const system = String(body.messages?.[0]?.content ?? "");
      const content = system.includes("evaluation agent") ? '{"verdict":"pass","evidence":[],"corrections":[],"confidence":1}' : "Done by the fake server.";
      res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const SECRET = "sk-test-never-written-31337";

function config(): JigConfig {
  return {
    loop: { provider: "fake" },
    providers: {
      dead: { kind: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", defaultModel: "x" },
      fake: { kind: "openai-compatible", baseUrl: url, key: "env:JIG_TEST_KEY", defaultModel: "m" },
    } as unknown as JigConfig["providers"],
    storage: {},
    logging: { level: "error" },
    brains: { pair: ["dead/x", "fake/m"] },
  };
}

describe("providers and brains in the console", () => {
  it("reads the entries, resolves the key from its reference, and says which model of a brain would answer now", async () => {
    process.env.JIG_TEST_KEY = SECRET;
    const m = await loadModels(config());
    expect(m.states.map((s) => [s.entry.name, s.source, Boolean(s.key)])).toEqual([["dead", "none", false], ["fake", "env:JIG_TEST_KEY", true]]);
    expect(m.brainsNow.pair).toEqual(["dead/x", "fake/m"]);
    const now = await resolveNow(m, "pair");
    expect(now.answers).toBe("fake/m");
    expect(now.notes[0]).toMatch(/^dead\/x: /);
  });

  it("runs a role on a brain: it falls back from the server that is down, says so, and writes no key anywhere", async () => {
    process.env.JIG_TEST_KEY = SECRET;
    const dir = await mkdtemp(join(tmpdir(), "jig-brain-"));
    const models = await loadModels(config());
    const ctrl = new SessionController({ workingDir: dir, models, storage: null, settings: { roleModels: { exec: "pair" } } });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 140, rows: 40 }} />);
    app.stdin.write("say done\r");
    const start = Date.now();
    while (!ctrl.messages.some((m) => m.kind === "run" && m.outcome) && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 100));
    const frame = (app.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    expect(frame).toMatch(/↪ exec fell back from dead\/x to fake\/m \(connection\)/);
    expect(frame).toMatch(/↪ m/);
    app.unmount();
    expect(auths.every((a) => a === `Bearer ${SECRET}`)).toBe(true);
    const files: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(join(d, e.name)) : files.push(join(d, e.name));
    };
    await walk(join(dir, ".jig"));
    expect(files.some((f) => f.includes("sessions"))).toBe(true);
    expect(files.some((f) => f.endsWith("steps.json"))).toBe(true);
    for (const f of files) expect(await readFile(f, "utf-8"), f).not.toContain(SECRET);
    await rm(dir, { recursive: true, force: true });
  });

  it("writes entries and brains to the user's config, mode 600, and never a key in clear", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jig-config-"));
    const file = join(dir, "config.json");
    saveEntry({ name: "groq", kind: "openai-compatible", preset: "groq", key: "env:GROQ_API_KEY" }, file);
    saveBrain("fast", ["groq/llama-3.3-70b", "ollama/qwen2.5:7b"], file);
    expect(() => saveEntry({ name: "x", kind: "openai", key: "sk-a-raw-key-123" }, file)).toThrow(/never in clear/);
    expect(readUserConfig(file)).toEqual({ providers: { groq: { kind: "openai-compatible", preset: "groq", key: "env:GROQ_API_KEY" } }, brains: { fast: ["groq/llama-3.3-70b", "ollama/qwen2.5:7b"] } });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await rm(dir, { recursive: true, force: true });
  });
});
