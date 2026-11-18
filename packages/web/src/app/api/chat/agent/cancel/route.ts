// ============================================
// API: POST /api/chat/agent/cancel
// ============================================
// Stops a running agent task: the session aborts the model and tool calls in
// flight and ends the run as stopped. The run record is also marked
// cancelled here, in case the run is not in this process.

import { NextRequest, NextResponse } from "next/server";
import { stopRun } from "jig-core";
import { cancelJob } from "../job-store";

async function getStorageClient() {
  try {
    const { createStorage } = await import("jig-core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId } = body as { runId?: string };

    if (!runId || typeof runId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid runId" },
        { status: 400 },
      );
    }

    const cancelled = stopRun(runId, "stopped by the user") || cancelJob(runId);

    // Safety net: directly set run status to "cancelled" in storage
    // even if the job hasn't reached a checkpoint yet. The job's own
    // finalizeRun will be a no-op if the status is already updated.
    let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
    try {
      storage = await getStorageClient();
      if (storage) {
        await storage.runs.updateRun(runId, {
          status: "cancelled",
          success: false,
          endedAt: new Date().toISOString(),
          summary: "Cancelled by user",
        });
      }
    } catch {
      // Best-effort — the job's own finalizeRun will handle it
    } finally {
      if (storage) storage.close().catch(() => {});
    }

    if (!cancelled) {
      // Even if the job wasn't found in memory (already finished),
      // we still updated storage above. Return 200.
      return NextResponse.json({
        ok: true,
        runId,
        note: "Job not in memory, storage updated",
      });
    }

    return NextResponse.json({ ok: true, runId });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
