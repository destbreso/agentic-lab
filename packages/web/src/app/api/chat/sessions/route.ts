import { NextRequest, NextResponse } from "next/server";

/**
 * GET    /api/chat/sessions — List chat sessions (from Postgres)
 * POST   /api/chat/sessions — Create a new session
 * DELETE /api/chat/sessions?id=X — Delete a session
 * PATCH  /api/chat/sessions — Update a session
 */

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function GET() {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json({ sessions: [] });
    }
    const sessions = await storage.chat.listSessions({ limit: 50 });
    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ sessions: [] });
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    storage = await getStorageClient();

    const sessionData = {
      title: body.title || "New session",
      model: body.model || "llama3.1:8b",
      provider: body.provider || "ollama",
      mode: (body.mode || "chat") as "chat" | "agent",
      recipe: body.recipe,
      messageCount: 0,
      tokenCount: 0,
      status: "active" as const,
    };

    if (storage) {
      const session = await storage.chat.createSession(sessionData);
      return NextResponse.json({ session }, { status: 201 });
    }

    // Fallback: return a temporary session
    const fallback = {
      ...sessionData,
      id: `session-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json({ session: fallback }, { status: 201 });
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
        { error: "Session ID required" },
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
    const deleted = await storage.chat.deleteSession(id);
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

export async function PATCH(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json(
        { error: "Session ID required" },
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
    const session = await storage.chat.updateSession(id, updates);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
