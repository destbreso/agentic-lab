// ============================================
// API: /api/memories/[key] — Single memory ops
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

/**
 * GET /api/memories/[key]?namespace=...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const { searchParams } = new URL(request.url);
  const nsParam = searchParams.get("namespace");
  const namespace = nsParam ? nsParam.split(",").filter(Boolean) : [];

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 },
      );
    }

    const item = await storage.memory.get(namespace, decodeURIComponent(key));
    if (!item) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(item);
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
 * DELETE /api/memories/[key]?namespace=...
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const { searchParams } = new URL(request.url);
  const nsParam = searchParams.get("namespace");
  const namespace = nsParam ? nsParam.split(",").filter(Boolean) : [];

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 },
      );
    }

    const deleted = await storage.memory.delete(
      namespace,
      decodeURIComponent(key),
    );
    if (!deleted) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 },
      );
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
