// Every provider sends a default output limit, times a call out, and stops
// when its signal aborts. Each provider talks to a local HTTP server that
// records what it was sent and answers, stalls or never answers.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { DEFAULT_MAX_TOKENS, ModelCallTimeoutError } from "./call-limits.js";
import type { LLMProvider } from "../types/llm.js";

type Mode = "answer" | "stall";
let mode: Mode = "answer";
let received: Array<{ path: string; body: Record<string, unknown> }> = [];
let server: http.Server;
let base = "";

const ANSWERS: Record<string, unknown> = {
  "/api/chat": { model: "m", message: { role: "assistant", content: "hi" }, done: true, prompt_eval_count: 1, eval_count: 1 },
  "/v1/chat/completions": {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
  "/v1/messages": {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "m",
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      received.push({ path, body: raw ? JSON.parse(raw) : {} });
      if (mode === "stall") return; // never answer: the client must give up on its own
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(ANSWERS[path] ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  mode = "answer";
  received = [];
});

const providers: Array<[string, () => LLMProvider, (b: Record<string, unknown>) => unknown]> = [
  ["ollama", () => new OllamaProvider({ model: "m", baseUrl: base }), (b) => (b.options as Record<string, unknown>).num_predict],
  ["openai", () => new OpenAIProvider({ model: "m", apiKey: "k", baseUrl: `${base}/v1` }), (b) => b.max_tokens],
  ["anthropic", () => new AnthropicProvider({ model: "m", apiKey: "k", baseUrl: base }), (b) => b.max_tokens],
];

const ask = { messages: [{ role: "user" as const, content: "hello" }] };

describe.each(providers)("%s provider call limits", (_name, make, maxTokensOf) => {
  it("sends the default output limit when none is set", async () => {
    await make().chat(ask);
    expect(maxTokensOf(received[0].body)).toBe(DEFAULT_MAX_TOKENS);
  });

  it("times a stalled call out, once, without retrying", async () => {
    mode = "stall";
    const started = Date.now();
    await expect(make().chat({ ...ask, timeoutMs: 150 })).rejects.toBeInstanceOf(ModelCallTimeoutError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(received).toHaveLength(1);
  });

  it("stops when its signal aborts", async () => {
    mode = "stall";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    await expect(make().chat({ ...ask, signal: controller.signal, timeoutMs: 60_000 })).rejects.toSatisfy(
      (e: Error) => !(e instanceof ModelCallTimeoutError) && /abort/i.test(`${e.name} ${e.message}`),
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("ollama provider conversation", () => {
  it("sends the model's own tool calls back with the conversation", async () => {
    await new OllamaProvider({ model: "m", baseUrl: base }).chat({
      messages: [
        { role: "user", content: "read it" },
        { role: "assistant", content: "", toolCalls: [{ id: "1", name: "file_read", arguments: { path: "a" } }] },
        { role: "tool", content: "contents", toolCallId: "1" },
      ],
    });
    const messages = received[0].body.messages as Array<Record<string, unknown>>;
    expect(messages[1].tool_calls).toEqual([{ function: { name: "file_read", arguments: { path: "a" } } }]);
  });
});
