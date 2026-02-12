import { NextRequest, NextResponse } from "next/server";

/**
 * GET  /api/chat/messages?sessionId=X — Get messages for a session
 * POST /api/chat/messages — Save a new message
 */

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json({ messages: [] });
    }

    const limit = parseInt(searchParams.get("limit") || "200", 10);
    const after = searchParams.get("after") || undefined;
    const messages = await storage.chat.getMessages(sessionId, {
      limit,
      after,
    });
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const {
      sessionId,
      role,
      content,
      tokens,
      durationMs,
      model,
      messageType,
      metadata,
    } = body;

    if (!sessionId || !role || !content) {
      return NextResponse.json(
        { error: "sessionId, role, and content are required" },
        { status: 400 },
      );
    }

    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage unavailable" },
        { status: 503 },
      );
    }

    const message = await storage.chat.saveMessage({
      sessionId,
      role,
      content,
      tokens: tokens || undefined,
      durationMs: durationMs || undefined,
      model: model || undefined,
      messageType: messageType || "text",
      metadata: metadata || {},
    });

    // ── Auto-embed into semantic memory (best-effort, non-blocking) ──
    // Stores meaningful messages in Qdrant so future sessions can recall
    // relevant context via semantic search. Short/system messages are skipped.
    if (content.length > 20 && role !== "system" && messageType !== "error") {
      (async () => {
        try {
          const ns = ["chat", sessionId];
          const key = `msg-${message.id}`;
          await storage.memory.put(ns, key, {
            text: content,
            role,
            sessionId,
            messageId: message.id,
            model: model || undefined,
            messageType: messageType || "text",
            tokens: tokens || undefined,
          });
        } catch {
          // Embedding failures must not break the response
        }
      })();
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

export async function DELETE(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Message ID required" },
        { status: 400 },
      );
    }

    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage unavailable" },
        { status: 503 },
      );
    }

    const deleted = await storage.chat.deleteMessage(id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
