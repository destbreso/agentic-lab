// ============================================
// API: /api/memory/status — Memory health & stats
// ============================================
// Returns the state of the memory infrastructure
// (PostgreSQL, Qdrant) and per-session memory counts.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface MemoryStatus {
  /** Overall status */
  status: "active" | "degraded" | "unavailable";
  /** Backend store health */
  store: {
    type: "postgres" | "memory" | "unavailable";
    healthy: boolean;
  };
  /** Vector search (Qdrant) health */
  vectorSearch: {
    available: boolean;
    healthy: boolean;
  };
  /** Per-session stats (when sessionId is provided) */
  session?: {
    id: string;
    memoryCount: number;
    namespace: string[];
  };
  /** Memory bank stats (when memoryNamespace is provided) */
  bank?: {
    id: string;
    memoryCount: number;
    namespace: string[];
  };
  /** Human-readable description */
  message: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const memoryNamespace = searchParams.get("memoryNamespace");

  const result: MemoryStatus = {
    status: "unavailable",
    store: { type: "unavailable", healthy: false },
    vectorSearch: { available: false, healthy: false },
    message: "Memory infrastructure not available",
  };

  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;

  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(result);
    }

    // ── Check store health ──
    const storeHealthy = await storage.healthy();
    const isPostgres =
      !!process.env.POSTGRES_HOST ||
      !!process.env.POSTGRES_URL ||
      !!process.env.DATABASE_URL;
    result.store = {
      type: isPostgres ? "postgres" : "memory",
      healthy: storeHealthy,
    };

    // ── Check Qdrant health ──
    const qdrantHost = process.env.QDRANT_HOST || process.env.QDRANT_URL;
    if (qdrantHost) {
      result.vectorSearch.available = true;
      try {
        const qdrantUrl =
          process.env.QDRANT_URL ||
          `http://${process.env.QDRANT_HOST || "localhost"}:${process.env.QDRANT_PORT || "6333"}`;
        const res = await fetch(`${qdrantUrl}/healthz`, {
          signal: AbortSignal.timeout(3000),
        });
        result.vectorSearch.healthy = res.ok;
      } catch {
        result.vectorSearch.healthy = false;
      }
    }

    // ── Determine overall status ──
    if (storeHealthy && result.vectorSearch.healthy) {
      result.status = "active";
      result.message = "Memory fully operational (PostgreSQL + Qdrant)";
    } else if (storeHealthy) {
      result.status = "degraded";
      result.message = result.vectorSearch.available
        ? "Memory saving works. Semantic search unavailable (Qdrant unhealthy) — using text fallback."
        : "Memory saving works. Semantic search not configured (no Qdrant) — using text fallback.";
    } else {
      result.status = "unavailable";
      result.message = "Memory infrastructure not available";
    }

    // ── Session memory stats ──
    if (sessionId) {
      const ns = memoryNamespace
        ? ["memory-bank", memoryNamespace]
        : ["chat", sessionId];
      try {
        const items = await storage.memory.search(ns, { limit: 1000 });
        if (memoryNamespace) {
          result.bank = {
            id: memoryNamespace,
            memoryCount: items.filter((m) => m.key !== "__meta__").length,
            namespace: ns,
          };
        } else {
          result.session = {
            id: sessionId,
            memoryCount: items.length,
            namespace: ns,
          };
        }
      } catch {
        // Count unavailable
      }
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(result);
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}
