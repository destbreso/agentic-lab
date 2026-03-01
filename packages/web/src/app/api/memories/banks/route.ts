// ============================================
// API: /api/memories/banks — Named memory banks
// ============================================
// Memory banks are named semantic memory pools that can
// be shared across sessions, runs, and benchmarks.
//
// All banks live under the ["memory-bank", bankId] namespace.
// A bank's metadata is stored as a special key `__meta__`.
//
// GET    /api/memories/banks           — List all banks
// POST   /api/memories/banks           — Create a new bank
// DELETE  /api/memories/banks?id=X     — Delete a bank
// POST   /api/memories/banks/clone     — Clone bank contents to another

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

/** Metadata stored in each bank under __meta__ key */
interface BankMeta {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  sourceSession?: string;
  tags: string[];
}

/**
 * GET /api/memories/banks
 * List all memory banks with their metadata and item count.
 */
export async function GET() {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json({ banks: [] });
    }

    // List all memories in the "memory-bank" parent namespace
    const allMemories = await storage.memory.search(["memory-bank"], {
      limit: 5000,
    });

    // Group by bank ID (second namespace segment)
    const bankMap = new Map<
      string,
      { meta: BankMeta | null; itemCount: number }
    >();

    for (const m of allMemories) {
      const bankId = m.namespace[1]; // ["memory-bank", bankId, ...]
      if (!bankId) continue;

      if (!bankMap.has(bankId)) {
        bankMap.set(bankId, { meta: null, itemCount: 0 });
      }
      const entry = bankMap.get(bankId)!;

      if (m.key === "__meta__") {
        entry.meta = m.value as unknown as BankMeta;
      } else {
        entry.itemCount++;
      }
    }

    const banks = Array.from(bankMap.entries()).map(
      ([id, { meta, itemCount }]) => ({
        id,
        name: meta?.name || id,
        description: meta?.description || "",
        createdAt: meta?.createdAt || "",
        updatedAt: meta?.updatedAt || "",
        sourceSession: meta?.sourceSession,
        tags: meta?.tags || [],
        itemCount,
      }),
    );

    // Sort by creation date (newest first)
    banks.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({ banks });
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
 * POST /api/memories/banks
 * Create a new memory bank.
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   tags?: string[],
 *   sourceSession?: string,        // optional: pre-populate from a session's memories
 * }
 */
export async function POST(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const { name, description = "", tags = [], sourceSession } = body as {
      name: string;
      description?: string;
      tags?: string[];
      sourceSession?: string;
    };

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
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

    const bankId = `bank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ns = ["memory-bank", bankId];
    const now = new Date().toISOString();

    // Store the bank metadata
    const meta: BankMeta = {
      id: bankId,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      sourceSession,
      tags,
    };

    await storage.memory.put(ns, "__meta__", meta as unknown as Record<string, unknown>);

    // If sourceSession is provided, copy memories from that session
    let copiedCount = 0;
    if (sourceSession) {
      try {
        const sessionMemories = await storage.memory.search(
          ["chat", sourceSession],
          { limit: 500 },
        );
        for (const m of sessionMemories) {
          await storage.memory.put(ns, m.key, m.value);
          copiedCount++;
        }
      } catch {
        // Source copy is best-effort
      }
    }

    return NextResponse.json(
      {
        bank: { ...meta, itemCount: copiedCount },
        copiedFromSession: copiedCount > 0 ? copiedCount : undefined,
      },
      { status: 201 },
    );
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
 * DELETE /api/memories/banks?id=X
 * Delete a memory bank and all its contents.
 */
export async function DELETE(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Bank ID required" },
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

    await storage.memory.deleteNamespace(["memory-bank", id]);

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
