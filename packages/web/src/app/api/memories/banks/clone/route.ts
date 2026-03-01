// ============================================
// API: /api/memories/banks/clone — Clone / transfer memories
// ============================================
// Copies memories from one namespace into a memory bank (or vice versa).
// Supports session→bank, bank→bank transfers.
//
// POST /api/memories/banks/clone
// Body: {
//   sourceNamespace: string[],   // e.g. ["chat", "session-123"] or ["memory-bank", "bank-abc"]
//   targetBankId: string,        // existing bank ID to clone INTO
//   overwrite?: boolean,         // if true, clears target before copying
// }

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

export async function POST(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const { sourceNamespace, targetBankId, overwrite = false } = body as {
      sourceNamespace: string[];
      targetBankId: string;
      overwrite?: boolean;
    };

    if (!sourceNamespace?.length || !targetBankId) {
      return NextResponse.json(
        { error: "sourceNamespace and targetBankId are required" },
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

    const targetNs = ["memory-bank", targetBankId];

    // Verify target bank exists (has __meta__)
    const meta = await storage.memory.get(targetNs, "__meta__");
    if (!meta) {
      return NextResponse.json(
        { error: `Bank "${targetBankId}" not found` },
        { status: 404 },
      );
    }

    // Optionally clear destination (except __meta__)
    if (overwrite) {
      const existing = await storage.memory.search(targetNs, { limit: 5000 });
      for (const m of existing) {
        if (m.key !== "__meta__") {
          await storage.memory.delete(targetNs, m.key);
        }
      }
    }

    // Copy from source
    const sourceMemories = await storage.memory.search(sourceNamespace, {
      limit: 2000,
    });

    let copied = 0;
    for (const m of sourceMemories) {
      // Skip __meta__ keys from source — don't overwrite target bank meta
      if (m.key === "__meta__") continue;

      // Prefix key with "clone-" to avoid collisions
      const newKey = `clone-${Date.now()}-${copied}`;
      await storage.memory.put(targetNs, newKey, {
        ...m.value,
        clonedFrom: sourceNamespace.join("/"),
        originalKey: m.key,
        clonedAt: new Date().toISOString(),
      });
      copied++;
    }

    // Update bank metadata (updatedAt)
    await storage.memory.put(targetNs, "__meta__", {
      ...(meta.value as Record<string, unknown>),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      message: `Cloned ${copied} memories from [${sourceNamespace.join("/")}] to bank "${targetBankId}"`,
      copied,
      sourceNamespace: sourceNamespace.join("/"),
      targetBankId,
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
