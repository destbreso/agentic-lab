import { NextRequest, NextResponse } from "next/server";
import { enqueueNudge, getActiveJob } from "../job-store";

/**
 * POST /api/chat/agent/nudge — Inject a steering nudge into a running agent task
 *
 * Body: { runId: string, message: string, priority?: "low" | "normal" | "high" | "critical" }
 *
 * This enables mid-loop steering: the human operator can send tactical corrections
 * to a running agent without stopping the loop. Nudges are consumed at the next
 * iteration boundary (all priorities) or mid-tool-loop (critical only).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, message, priority = "normal" } = body;

    if (!runId || !message) {
      return NextResponse.json(
        { error: "runId and message are required" },
        { status: 400 },
      );
    }

    const validPriorities = ["low", "normal", "high", "critical"];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json(
        {
          error: `Invalid priority: ${priority}. Use: ${validPriorities.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Verify the run is actually active
    const job = getActiveJob(runId);
    if (!job) {
      return NextResponse.json(
        { error: `No active run found with id: ${runId}` },
        { status: 404 },
      );
    }

    const nudge = enqueueNudge(runId, message, priority);

    return NextResponse.json({
      ok: true,
      nudge,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
