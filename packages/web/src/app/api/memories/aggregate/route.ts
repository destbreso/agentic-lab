// ============================================
// API: /api/memories/aggregate
// ============================================
// Aggregates (compresses) semantic memories in a namespace.
// Uses the LLM to summarize many small memories into fewer,
// higher-quality entries — similar to how human long-term
// memory consolidates experiences into lasting knowledge.
//
// POST /api/memories/aggregate
// Body: {
//   namespace: string[],        // e.g. ["chat","session-abc"] or ["memory-bank","my-bank"]
//   model?: string,
//   provider?: string,
//   maxSummaries?: number,      // target number of consolidated memories (default: 5)
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

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

/** Call the LLM via /api/chat/send to produce a summary */
async function callLLMForSummary(
  prompt: string,
  model: string,
  provider: string,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: prompt,
      model,
      provider,
      context: [],
      // Don't save this meta-call to memory
    }),
  });

  if (!res.ok) throw new Error(`LLM call failed: HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No reader");

  const decoder = new TextDecoder();
  let fullContent = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.content) fullContent += data.content;
      } catch {
        /* skip */
      }
    }
  }

  return fullContent;
}

export async function POST(request: NextRequest) {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    const body = await request.json();
    const {
      namespace = [],
      model = "llama3.1:8b",
      provider = "ollama",
      maxSummaries = 5,
    } = body as {
      namespace: string[];
      model?: string;
      provider?: string;
      maxSummaries?: number;
    };

    if (!namespace.length) {
      return NextResponse.json(
        { error: "namespace is required" },
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

    // 1. Fetch all memories in the namespace
    const memories = await storage.memory.search(namespace, { limit: 1000 });

    if (memories.length <= maxSummaries) {
      return NextResponse.json({
        message:
          "No aggregation needed — memory count is already within target",
        memoryCount: memories.length,
        target: maxSummaries,
      });
    }

    // 2. Build a prompt for the LLM to consolidate these memories
    const memoryTexts = memories
      .map((m, i) => {
        const text = (m.value.text as string) || JSON.stringify(m.value);
        const role = (m.value.role as string) || "unknown";
        return `[${i + 1}] (${role}) ${text.slice(0, 600)}`;
      })
      .join("\n");

    const aggregationPrompt = `You are a memory consolidation engine. You receive a list of ${memories.length} memories from a conversation history and must compress them into exactly ${maxSummaries} consolidated summaries.

Each summary should:
- Capture the ESSENCE of multiple related memories
- Preserve key facts, decisions, code patterns, and important context
- Discard trivial/repetitive content
- Be self-contained and useful for future conversations

MEMORIES TO CONSOLIDATE:
${memoryTexts}

Respond with ONLY a JSON array of ${maxSummaries} objects, no markdown:
[{"title": "short title", "summary": "detailed consolidated summary", "importance": "high|medium|low", "topics": ["topic1","topic2"]}]`;

    const llmResponse = await callLLMForSummary(
      aggregationPrompt,
      model,
      provider,
    );

    // 3. Parse the LLM response
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json(
        {
          error: "LLM did not return valid JSON",
          llmResponse: llmResponse.slice(0, 500),
        },
        { status: 500 },
      );
    }

    let summaries: Array<{
      title: string;
      summary: string;
      importance: string;
      topics: string[];
    }>;
    try {
      summaries = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json(
        {
          error: "Failed to parse LLM JSON",
          llmResponse: llmResponse.slice(0, 500),
        },
        { status: 500 },
      );
    }

    // 4. Delete old memories and write consolidated ones
    await storage.memory.deleteNamespace(namespace);

    const newMemories = [];
    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i];
      const mem = await storage.memory.put(
        namespace,
        `consolidated-${Date.now()}-${i}`,
        {
          text: s.summary,
          title: s.title,
          role: "system",
          messageType: "consolidated",
          importance: s.importance,
          topics: s.topics,
          aggregatedFrom: memories.length,
          aggregatedAt: new Date().toISOString(),
        },
      );
      newMemories.push(mem);
    }

    return NextResponse.json({
      message: `Aggregated ${memories.length} memories into ${newMemories.length} consolidated summaries`,
      before: memories.length,
      after: newMemories.length,
      memories: newMemories,
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
