// ============================================
// API: /api/runs — Run management endpoints
// ============================================

import { NextRequest, NextResponse } from "next/server";

// In a production setup, this would import from @agentic-lab/core
// and connect to the real storage. For now, we use the same
// pattern and will wire it up via env vars.

const STORAGE_API_URL = process.env.STORAGE_API_URL || "http://localhost:3100";

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

  try {
    const storage = await getStorageClient();
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
  }
}
