// What a terminal session needs from the engine: a role's answer handed on as
// its model writes it, a shell command off a role's list put to the person
// (allowed once, for the session, or denied, and denied on a stop), memory
// scoped to the session, and a provider that streams with its tools.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopologyRun, type RunEvent } from "./topology-run.js";
import { scopePrefix } from "./memory-scope.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { ShellTool, type ShellApproval } from "../tools/shell.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import { OllamaProvider } from "../providers/ollama.js";
import { initialRunState, reduceRun } from "../grid/run-state.js";
import { drawingOf, footer, logText, toText } from "../grid/index.js";
import { getRecipe } from "../loops/recipes.js";

let ws: string;
beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "jig-term-"));
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

const doRunsShell = (command: string) =>
  scriptedProvider((c) => (c.role === "do" && c.turn === 1 ? { toolCalls: [{ name: "shell", arguments: { command } }] } : c.role === "do" ? "The answer, written word by word." : undefined));

async function runWith(config: Partial<ConstructorParameters<typeof TopologyRun>[0]>, provider = doRunsShell("node -e 'console.log(6 * 7)'")) {
  const events: RunEvent[] = [];
  const session = new TopologyRun({ provider, tools: createDefaultToolkit(), topology: "exec-eval", workingDir: ws, delayMs: 0, maxRounds: 1, ...config });
  session.on("event", (e) => events.push(e));
  const run = await session.run("t");
  const shell = String(run.steps.find((s) => s.role === "exec")?.toolCalls[0]?.result ?? "");
  return { events, run, shell, session };
}

describe("the answer as it is written", () => {
  it("comes as text events, in order, only when the session asks for it", async () => {
    const { events, run } = await runWith({ streamText: true }, doRunsShell("ls"));
    const text = events.filter((e): e is Extract<RunEvent, { type: "text" }> => e.type === "text" && e.role === "exec");
    expect(text.map((t) => t.delta).join("")).toBe("The answer, written word by word.");
    expect(new Set(text.map((t) => t.seq))).toEqual(new Set([2]));
    expect(run.answer).toBe("The answer, written word by word.");
    const quiet = await runWith({}, doRunsShell("ls"));
    expect(quiet.events.some((e) => e.type === "text")).toBe(false);
  });
});

