import { NextRequest, NextResponse } from "next/server";
import { steerRun, type NudgePriority } from "jig-core";

/**
 * POST /api/chat/agent/nudge: steer a running agent task.
 *
 * Body: { runId: string, message: string, priority?: "low" | "normal" | "high" | "critical" }
 *
 * The note reaches Do as a context signal, read on its next turn; no other
 * role sees it. The priority is carried as a label in the note.
 */
const PRIORITIES: NudgePriority[] = ["low", "normal", "high", "critical"];

export async function POST(request: NextRequest) {
  try {
    const { runId, message, priority = "normal" } = await request.json();

    if (!runId || !message) {
      return NextResponse.json({ error: "runId and message are required" }, { status: 400 });
    }
    if (!PRIORITIES.includes(priority)) {
      return NextResponse.json(
        { error: `Invalid priority: ${priority}. Use: ${PRIORITIES.join(", ")}` },
        { status: 400 },
      );
    }

    const note = steerRun(runId, message, priority);
    if (!note) {
      return NextResponse.json({ error: `No active run found with id: ${runId}` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, nudge: note });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
