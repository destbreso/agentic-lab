// ============================================
// API: /api/events/[runId] — SSE event stream
// ============================================
// Server-Sent Events endpoint for real-time
// run updates. The dashboard connects to this
// for live streaming of loop events.
// Uses Redis pub/sub when available for cross-process
// event delivery (e.g. CLI → dashboard).

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

async function getInfra() {
  try {
    const { createStorageWithRedis } = await import("@agentic-lab/core");
    return await createStorageWithRedis();
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const infra = await getInfra();
  const storage = infra?.storage ?? null;
  const redisBus = infra?.redis ?? null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Send initial connection event
      send("connected", { runId, timestamp: new Date().toISOString() });

      const cleanups: Array<() => void> = [];

      if (storage) {
        // Subscribe to storage events (in-memory or Postgres event store)
        const unsubscribe = storage.events.subscribe(runId, (event) => {
          send(event.eventType, event.payload);
        });
        cleanups.push(unsubscribe);
      }

      if (redisBus) {
        // Subscribe to Redis pub/sub for cross-process events
        const unsubPromise = redisBus.subscribeToRun(runId, (event) => {
          send(event.eventType, event.payload);
        });
        unsubPromise.then((unsub) => cleanups.push(unsub)).catch(() => {});
      }

      if (!storage && !redisBus) {
        send("error", { message: "No event transport configured" });
        controller.close();
        return;
      }

      // Keep alive every 30 seconds
      const keepAlive = setInterval(() => {
        send("ping", { timestamp: new Date().toISOString() });
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        for (const fn of cleanups) fn();
        if (redisBus) redisBus.disconnect().catch(() => {});
        if (storage) storage.close().catch(() => {});
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
