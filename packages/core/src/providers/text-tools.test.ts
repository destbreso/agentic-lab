// Tool calls read from text: the lenient JSON reader, the <tool_call> blocks, a model whose template writes its
// calls that way given its tools as text, and the Ollama provider asking again as text when, for another model,
// Ollama returns an empty reply after generating a call it could not parse (a file_write with a docstring's """).

import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { asTextConversation, heldBack, parseLenientJson, toolCallsInText } from "./text-tools.js";
import { LOST_CALL_MIN_TOKENS, OllamaProvider, UNREADABLE_CALL_NUDGE } from "./ollama.js";
import type { ToolDefinition } from "../types/llm.js";

const CODE = 'def f(a: str) -> str:\n    """ Return a.\n    >>> f(\'x\')\n    \'x\'\n    """\n    print("a", a)\n    return a\n';
// What the model wrote: the code's quotes and newlines escaped as JSON wants, except the docstring's """ and print's "a".
const BROKEN = `{"name": "file_write", "arguments": {"path": "solution.py", "content": "${CODE.replace(/\n/g, "\\n").replace(/\\n/g, "\\n")}"}}`;

describe("reading JSON a model wrote", () => {
  it("leaves valid JSON as it is, and gives up on text that is not JSON", () => {
    expect(parseLenientJson('{"a": "b \\"c\\""}')).toEqual({ a: 'b "c"' });
    expect(parseLenientJson("not json at all")).toBeUndefined();
  });
  it("repairs quotes left unescaped inside a string, the docstring's and a call's alike", () => {
    expect(() => JSON.parse(BROKEN)).toThrow();
    const parsed = parseLenientJson(BROKEN) as { arguments: { content: string } };
    expect(parsed.arguments.content).toBe(CODE);
  });
  it("repairs raw newlines inside a string", () => {
    expect(parseLenientJson('{"content": "a\nb"}')).toEqual({ content: "a\nb" });
  });
});