describe("a shell command off a role's list", () => {
  it("is refused when nobody is asked, as before", async () => {
    expect((await runWith({})).shell).toMatch(/Refused: .*"node" is not on this role's allow-list/);
  });

  it("runs once when the person allows it, with an event each way and the role waiting for you in between", async () => {
    const asked: ShellApproval[] = [];
    let during = initialRunState(0);
    const { events, shell } = await runWith({
      approve: async (r) => {
        asked.push(r);
        return "once";
      },
    });
    expect(shell).toBe("42\n");
    expect(asked).toEqual([expect.objectContaining({ command: "node -e 'console.log(6 * 7)'", programs: ["node"], role: "exec", roleName: expect.any(String), cwd: "." })]);
    const kinds = events.filter((e) => e.type.startsWith("approval")).map((e) => (e.type === "approval:answered" ? `${e.type}:${e.answer}` : e.type));
    expect(kinds).toEqual(["approval:asked", "approval:answered:once"]);
    for (const e of events) {
      during = reduceRun(during, e, 0);
      if (e.type === "approval:asked") break;
    }
    const d = drawingOf(getRecipe("exec-eval")!, { model: "m" });
    expect(during.asking).toEqual({ role: "exec", command: "node -e 'console.log(6 * 7)'", programs: ["node"] });
    expect(toText(footer(d, during, 120))).toMatch(/> do \S* ?\[waiting for you\]/);
    expect(logText(d, during).at(-1)).toMatch(/¦ asks you to run: node -e .* \(node not on its list\)/);
  });

  it("is refused when the person denies it", async () => {
    const { shell, events } = await runWith({ approve: async () => "deny" });
    expect(shell).toMatch(/Refused: .*node is not on this role's allow-list, and the person at the terminal did not allow it/);
    expect(events.find((e) => e.type === "approval:answered")).toMatchObject({ answer: "deny" });
  });

  it("never asks about a path outside the workspace, an expansion or a program run by its path", async () => {
    for (const command of ["node ../x.js", "node -e $HOME", "/usr/bin/node -v"]) {
      const asked: string[] = [];
      const { shell } = await runWith({ approve: async (r) => (asked.push(r.command), "once") }, doRunsShell(command));
      expect(shell, command).toMatch(/^Error: Refused|Refused:/);
      expect(asked, command).toEqual([]);
    }
  });

  it("is answered deny when the run stops while the question is open", async () => {
    const events: RunEvent[] = [];
    const session: TopologyRun = new TopologyRun({
      provider: doRunsShell("node -e 'console.log(6 * 7)'"),
      tools: createDefaultToolkit(),
      topology: "exec-eval",
      workingDir: ws,
      delayMs: 0,
      maxRounds: 1,
      // Never answered by the person: the stop answers it.
      approve: () => {
        setTimeout(() => session.stop("stopped at the question"), 10);
        return new Promise(() => {});
      },
    });
    session.on("event", (e) => events.push(e));
    const run = await session.run("t");
    expect(events.find((e) => e.type === "approval:answered")).toMatchObject({ answer: "deny" });
    expect(run.outcome).toBe("stopped");
  });

  it("keeps everything else the policy checks with an approver in place", async () => {
    const tool = new ShellTool({ timeout: 5000 }).withApprover(async () => "once");
    const ctx = { workingDir: ws, iteration: 1, log: () => {}, verbose: false };
    await expect(tool.execute({ command: "node -e 1 > /tmp/out" }, ctx)).rejects.toThrow(/outside the workspace/);
    expect(await tool.withCommands(["cat"]).execute({ command: "node -e 'console.log(1)'" }, ctx)).toBe("1\n");
  });
});

describe("a tool at work", () => {
  it("is reported as it starts and as it ends, between the call that asked for it and the next", async () => {
    const { events } = await runWith({ approve: async () => "once" });
    const exec = events.filter((e) => "role" in e && e.role === "exec" && ["call", "tool:start", "tool:end", "approval:asked", "approval:answered"].includes(e.type));
    expect(exec.map((e) => e.type)).toEqual(["call", "tool:start", "approval:asked", "approval:answered", "tool:end", "call"]);
    expect(exec[1]).toMatchObject({ tool: "shell", seq: 1, args: expect.stringContaining("console.log(6 * 7)") });
    expect(exec[4]).toMatchObject({ tool: "shell", ok: true, durationMs: expect.any(Number) });
    let s = initialRunState(0);
    for (const e of events) {
      s = reduceRun(s, e, 0);
      if (e.type === "tool:start") break;
    }
    expect(s.tool).toEqual({ role: "exec", tool: "shell", args: expect.any(String) });
  });
});

describe("memory scoped to the session", () => {
  it("reads and writes under the session, or only the run's own outside one", () => {
    expect(scopePrefix("session", { runId: "r1", task: "t", sessionId: "s1" })).toEqual(["session", "s1"]);
    expect(scopePrefix("session", { runId: "r1", task: "t" })).toEqual(["run", "r1"]);
  });
});

describe("Ollama, streamed with its tools", () => {
  let server: Server;
  let url = "";
  const bodies: Array<Record<string, unknown>> = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        bodies.push(body);
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const lines = body.tools
          ? [{ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "file_read", arguments: { path: "a" } } }] }, done: false }, { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 7, eval_count: 3, model: "m" }]
          : [{ message: { role: "assistant", content: "Hel" }, done: false }, { message: { role: "assistant", content: "lo" }, done: false }, { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 2, model: "m" }];
        for (const l of lines) res.write(`${JSON.stringify(l)}\n`);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("hands the text on as it comes and returns the same result a plain call would", async () => {
    const p = new OllamaProvider({ model: "m", baseUrl: url });
    const pieces: string[] = [];
    const r = await p.chat({ messages: [{ role: "user", content: "hi" }], onText: (d) => pieces.push(d) });
    expect(pieces).toEqual(["Hel", "lo"]);
    expect(r.message.content).toBe("Hello");
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    expect(bodies.at(-1)?.stream).toBe(true);
    const withTools = await p.chat({ messages: [{ role: "user", content: "hi" }], tools: [{ name: "file_read", description: "d", parameters: { type: "object", properties: {} } }], onText: () => {} });
    expect(withTools.finishReason).toBe("tool_calls");
    expect(withTools.message.toolCalls?.[0]).toMatchObject({ name: "file_read", arguments: { path: "a" } });
    expect(withTools.usage.totalTokens).toBe(10);
  });
});
