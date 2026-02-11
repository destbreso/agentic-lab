import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/chat/send — Send a message and get AI response
 *
 * Streams the response via SSE-style chunks for the chat UI.
 * In production this calls the core loop engine; for now it
 * hits Ollama directly for a snappy chat experience.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      message,
      model = "llama3.1:8b",
      provider = "ollama",
      sessionId,
      context = [],
    } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    if (provider === "ollama") {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

      const messages = [
        {
          role: "system",
          content:
            "You are Agentic Lab assistant — a multi-loop agentic engine. You help users build, debug, and understand agentic pipelines. Be concise and technical. Use code blocks when showing code.",
        },
        ...context.map((c: { role: string; content: string }) => ({
          role: c.role,
          content: c.content,
        })),
        { role: "user", content: message },
      ];

      const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
        }),
      });

      if (!ollamaRes.ok || !ollamaRes.body) {
        return NextResponse.json(
          { error: `Ollama error: ${ollamaRes.statusText}` },
          { status: 502 },
        );
      }

      // Stream Ollama's response through
      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async pull(controller) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          // Ollama sends newline-delimited JSON
          const lines = text.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              const chunk = JSON.stringify({
                content: parsed.message?.content || "",
                done: parsed.done || false,
                model: parsed.model,
                eval_count: parsed.eval_count,
                eval_duration: parsed.eval_duration,
                total_duration: parsed.total_duration,
                prompt_eval_count: parsed.prompt_eval_count,
              });
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            } catch {
              // skip malformed lines
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Fallback for non-ollama providers
    return NextResponse.json({
      response: `Provider "${provider}" is not yet configured. Please use Ollama.`,
      model,
      sessionId,
      tokens: 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
