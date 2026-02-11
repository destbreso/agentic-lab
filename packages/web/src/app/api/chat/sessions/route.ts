import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/chat/sessions — List chat sessions
 * POST /api/chat/sessions — Create a new session
 */

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

// Simulated sessions for when storage isn't configured
const demoSessions = [
  {
    id: "session-demo-1",
    title: "Debug auth middleware",
    model: "llama3.1:8b",
    provider: "ollama",
    messageCount: 12,
    tokenCount: 4820,
    status: "completed" as const,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2 + 3600000).toISOString(),
  },
  {
    id: "session-demo-2",
    title: "Refactor pipeline orchestrator",
    model: "qwen2.5-coder:7b",
    provider: "ollama",
    messageCount: 28,
    tokenCount: 11230,
    status: "completed" as const,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000 + 7200000).toISOString(),
  },
  {
    id: "session-demo-3",
    title: "New session",
    model: "llama3.1:8b",
    provider: "ollama",
    messageCount: 0,
    tokenCount: 0,
    status: "active" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export async function GET() {
  try {
    const storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json({ sessions: demoSessions });
    }
    // In production: const sessions = await storage.chat.listSessions();
    return NextResponse.json({ sessions: demoSessions });
  } catch {
    return NextResponse.json({ sessions: demoSessions });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const newSession = {
      id: `session-${Date.now()}`,
      title: body.title || "New session",
      model: body.model || "llama3.1:8b",
      provider: body.provider || "ollama",
      messageCount: 0,
      tokenCount: 0,
      status: "active" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return NextResponse.json({ session: newSession }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
