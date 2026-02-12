// ============================================
// API: /api/memories/namespaces — List all namespaces
// ============================================

import { NextResponse } from "next/server";

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
 * GET /api/memories/namespaces
 * Returns a list of distinct namespaces across all memories.
 */
export async function GET() {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json({ namespaces: [] });
    }

    // Fetch all memories to extract unique namespaces
    const allMemories = await storage.memory.search([], { limit: 5000 });
    const nsSet = new Map<string, number>();
    for (const m of allMemories) {
      const nsKey = m.namespace.join("/");
      nsSet.set(nsKey, (nsSet.get(nsKey) || 0) + 1);
    }

    const namespaces = Array.from(nsSet.entries())
      .map(([path, count]) => ({
        path,
        segments: path ? path.split("/") : [],
        count,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return NextResponse.json({ namespaces, total: allMemories.length });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
