// Anthropic's advisor tool, against a mocked Messages API: no key, no network.
// The mock answers with the content blocks the advisor tool's documentation
// shows (server_tool_use, advisor_tool_result with plain or encrypted advice,
// usage.iterations); the lab must offer the tool with its beta header, send
// the blocks back verbatim, follow a pause_turn, and record the advice as the
// Advisor's step, sealed when it is encrypted.

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AnthropicProvider } from "../providers/anthropic.js";
import { TopologyRun, type RunEvent } from "./topology-run.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { getRecipe } from "../roles/recipes.js";
import { usesRealAdvisor, advisorModelFor } from "./advisor-tool.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import type { Topology } from "../formats/model.js";

interface Seen {
  body: Record<string, any>;
  headers: IncomingHttpHeaders;
}

let server: Server | null = null;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** A Messages API that answers each request with the next scripted body. */
async function mockApi(replies: Array<Record<string, unknown>>): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ body: JSON.parse(raw), headers: req.headers });
      const reply = replies[seen.length - 1];
      res.writeHead(reply ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(reply ?? { type: "error", error: { type: "api_error", message: "no more replies" } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}

const message = (content: unknown[], stop: string, usage: Record<string, unknown> = {}) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20, ...usage },
});

describe("the real advisor tool", () => {
  it("is used only for an Anthropic caller whose consult shows the whole transcript", () => {
    const edge = (getRecipe("advisor") as Topology).consults[0];
    const anthropic = { name: "anthropic" } as never;
    expect(usesRealAdvisor(anthropic, edge)).toBe(true);
    expect(usesRealAdvisor({ name: "ollama" } as never, edge)).toBe(false);
    expect(usesRealAdvisor(anthropic, { ...edge, sees: ["tool_results", "checks"] })).toBe(false);
    expect(advisorModelFor(edge, "claude-sonnet-5-5")).toBe("claude-opus-5-5");
    expect(advisorModelFor(edge, "claude-fable-5-2")).toBe("claude-fable-5-2");
  });

  it("follows a pause_turn, sends the blocks back verbatim, and records sealed advice as sealed", async () => {
    const pending = [
      { type: "text", text: "Let me consult the advisor." },
      { type: "server_tool_use", id: "srvtoolu_1", name: "advisor", input: {} },
    ];
    const api = await mockApi([
      message(pending, "pause_turn"),
      message(
        [
          { type: "advisor_tool_result", tool_use_id: "srvtoolu_1", content: { type: "advisor_redacted_result", encrypted_content: "EqQBCkYI-SEALED" } },
          { type: "text", text: "The answer is 42." },
        ],
        "end_turn",
        { iterations: [{ type: "message", input_tokens: 100, output_tokens: 20 }, { type: "advisor_message", model: "claude-opus-5-5", input_tokens: 823, output_tokens: 412 }] },
      ),
    ]);
    const provider = new AnthropicProvider({ apiKey: "test-key", baseUrl: api.url, model: "claude-sonnet-5-5" });
    const events: RunEvent[] = [];
    const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "advisor", workingDir: "/tmp", delayMs: 0 });
    session.on("event", (e) => events.push(e));
    const run = await session.run("What is six times seven?");

    // The first request offers the advisor tool, with its beta header, and no lab consult tool.
    const first = api.seen[0];
    expect(first.headers["anthropic-beta"]).toContain("advisor-tool-2026-03-01");
    expect(first.body.tools).toContainEqual({ type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5", max_uses: 3 });
    expect(first.body.tools.map((t: { name: string }) => t.name)).not.toContain("consult_advisor");
    // The resume sends the paused content back unchanged, with no new user message.
    const second = api.seen[1].body.messages;
    expect(second.at(-1)).toEqual({ role: "assistant", content: pending });
    expect(second.filter((m: { role: string }) => m.role === "user")).toHaveLength(1);

    expect(run.answer).toBe("Let me consult the advisor.The answer is 42.");
    const step = run.steps.find((s) => s.role === "advisor")!;
    expect(step.outputs).toEqual([{ type: "advice", fields: { sealed: { provenance: "measured", value: true } } }]);
    expect(JSON.stringify(step)).not.toContain("SEALED");
    expect(step.tokens).toEqual({ inputTokens: 823, outputTokens: 412, totalTokens: 1235 });
    const end = events.find((e) => e.type === "consult:end");
    expect(end).toMatchObject({ from: "exec", to: "advisor", sealed: true, real: true });
    // The executor's tokens and the advisor's both count for the run.
    expect(run.result.finalState.totalTokens.totalTokens).toBe(240 + 1235);
  });

  it("keeps the advisor's blocks beside a client tool call, and reads plain advice", async () => {
    const turn1 = [
      { type: "server_tool_use", id: "srvtoolu_2", name: "advisor", input: {} },
      { type: "tool_use", id: "toolu_1", name: "glob", input: { pattern: "*.md" } },
    ];
    const api = await mockApi([
      message(turn1, "tool_use"),
      message(
        [
          { type: "advisor_tool_result", tool_use_id: "srvtoolu_2", content: { type: "advisor_result", text: "ADVICE-MARK: read the README first", stop_reason: "end_turn" } },
          { type: "text", text: "done" },
        ],
        "end_turn",
        { iterations: [{ type: "advisor_message", model: "claude-opus-5-5", input_tokens: 500, output_tokens: 50 }] },
      ),
    ]);
    const provider = new AnthropicProvider({ apiKey: "test-key", baseUrl: api.url, model: "claude-sonnet-5-5" });
    const run = await new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "advisor", workingDir: "/tmp", delayMs: 0 }).run("Find the docs.");

    // The second request carries the first reply's blocks verbatim, then the client tool's result.
    const messages = api.seen[1].body.messages;
    expect(messages.at(-2)).toEqual({ role: "assistant", content: turn1 });
    expect(messages.at(-1).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    const step = run.steps.find((s) => s.role === "advisor")!;
    expect(step.outputs[0].fields.advice).toEqual({ provenance: "written", value: "ADVICE-MARK: read the README first" });
    expect(step.inputs[0]).toMatchObject({ name: "transcript", provenance: "written" });
  });

  it("emulates the advisor with any other provider, with the same sight", async () => {
    const provider = scriptedProvider((call) => (call.role === "do" && !call.prompt.includes("advice") ? { toolCalls: [{ name: "consult_advisor", arguments: {} }] } : call.system.startsWith("You are an advisor") ? "advice" : undefined));
    const events: RunEvent[] = [];
    const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "advisor", workingDir: "/tmp", delayMs: 0 });
    session.on("event", (e) => events.push(e));
    await session.run("a task");
    expect(events.find((e) => e.type === "consult:end")).toMatchObject({ real: false, sealed: false });
  });
});
