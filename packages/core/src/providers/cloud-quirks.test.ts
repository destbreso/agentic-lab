// What current cloud models refuse or need back, against fake servers that answer
// as the real APIs did when probed: Claude's current models refuse temperature,
// OpenAI's reasoning models refuse max_tokens, Gemini streams calls without an
// index, needs each call's thought signature back, and answers errors as arrays.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { forgetRefusedParams, refusedParam } from "./refused-params.js";
import { unavailability } from "./brains.js";
import { entriesOf, entryProvider } from "./entries.js";
import type { ChatMessage, ToolDefinition } from "../types/llm.js";

type Reply = { status?: number; body: unknown; sse?: string[] };
const servers: http.Server[] = [];

/** A server that records each request body and answers from the list in order. */
async function fake(replies: Array<Reply | ((body: Record<string, unknown>) => Reply)>): Promise<{ url: string; bodies: Array<Record<string, unknown>> }> {
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      bodies.push(body);
      const next = replies.shift();
      const reply = typeof next === "function" ? next(body) : next ?? { status: 500, body: { error: { message: "no reply left" } } };
      if (reply.sse) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const line of reply.sse) res.write(`data: ${line}\n\n`);
        res.end();
        return;
      }
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});
beforeEach(() => forgetRefusedParams());

const add: ToolDefinition = { name: "add", description: "Adds two numbers.", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } };
const completion = (message: Record<string, unknown>) => ({
  id: "c1",
  object: "chat.completion",
  created: 1,
  model: "m",
  choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message: { role: "assistant", content: null, ...message } }],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
});
const user = (content: string): ChatMessage => ({ role: "user", content });

describe("refusedParam", () => {
  it("reads the field from OpenAI's param, and from Anthropic's message", () => {
    expect(refusedParam({ status: 400, param: "max_tokens", message: "Unsupported parameter" }, ["temperature", "max_tokens"])).toBe("max_tokens");
    expect(refusedParam({ status: 400, message: "400 `temperature` is deprecated for this model." }, ["temperature"])).toBe("temperature");
  });

  it("ignores other errors, other statuses and fields the request did not send", () => {
    expect(refusedParam({ status: 400, message: "messages: field required" }, ["temperature"])).toBeNull();
    expect(refusedParam({ status: 429, param: "temperature" }, ["temperature"])).toBeNull();
    expect(refusedParam({ status: 400, message: "temperature is not supported" }, ["max_tokens"])).toBeNull();
    // max_completion_tokens in a message is not max_tokens.
    expect(refusedParam({ status: 400, message: "max_completion_tokens is not supported" }, ["max_tokens"])).toBeNull();
  });
});