describe("tool calls written as text", () => {
  const params = (...names: string[]) => ({ type: "object" as const, properties: Object.fromEntries(names.map((n) => [n, { type: "string" }])) });
  const TOOLS: ToolDefinition[] = [
    { name: "file_write", description: "write", parameters: params("path", "content") },
    { name: "file_read", description: "read", parameters: params("path") },
  ];
  const write = (content: string) => `{"name": "file_write", "arguments": {"path": "solution.py", "content": "${content.replace(/\n/g, "\\n")}"}}`;

  it("reads every call, one to a tool that does not exist too (the role is then told so), and keeps the text around them", () => {
    const { calls, rest, unreadable } = toolCallsInText(`I will write it.\n<tool_call>\n${BROKEN}\n</tool_call>\n<tool_call>{"name": "rm_rf", "arguments": {}}</tool_call>`, TOOLS);
    expect(calls).toEqual([
      { name: "file_write", arguments: { path: "solution.py", content: CODE } },
      { name: "rm_rf", arguments: {} },
    ]);
    expect(rest).toBe("I will write it.");
    expect(unreadable).toBe(0);
  });

  it("reads code whose quotes were left unescaped, by the tool's own parameter names, where JSON repair gives up", () => {
    for (const code of ['x = ", ".join(xs)', 's.split(",")', 'print("a", "b")', 'assert f("a,b") == ["a","b"]', 's.replace(" ", "")', 'def f():\n    """Doc."""\n    return "a"']) {
      const { calls, unreadable } = toolCallsInText(`<tool_call>\n${write(code)}\n</tool_call>`, TOOLS);
      expect(unreadable, code).toBe(0);
      expect(calls, code).toEqual([{ name: "file_write", arguments: { path: "solution.py", content: code } }]);
    }
  });

  it("is not swallowed by a <tool_call> mentioned before it, reads a call whose closing tag never came, and takes Llama's parameters key", () => {
    const mentioned = toolCallsInText('I write calls in <tool_call> tags.\n<tool_call>{"name": "file_read", "arguments": {"path": "a"}}</tool_call>', TOOLS);
    expect(mentioned.calls).toEqual([{ name: "file_read", arguments: { path: "a" } }]);
    expect(mentioned.rest).toBe("I write calls in <tool_call> tags.");
    const unclosed = toolCallsInText('Reading it.\n<tool_call>\n{"name": "file_read", "arguments": {"path": "a"}}', TOOLS);
    expect(unclosed).toEqual({ calls: [{ name: "file_read", arguments: { path: "a" } }], rest: "Reading it.", unreadable: 0 });
    expect(toolCallsInText('<tool_call>{"name": "file_read", "parameters": {"path": "a"}}</tool_call>', TOOLS).calls).toEqual([{ name: "file_read", arguments: { path: "a" } }]);
  });

  it("counts a call it cannot read, and not a tag that holds no JSON", () => {
    expect(toolCallsInText('<tool_call>{"name": "file_write", "arguments": {"path": </tool_call>', TOOLS)).toMatchObject({ calls: [], unreadable: 1 });
    expect(toolCallsInText("I use <tool_call> blocks.", TOOLS)).toMatchObject({ calls: [], unreadable: 0 });
  });

  it("puts the tools in the first system message only", () => {
    const conv = asTextConversation([{ role: "system", content: "You are Do." }, { role: "user", content: "task" }, { role: "system", content: "Earlier turns, summarized." }], TOOLS);
    expect(conv[0].content).toContain("<tools>");
    expect(conv[2].content).toBe("Earlier turns, summarized.");
  });
  it("puts past calls and results in the conversation as text, and the tools in the system prompt", () => {
    const tools: ToolDefinition[] = [{ name: "file_read", description: "read", parameters: { type: "object", properties: {} } }];
    const conv = asTextConversation(
      [
        { role: "system", content: "You are Do." },
        { role: "user", content: "task" },
        { role: "assistant", content: "", toolCalls: [{ id: "1", name: "file_read", arguments: { path: "a" } }] },
        { role: "tool", content: "file text", toolCallId: "1" },
      ],
      tools,
    );
    expect(conv.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(conv[0].content).toContain("<tools>");
    expect(conv[2].content).toContain('<tool_call>\n{"name":"file_read","arguments":{"path":"a"}}\n</tool_call>');
    expect(conv[3].content).toBe("<tool_response>\nfile text\n</tool_response>");
  });
  it("keeps an earlier turn's call beside its text, where the model's own template would drop it", () => {
    const conv = asTextConversation(
      [{ role: "assistant", content: "I will read it.", toolCalls: [{ id: "1", name: "file_read", arguments: { path: "a" } }] }],
      [],
    );
    expect(conv[1].content).toBe('I will read it.\n<tool_call>\n{"name":"file_read","arguments":{"path":"a"}}\n</tool_call>');
  });
  it("shows a streamed reply up to its first call, holding back a tail that could be the call's start", () => {
    expect(heldBack("I will write it.", "<tool_call>")).toBe(16);
    expect(heldBack("I will write it.\n<tool", "<tool_call>")).toBe(17);
    expect(heldBack("I will write it.\n<tool_call>\n{", "<tool_call>")).toBe(17);
    expect(heldBack("a < b", "<tool_call>")).toBe(5);
  });
});

describe("the Ollama provider, for a model whose template writes <tool_call> blocks", () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
  const HERMES = "{{ .System }}<tools>{{ range .Tools }}{{ . }}{{ end }}</tools><tool_call>{{ .Content }}</tool_call>";

  /** A fake Ollama whose model has `template`, answering every chat with `reply` (one after another when a list; streamed in `chunks` when asked). */
  async function fakeOllama(template: string, replies: string | string[], chunks?: string[]) {
    const queue = Array.isArray(replies) ? [...replies] : null;
    const chats: Array<Record<string, unknown>> = [];
    let shows = 0;
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        res.setHeader("content-type", "application/json");
        if ((req.url ?? "").startsWith("/api/show")) {
          shows++;
          return res.end(JSON.stringify({ template }));
        }
        chats.push(body);
        const reply = queue ? (queue.length > 1 ? queue.shift()! : queue[0]) : (replies as string);
        const end = { model: "m", done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 300 };
        if (!body.stream) return res.end(JSON.stringify({ ...end, message: { role: "assistant", content: reply } }));
        for (const c of chunks ?? [reply]) res.write(JSON.stringify({ model: "m", done: false, message: { role: "assistant", content: c } }) + "\n");
        res.end(JSON.stringify({ ...end, message: { role: "assistant", content: "" } }) + "\n");
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, chats, shows: () => shows };
  }
  const tools: ToolDefinition[] = [{ name: "file_write", description: "write", parameters: { type: "object", properties: {} } }];
  const ask = { messages: [{ role: "system" as const, content: "You are Do." }, { role: "user" as const, content: "complete f" }], tools };

  it("gives the tools in the system prompt instead of to Ollama's parser, and reads a call Ollama would have dropped", async () => {
    const { base, chats, shows } = await fakeOllama(HERMES, `I will write it.\n<tool_call>\n${BROKEN}\n</tool_call>`);
    const provider = new OllamaProvider({ model: "m", baseUrl: base });
    const result = await provider.chat(ask);
    expect(chats).toHaveLength(1);
    expect(chats[0].tools).toBeUndefined();
    expect((chats[0].messages as Array<{ content: string }>)[0].content).toContain("<tools>");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls?.[0]).toMatchObject({ name: "file_write", arguments: { path: "solution.py", content: CODE } });
    expect(result.message.content).toBe("I will write it.");
    expect(result.note).toBeUndefined();
    await provider.chat(ask);
    expect(shows()).toBe(1);
  });

  it("streams the text before the call and never the call", async () => {
    const call = `<tool_call>\n${BROKEN}\n</tool_call>`;
    const { base } = await fakeOllama(HERMES, "", ["I will ", "write it.\n<tool", call.slice(5)]);
    const seen: string[] = [];
    const result = await new OllamaProvider({ model: "m", baseUrl: base }).chat({ ...ask, onText: (d) => seen.push(d) });
    expect(seen.join("")).toBe("I will write it.\n");
    expect(result.message.toolCalls?.[0]?.name).toBe("file_write");
  });

  it("streams a reply with no call whole, a held-back tail included", async () => {
    const { base } = await fakeOllama(HERMES, "", ["Done: a < b", " holds, and x <"]);
    const seen: string[] = [];
    const result = await new OllamaProvider({ model: "m", baseUrl: base }).chat({ ...ask, onText: (d) => seen.push(d) });
    expect(seen.join("")).toBe("Done: a < b holds, and x <");
    expect(result.finishReason).toBe("stop");
  });

  it("asks once more for a call it cannot read, saying what went wrong, and reads the call written again", async () => {
    const broken = '<tool_call>\n{"name": "file_write", "arguments": {"path": \n</tool_call>';
    const { base, chats } = await fakeOllama(HERMES, [broken, '<tool_call>\n{"name": "file_write", "arguments": {"path": "a.py"}}\n</tool_call>']);
    const result = await new OllamaProvider({ model: "m", baseUrl: base }).chat(ask);
    expect(chats).toHaveLength(2);
    const second = chats[1].messages as Array<{ role: string; content: string }>;
    expect(second.slice(-2)).toEqual([{ role: "assistant", content: broken }, { role: "user", content: UNREADABLE_CALL_NUDGE }]);
    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls?.map((c) => c.arguments)).toEqual([{ path: "a.py" }]);
    expect(result.note).toMatch(/asked once more, the call was read/);
  });

  it("ends the turn with a note when the call cannot be read the second time either, and asks only once", async () => {
    const { base, chats } = await fakeOllama(HERMES, '<tool_call>\n{"name": "file_write", "arguments": {"path": \n</tool_call>');
    const result = await new OllamaProvider({ model: "m", baseUrl: base }).chat(ask);
    expect(chats).toHaveLength(2);
    expect(result.finishReason).toBe("stop");
    expect(result.note).toMatch(/nor when asked once more/);
  });

  it("keeps Ollama's own tool calling for a model whose template has another format", async () => {
    const { base, chats } = await fakeOllama("[TOOL_CALLS] {{ .Content }}", "done");
    await new OllamaProvider({ model: "m", baseUrl: base }).chat(ask);
    expect(chats[0].tools).toBeDefined();
  });
});

