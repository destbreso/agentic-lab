// ============================================
// API: /api/memories — Memory management
// ============================================
// List, create, search memories with optional
// Qdrant-powered semantic search.

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
 * GET /api/memories?namespace=...&q=...&limit=...
 * - No params: list all memories
 * - namespace: filter by namespace (comma-separated path)
 * - q: semantic search query (requires Qdrant)
 * - limit: max results
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const nsParam = searchParams.get("namespace");
  const query = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { memories: [], total: 0, message: "Storage not configured" },
        { status: 200 },
      );
    }

    const namespace = nsParam ? nsParam.split(",").filter(Boolean) : [];

    // Semantic search
    if (query) {
      try {
        const results = await storage.memory.semanticSearch(namespace, query, {
          limit,
        });
        return NextResponse.json({
          memories: results,
          total: results.length,
          searchType: "semantic",
          query,
        });
      } catch (error) {
        // If semantic search is not available, fall back to listing with filter
        const all = await storage.memory.search(namespace, { limit: 500 });
        const lowerQ = query.toLowerCase();
        const filtered = all.filter((m) => {
          const text = JSON.stringify(m.value).toLowerCase();
          return (
            text.includes(lowerQ) || m.key.toLowerCase().includes(lowerQ)
          );
        });
        return NextResponse.json({
          memories: filtered.slice(0, limit),
          total: filtered.length,
          searchType: "text-fallback",
          query,
          note: (error as Error).message,
        });
      }
    }

    // List by namespace
    const memories = await storage.memory.search(namespace, { limit });
    return NextResponse.json({ memories, total: memories.length });
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
 * POST /api/memories
 * Body: { namespace: string[], key: string, value: Record<string, unknown> }
 */
export async function POST(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const {
      namespace,
      key,
      value,
    }: {
      namespace: string[];
      key: string;
      value: Record<string, unknown>;
    } = body;

    if (!key || !value) {
      return NextResponse.json(
        { error: "key and value are required" },
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

    const item = await storage.memory.put(namespace || [], key, value);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
