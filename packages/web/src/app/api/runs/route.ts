// ============================================
// API: /api/runs — Run management endpoints
// ============================================

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function getStorageClient() {
  // Dynamic import to avoid bundling issues
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const provider = searchParams.get("provider") || undefined;
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { runs: [], total: 0, message: "Storage not configured" },
        { status: 200 },
      );
    }

    const result = await storage.runs.listRuns({
      status,
      provider,
      limit,
      offset,
      orderBy: "created_at",
      orderDir: "desc",
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
