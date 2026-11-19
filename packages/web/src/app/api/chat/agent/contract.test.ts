// The contract: the same scripted run gives the same engine event sequence
// through the chat route and through the CLI, because both are adapters over
// AgentSession. Volatile fields (ids, durations) are dropped before comparing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { registerProvider, type SessionEvent } from "jig-core";
import { POST } from "./route";
import { POST as nudge } from "./nudge/route";
import { runTopology } from "../../../../../../cli/src/session-runner";
import { scriptedProvider, type ScriptedCall } from "../../../../../../core/src/test-support/scripted-provider";

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["wrong"], corrections: ["fix it"], confidence: 0.8 });

/** Check fails once; Decide sends the work back to Do; then everything passes. */
function script(c: ScriptedCall) {
  if (c.role === "do") return `answer ${c.turn}`;
  if (c.role === "check" && c.turn === 1) return FAIL;
  if (c.role === "decide") return JSON.stringify({ decision: "refine", reason: "again", corrections: ["fix it"] });
  return undefined;
}

// Each `new` builds a fresh scripted provider, so both runs start from turn 1.
const prompts: string[][] = [];
registerProvider(
  "contract-mock",
  class {
    constructor() {
      const p = scriptedProvider((c) => {
        if (c.role === "do") prompts.at(-1)?.push(c.prompt);
        return script(c);
      });
      prompts.push([]);
      return p;
    }
  } as never,
);

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "contract-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const TASK = "Say hello to the operator";

/** Post to a route and collect every SSE payload until the stream closes. */
async function collect(res: Response, onEvent?: (e: Record<string, unknown>) => Promise<void> | void) {
  const payloads: Array<Record<string, unknown>> = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const payload = JSON.parse(line.slice(6));
      payloads.push(payload);
      await onEvent?.(payload);
    }
  }
  return payloads;
}

function normalise(events: SessionEvent[]) {
  return events.map((e) => {
    const copy: Record<string, unknown> = { ...e };
    delete copy.runId;
    delete copy.durationMs;
    delete copy.event;
    // jig_help is the console's own tool (Jig's documentation, shipped with jig-console): the engine is the same without it.
    if (Array.isArray(copy.tools)) copy.tools = (copy.tools as string[]).filter((t) => t !== "jig_help");
    return copy;
  });
}

function chatRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/chat/agent", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("one engine for the chat and the CLI", () => {
  it("the same mock run gives the same event sequence through the web route and the CLI", async () => {
    const res = await POST(
      chatRequest({
        task: TASK,
        mode: "recipe",
        recipe: "deep-reasoning",
        provider: "contract-mock",
        model: "m",
        memoryEnabled: false,
        workingDir: dir,
      }),
    );
    const payloads = await collect(res);
    const web = payloads.filter((p) => p.event === "engine") as unknown as SessionEvent[];

    const cliLines: string[] = [];
    await runTopology(
      { topology: "deep-reasoning", task: TASK, provider: "contract-mock", model: "m", dir, json: true },
      { out: (l) => cliLines.push(l), note: () => {} },
      // The web route does not skip a Check with nothing to verify; the contract compares the same engine settings.
      { storage: null, handleSignals: false, skipUnverifiable: false },
    );
    const cli = cliLines.map((l) => JSON.parse(l) as SessionEvent);

    expect(web.length).toBeGreaterThan(10);
    expect(normalise(web)).toEqual(normalise(cli));
    expect(web.at(-1)).toMatchObject({ type: "run:end", outcome: "passed", rounds: 2 });
    // The chat page's own events are derived from the same run.
    expect(payloads.find((p) => p.event === "result")).toMatchObject({ outcome: "passed", success: true, finalAnswer: "answer 2" });
  });

  it("the chat's steering reaches Do on its next turn, through the run registry", async () => {
    let runId = "";
    let steered = false;
    const res = await POST(
      chatRequest({ task: TASK, mode: "recipe", recipe: "deep-reasoning", provider: "contract-mock", model: "m", memoryEnabled: false, workingDir: dir }),
    );
    const payloads = await collect(res, async (p) => {
      if (p.event === "run_id") runId = String(p.runId);
      if (!steered && p.event === "engine" && p.type === "role:start" && p.role === "exec") {
        steered = true;
        const reply = await nudge(
          new NextRequest("http://localhost/api/chat/agent/nudge", {
            method: "POST",
            body: JSON.stringify({ runId, message: "MARK-NUDGE keep it short", priority: "high" }),
          }),
        );
        expect(reply.status).toBe(200);
      }
    });
    const doPrompts = prompts.at(-1)!;
    expect(doPrompts[0]).not.toContain("MARK-NUDGE");
    expect(doPrompts[1]).toContain("MARK-NUDGE");
    expect(payloads.some((p) => p.event === "steering:consumed")).toBe(true);
  });

  it("a nudge to a run that is not active is a 404", async () => {
    const reply = await nudge(
      new NextRequest("http://localhost/api/chat/agent/nudge", {
        method: "POST",
        body: JSON.stringify({ runId: "run-none", message: "hello" }),
      }),
    );
    expect(reply.status).toBe(404);
  });
});
