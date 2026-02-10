// ============================================
// API: /api/events/[runId] — SSE event stream
// ============================================
// Server-Sent Events endpoint for real-time
// run updates. The dashboard connects to this
// for live streaming of loop events.

import { NextRequest } from "next/server";

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const storage = await getStorageClient();

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

      if (storage) {
        // Subscribe to events
        const unsubscribe = storage.events.subscribe(runId, (event) => {
          send(event.eventType, event.payload);
        });

        // Keep alive every 30 seconds
        const keepAlive = setInterval(() => {
          send("ping", { timestamp: new Date().toISOString() });
        }, 30000);

        // Cleanup on close
        request.signal.addEventListener("abort", () => {
          clearInterval(keepAlive);
          unsubscribe();
          controller.close();
        });
      } else {
        send("error", { message: "Storage not configured" });
        controller.close();
      }
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
