import { NextRequest, NextResponse } from "next/server";
import {
  createProvider,
  buildMetaKnowledgePrompt,
  buildCompactMetaPrompt,
  detectMetaQuestion,
  type LLMProviderConfig,
} from "@agentic-lab/core";

/**
 * POST /api/chat/send — Send a message and get AI response
 *
 * Uses the core provider abstraction so ALL configured providers work
 * (Ollama, OpenAI, Anthropic, OpenRouter). Streams the response via SSE.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      message,
      model = "llama3.1:8b",
      provider: providerName = "ollama",
      sessionId,
      context = [],
    } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // --- Build provider config from environment ---
    const providerConfig: LLMProviderConfig = { model };

    if (providerName === "ollama") {
      providerConfig.baseUrl =
        process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    } else if (providerName === "openai") {
      providerConfig.apiKey = process.env.OPENAI_API_KEY;
    } else if (providerName === "anthropic") {
      providerConfig.apiKey = process.env.ANTHROPIC_API_KEY;
    } else if (providerName === "openrouter") {
      providerConfig.apiKey = process.env.OPENROUTER_API_KEY;
      providerConfig.baseUrl = "https://openrouter.ai/api/v1";
    }

    let llm;
    try {
      llm = createProvider(providerName, providerConfig);
    } catch {
      return NextResponse.json(
        {
          error: `Provider "${providerName}" is not available. Check your API keys in .env`,
        },
        { status: 400 },
      );
    }

    // --- Build messages array with meta-knowledge ---
    const metaConfidence = detectMetaQuestion(message);
    const runtimeCtx = {
      activeProvider: providerName,
      activeModel: model,
      sessionId,
    };
    const metaBlock =
      metaConfidence >= 0.5
        ? buildMetaKnowledgePrompt(runtimeCtx)
        : buildCompactMetaPrompt(runtimeCtx);

    const systemPrompt =
      `${metaBlock}\n\n` +
      "You are Agentic Lab assistant — a multi-loop agentic engine. You help users build, debug, and understand agentic pipelines. Be concise and technical. Use code blocks when showing code.";

    const messages = [
      {
        role: "system" as const,
        content: systemPrompt,
      },
      ...context.map((c: { role: string; content: string }) => ({
        role: c.role as "user" | "assistant",
        content: c.content,
      })),
      { role: "user" as const, content: message },
    ];

    // --- Stream via core provider ---
    if (llm.chatStream) {
      const encoder = new TextEncoder();
      const streamGen = llm.chatStream({ messages });

      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const { value, done } = await streamGen.next();
            if (done) {
              controller.close();
              return;
            }
            const chunk = JSON.stringify({
              content: value.text || "",
              done: value.type === "done",
              model,
              eval_count: value.usage?.outputTokens,
              prompt_eval_count: value.usage?.inputTokens,
            });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            if (value.type === "done") {
              controller.close();
            }
          } catch (err) {
            const errChunk = JSON.stringify({
              content: "",
              done: true,
              error: (err as Error).message,
            });
            controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
            controller.close();
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

    // --- Non-streaming fallback ---
    const result = await llm.chat({ messages });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunk = JSON.stringify({
          content: result.message.content || "",
          done: true,
          model: result.model,
          eval_count: result.usage.outputTokens,
          prompt_eval_count: result.usage.inputTokens,
        });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
