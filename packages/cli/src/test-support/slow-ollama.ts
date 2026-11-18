// ============================================
// A slow Ollama, for tests: the two endpoints the provider calls
// ============================================
// GET /api/tags answers at once; POST /api/chat answers after the delay the
// test gives for that call, with a reply chosen by the role the system prompt
// names (Check passes, Decide converges). Each call's arrival and answer
// times are kept, so a test can look at what the terminal did while a call
// was pending.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { playRoleOf as roleOf } from "@agentic-lab/core";

const REPLIES: Record<string, string> = {
  plan: "STRATEGY: continue\nREASONING: start\nNEXT_TASK: do the task",
  do: "done",
  check: '{"verdict":"pass","evidence":["looked"],"corrections":[],"confidence":0.9}',
  critique: '{"status":"ok","issues":[],"intervention":"none","reasoning":"fine"}',
  decide: '{"decision":"converge","reason":"good","corrections":[]}',
  memory: '{"summary":"s","isMilestone":false,"milestoneDescription":"","memories":[],"noiseFiltered":""}',
  other: "ok",
};

export interface SlowOllama {
  url: string;
  calls: Array<{ role: string; arrived: number; answered: number }>;
  close(): Promise<void>;
}

/** Start it on a free port; `delayOf(n)` is the delay of the n-th chat call (1-based), in milliseconds. */
export async function slowOllama(delayOf: (n: number) => number): Promise<SlowOllama> {
  const calls: SlowOllama["calls"] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url?.startsWith("/api/tags")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "slow-mock", model: "slow-mock" }] }));
        return;
      }
      if (req.url?.startsWith("/api/chat")) {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        const system = (body.messages ?? []).find((m: { role: string }) => m.role === "system")?.content ?? "";
        const role = roleOf(system);
        const call = { role, arrived: Date.now(), answered: 0 };
        calls.push(call);
        const timer = setTimeout(() => {
          call.answered = Date.now();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              model: "slow-mock",
              created_at: new Date().toISOString(),
              message: { role: "assistant", content: REPLIES[role] ?? "ok" },
              done: true,
              done_reason: "stop",
              prompt_eval_count: 12,
              eval_count: 5,
            }),
          );
        }, delayOf(calls.length));
        res.on("close", () => clearTimeout(timer));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
