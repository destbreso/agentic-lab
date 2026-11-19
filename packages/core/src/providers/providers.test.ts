// Provider entries and brains: keys by reference and never written anywhere,
// each key only to its own host, live model lists, chains that fall back only
// when a provider is unavailable and stay there for the run, the fallback
// recorded and shown, and the chains kept in a topology file.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entriesOf, entryProvider, listEntryModels, resolveKey, splitCommand, testEntry, type ProviderEntry } from "./entries.js";
import { chainOf, chainProvider, defaultBrains, unavailability, UnavailableModel, type Fallback } from "./brains.js";
import { clearSecrets, redact } from "./secrets.js";
import { ModelCallTimeoutError } from "./call-limits.js";
import { createLogger } from "../utils/logger.js";
import { AgentSession, type SessionEvent } from "../engine/agent-session.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { getRecipe } from "../loops/recipes.js";
import { drawingOf, footer, foldRun, horizontal, toText } from "../grid/index.js";
import { readTopologyText, writeTopologyText } from "../formats/index.js";
import type { ChatCompletionResult, LLMProvider } from "../types/llm.js";

/** A fake OpenAI-compatible server: records each request's path and Authorization, answers by script. */
function fakeServer(answer: (path: string, body: Record<string, unknown>) => { status?: number; json: unknown }): Promise<{ url: string; seen: Array<{ path: string; auth?: string }>; close(): Promise<void> }> {
  const seen: Array<{ path: string; auth?: string }> = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", ...(req.headers.authorization ? { auth: String(req.headers.authorization) } : {}) });
      const a = answer(req.url ?? "", raw ? JSON.parse(raw) : {});
      res.writeHead(a.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(a.json));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}/v1`, seen, close: () => new Promise((r) => server.close(() => r())) });
    }),
  );
}
const completion = (content: string, model = "m") => ({ id: "c", object: "chat.completion", created: 0, model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });

afterEach(() => clearSecrets());

describe("provider entries", () => {
  it("reads named entries of any kind, several of one kind, presets with their base URL and key variable", () => {
    const entries = entriesOf({
      ollama: { baseUrl: "http://a:11434", defaultModel: "qwen2.5:7b" },
      "gpu-box": { kind: "ollama", baseUrl: "http://b:11434" },
      groq: {},
      studio: { preset: "lmstudio" },
      google: { apiKey: "x" },
      weird: { kind: "nope" },
    });
    expect(entries.map((e) => [e.name, e.kind, e.baseUrl ?? "", e.key ?? ""])).toEqual([
      ["ollama", "ollama", "http://a:11434", ""],
      ["gpu-box", "ollama", "http://b:11434", ""],
      ["groq", "openai-compatible", "https://api.groq.com/openai/v1", "env:GROQ_API_KEY"],
      ["studio", "openai-compatible", "http://localhost:1234/v1", ""],
      ["google", "gemini", "", ""],
    ]);
  });

  it("splits a helper's command line without a shell, quotes respected", () => {
    expect(splitCommand(`op read "op://vault/my key/credential"`)).toEqual(["op", "read", "op://vault/my key/credential"]);
    expect(splitCommand("security find-generic-password -w -s jig")).toEqual(["security", "find-generic-password", "-w", "-s", "jig"]);
  });

  it("finds a key by env:, keychain or command:, warns on a raw key and on a file others can read", async () => {
    const e = (key?: string, apiKey?: string): ProviderEntry => ({ name: "x", kind: "openai", ...(key ? { key } : {}), ...(apiKey ? { apiKey } : {}) });
    expect((await resolveKey(e("env:MY_KEY"), { MY_KEY: "sk-env-1234567890" })).key).toBe("sk-env-1234567890");
    expect((await resolveKey(e(), { OPENAI_API_KEY: "sk-default-123456" })).source).toBe("env:OPENAI_API_KEY");
    const fromHelper = await resolveKey(e(`command:${process.execPath} -e "process.stdout.write('sk-helper-1234567')"`), {});
    expect(fromHelper).toMatchObject({ key: "sk-helper-1234567", source: `command:${process.execPath}` });
    const kc = { Entry: class { constructor(readonly service: string, readonly account: string) {} getPassword() { return `sk-keychain-${this.service}-${this.account}`; } setPassword() {} deletePassword() { return true; } } };
    expect((await resolveKey(e("keychain"), {}, undefined, { keychain: () => kc })).key).toBe("sk-keychain-jig-x");
    expect((await resolveKey(e("keychain"), {}, undefined, { keychain: () => null })).warnings[0]).toMatch(/keychain library .* is not installed/);
    const dir = await mkdtemp(join(tmpdir(), "jig-keys-"));
    const file = join(dir, "config.json");
    await writeFile(file, "{}");
    await chmod(file, 0o644);
    const raw = await resolveKey(e(undefined, "sk-raw-written-123"), {}, file);
    expect(raw.key).toBe("sk-raw-written-123");
    expect(raw.warnings.join("\n")).toMatch(/written in clear[\s\S]*can be read by other users/);
    await rm(dir, { recursive: true, force: true });
  });

  it("sends each key only to its own entry's host, and lists and tests models live", async () => {
    const a = await fakeServer((path) => (path.endsWith("/models") ? { json: { data: [{ id: "a-1" }, { id: "a-2" }] } } : { json: completion("ok") }));
    const b = await fakeServer(() => ({ json: completion("ok") }));
    const ea: ProviderEntry = { name: "a", kind: "openai-compatible", baseUrl: a.url };
    const eb: ProviderEntry = { name: "b", kind: "openai-compatible", baseUrl: b.url };
    expect(await listEntryModels(ea, "sk-aaaaaaaaaaaa")).toEqual(["a-1", "a-2"]);
    const t = await testEntry(ea, "a-1", "sk-aaaaaaaaaaaa");
    expect(t).toMatchObject({ ok: true, detail: expect.stringContaining('a-1 answered "ok"') });
    expect(t.ms).toBeGreaterThanOrEqual(0);
    await entryProvider(eb, "b-1", "sk-bbbbbbbbbbbb").chat({ messages: [{ role: "user", content: "hi" }] });
    expect(a.seen.every((s) => s.auth === "Bearer sk-aaaaaaaaaaaa")).toBe(true);
    expect(b.seen.map((s) => s.auth)).toEqual(["Bearer sk-bbbbbbbbbbbb"]);
    await a.close();
    await b.close();
  });

  it("asks Anthropic, OpenAI and Gemini for their model lists the way each one wants", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchMock = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return new Response(JSON.stringify({ data: [{ id: url.includes("generativelanguage") ? "models/gemini-x" : "m-1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await listEntryModels({ name: "claude", kind: "anthropic" }, "sk-ant-1234567", fetchMock)).toEqual(["m-1"]);
    expect(await listEntryModels({ name: "oa", kind: "openai" }, "sk-oa-12345678", fetchMock)).toEqual(["m-1"]);
    expect(await listEntryModels({ name: "gem", kind: "gemini" }, "gm-1234567890", fetchMock)).toEqual(["gemini-x"]);
    expect(calls[0]).toMatchObject({ url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": "sk-ant-1234567", "anthropic-version": "2023-06-01" } });
    expect(calls[1]).toMatchObject({ url: "https://api.openai.com/v1/models", headers: { authorization: "Bearer sk-oa-12345678" } });
    expect(calls[2].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
  });
});

/** A provider that fails with `error` or answers `content`, counting its calls. */
function fake(name: string, behave: { error?: unknown; content?: string }): LLMProvider & { calls: number } {
  const p = {
    name,
    calls: 0,
    async chat(): Promise<ChatCompletionResult> {
      p.calls++;
      if (behave.error) throw behave.error;
      return { message: { role: "assistant", content: behave.content ?? "fine" }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, finishReason: "stop", model: name };
    },
    listModels: async () => [name],
    healthCheck: async () => true,
  };
  return p;
}

describe("brains", () => {
  it("resolves a brain, a model, and a chain of the role's own", () => {
    const brains = { strong: ["anthropic/claude-x", "ollama/qwen2.5:14b"] };
    expect(chainOf("strong", brains)).toEqual(["anthropic/claude-x", "ollama/qwen2.5:14b"]);
    expect(chainOf("ollama/qwen2.5:7b", brains)).toEqual(["ollama/qwen2.5:7b"]);
    expect(chainOf(["openai/gpt-x", "strong"], brains)).toEqual(["openai/gpt-x", "anthropic/claude-x", "ollama/qwen2.5:14b"]);
    expect(() => chainOf("nope", brains)).toThrow(/no brain named nope/);
  });

  it("ships brains that resolve to what is configured: with only Ollama, every brain is the local model", () => {
    const brains = defaultBrains([{ name: "ollama", kind: "ollama", defaultModel: "qwen2.5:7b", local: true }], "ollama/qwen2.5:7b");
    for (const chain of Object.values(brains)) expect(chain).toEqual(["ollama/qwen2.5:7b"]);
    const both = defaultBrains([{ name: "ollama", kind: "ollama", defaultModel: "q", local: true }, { name: "claude", kind: "anthropic", defaultModel: "c", local: false }], "ollama/q");
    expect(both.strong).toEqual(["claude/c", "ollama/q"]);
    expect(both.fast).toEqual(["ollama/q", "claude/c"]);
  });

  const triggers: Array<[string, unknown]> = [
    ["no entry", new UnavailableModel("no-entry", "no provider named x")],
    ["no key", new UnavailableModel("no-key", "x has no key")],
    ["connection refused", Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" })],
    ["timeout", new ModelCallTimeoutError("x", 1000)],
    ["5xx after the retries", Object.assign(new Error("Internal Server Error"), { status: 503 })],
    ["429 after its retry window", Object.assign(new Error("Too Many Requests"), { status: 429 })],
    ["model not found", Object.assign(new Error('model "qwen9" not found, try pulling it first'), {})],
  ];
  it.each(triggers)("falls back on %s", async (_name, error) => {
    const first = fake("a", { error });
    const second = fake("b", { content: "from b" });
    const seen: Fallback[] = [];
    const p = chainProvider(["x/a", "y/b"], (ref) => (ref === "x/a" ? first : second), { onFallback: (f) => seen.push(f) });
    const r = await p.chat({ messages: [] });
    expect(r.message.content).toBe("from b");
    expect(r.route).toMatchObject({ chain: ["x/a", "y/b"], answeredBy: "y/b", fallbacks: [{ from: "x/a", to: "y/b" }] });
    expect(seen[0].reason).toBe(unavailability(error));
  });

  it("never falls back on a bad, empty or unreadable answer, nor on a refused key", async () => {
    for (const behave of [{ content: "" }, { content: "{{{ not json" }, { error: Object.assign(new Error("Unauthorized"), { status: 401 }) }]) {
      const first = fake("a", behave);
      const second = fake("b", { content: "from b" });
      const p = chainProvider(["x/a", "y/b"], (ref) => (ref === "x/a" ? first : second));
      await p.chat({ messages: [] }).catch(() => null);
      expect(second.calls, JSON.stringify(behave)).toBe(0);
    }
  });

  it("stays on the fallback for the rest of the run, and starts from the top in the next", async () => {
    const first = fake("a", { error: Object.assign(new Error("down"), { status: 500 }) });
    const second = fake("b", {});
    const make = (ref: string) => (ref === "x/a" ? first : second);
    const run1 = chainProvider(["x/a", "y/b"], make);
    await run1.chat({ messages: [] });
    await run1.chat({ messages: [] });
    expect([first.calls, second.calls]).toEqual([1, 2]);
    expect(run1.current()).toBe("y/b");
    const run2 = chainProvider(["x/a", "y/b"], make);
    await run2.chat({ messages: [] });
    expect(first.calls).toBe(2);
  });

  it("records the fallback on the step, lists it at the run's end, and marks the box and the footer", async () => {
    const t = structuredClone(getRecipe("exec-eval")!);
    t.nodes[0].config = { ...t.nodes[0].config, brain: { chain: ["gone/a", "ollama/b"] } };
    const ok = fake("b", { content: '{"verdict":"pass","evidence":[],"corrections":[],"confidence":1}' });
    const down = fake("a", { error: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    const events: SessionEvent[] = [];
    const session = new AgentSession({
      provider: ok,
      providerFactory: (brain) => chainProvider(brain.chain ?? [], (ref) => (ref === "gone/a" ? down : ok)),
      tools: createDefaultToolkit(),
      topology: t,
      workingDir: tmpdir(),
      delayMs: 0,
      maxRounds: 1,
    });
    session.on("event", (e) => events.push(e));
    const run = await session.run("t");
    const exec = run.steps.find((s) => s.role === "exec")!;
    expect(exec.calls[0].route).toMatchObject({ chain: ["gone/a", "ollama/b"], answeredBy: "ollama/b", fallbacks: [{ from: "gone/a", to: "ollama/b", reason: "connection" }] });
    expect(events.find((e) => e.type === "run:end")).toMatchObject({ fallbacks: [{ role: "exec", from: "gone/a", to: "ollama/b", reason: "connection" }] });
    let n = 0;
    const state = foldRun(events, () => (n += 1000));
    const d = drawingOf(t, { model: "a" });
    expect(toText(horizontal(d, state))).toContain("↪ b");
    expect(toText(footer(d, state, 160))).toMatch(/> do ↪ b \[done\]/);
  });

  it("keeps a role's brain or chain through a topology file, and Agent Spec stays valid", () => {
    const t = structuredClone(getRecipe("deep-reasoning")!);
    t.nodes[0].config = { ...t.nodes[0].config, brain: { brain: "strong" } };
    t.nodes[1].config = { ...t.nodes[1].config, brain: { chain: ["claude/sonnet", "ollama/qwen2.5:7b"] } };
    for (const syntax of ["yaml", "json"] as const) {
      const text = writeTopologyText(t, { syntax }).text;
      const back = readTopologyText(text, { filename: `x.${syntax}` });
      expect(back.losses).toEqual([]);
      expect(back.topology.nodes[0].config.brain).toEqual({ brain: "strong" });
      expect(back.topology.nodes[1].config.brain).toEqual({ chain: ["claude/sonnet", "ollama/qwen2.5:7b"] });
      expect(text).toMatch(/model_id: sonnet|"model_id": "sonnet"/);
    }
  });
});

describe("a key never lands anywhere", () => {
  let server: Awaited<ReturnType<typeof fakeServer>>;
  beforeAll(async () => {
    server = await fakeServer(() => ({ json: completion("Done.") }));
  });
  afterAll(() => server.close());

  it.each([
    ["env:", "env:SECRET_FOR_TEST"],
    ["command:", `command:${process.execPath} -e "process.stdout.write('sk-from-a-helper-424242')"`],
    ["keychain", "keychain"],
    ["a raw key in the file", ""],
  ])("from %s: not in the run's steps, its record, a log or an error", async (_n, ref) => {
    const secret = ref === "keychain" ? "sk-from-the-keychain-4242" : ref.startsWith("command:") ? "sk-from-a-helper-424242" : ref ? "sk-from-the-env-4242424" : "sk-written-in-clear-4242";
    const entry: ProviderEntry = { name: "fake", kind: "openai-compatible", baseUrl: server.url, ...(ref ? { key: ref } : { apiKey: secret }) };
    const kc = { Entry: class { getPassword() { return secret; } setPassword() {} deletePassword() { return true; } } };
    const { key } = await resolveKey(entry, { SECRET_FOR_TEST: secret }, undefined, { keychain: () => kc as never });
    expect(key).toBe(secret);
    const dir = await mkdtemp(join(tmpdir(), "jig-secret-"));
    const logFile = join(dir, "log.txt");
    const logger = createLogger({ level: "debug", logFile });
    logger.info(`a careless line with ${secret} in it`);
    const session = new AgentSession({ provider: entryProvider(entry, "m", key), tools: createDefaultToolkit(), topology: "exec-eval", workingDir: dir, delayMs: 0, maxRounds: 1 });
    const run = await session.run("say done");
    await writeFile(join(dir, "steps.json"), JSON.stringify(run.steps));
    await new Promise((r) => setTimeout(r, 50));
    expect(server.seen.at(-1)?.auth).toBe(`Bearer ${secret}`);
    for (const f of await readdir(dir)) expect(await readFile(join(dir, f), "utf-8"), f).not.toContain(secret);
    expect(redact(`Error: 401 for ${secret}`)).toBe("Error: 401 for [redacted]");
    await rm(dir, { recursive: true, force: true });
  });
});
