// The model catalog: capabilities read from the provider where it says them
// (Ollama's /api/show, OpenRouter's /models), from the bundled table
// otherwise, marked; and the brains and the default chosen only from what is
// listed, by the stated rule.

import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { brainsFromCatalog, buildCatalog, fromTable, parseParams, type ModelInfo } from "./catalog.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function fakeOllama(models: Record<string, { capabilities: string[]; context: number; size: string }>): Promise<string> {
  const s = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url !== "/api/show") return res.writeHead(404).end();
      const m = models[JSON.parse(raw).model];
      if (!m) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ capabilities: m.capabilities, model_info: { "general.architecture": "x", "x.context_length": m.context }, details: { parameter_size: m.size } }));
    });
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

const info = (ref: string, over: Partial<ModelInfo>): ModelInfo => ({ ref, entry: ref.split("/")[0], model: ref.split("/")[1], local: true, tools: true, source: "provider", ...over });

describe("the model catalog", () => {
  it("reads tools, context and size from Ollama's /api/show, and marks a model it cannot read from the table", async () => {
    const base = await fakeOllama({
      "qwen2.5:7b": { capabilities: ["completion", "tools"], context: 32768, size: "7.6B" },
      "gemma2:2b": { capabilities: ["completion"], context: 8192, size: "2.6B" },
    });
    const cat = await buildCatalog([{ name: "ollama", kind: "ollama", baseUrl: base, local: true, models: ["qwen2.5:7b", "gemma2:2b", "llama3.1:8b", "mystery:1b"] }]);
    expect(cat).toEqual([
      { ref: "ollama/qwen2.5:7b", entry: "ollama", model: "qwen2.5:7b", local: true, tools: true, context: 32768, params: 7.6, source: "provider" },
      { ref: "ollama/gemma2:2b", entry: "ollama", model: "gemma2:2b", local: true, tools: false, context: 8192, params: 2.6, source: "provider" },
      { ref: "ollama/llama3.1:8b", entry: "ollama", model: "llama3.1:8b", local: true, tools: true, context: 128000, source: "table" },
      { ref: "ollama/mystery:1b", entry: "ollama", model: "mystery:1b", local: true, tools: null, source: "unknown" },
    ]);
  });

  it("reads OpenRouter's context, price and tool use", async () => {
    const s = http.createServer((req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "anthropic/claude-x", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["tools", "temperature"] }] })));
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const cat = await buildCatalog([{ name: "openrouter", kind: "openrouter", baseUrl: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1`, local: false, models: ["anthropic/claude-x"] }]);
    expect(cat[0]).toMatchObject({ ref: "openrouter/anthropic/claude-x", local: false, tools: true, context: 200000, source: "provider" });
    expect(cat[0].price!.input).toBeCloseTo(3);
    expect(cat[0].price!.output).toBeCloseTo(15);
  });

  it("knows a few families from its own table, and nothing it is not sure of", () => {
    expect(fromTable("claude-sonnet-4-20250514")).toMatchObject({ tools: true });
    expect(fromTable("deepseek-r1:8b")).toMatchObject({ tools: false });
    expect(fromTable("something-new")).toBeNull();
    expect(parseParams("500M")).toBe(0.5);
  });

  it("builds the brains and the default only from what is listed, by the stated rule", () => {
    const cat = [
      info("ollama/qwen2.5:14b", { params: 14.8 }),
      info("ollama/qwen2.5:7b", { params: 7.6 }),
      info("ollama/gemma2:2b", { params: 2.6, tools: false }),
      info("openai/gpt-4o", { local: false, context: 128000 }),
      info("anthropic/claude-x", { local: false, context: 200000 }),
    ];
    const { brains, defaultRef } = brainsFromCatalog(cat);
    expect(brains.local).toEqual(["ollama/qwen2.5:14b", "ollama/qwen2.5:7b", "ollama/gemma2:2b"]);
    expect(brains.fast).toEqual(["ollama/qwen2.5:7b", "ollama/qwen2.5:14b", "ollama/gemma2:2b", "anthropic/claude-x", "openai/gpt-4o"]);
    expect(brains.strong).toEqual(["anthropic/claude-x", "openai/gpt-4o", "ollama/qwen2.5:14b", "ollama/qwen2.5:7b", "ollama/gemma2:2b"]);
    expect(defaultRef).toBe("ollama/qwen2.5:14b");
    // The person's own default wins when it is listed, and is ignored when it is not.
    expect(brainsFromCatalog(cat, { preferred: "ollama/qwen2.5:7b" }).defaultRef).toBe("ollama/qwen2.5:7b");
    expect(brainsFromCatalog(cat, { preferred: "ollama/llama3.1" }).defaultRef).toBe("ollama/qwen2.5:14b");
    // Nothing listed, nothing chosen.
    expect(brainsFromCatalog([])).toEqual({ brains: {}, defaultRef: null });
    // Cloud only: the default is the strongest cloud model.
    expect(brainsFromCatalog(cat.filter((m) => !m.local)).defaultRef).toBe("anthropic/claude-x");
  });
});
