import { NextRequest, NextResponse } from "next/server";
import {
  createProvider,
  createStorage,
  buildMetaKnowledgePrompt,
  buildCompactMetaPrompt,
  detectMetaQuestion,
  type LLMProviderConfig,
  type Storage,
} from "@agentic-lab/core";

/**
 * Save a user + assistant exchange into semantic memory (best-effort).
 * Runs in the background so it doesn't block the SSE response.
 */
async function persistChatMemory(opts: {
  sessionId: string;
  memoryNamespace?: string;
  userText: string;
  assistantText: string;
  model: string;
}) {
  let st: Storage | null = null;
  try {
    st = await createStorage();
    const ns = opts.memoryNamespace
      ? ["memory-bank", opts.memoryNamespace]
      : ["chat", opts.sessionId];
    const ts = Date.now();

    // Store the user message
    await st.memory.put(ns, `user-${ts}`, {
      text: opts.userText.slice(0, 2000),
      role: "user",
      sessionId: opts.sessionId,
      messageType: "chat",
      timestamp: new Date(ts).toISOString(),
    });

    // Store the assistant response
    await st.memory.put(ns, `assistant-${ts}`, {
      text: opts.assistantText.slice(0, 4000),
      role: "assistant",
      sessionId: opts.sessionId,
      messageType: "chat",
      model: opts.model,
      timestamp: new Date(ts).toISOString(),
    });
  } catch {
    // Memory persistence is best-effort — never break the chat
  } finally {
    if (st) st.close().catch(() => {});
  }
}

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
      memoryNamespace,
      memoryEnabled = true,
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

    // --- Retrieve relevant semantic memories (best-effort) ---
    // If a memoryNamespace is provided, search within that memory bank;
    // otherwise fall back to the global "chat" namespace.
    // Strategy: try semanticSearch (Qdrant) first; if it fails, fall back
    // to a plain search + text filter through PostgreSQL.
    // Skip entirely if memoryEnabled is false.
    let memoryContext = "";
    let memorySearchType: "semantic" | "text-fallback" | "none" = "none";
    let storage: Storage | null = null;
    const searchNs = memoryNamespace
      ? ["memory-bank", memoryNamespace]
      : ["chat"];

    if (memoryEnabled) {
      try {
        storage = await createStorage();
        let memories: Awaited<ReturnType<typeof storage.memory.search>> = [];

        // 1. Try semantic search (requires healthy Qdrant)
        try {
          memories = await storage.memory.semanticSearch(searchNs, message, {
            limit: 5,
          });
          if (memories.length > 0) memorySearchType = "semantic";
        } catch {
          // Qdrant unavailable — fall back to text search
        }

        // 2. Fallback: plain search + text relevance filter
        if (memories.length === 0) {
          try {
            const all = await storage.memory.search(searchNs, { limit: 200 });
            const lowerQ = message.toLowerCase();
            const keywords = lowerQ.split(/\s+/).filter((w: string) => w.length > 3);
            memories = all
              .filter((m: { value: Record<string, unknown> }) => {
                const t = ((m.value.text as string) || "").toLowerCase();
                return keywords.some((kw: string) => t.includes(kw));
              })
              .slice(0, 5);
            if (memories.length > 0) memorySearchType = "text-fallback";
          } catch {
            // search also failed — proceed without
          }
        }

        if (memories.length > 0) {
          const snippets = memories.map((m) => {
            const role = (m.value.role as string) || "unknown";
            const text = (m.value.text as string) || JSON.stringify(m.value);
            const sid = (m.value.sessionId as string) || "";
            const sessionTag =
              sid && sid !== sessionId ? ` [session:${sid.slice(0, 8)}]` : "";
            return `[${role}${sessionTag}]: ${text.slice(0, 500)}`;
          });
          memoryContext = `\n\n---\nRELEVANT MEMORIES FROM PREVIOUS CONVERSATIONS:\n${snippets.join("\n")}\n---\n`;
        }
      } catch {
        // No memory available — proceed without
      } finally {
        if (storage) storage.close().catch(() => {});
      }
    }

    const systemPrompt =
      `${metaBlock}\n\n` +
      "You are Agentic Lab assistant — a multi-loop agentic engine. You help users build, debug, and understand agentic pipelines. Be concise and technical. Use code blocks when showing code." +
      memoryContext;

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
      let fullContent = ""; // accumulate for memory persistence
      let sentMemoryEvent = false;

      const stream = new ReadableStream({
        async pull(controller) {
          try {
            // Emit memory retrieval event at the start (once)
            if (!sentMemoryEvent) {
              sentMemoryEvent = true;
              const memEvent = JSON.stringify({
                event: "memory",
                phase: "retrieval",
                searchType: memorySearchType,
                memoriesFound: memorySearchType !== "none",
                namespace: searchNs,
              });
              controller.enqueue(encoder.encode(`data: ${memEvent}\n\n`));
            }

            const { value, done } = await streamGen.next();
            if (done) {
              // Persist to memory after stream completes (fire-and-forget)
              if (memoryEnabled && sessionId && fullContent) {
                persistChatMemory({
                  sessionId,
                  memoryNamespace,
                  userText: message,
                  assistantText: fullContent,
                  model,
                }).catch(() => {});
                // Emit memory persist event
                const saveEvent = JSON.stringify({
                  event: "memory",
                  phase: "saved",
                  namespace: memoryNamespace
                    ? ["memory-bank", memoryNamespace]
                    : ["chat", sessionId],
                });
                controller.enqueue(encoder.encode(`data: ${saveEvent}\n\n`));
              }
              controller.close();
              return;
            }
            if (value.text) fullContent += value.text;
            const chunk = JSON.stringify({
              content: value.text || "",
              done: value.type === "done",
              model,
              eval_count: value.usage?.outputTokens,
              prompt_eval_count: value.usage?.inputTokens,
            });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            if (value.type === "done") {
              if (memoryEnabled && sessionId && fullContent) {
                persistChatMemory({
                  sessionId,
                  memoryNamespace,
                  userText: message,
                  assistantText: fullContent,
                  model,
                }).catch(() => {});
                const saveEvent = JSON.stringify({
                  event: "memory",
                  phase: "saved",
                  namespace: memoryNamespace
                    ? ["memory-bank", memoryNamespace]
                    : ["chat", sessionId],
                });
                controller.enqueue(encoder.encode(`data: ${saveEvent}\n\n`));
              }
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
    const assistantContent = result.message.content || "";

    // Persist to memory (fire-and-forget)
    if (memoryEnabled && sessionId && assistantContent) {
      persistChatMemory({
        sessionId,
        memoryNamespace,
        userText: message,
        assistantText: assistantContent,
        model,
      }).catch(() => {});
    }

    const stream = new ReadableStream({
      start(controller) {
        // Memory retrieval event
        const memEvent = JSON.stringify({
          event: "memory",
          phase: "retrieval",
          searchType: memorySearchType,
          memoriesFound: memorySearchType !== "none",
          namespace: searchNs,
        });
        controller.enqueue(encoder.encode(`data: ${memEvent}\n\n`));

        const chunk = JSON.stringify({
          content: assistantContent,
          done: true,
          model: result.model,
          eval_count: result.usage.outputTokens,
          prompt_eval_count: result.usage.inputTokens,
        });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

        // Memory saved event
        if (sessionId && assistantContent) {
          const saveEvent = JSON.stringify({
            event: "memory",
            phase: "saved",
            namespace: memoryNamespace
              ? ["memory-bank", memoryNamespace]
              : ["chat", sessionId],
          });
          controller.enqueue(encoder.encode(`data: ${saveEvent}\n\n`));
        }

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
