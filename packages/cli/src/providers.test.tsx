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
import { doctorCommand } from "./commands/providers.js";
import { SessionController } from "./session/controller.js";
import { addServer } from "./session/first-run.js";
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
    for (const b of ["fast", "strong", "local"]) expect(models.brainsNow[b], b).toEqual(["ollama/qwen2.5:7b"]);
    expect(models.brainsNow.default).toBeUndefined();
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

describe("a first run with nothing configured", () => {
  /** A fake Ollama: its models, and what /api/show says of each. */
  const fakeOllama = async (models: Record<string, { tools: boolean; size: string }>) => {
    const s = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/api/tags") return res.end(JSON.stringify({ models: Object.keys(models).map((name) => ({ name })) }));
        if (req.url === "/api/show") {
          const m = models[JSON.parse(raw || "{}").model];
          if (!m) return res.writeHead(404).end("{}");
          return res.end(JSON.stringify({ capabilities: m.tools ? ["completion", "tools"] : ["completion"], details: { parameter_size: m.size }, model_info: { "x.context_length": 32768 } }));
        }
        res.writeHead(404).end("{}");
      });
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return { s, port: (s.address() as { port: number }).port };
  };
  const nothing = (extra: Partial<JigConfig> = {}): JigConfig => ({ loop: {}, providers: {}, storage: {}, logging: { level: "error" }, ...extra }) as unknown as JigConfig;
  const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

  it("picks the default and every shipped brain only from the models really listed, by the stated rule", async () => {
    const o = await fakeOllama({ "qwen2.5:14b": { tools: true, size: "14.8B" }, "qwen2.5:7b": { tools: true, size: "7.6B" }, "gemma2:2b": { tools: false, size: "2.6B" } });
    // The Ollama assumed with nothing configured is where OLLAMA_HOST says: here, the fake one.
    const host = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = `127.0.0.1:${o.port}`;
    try {
      const m = await loadModels(nothing());
      expect(m.defaultRef).toBe("ollama/(finding a model)");
      await m.prepare({ discovery: { servers: [{ ...LOCAL_SERVERS[0], port: o.port }] } });
      // A role that names nothing gets the first of fast: the smaller local model that uses tools.
      expect(m.defaultRef).toBe("ollama/qwen2.5:7b");
      expect(m.brainsNow.fast).toEqual(["ollama/qwen2.5:7b", "ollama/qwen2.5:14b", "ollama/gemma2:2b"]);
      expect(m.brainsNow.strong[0]).toBe("ollama/qwen2.5:14b");
      expect(Object.values(m.brainsNow).flat().every((r) => m.catalog!.some((c) => c.ref === r))).toBe(true);
      expect(m.capabilities("ollama/gemma2:2b")).toMatchObject({ tools: false, source: "provider" });
      expect(m.states.map((s) => s.entry.name)).toEqual(["ollama"]);
    } finally {
      if (host === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = host;
      await close(o.s);
    }
  });

  it("jig doctor reads what is there before it answers: each brain names a listed model, never the placeholder", async () => {
    const o = await fakeOllama({ "qwen2.5:14b": { tools: true, size: "14.8B" }, "qwen2.5:7b": { tools: true, size: "7.6B" } });
    const dir = await mkdtemp(join(tmpdir(), "jig-doctor-"));
    // Only the fake server: no Ollama named by the environment, which is over the user's file.
    const env = { JIG_CONFIG_DIR: process.env.JIG_CONFIG_DIR, JIG_DISCOVERY: process.env.JIG_DISCOVERY, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL, OLLAMA_DEFAULT_MODEL: process.env.OLLAMA_DEFAULT_MODEL, OLLAMA_HOST: process.env.OLLAMA_HOST };
    const log = console.log;
    const out: string[] = [];
    try {
      saveEntry({ name: "ollama", kind: "ollama", baseUrl: `http://127.0.0.1:${o.port}` }, join(dir, "config.json"));
      Object.assign(process.env, { JIG_CONFIG_DIR: dir, JIG_DISCOVERY: "off" });
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.OLLAMA_DEFAULT_MODEL;
      delete process.env.OLLAMA_HOST;
      console.log = (...a: unknown[]) => void out.push(a.map(String).join(" "));
      await doctorCommand(dir);
    } finally {
      console.log = log;
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      await close(o.s);
      await rm(dir, { recursive: true, force: true });
    }
    const text = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).not.toContain("(finding a model)");
    expect(text).toMatch(/✓ fast +ollama\/qwen2\.5:7b/);
    expect(text).toMatch(/✓ strong +ollama\/qwen2\.5:14b/);
    expect(text).toContain("default model: ollama/qwen2.5:7b");
  });

  it("never keeps a default that is not listed (llama3.1 in a clean machine), and says what it chose instead", async () => {
    const o = await fakeOllama({ "qwen2.5:7b": { tools: true, size: "7.6B" } });
    try {
      const m = await loadModels(nothing({ providers: { ollama: { baseUrl: `http://127.0.0.1:${o.port}`, defaultModel: "llama3.1" } } as unknown as JigConfig["providers"] }));
      const notes = await m.prepare({ found: [] });
      expect(m.defaultRef).toBe("ollama/qwen2.5:7b");
      expect(notes).toEqual(["ollama/llama3.1 is not listed by ollama, so ollama/qwen2.5:7b is the default (ollama pull llama3.1 gets it)"]);
      // A model named on the command line is used as asked, and said to be missing.
      const asked = await loadModels(nothing({ providers: { ollama: { baseUrl: `http://127.0.0.1:${o.port}` } } as unknown as JigConfig["providers"] }), { model: "llama3.1" });
      expect(await asked.prepare({ found: [] })).toEqual(["ollama/llama3.1 is not listed by ollama: it is used as you asked, and may not answer"]);
      expect(asked.defaultRef).toBe("ollama/llama3.1");
    } finally {
      await close(o.s);
    }
  });

  it("guides the person when there is no model at all, and takes a server's address, told apart by its answer", async () => {
    const o = await fakeOllama({ "qwen2.5:7b": { tools: true, size: "7.6B" } });
    const configDir = await mkdtemp(join(tmpdir(), "jig-first-config-"));
    const dir = await mkdtemp(join(tmpdir(), "jig-first-"));
    const saved = process.env.JIG_CONFIG_DIR;
    process.env.JIG_CONFIG_DIR = configDir;
    try {
      const closed = { ...LOCAL_SERVERS[0], port: 9 };
      const configOf = async () => nothing({ providers: (readUserConfig().providers ?? { ollama: { baseUrl: "http://127.0.0.1:9" } }) as JigConfig["providers"] });
      const ctrl = new SessionController({
        workingDir: dir,
        models: await loadModels(await configOf()),
        storage: null,
        discovery: { servers: [closed], timeoutMs: 200 },
        reloadModels: async () => loadModels(await configOf()),
        addServer,
        permissions: { mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [dir] },
      });
      await ctrl.load();
      const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 120, rows: 40 }} fps={50} />);
      const frame = () => (app.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
      const wait = async (f: () => boolean) => {
        for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 20));
        if (!f()) throw new Error(`timed out:\n${frame()}`);
      };
      await ctrl.prepare();
      await wait(() => /Jig found no model to run on/.test(frame()));
      expect(frame()).toMatch(/install Ollama .*https:\/\/ollama\.com\/download/);
      expect(frame()).toMatch(/add a cloud key .*hidden, kept in your keychain/);
      app.stdin.write("3");
      await wait(() => /The server's address/.test(frame()));
      app.stdin.write(`127.0.0.1:${o.port}`);
      await new Promise((r) => setTimeout(r, 50));
      app.stdin.write("\r");
      await wait(() => /ollama saved: http:\/\/127\.0\.0\.1:\d+, 1 model/.test(frame()));
      expect((readUserConfig().providers as Record<string, { baseUrl: string; kind: string }>).ollama).toMatchObject({ kind: "ollama", baseUrl: `http://127.0.0.1:${o.port}` });
      await wait(() => ctrl.models.defaultRef === "ollama/qwen2.5:7b");
      app.unmount();
    } finally {
      if (saved === undefined) delete process.env.JIG_CONFIG_DIR;
      else process.env.JIG_CONFIG_DIR = saved;
      await close(o.s);
      await rm(configDir, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("names a role whose model cannot use its tools before the run", async () => {
    const o = await fakeOllama({ "gemma2:2b": { tools: false, size: "2.6B" } });
    const dir = await mkdtemp(join(tmpdir(), "jig-tools-"));
    try {
      const models = await loadModels(nothing({ providers: { ollama: { baseUrl: `http://127.0.0.1:${o.port}` } } as unknown as JigConfig["providers"] }));
      await models.prepare({ found: [] });
      const ctrl = new SessionController({ workingDir: dir, models, storage: null, guide: false, permissions: { mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [dir] } });
      await ctrl.load();
      const warnings = ctrl.toolWarnings(ctrl.configured(ctrl.topology!));
      expect(warnings[0]).toBe("Do has tools (file_read, file_write, shell, glob, grep, git), but ollama/gemma2:2b cannot use them: it will answer without acting. /models gives it one that can.");
      expect(warnings[1]).toMatch(/^Check has tools \(.*\), but ollama\/gemma2:2b cannot use them/);
      expect(warnings).toHaveLength(2);
    } finally {
      await close(o.s);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the privacy boundary", () => {
  const cloudAndLocal = (privacy?: "local-only"): JigConfig =>
    ({
      loop: { provider: "ollama" },
      providers: {
        ollama: { baseUrl: "http://127.0.0.1:9", defaultModel: "q" },
        openai: { kind: "openai", key: "env:JIG_TEST_KEY", defaultModel: "gpt-x" },
      },
      storage: {},
      logging: { level: "error" },
      brains: { fast: ["ollama/q", "openai/gpt-x"], strong: ["openai/gpt-x", "ollama/q"], open: ["ollama/q", "openai/gpt-x"] },
      crossToCloud: ["open"],
      ...(privacy ? { privacy } : {}),
    }) as unknown as JigConfig;

  it("never lets a local server that is down fall silently to the cloud, unless the brain says crossToCloud", async () => {
    process.env.JIG_TEST_KEY = SECRET;
    const m = await loadModels(cloudAndLocal());
    // Ollama at port 9 is down: fast stops at the boundary, before openai is ever made.
    await expect(m.provider("fast").chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/does not let a local model's work fall to the cloud \(openai\/gpt-x is next\)/);
    expect(m.crossToCloud).toEqual(["open"]);
    expect(m.isLocalRef("ollama/q")).toBe(true);
    expect(m.isLocalRef("openai/gpt-x")).toBe(false);
  });

  it("keeps a local-only project on local models: cloud entries refused with the reason, brains local, and both lists say so", async () => {
    process.env.JIG_TEST_KEY = SECRET;
    const m = await loadModels(cloudAndLocal("local-only"));
    await m.prepare({ found: [] });
    expect(m.localOnly).toBe(true);
    expect(Object.values(m.brainsNow).flat().every((r) => r.startsWith("ollama/"))).toBe(true);
    expect(() => m.provider("openai/gpt-x")).toThrow(/openai is a cloud provider, and this project is local-only/);
    const dir = await mkdtemp(join(tmpdir(), "jig-local-only-"));
    const ctrl = new SessionController({ workingDir: dir, models: m, storage: null, guide: false, permissions: { mode: "default", rules: { allow: [], ask: [], deny: [] }, workingDirs: [dir] } });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 140, rows: 40 }} fps={50} />);
    const frame = () => (app.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ");
    app.stdin.write("/providers list\r");
    await new Promise((r) => setTimeout(r, 200));
    expect(frame()).toMatch(/openai .* cloud: refused here, this project is local-only/);
    app.stdin.write("/brains list\r");
    await new Promise((r) => setTimeout(r, 200));
    expect(frame()).toMatch(/this project is local-only: every brain runs on local models/);
    app.unmount();
    await rm(dir, { recursive: true, force: true });
  });

  it("shows in /brains where a chain stops before the cloud, and where a brain may cross", async () => {
    process.env.JIG_TEST_KEY = SECRET;
    const dir = await mkdtemp(join(tmpdir(), "jig-boundary-"));
    const ctrl = new SessionController({ workingDir: dir, models: await loadModels(cloudAndLocal()), storage: null, guide: false });
    await ctrl.load();
    const app = render(<App ctrl={ctrl} version="0.1.0" splash={false} size={{ columns: 160, rows: 40 }} fps={50} />);
    app.stdin.write("/brains list\r");
    await new Promise((r) => setTimeout(r, 200));
    const frame = (app.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    expect(frame).toMatch(/fast +ollama\/q {2}⇢ {2}openai\/gpt-x \(cloud\)/);
    expect(frame).toMatch(/stops before the cloud: a fallback from ollama\/q never goes on to a cloud model unless the brain says crossToCloud/);
    expect(frame).toMatch(/may fall from a local model to the cloud: this brain says crossToCloud/);
    app.unmount();
    await rm(dir, { recursive: true, force: true });
  });
});
