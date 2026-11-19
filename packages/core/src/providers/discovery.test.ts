// Discovery of the model servers on this machine: fake servers on free ports
// answer as Ollama and as OpenAI-compatible servers; a closed port and a
// slow server are left out within the timeout; two servers answer at once;
// a server is named by what it says owns its models; and nothing beyond
// 127.0.0.1 is ever asked, OLLAMA_HOST pointing elsewhere included.

import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { discoverLocal, discoverySummary, ollamaPort, serverKey, LOCAL_SERVERS, type LocalServer } from "./discovery.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A server on a free port of 127.0.0.1 answering one path, after a delay. */
async function serve(path: string, body: unknown, delayMs = 0): Promise<number> {
  const s = http.createServer((req, res) => {
    setTimeout(() => {
      if (req.url !== path) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    }, delayMs);
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return (s.address() as AddressInfo).port;
}

/** A port nothing listens on: one a server had and gave back. */
async function closedPort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

const as = (name: string, port: number): LocalServer => ({ ...LOCAL_SERVERS.find((s) => s.name === name)!, port });

describe("discovering local model servers", () => {
  it("finds an Ollama and an OpenAI-compatible server answering at once, with their live models", async () => {
    const ollama = await serve("/api/tags", { models: [{ name: "qwen2.5:7b" }, { name: "llama3.1:8b" }] });
    const studio = await serve("/v1/models", { data: [{ id: "qwen2.5-coder-7b", owned_by: "organization_owner" }] });
    const found = await discoverLocal({ servers: [as("ollama", ollama), as("lmstudio", studio)] });
    expect(found).toEqual([
      expect.objectContaining({ name: "ollama", kind: "ollama", baseUrl: `http://127.0.0.1:${ollama}`, models: ["qwen2.5:7b", "llama3.1:8b"] }),
      expect.objectContaining({ name: "lmstudio", kind: "openai-compatible", baseUrl: `http://127.0.0.1:${studio}/v1`, models: ["qwen2.5-coder-7b"] }),
    ]);
    expect(discoverySummary(found)).toBe("ollama up (2 models) ∙ lmstudio up (1)");
  });

  it("leaves out a closed port and a server slower than the timeout, and is never slower than it", async () => {
    const slow = await serve("/v1/models", { data: [{ id: "x" }] }, 1500);
    const closed = await closedPort();
    const started = Date.now();
    const found = await discoverLocal({ servers: [as("vllm", slow), as("jan", closed)], timeoutMs: 200 });
    expect(found).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(discoverySummary(found)).toBe("no local model server found");
  });

  it("names a server on a shared port by what it says owns its models, and ignores an answer that is not a model list", async () => {
    const vllm = await serve("/v1/models", { data: [{ id: "meta-llama/Llama-3.1-8B", owned_by: "vllm" }] });
    const other = await serve("/v1/models", { hello: "world" });
    const found = await discoverLocal({ servers: [as("llamacpp", vllm), as("koboldcpp", other)] });
    expect(found.map((d) => [d.name, d.label])).toEqual([["vllm", "vLLM"]]);
  });

  it("never asks anything but 127.0.0.1, whatever OLLAMA_HOST says", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      throw new Error("refused");
    }) as unknown as typeof fetch;
    await discoverLocal({ fetchImpl, env: { OLLAMA_HOST: "http://192.168.1.20:11434" } });
    await discoverLocal({ fetchImpl, env: { OLLAMA_HOST: "0.0.0.0:11500" } });
    expect(asked.length).toBe(LOCAL_SERVERS.length * 2);
    expect(asked.every((u) => u.startsWith("http://127.0.0.1:"))).toBe(true);
    expect(asked).toContain("http://127.0.0.1:11500/api/tags");
    expect(ollamaPort({ OLLAMA_HOST: "http://192.168.1.20:11434" })).toBeNull();
    expect(ollamaPort({ OLLAMA_HOST: "localhost" })).toBe(11434);
  });

  it("treats localhost and 127.0.0.1 as the same server", () => {
    expect(serverKey("http://localhost:11434")).toBe(serverKey("http://127.0.0.1:11434/"));
    expect(serverKey("http://localhost:1234/v1")).toBe("127.0.0.1:1234");
    expect(serverKey("https://api.openai.com/v1")).toBe("api.openai.com:443");
  });
});