describe("the OpenAI-compatible provider", () => {
  it("sends the limit as max_completion_tokens once the model refuses max_tokens, and remembers it", async () => {
    const server = await fake([
      { status: 400, body: { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: "invalid_request_error", param: "max_tokens", code: "unsupported_parameter" } } },
      { body: completion({ content: "Lima." }) },
      { body: completion({ content: "Lima again." }) },
    ]);
    const p = new OpenAIProvider({ model: "reasoner", apiKey: "k", baseUrl: server.url });
    const first = await p.chat({ messages: [user("Capital of Peru?")], maxTokens: 300 });
    expect(first.message.content).toBe("Lima.");
    expect(first.note).toMatch(/max_completion_tokens/);
    expect(server.bodies[1]).toMatchObject({ max_completion_tokens: 300 });
    expect(server.bodies[1]).not.toHaveProperty("max_tokens");
    const second = await p.chat({ messages: [user("Again?")], maxTokens: 300 });
    expect(second.note).toBeUndefined();
    expect(server.bodies).toHaveLength(3);
    expect(server.bodies[2]).toMatchObject({ max_completion_tokens: 300 });
  });

  it("leaves temperature out once the model refuses it", async () => {
    const server = await fake([
      { status: 400, body: { error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.", param: "temperature", code: "unsupported_value" } } },
      { body: completion({ content: "ok" }) },
    ]);
    const p = new OpenAIProvider({ model: "reasoner", apiKey: "k", baseUrl: server.url });
    const r = await p.chat({ messages: [user("hi")], temperature: 0.2 });
    expect(r.message.content).toBe("ok");
    expect(server.bodies[0]).toMatchObject({ temperature: 0.2 });
    expect(server.bodies[1]).not.toHaveProperty("temperature");
  });

  it("reads streamed calls that come whole and without an index, and sends their extra fields back to the same server only", async () => {
    const signature = { google: { thought_signature: "sig-1" } };
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
    const server = await fake([
      {
        body: null,
        sse: [
          chunk({ role: "assistant", tool_calls: [{ extra_content: signature, function: { arguments: '{"a":17,"b":25}', name: "add" }, id: "call_1", type: "function" }] }, "tool_calls"),
          chunk({ role: "assistant", tool_calls: [{ function: { arguments: '{"a":1,"b":2}', name: "add" }, id: "call_2", type: "function" }] }),
          "[DONE]",
        ],
      },
      { body: completion({ content: "42" }) },
    ]);
    const p = new OpenAIProvider({ model: "gemini-like", apiKey: "k", baseUrl: server.url });
    const r = await p.chat({ messages: [user("17 + 25?")], tools: [add], onText: () => {} });
    expect(r.message.toolCalls?.map((c) => [c.id, c.arguments])).toEqual([
      ["call_1", { a: 17, b: 25 }],
      ["call_2", { a: 1, b: 2 }],
    ]);
    expect(r.message.toolCalls?.[0].echo).toEqual({ provider: p.name, fields: { extra_content: signature } });

    const history: ChatMessage[] = [user("17 + 25?"), r.message, { role: "tool", content: "42", toolCallId: "call_1" }, { role: "tool", content: "3", toolCallId: "call_2" }];
    await p.chat({ messages: history, tools: [add] });
    const sent = (server.bodies[1].messages as Array<Record<string, unknown>>)[1].tool_calls as Array<Record<string, unknown>>;
    expect(sent[0]).toMatchObject({ id: "call_1", extra_content: signature });
    expect(sent[1]).not.toHaveProperty("extra_content");

    // Another provider never gets them.
    const other = await fake([{ body: completion({ content: "42" }) }]);
    await new OpenAIProvider({ model: "x", apiKey: "k", baseUrl: other.url, name: "elsewhere" }).chat({ messages: history, tools: [add] });
    expect(((other.bodies[0].messages as Array<Record<string, unknown>>)[1].tool_calls as Array<Record<string, unknown>>)[0]).not.toHaveProperty("extra_content");
  });

  it("joins pieces of one streamed call that carry an index, as OpenAI sends them", async () => {
    const chunk = (delta: Record<string, unknown>) => JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: null }] });
    const server = await fake([
      {
        body: null,
        sse: [
          chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "add", arguments: '{"a":' } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: "4,\"b\":5}" } }] }),
          "[DONE]",
        ],
      },
    ]);
    const r = await new OpenAIProvider({ model: "m", apiKey: "k", baseUrl: server.url }).chat({ messages: [user("4 + 5?")], tools: [add], onText: () => {} });
    expect(r.message.toolCalls).toEqual([{ id: "c1", name: "add", arguments: { a: 4, b: 5 } }]);
  });

  it("takes a server that is down for a connection failure, through Node's fetch too, so a brain falls back from it", async () => {
    const closed = await fake([]);
    servers.splice(0).forEach((s) => s.close());
    await new Promise((r) => setTimeout(r, 50));
    for (const name of ["google", undefined]) {
      const p = new OpenAIProvider({ model: "m", apiKey: "k", baseUrl: closed.url, ...(name ? { name } : {}) });
      const err = await p.chat({ messages: [user("hi")] }).catch((e: unknown) => e);
      expect(unavailability(err), name ?? "openai").toBe("connection");
    }
    const deep = Object.assign(new Error("Connection error."), { cause: new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) }) });
    expect(unavailability(deep)).toBe("connection");
  });

  it("says what the server said when it answers an error as an array", async () => {
    const server = await fake([{ status: 400, body: [{ error: { code: 400, message: "Please pass a valid API key", status: "INVALID_ARGUMENT" } }] }]);
    const p = new OpenAIProvider({ model: "m", apiKey: "bad", baseUrl: server.url, name: "google" });
    await expect(p.chat({ messages: [user("hi")] })).rejects.toThrow(/Please pass a valid API key/);
  });
});