describe("the Ollama provider, when Ollama loses a tool call of a model in another format", () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  /** A fake Ollama: with tools it returns nothing after `lost` tokens; without tools, the call as text. */
  async function fakeOllama(lost: number, asText: string): Promise<{ base: string; bodies: Array<Record<string, unknown>> }> {
    const bodies: Array<Record<string, unknown>> = [];
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        if ((req.url ?? "").startsWith("/api/show")) return res.end(JSON.stringify({ template: "[TOOL_CALLS] {{ .Content }}" }));
        bodies.push(body);
        const content = body.tools ? "" : asText;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ model: "m", message: { role: "assistant", content }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: body.tools ? lost : 140 }));
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, bodies };
  }
  const tools: ToolDefinition[] = [{ name: "file_write", description: "write", parameters: { type: "object", properties: {} } }];
  const ask = { messages: [{ role: "system" as const, content: "You are Do." }, { role: "user" as const, content: "complete f" }], tools };

  it("asks again as text and reads the call from the reply, with a note for the step record", async () => {
    const { base, bodies } = await fakeOllama(140, `<tool_call>\n${BROKEN}\n</tool_call>`);
    const result = await new OllamaProvider({ model: "m", baseUrl: base }).chat(ask);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].tools).toBeUndefined();
    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls?.[0]).toMatchObject({ name: "file_write", arguments: { path: "solution.py", content: CODE } });
    expect(result.note).toMatch(/empty reply after 140 tokens/);
    expect(result.usage.outputTokens).toBe(280);
  });

  it("leaves a short empty reply alone: no second call when the model generated almost nothing", async () => {
    const { base, bodies } = await fakeOllama(LOST_CALL_MIN_TOKENS - 1, "unused");
    const result = await new OllamaProvider({ model: "m", baseUrl: base }).chat(ask);
    expect(bodies).toHaveLength(1);
    expect(result.message.content).toBe("");
    expect(result.note).toBeUndefined();
  });
});
