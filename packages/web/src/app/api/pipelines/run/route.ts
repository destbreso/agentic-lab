// ============================================
// POST /api/pipelines/run  (SSE)
// ============================================
// Runs a pipeline composed in the visual editor through AgentSession, the
// engine the chat and the CLI use: the graph becomes a topology definition,
// the session runs it, and its events stream back to the canvas, the raw
// engine events included. A client that disconnects stops the run.

import type { NextRequest } from "next/server";
import { createStorage, type SessionEvent, type Storage } from "@agentic-lab/core";
import { graphToRecipe, type GraphPayload } from "@/lib/pipeline-build";
import { startAgentRun } from "@/lib/agent-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunBody extends GraphPayload {
  provider?: string;
  model?: string;
  task?: string;
  maxCycles?: number;
  workingDir?: string;
}

/** The canvas's events for one engine event. */
function canvasEventsFor(e: SessionEvent): Array<Record<string, unknown>> {
  switch (e.type) {
    case "run:start":
      return [{ event: "pipeline:start", nodes: e.roles.length, order: e.order }];
    case "round:start":
      return [{ event: "cycle:start", cycle: e.round, startAt: e.startAt }];
    case "role:start":
      return [{ event: "node:start", nodeId: e.role, cycle: e.round }];
    case "role:end":
      return [
        {
          event: e.success ? "node:end" : "node:error",
          nodeId: e.role,
          cycle: e.round,
          tokens: e.tokens.totalTokens,
          toolCalls: e.toolCalls.length,
          errors: e.errors,
          error: e.errors.join("; "),
          success: e.success,
          verdict: e.verdict,
          decision: e.decision,
        },
      ];
    case "signal":
      return [{ event: "signal", from: e.from, type: e.signal }];
    default:
      return [];
  }
}

export async function POST(req: NextRequest) {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { nodes = [], wires = [], provider = "ollama", model = "llama3.1", task, maxCycles = 10, name } = body;
  if (!nodes.length) {
    return Response.json({ error: "Pipeline has no nodes" }, { status: 400 });
  }

  let storage: Storage | null = null;
  try {
    storage = await createStorage();
  } catch {
    /* runs still go ahead, unrecorded */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      try {
        const handle = await startAgentRun(
          {
            task: task || "Follow the plan and the files in the working directory.",
            topology: graphToRecipe({ nodes, wires, name }),
            provider,
            model,
            workingDir: body.workingDir,
            maxRounds: maxCycles,
            tags: ["builder", provider],
            config: { source: "builder" },
          },
          {
            storage,
            onEvent: (e) => {
              send({ event: "engine", ...e });
              for (const p of canvasEventsFor(e)) send(p);
            },
          },
        );
        req.signal.addEventListener("abort", () => handle.session.stop("the canvas closed the run"));
        const run = await handle.done;
        send({
          event: "complete",
          success: run.success,
          outcome: run.outcome,
          reason: run.reason,
          topologyOutcome: run.result.outcome,
          verdict: run.result.verdict,
          measured: run.measured,
          cycles: run.result.totalCycles,
          durationMs: run.result.totalDurationMs,
          tokens: run.result.finalState.totalTokens.totalTokens,
          summary: run.result.summary,
          answer: run.answer,
        });
      } catch (e) {
        send({ event: "error", error: (e as Error).message });
      } finally {
        storage?.close().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