describe("the OpenAI provider on the Responses API", () => {
  const response = (output: unknown[], extra: Record<string, unknown> = {}) => ({ id: "resp_1", object: "response", status: "completed", model: "gpt-x", output, usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 }, ...extra });
  const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc-abc" };
  const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "add", arguments: '{"a":17,"b":25}', status: "completed" };

  it("reasons at a set effort with nothing stored, and sends the turn's encrypted reasoning back with its call", async () => {
    const server = await fake([{ body: response([reasoning, call]) }, { body: response([{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "42", annotations: [] }] }]) }]);
    const p = new OpenAIProvider({ model: "gpt-x", apiKey: "k", baseUrl: server.url, api: "responses" });
    const r = await p.chat({ messages: [{ role: "system", content: "You are Do." }, user("17 + 25?")], tools: [add], maxTokens: 300 });
    expect(server.bodies[0]).toMatchObject({
      model: "gpt-x",
      instructions: "You are Do.",
      input: [{ role: "user", content: "17 + 25?" }],
      tools: [{ type: "function", name: "add", parameters: add.parameters }],
      max_output_tokens: 300,
      store: false,
      reasoning: { effort: "low" },
      include: ["reasoning.encrypted_content"],
    });
    expect(r.finishReason).toBe("tool_calls");
    expect(r.message.toolCalls).toEqual([{ id: "call_1", name: "add", arguments: { a: 17, b: 25 } }]);

    const final = await p.chat({ messages: [{ role: "system", content: "You are Do." }, user("17 + 25?"), r.message, { role: "tool", content: "42", toolCallId: "call_1" }], tools: [add] });
    expect(server.bodies[1].input).toEqual([{ role: "user", content: "17 + 25?" }, reasoning, call, { type: "function_call_output", call_id: "call_1", output: "42" }]);
    expect(final.message.content).toBe("42");
    expect(final.message.providerItems).toBeUndefined();
  });

  it("takes the reasoning effort from a provider entry of the person's config", async () => {
    const server = await fake([{ body: response([]) }]);
    const [entry] = entriesOf({ openai: { baseUrl: server.url, reasoningEffort: "medium" } });
    expect(entry.reasoningEffort).toBe("medium");
    expect(entriesOf({ openai: { reasoningEffort: "extreme" } })[0].reasoningEffort).toBeUndefined();
    await (entryProvider(entry, "gpt-x", "k") as OpenAIProvider).chat({ messages: [user("hi")] }).catch(() => {});
    // An entry's own server speaks Chat Completions unless it is OpenAI's: the effort reaches the Responses path only there.
    expect(server.bodies[0]).not.toHaveProperty("reasoning");
    const responses = await fake([{ body: response([]) }]);
    await new OpenAIProvider({ model: "gpt-x", apiKey: "k", baseUrl: responses.url, api: "responses", reasoningEffort: entry.reasoningEffort }).chat({ messages: [user("hi")] });
    expect(responses.bodies[0]).toMatchObject({ reasoning: { effort: "medium" } });
  });

  it("learns that a model takes no reasoning effort or no temperature, and asks without them", async () => {
    const server = await fake([
      { status: 400, body: { error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", type: "invalid_request_error", param: "reasoning.effort", code: "unsupported_parameter" } } },
      { status: 400, body: { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: "invalid_request_error", param: "temperature", code: "unsupported_parameter" } } },
      { body: response([{ type: "message", id: "m", role: "assistant", content: [{ type: "output_text", text: "Lima.", annotations: [] }] }]) },
    ]);
    const p = new OpenAIProvider({ model: "gpt-y", apiKey: "k", baseUrl: server.url, api: "responses" });
    const r = await p.chat({ messages: [user("Capital of Peru?")], temperature: 0.2 });
    expect(r.message.content).toBe("Lima.");
    expect(r.note).toMatch(/no reasoning effort.*temperature/);
    expect(server.bodies[2]).not.toHaveProperty("reasoning");
    expect(server.bodies[2]).not.toHaveProperty("include");
    expect(server.bodies[2]).not.toHaveProperty("temperature");
  });

  it("streams the text as it comes and reads the completed response, cut short by its token limit included", async () => {
    const done = response([{ type: "message", id: "m", role: "assistant", content: [{ type: "output_text", text: "1 2 3", annotations: [] }] }], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    const server = await fake([{ body: null, sse: [JSON.stringify({ type: "response.output_text.delta", delta: "1 2" }), JSON.stringify({ type: "response.output_text.delta", delta: " 3" }), JSON.stringify({ type: "response.incomplete", response: done })] }]);
    let text = "";
    const r = await new OpenAIProvider({ model: "gpt-x", apiKey: "k", baseUrl: server.url, api: "responses" }).chat({ messages: [user("Count.")], onText: (d) => (text += d) });
    expect(text).toBe("1 2 3");
    expect(r.message.content).toBe("1 2 3");
    expect(r.finishReason).toBe("length");
  });

  it("rebuilds a turn another provider wrote as function_call items, and keeps Chat Completions for every other server", async () => {
    const server = await fake([{ body: response([]) }]);
    const history: ChatMessage[] = [user("17 + 25?"), { role: "assistant", content: "Adding.", toolCalls: [{ id: "c9", name: "add", arguments: { a: 17, b: 25 } }] }, { role: "tool", content: "42", toolCallId: "c9" }];
    await new OpenAIProvider({ model: "gpt-x", apiKey: "k", baseUrl: server.url, api: "responses" }).chat({ messages: history, tools: [add] });
    expect(server.bodies[0].input).toEqual([
      { role: "user", content: "17 + 25?" },
      { role: "assistant", content: "Adding." },
      { type: "function_call", call_id: "c9", name: "add", arguments: '{"a":17,"b":25}' },
      { type: "function_call_output", call_id: "c9", output: "42" },
    ]);
    const chat = await fake([{ body: completion({ content: "42" }) }]);
    await new OpenAIProvider({ model: "gpt-x", apiKey: "k", baseUrl: chat.url }).chat({ messages: history, tools: [add] });
    expect(chat.bodies[0]).toHaveProperty("messages");
  });
});

