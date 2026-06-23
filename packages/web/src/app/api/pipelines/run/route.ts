// ============================================
// POST /api/pipelines/run  (SSE)
// ============================================
// Runs a pipeline composed in the visual editor: converts the graph into a
// core Recipe, instantiates it with the chosen provider + toolkit + skills,
// seeds the task onto the shared blackboard, and streams live execution events
// (cycle/node/signal/complete) back to the canvas over Server-Sent Events.

import type { NextRequest } from "next/server";
import { instantiateRecipeFromDefinition, createDefaultToolkit } from "@agentic-lab/core";
import { graphToRecipe, createWebProvider, type GraphPayload } from "@/lib/pipeline-build";
import { getSkills } from "@/lib/skills-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunBody extends GraphPayload {
  provider?: string;
  model?: string;
  task?: string;
  maxCycles?: number;
}

export async function POST(req: NextRequest) {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    nodes = [],
    wires = [],
    provider: providerName = "ollama",
    model = "llama3.1",
    task,
    maxCycles = 10,
    name,
  } = body;

  if (!nodes.length) {
    return Response.json({ error: "Pipeline has no nodes" }, { status: 400 });
  }

  let provider;
  try {
    provider = createWebProvider(providerName, model);
  } catch (e) {
    return Response.json(
      { error: `Provider "${providerName}" unavailable: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const tools = createDefaultToolkit();
  const skills = await getSkills();
  const recipe = graphToRecipe({ nodes, wires, name });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown> = {}) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...data })}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      try {
        const pipeline = instantiateRecipeFromDefinition(
          recipe,
          {
            provider,
            tools,
            skills,
            // Lets per-node brain config (provider/model) build its own provider.
            providerFactory: (brain: { provider?: string; model?: string }) =>
              createWebProvider(brain.provider ?? providerName, brain.model ?? model),
            workingDir: process.cwd(),
            seedShared: task ? { task } : undefined,
          },
          { maxCycles },
        );

        pipeline.on("pipeline:start", () => send("pipeline:start", { nodes: nodes.length }));
        pipeline.on("pipeline:cycle:start", (d) => send("cycle:start", { cycle: d.cycle }));
        pipeline.on("node:start", (d) => send("node:start", { nodeId: d.nodeId, cycle: d.cycle }));
        pipeline.on("node:end", (d) =>
          send("node:end", {
            nodeId: d.nodeId,
            cycle: d.cycle,
            tokens: d.result.tokenUsage.totalTokens,
            toolCalls: d.result.toolCalls.length,
            errors: d.result.errors,
            success: d.result.success,
          }),
        );
        pipeline.on("node:error", (d) => send("node:error", { nodeId: d.nodeId, error: d.error.message }));
        pipeline.on("node:skip", (d) => send("node:skip", { nodeId: d.nodeId, reason: d.reason }));
        pipeline.on("signal:sent", (d) =>
          send("signal", { from: d.signal.sourceNodeId, type: d.signal.type }),
        );

        const result = await pipeline.run();
        send("complete", {
          success: result.success,
          cycles: result.totalCycles,
          durationMs: result.totalDurationMs,
          tokens: result.finalState.totalTokens.totalTokens,
          summary: result.summary,
        });
      } catch (e) {
        send("error", { error: (e as Error).message });
      } finally {
        controller.close();
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
