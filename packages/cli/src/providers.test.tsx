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
import { LOCAL_SERVERS, discoverLocal, type JigConfig } from "jig-core";
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

  it("runs a built-in topology whose roles name fast and strong on only Ollama exactly as before: every role on the local model, no fallback", async () => {
    const seen: string[] = [];
    const ollama = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.url?.startsWith("/api/tags")) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }));
        }
        const body = JSON.parse(raw || "{}");
        seen.push(String(body.model));
        const system = String(body.messages?.[0]?.content ?? "");
        const content = system.includes("evaluation agent") ? '{"verdict":"pass","evidence":[],"corrections":[],"confidence":1}' : "done";
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end(`${JSON.stringify({ model: body.model, message: { role: "assistant", content }, done: false })}\n${JSON.stringify({ model: body.model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 3, eval_count: 2 })}\n`);
      });
    });
    await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(ollama.address() as { port: number }).port}`;
    const models = await loadModels({ loop: { provider: "ollama" }, providers: { ollama: { baseUrl: base, defaultModel: "qwen2.5:7b" } }, storage: {}, logging: { level: "error" } } as unknown as JigConfig);
    for (const b of ["default", "fast", "strong", "local"]) expect(models.brainsNow[b], b).toEqual(["ollama/qwen2.5:7b"]);
    const dir = await mkdtemp(join(tmpdir(), "jig-only-ollama-"));
    const ctrl = new SessionController({ workingDir: dir, models, storage: null, persist: false, skipUnverifiable: false });
    await ctrl.load();
    expect(ctrl.topology?.nodes.map((n) => n.config.brain?.brain)).toEqual(["fast", "strong"]);
    expect(ctrl.drawing?.roles.map((r) => r.model)).toEqual(["qwen2.5:7b", "qwen2.5:7b"]);
    await ctrl.send("say done");
    const run = ctrl.messages.find((m) => m.kind === "run") as { outcome?: string; runId?: string; fallbacks?: unknown[] };
    expect(run.outcome).toBe("passed");
    expect(run.fallbacks ?? []).toEqual([]);
    expect(new Set(seen)).toEqual(new Set(["qwen2.5:7b"]));
    const steps = JSON.parse(await readFile(join(dir, ".jig", "runs", run.runId!, "steps.json"), "utf-8")) as Array<{ role: string; calls: Array<{ route?: { answeredBy: string } }> }>;
    for (const s of steps.filter((x) => x.calls.length)) expect(s.calls.every((c) => c.route?.answeredBy === "ollama/qwen2.5:7b"), s.role).toBe(true);
    await new Promise<void>((r) => ollama.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  });
});

describe("model servers found on this machine", () => {
  const ollamaAt = async (models: string[]) => {
    const s = createServer((req, res) => {
      res.writeHead(req.url === "/api/tags" ? 200 : 404, { "content-type": "application/json" });
      res.end(req.url === "/api/tags" ? JSON.stringify({ models: models.map((name) => ({ name })) }) : "{}");
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return { s, port: (s.address() as { port: number }).port };
  };
  const local = (name: string, port: number) => ({ ...LOCAL_SERVERS.find((x) => x.name === name)!, port });
  const localConfig = (ollamaPort: number): JigConfig =>
    ({ loop: {}, providers: { ollama: { baseUrl: `http://localhost:${ollamaPort}`, defaultModel: "qwen2.5:7b" } }, storage: {}, logging: { level: "error" } }) as unknown as JigConfig;

  it("joins what answers as discovered entries after the configured ones, and a configured entry at the same server wins", async () => {
    const ollama = await ollamaAt(["qwen2.5:7b", "llama3.1:8b"]);
    const studioPort = Number(new URL(url).port);
    try {
      const m = await loadModels(localConfig(ollama.port));
      const found = await discoverLocal({ servers: [local("ollama", ollama.port), local("lmstudio", studioPort)] });
      m.applyDiscovery(found);
      // The configured Ollama (at localhost) is the one found at 127.0.0.1: no duplicate, only its live models.
      expect(m.states.map((s) => s.entry.name)).toEqual(["ollama", "lmstudio"]);
      expect(m.states[0].live).toEqual(["qwen2.5:7b", "llama3.1:8b"]);
      expect(m.states[1].discovered).toEqual({ label: "LM Studio", models: ["m"] });
      // It joins the shipped brains' local chains after the configured entries, and answers through them.
      expect(m.brainsNow.local).toEqual(["ollama/qwen2.5:7b", "lmstudio/m"]);
      expect(m.discovery?.summary).toBe("ollama up (2 models) ∙ lmstudio up (1)");
      expect(m.entries()).toEqual(["ollama", "lmstudio"]);
      // Asked again with nothing there, the discovered entry goes.
      m.applyDiscovery([]);
      expect(m.states.map((s) => s.entry.name)).toEqual(["ollama"]);
    } finally {
      await new Promise<void>((r) => ollama.s.close(() => r()));
    }
  });

  it("says what it found in the header and /providers, in the background, and keeps a server only when told", async () => {
    const studioPort = Number(new URL(url).port);
    const configDir = await mkdtemp(join(tmpdir(), "jig-discover-config-"));
    const dir = await mkdtemp(join(tmpdir(), "jig-discover-"));
    const saved = process.env.JIG_CONFIG_DIR;
    process.env.JIG_CONFIG_DIR = configDir;
    try {
      const models = await loadModels(localConfig(9));
      const ctrl = new SessionController({
        workingDir: dir,
        models,
        storage: null,
        discovery: { servers: [local("ollama", 9), local("lmstudio", studioPort)], timeoutMs: 300 },
        reloadModels: async () => loadModels({ ...localConfig(9), providers: { ...localConfig(9).providers, ...(readUserConfig().providers as object) } } as JigConfig),
        permissions: { mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [dir] },
      });
      await ctrl.load();
      const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 120, rows: 40 }} fps={50} />);
      const frame = () => (app.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
      await ctrl.discover();
      await new Promise((r) => setTimeout(r, 100));
      expect(frame()).toMatch(/lmstudio up \(1 model\)/);
      app.stdin.write("/providers list\r");
      await new Promise((r) => setTimeout(r, 150));
      expect(frame().replace(/\s+/g, " ")).toMatch(/found on this machine \(LM Studio\), 1 model, not kept: \/providers keep lmstudio/);
      expect(readUserConfig().providers).toBeUndefined();
      app.stdin.write("/providers keep lmstudio\r");
      await new Promise((r) => setTimeout(r, 200));
      expect((readUserConfig().providers as Record<string, { baseUrl: string }>).lmstudio.baseUrl).toBe(`http://127.0.0.1:${studioPort}/v1`);
      // Kept, it is a configured entry now: no longer "not kept", and still one entry.
      expect((ctrl.models as Awaited<ReturnType<typeof loadModels>>).states.filter((s) => s.entry.name === "lmstudio").map((s) => Boolean(s.discovered))).toEqual([false]);
      app.unmount();
    } finally {
      if (saved === undefined) delete process.env.JIG_CONFIG_DIR;
      else process.env.JIG_CONFIG_DIR = saved;
      await rm(configDir, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
