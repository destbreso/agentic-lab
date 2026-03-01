// ============================================
// API: /api/runs/[id] — Single run details
// ============================================

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 },
      );
    }

    const run = await storage.runs.getRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Fetch iterations and tool calls
    const iterations = await storage.runs.getIterations(run.id);

    return NextResponse.json({
      run,
      iterations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 },
      );
    }

    const deleted = await storage.runs.deleteRun(id);
    if (!deleted) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

/**
 * PATCH /api/runs/[id] — Update a run's status or metadata
 * Body: { status?: string, summary?: string, tags?: string[] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const allowedUpdates: Record<string, unknown> = {};

    // Whitelist fields that can be updated
    if (body.status && typeof body.status === "string") {
      const valid = ["completed", "failed", "cancelled", "archived", "running", "pending"];
      if (!valid.includes(body.status)) {
        return NextResponse.json(
          { error: `Invalid status: ${body.status}. Allowed: ${valid.join(", ")}` },
          { status: 400 },
        );
      }
      allowedUpdates.status = body.status;
    }
    if (body.summary && typeof body.summary === "string") {
      allowedUpdates.summary = body.summary.slice(0, 500);
    }
    if (body.tags && Array.isArray(body.tags)) {
      allowedUpdates.tags = body.tags.filter(
        (t: unknown) => typeof t === "string",
      );
    }
    if (body.name && typeof body.name === "string") {
      allowedUpdates.name = body.name.slice(0, 120);
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 },
      );
    }

    const updated = await storage.runs.updateRun(id, allowedUpdates);
    if (!updated) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ run: updated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