describe("the Anthropic provider", () => {
  const message = (content: unknown[], stop = "end_turn") => ({ id: "m1", type: "message", role: "assistant", model: "claude-x", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 3 } });

  it("leaves temperature out once the model refuses it, says so once, and remembers it", async () => {
    const server = await fake([
      { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } } },
      { body: message([{ type: "text", text: "Lima." }]) },
      { body: message([{ type: "text", text: "Lima again." }]) },
    ]);
    const p = new AnthropicProvider({ model: "claude-x", apiKey: "k", baseUrl: server.url });
    const first = await p.chat({ messages: [user("Capital of Peru?")], temperature: 0.2 });
    expect(first.message.content).toBe("Lima.");
    expect(first.note).toMatch(/temperature/);
    expect(server.bodies[0]).toMatchObject({ temperature: 0.2 });
    expect(server.bodies[1]).not.toHaveProperty("temperature");
    const second = await p.chat({ messages: [user("Again?")], temperature: 0.2 });
    expect(second.note).toBeUndefined();
    expect(server.bodies[2]).not.toHaveProperty("temperature");
  });

  it("does not retry an error that is not about a refused field", async () => {
    const server = await fake([{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "messages: at least one message is required" } } }]);
    const p = new AnthropicProvider({ model: "claude-x", apiKey: "k", baseUrl: server.url });
    await expect(p.chat({ messages: [user("hi")] })).rejects.toThrow(/at least one message/);
    expect(server.bodies).toHaveLength(1);
  });

  it("sends a call again without the thinking blocks when the API says their signature no longer fits, as after a role drops its tools", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
    const server = await fake([
      { body: message([thinking, { type: "tool_use", id: "tu1", name: "add", input: { a: 1, b: 2 } }], "tool_use") },
      { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "messages.1.content.0: Invalid `signature` in `thinking` block" } } },
      { body: message([{ type: "text", text: "verdict: pass" }]) },
    ]);
    const p = new AnthropicProvider({ model: "claude-x", apiKey: "k", baseUrl: server.url });
    const r = await p.chat({ messages: [user("1 + 2?")], tools: [add] });
    const verdict = await p.chat({ messages: [user("1 + 2?"), r.message, { role: "tool", content: "3", toolCallId: "tu1" }, user("Now give your verdict.")] });
    expect(verdict.message.content).toBe("verdict: pass");
    expect(verdict.note).toMatch(/thinking blocks of earlier turns no longer matched/);
    const retried = (server.bodies[2].messages as Array<{ role: string; content: unknown }>)[1];
    expect(retried).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "add", input: { a: 1, b: 2 } }] });
  });

  it("sends a thinking block back unchanged beside the tool call it came with", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
    const server = await fake([
      { body: message([thinking, { type: "tool_use", id: "tu1", name: "add", input: { a: 17, b: 25 } }], "tool_use") },
      { body: message([{ type: "text", text: "42" }]) },
    ]);
    const p = new AnthropicProvider({ model: "claude-x", apiKey: "k", baseUrl: server.url });
    const r = await p.chat({ messages: [user("17 + 25?")], tools: [add] });
    expect(r.message.toolCalls).toEqual([{ id: "tu1", name: "add", arguments: { a: 17, b: 25 } }]);
    await p.chat({ messages: [user("17 + 25?"), r.message, { role: "tool", content: "42", toolCallId: "tu1" }], tools: [add] });
    const assistant = (server.bodies[1].messages as Array<{ role: string; content: unknown }>)[1];
    expect(assistant).toEqual({ role: "assistant", content: [thinking, { type: "tool_use", id: "tu1", name: "add", input: { a: 17, b: 25 } }] });
  });
});
