import { NextRequest, NextResponse } from "next/server";
import { EventEmitter } from "events";
import {
  createProvider,
  listRecipes,
  buildMetaKnowledgePrompt,
  buildCompactMetaPrompt,
  detectMetaQuestion,
  createStorageWithRedis,
  type LLMProvider,
  type LLMProviderConfig,
  type ChatMessage,
  type Storage,
  type RedisEventBus,
} from "@agentic-lab/core";

// ── Shared process-wide state for active jobs and nudge queues ──
// Imported from a dedicated module to guarantee a SINGLE instance
// across all route handlers (agent, nudge, cancel). Without this,
// Next.js/Turbopack creates separate module instances per route.
import {
  JobCancelledError,
  registerJob,
  unregisterJob,
  drainNudges,
  formatNudgesAsMessage,
} from "./job-store";

/**
 * POST /api/chat/agent — Run an agentic task via the multi-loop engine
 *
 * Uses the core engine's provider abstraction and recipe registry.
 * Streams execution events as SSE so the chat UI can show real-time
 * pipeline progress (loop iterations, tool calls, planning, evaluation).
 *
 * All providers are supported (Ollama, OpenAI, Anthropic, OpenRouter)
 * via core's createProvider(). Recipe definitions come from core's
 * recipe registry — single source of truth.
 */

// ── Types ───────────────────────────────────────────────
interface AgentRequest {
  task: string;
  mode: "recipe" | "pipeline" | "auto";
  recipe?: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  memoryNamespace?: string;
  workingDir?: string;
  context?: Array<{ role: string; content: string }>;
}

type StepType =
  | "think"
  | "plan"
  | "tool"
  | "code"
  | "search"
  | "write"
  | "eval";
type StepStatus = "pending" | "running" | "completed" | "error" | "skipped";

interface SSEStep {
  event: "step";
  id: string;
  label: string;
  type: StepType;
  status: StepStatus;
  detail?: string;
  durationMs?: number;
  loop?: string;
  iteration?: number;
  contentPreview?: string;
}

interface SSESubtask {
  event: "subtask";
  parentStepId: string;
  id: string;
  label: string;
  status: StepStatus;
  index: number;
  total: number;
}

interface SSEThinking {
  event: "thinking";
  content: string;
  phase: string;
  round?: number;
}

interface SSEStream {
  event: "stream";
  content: string;
  done: boolean;
}

interface SSEResult {
  event: "result";
  content: string;
  finalAnswer: string;
  tokens: number;
  durationMs: number;
  loops: string[];
  iterations: number;
}

interface SSEError {
  event: "error";
  message: string;
}

type SSEPayload =
  | SSEStep
  | SSESubtask
  | SSEThinking
  | SSEStream
  | SSEResult
  | SSEError;

// ── Provider factory (uses core engine) ─────────────────

function createLLMProvider(providerName: string, model: string): LLMProvider {
  const config: LLMProviderConfig = { model };

  if (providerName === "ollama") {
    config.baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  } else if (providerName === "openai") {
    config.apiKey = process.env.OPENAI_API_KEY;
  } else if (providerName === "anthropic") {
    config.apiKey = process.env.ANTHROPIC_API_KEY;
  } else if (providerName === "openrouter") {
    config.apiKey = process.env.OPENROUTER_API_KEY;
    config.baseUrl = "https://openrouter.ai/api/v1";
  }

  return createProvider(providerName, config);
}

// ── Recipe helpers (uses core registry) ─────────────────

/** Build a simplified recipe lookup from core registry */
function getRecipeLookup(): Record<
  string,
  { name: string; loops: string[]; description: string }
> {
  const coreRecipes = listRecipes();
  const lookup: Record<
    string,
    { name: string; loops: string[]; description: string }
  > = {};

  for (const r of coreRecipes) {
    // Extract unique loop categories in order from nodes
    const loops = r.nodes.map((n) => n.category);
    lookup[r.id] = {
      name: r.name,
      loops,
      description: r.description,
    };
  }

  return lookup;
}

function pickRecipeForTask(
  task: string,
  recipes: Record<
    string,
    { name: string; loops: string[]; description: string }
  >,
): string {
  const lower = task.toLowerCase();

  if (
    lower.includes("deep") ||
    lower.includes("reason") ||
    lower.includes("complex") ||
    lower.includes("hard") ||
    lower.includes("difficult") ||
    lower.includes("think step by step") ||
    lower.includes("opus") ||
    lower.includes("refine")
  ) {
    return recipes["deep-reasoning"] ? "deep-reasoning" : "ralph-loop";
  }
  if (
    lower.includes("plan") ||
    lower.includes("architect") ||
    lower.includes("design")
  ) {
    return recipes["plan-exec-eval"]
      ? "plan-exec-eval"
      : recipes["full-pipeline"]
        ? "full-pipeline"
        : "ralph-loop";
  }
  if (
    lower.includes("full") ||
    lower.includes("complete") ||
    lower.includes("pipeline")
  ) {
    return recipes["full-pipeline"] || recipes["full-agent-pipeline"]
      ? "full-pipeline"
      : "ralph-loop";
  }
  if (
    lower.includes("verify") ||
    lower.includes("test") ||
    lower.includes("eval")
  ) {
    return recipes["exec-eval"] ? "exec-eval" : "ralph-loop";
  }
  if (
    lower.includes("compete") ||
    lower.includes("duel") ||
    lower.includes("adversarial") ||
    lower.includes("tournament") ||
    lower.includes("versus") ||
    lower.includes("compare") ||
    lower.includes("battle")
  ) {
    return recipes["adversarial-duel"] ? "adversarial-duel" : "ralph-loop";
  }
  if (
    lower.includes("supervise") ||
    lower.includes("team") ||
    lower.includes("code review") ||
    lower.includes("supervised") ||
    lower.includes("review my") ||
    lower.includes("pair program")
  ) {
    return recipes["supervised-coder"] ? "supervised-coder" : "ralph-loop";
  }

  return "ralph-loop";
}

function stepId() {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Rough cost estimate per 1K tokens (used for usage tracking).
 *  Ollama models use a "cloud equivalent" rate so users can see
 *  what the same workload would cost on a hosted API. */
function estimateCost(provider: string, model: string, tokens: number): number {
  const perK: Record<string, number> = {
    // Ollama — cloud-equivalent rates (local = free, but track value)
    "ollama:llama3.1:8b": 0.0001,
    "ollama:llama3.1:70b": 0.0008,
    "ollama:llama3.2:3b": 0.00006,
    "ollama:mistral": 0.0002,
    "ollama:mixtral": 0.0006,
    "ollama:codellama": 0.0002,
    "ollama:deepseek-coder": 0.0002,
    "ollama:qwen2.5-coder": 0.0002,
    ollama: 0.0001, // default for unlisted ollama models
    // OpenAI
    "openai:gpt-4o": 0.005,
    "openai:gpt-4o-mini": 0.00015,
    "openai:gpt-4-turbo": 0.01,
    // Anthropic
    "anthropic:claude-3-opus": 0.015,
    "anthropic:claude-3-sonnet": 0.003,
    "anthropic:claude-3-haiku": 0.00025,
    // OpenRouter (avg)
    openrouter: 0.002,
  };
  const key = `${provider}:${model}`;
  const rate = perK[key] ?? perK[provider] ?? 0;
  return (tokens / 1000) * rate;
}

// ── Core LLM helpers (using provider abstraction) ───────

/**
 * Call LLM without streaming — returns full content + token count.
 * Uses the core provider (works with ALL providers).
 * Accepts an optional AbortSignal to cancel in-flight requests.
 */
async function callLLM(
  provider: LLMProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ content: string; tokens: number }> {
  const result = await provider.chat({ messages, temperature: 0.7, signal });
  const tokens = result.usage.totalTokens;
  return { content: result.message.content || "", tokens };
}

/**
 * Call LLM with streaming — invokes onChunk per token, returns full content.
 * Falls back to non-streaming if provider doesn't support chatStream.
 * Accepts an optional AbortSignal to cancel in-flight requests.
 */
async function callLLMStreaming(
  provider: LLMProvider,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; tokens: number }> {
  if (provider.chatStream) {
    let content = "";
    let tokens = 0;
    for await (const chunk of provider.chatStream({
      messages,
      temperature: 0.7,
      signal,
    })) {
      if (chunk.type === "text" && chunk.text) {
        content += chunk.text;
        onChunk(chunk.text);
      }
      if (chunk.type === "done" && chunk.usage) {
        tokens = chunk.usage.totalTokens;
      }
    }
    return { content, tokens };
  }

  // Non-streaming fallback
  const result = await callLLM(provider, messages, signal);
  onChunk(result.content);
  return result;
}

// ── Route Handler ───────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: AgentRequest = await request.json();
    const {
      task,
      mode = "auto",
      recipe: requestedRecipe,
      model = "llama3.1:8b",
      provider: providerName = "ollama",
      context = [],
    } = body;

    if (!task) {
      return NextResponse.json({ error: "Task is required" }, { status: 400 });
    }

    // Create provider from core engine
    let llm: LLMProvider;
    try {
      llm = createLLMProvider(providerName, model);
    } catch {
      return NextResponse.json(
        {
          error: `Provider "${providerName}" is not available. Check your .env configuration.`,
        },
        { status: 400 },
      );
    }

    // Get recipes from core registry (single source of truth)
    const recipes = getRecipeLookup();

    const recipeId =
      mode === "recipe" && requestedRecipe
        ? requestedRecipe
        : mode === "auto"
          ? pickRecipeForTask(task, recipes)
          : "ralph-loop";

    const recipe = recipes[recipeId] ||
      recipes["ralph-loop"] || {
        name: "Ralph Loop",
        loops: ["execution"],
        description: "Single execution loop",
      };

    // ── Meta-Knowledge: inject system self-awareness ───
    // Detect if the user is asking about the system itself and choose
    // the appropriate level of meta-knowledge to inject.
    const metaConfidence = detectMetaQuestion(task);
    const runtimeCtx = {
      activeProvider: providerName,
      activeModel: model,
      activeRecipe: recipeId,
      sessionId: body.sessionId,
    };
    const metaPromptBlock =
      metaConfidence >= 0.5
        ? buildMetaKnowledgePrompt(runtimeCtx)
        : buildCompactMetaPrompt(runtimeCtx);

    // ── Storage & Event Bus (graceful — does NOT block if infra is down) ──
    let storage: Storage | null = null;
    let redisBus: RedisEventBus | null = null;
    try {
      const infra = await createStorageWithRedis();
      storage = infra.storage;
      redisBus = infra.redis ?? null;
    } catch {
      // No infra — proceed without persistence
    }

    // Create a persistent run record
    const runExternalId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let storedRunId: string | null = null;
    if (storage) {
      try {
        const run = await storage.runs.createRun({
          externalId: runExternalId,
          name: task.slice(0, 120),
          status: "running",
          provider: providerName,
          model,
          maxIterations: recipe.loops.length * 3,
          workingDir: body.workingDir || process.cwd(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          startedAt: new Date().toISOString(),
          config: { recipe: recipeId, mode },
          success: false,
          tags: [recipeId, providerName],
        });
        storedRunId = run.id;
      } catch {
        // Run creation failed — continue without persistence
      }
    }

    // ── Semantic memory retrieval: enrich context with past conversations ──
    // If a memoryNamespace (memory bank) is provided, search within it;
    // otherwise fall back to the global "chat" namespace.
    const memorySearchNs = body.memoryNamespace
      ? ["memory-bank", body.memoryNamespace]
      : ["chat"];
    if (storage) {
      try {
        const memories = await storage.memory.semanticSearch(
          memorySearchNs,
          task,
          {
            limit: 5,
          },
        );
        if (memories.length > 0) {
          const snippets = memories.map((m) => {
            const role = (m.value.role as string) || "unknown";
            const text = (m.value.text as string) || JSON.stringify(m.value);
            const sid = (m.value.sessionId as string) || "";
            const sessionTag =
              sid && sid !== body.sessionId
                ? ` [session:${sid.slice(0, 8)}]`
                : "";
            return `[${role}${sessionTag}]: ${text.slice(0, 500)}`;
          });
          context.unshift({
            role: "system",
            content: `RELEVANT MEMORIES FROM PREVIOUS CONVERSATIONS:\n${snippets.join("\n")}`,
          });
        }
      } catch {
        // Semantic search unavailable — proceed without memories
      }
    }

    const encoder = new TextEncoder();

    // ── Event emitter: decouples execution from SSE response ──
    // The execution publishes events here. The SSE stream subscribes.
    // If the client disconnects, the subscription ends but the job survives.
    const jobEmitter = new EventEmitter();
    jobEmitter.setMaxListeners(50);

    const send = (payload: SSEPayload) => {
      // Emit locally for SSE observer
      jobEmitter.emit("sse", payload);
      // Broadcast to Redis + persist event (best-effort, never blocks)
      const eventData = {
        id: Date.now(),
        runId: runExternalId,
        eventType: payload.event,
        payload: payload as unknown as Record<string, unknown>,
        createdAt: new Date().toISOString(),
      };
      if (redisBus) {
        redisBus.publishEvent(runExternalId, eventData).catch(() => {});
      }
      if (storage) {
        storage.events
          .emit(
            runExternalId,
            payload.event,
            payload as unknown as Record<string, unknown>,
          )
          .catch(() => {});
      }
    };

    /** Helper: persist an iteration record (best-effort) */
    const persistIteration = (opts: {
      number: number;
      tokens: number;
      content: string;
      loop: string;
      durationMs: number;
      success: boolean;
    }) => {
      if (!storage || !storedRunId) return;
      storage.runs
        .saveIteration({
          id: `iter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          runId: storedRunId,
          number: opts.number,
          success: opts.success,
          inputTokens: 0,
          outputTokens: opts.tokens,
          totalTokens: opts.tokens,
          responseText: opts.content.slice(0, 5000),
          planItemTitle: opts.loop,
          startedAt: new Date(Date.now() - opts.durationMs).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: opts.durationMs,
          errors: [],
        })
        .catch(() => {});
    };

    /** Helper: finalize the run record */
    const finalizeRun = async (opts: {
      success: boolean;
      totalTokens: number;
      totalIterations: number;
      summary: string;
      durationMs: number;
      status?: string; // explicit status override (e.g. "cancelled")
    }) => {
      if (!storage) return;
      try {
        const desiredStatus =
          opts.status ?? (opts.success ? "completed" : "failed");

        // Guard: if the cancel safety-net already set the run to "cancelled"
        // in storage, don't overwrite it (unless we're also setting "cancelled").
        if (desiredStatus !== "cancelled") {
          try {
            const current = await storage.runs.getRun(runExternalId);
            if (current?.status === "cancelled") {
              // Already cancelled by safety-net — skip status overwrite but
              // still update tokens/duration/summary
              await storage.runs.updateRun(runExternalId, {
                totalTokens: opts.totalTokens,
                durationMs: opts.durationMs,
                summary: opts.summary.slice(0, 500),
              });
              return;
            }
          } catch {
            // getRun failed — proceed with normal finalization
          }
        }

        await storage.runs.updateRun(runExternalId, {
          status: desiredStatus,
          success: opts.success,
          totalTokens: opts.totalTokens,
          endedAt: new Date().toISOString(),
          durationMs: opts.durationMs,
          summary: opts.summary.slice(0, 500),
        });
        // Record usage for cost tracking
        await storage.usage.record({
          runId: storedRunId || undefined,
          provider: providerName,
          model,
          inputTokens: 0,
          outputTokens: opts.totalTokens,
          totalTokens: opts.totalTokens,
          estimatedCost: estimateCost(providerName, model, opts.totalTokens),
        });
      } catch {
        // Best-effort
      }
    };

    // ── Background Job: runs to completion unless cancelled ──

    const jobAbort = new AbortController();

    /**
     * Check if the job has been cancelled by the user.
     * Called before every callLLM/callLLMStreaming and at iteration boundaries.
     * Throws JobCancelledError to unwind the job cleanly.
     */
    const checkCancelled = (): void => {
      if (jobAbort.signal.aborted) throw new JobCancelledError();
    };

    /**
     * Accumulated steering nudges. Once a nudge is consumed from the queue,
     * it moves here and is RE-INJECTED into EVERY subsequent LLM call.
     *
     * This solves the problem where specialized loops (adversarial, code-review,
     * deep-reasoning) build message arrays from scratch each phase — without
     * this, a nudge consumed during the "arena" phase would never be seen by
     * the "alpha", "beta", or "arbiter" phases because they construct new arrays
     * that don't include `context`.
     *
     * The accumulated nudges are injected as a single system message right before
     * the user's task message, so the LLM always sees the operator's corrections.
     */
    const accumulatedNudges: ChatMessage[] = [];

    /**
     * Drain queued nudges and inject them into an LLM message array.
     * Called before every callLLM/callLLMStreaming inside the job.
     * Also checks for cancellation before proceeding.
     *
     * New nudges are drained from the queue and added to `accumulatedNudges`.
     * Then ALL accumulated nudges (including from prior phases) are injected
     * into the current message array. This guarantees that steering corrections
     * are transversal: once sent, they affect every subsequent LLM call for the
     * entire run, regardless of how the messages are constructed.
     *
     * Returns the number of NEW nudges consumed (0 = no new nudges, but
     * previously accumulated nudges are still injected).
     */
    const injectNudges = (
      messages: ChatMessage[],
      onlyCritical = false,
    ): number => {
      checkCancelled();

      // 1. Drain new nudges from the queue
      const newNudges = drainNudges(runExternalId, onlyCritical);
      let newCount = 0;

      if (newNudges.length > 0) {
        newCount = newNudges.length;
        const nudgeMsg = formatNudgesAsMessage(newNudges);

        // Accumulate for re-injection in future calls
        accumulatedNudges.push(nudgeMsg);

        // Also persist into shared context for loops that use buildLoopMessages
        context.push({
          role: "user",
          content: nudgeMsg.content,
        });

        // Emit consumed event so the UI can update
        send({
          event: "steering:consumed",
          nudges: newNudges,
          injectionPoint: onlyCritical ? "mid-tool-loop" : "between-iterations",
        } as unknown as SSEPayload);
      }

      // 2. Always inject ALL accumulated nudges into the current call
      // so the LLM sees all corrections regardless of which phase we're in
      for (const msg of accumulatedNudges) {
        messages.push(msg);
      }

      return newCount;
    };

    const startTime = Date.now();
    let totalTokens = 0;
    let totalIterations = 0;
    let pendingSubtasks: Array<{
      parentStepId: string;
      id: string;
      label: string;
      status: StepStatus;
      index: number;
      total: number;
    }> = [];

    const jobPromise = (async () => {
      // Yield to the event loop so the SSE stream subscriber
      // (created after this IIFE) is wired up before we emit anything.
      await Promise.resolve();

      try {
        // ─── Emit runId so the client can reconnect ───
        send({
          event: "run_id",
          runId: runExternalId,
        } as unknown as SSEPayload);

        // ─── Phase 0: Initialization ───
        const initId = stepId();
        send({
          event: "step",
          id: initId,
          label: `Initializing ${recipe.name}`,
          type: "think",
          status: "running",
          detail: `Recipe: ${recipeId} · ${recipe.loops.length} loops · Provider: ${providerName}`,
        });
        await sleep(400);
        send({
          event: "step",
          id: initId,
          label: `Initializing ${recipe.name}`,
          type: "think",
          status: "completed",
          durationMs: 400,
          detail: `Recipe: ${recipeId} · ${recipe.loops.length} loops · Provider: ${providerName}`,
        });

        // ─── Deep Reasoning: iterative self-correcting engine ───
        if (recipeId === "deep-reasoning") {
          const MAX_ROUNDS = 3;
          const PASS_THRESHOLD = 0.7;
          let round = 0;
          let converged = false;
          let currentPlan = "";
          let currentOutput = "";
          let refinementHistory: string[] = [];

          while (round < MAX_ROUNDS && !converged) {
            round++;

            // ──── PLANNING PHASE ────
            const planStepId = stepId();
            const planLabel =
              round === 1
                ? "Strategic Planning"
                : `Re-planning (Round ${round})`;
            send({
              event: "step",
              id: planStepId,
              label: planLabel,
              type: "plan",
              status: "running",
              loop: "planning",
              iteration: round,
              detail:
                round === 1
                  ? "Analyzing task and building initial plan"
                  : `Incorporating feedback from round ${round - 1}`,
            });

            const planMessages: ChatMessage[] =
              round === 1
                ? buildLoopMessages("planning", task, context, metaPromptBlock)
                : buildDeepReasoningMessages(
                    "replan",
                    task,
                    context,
                    currentPlan,
                    currentOutput,
                    refinementHistory,
                    metaPromptBlock,
                  );

            const planStart = Date.now();
            injectNudges(planMessages);
            const planResult = await callLLM(
              llm,
              planMessages,
              jobAbort.signal,
            );
            currentPlan = planResult.content;
            totalTokens += planResult.tokens;

            send({
              event: "step",
              id: planStepId,
              label: planLabel,
              type: "plan",
              status: "completed",
              loop: "planning",
              iteration: round,
              durationMs: Date.now() - planStart,
              detail: getLoopDetail("planning", planResult.tokens, currentPlan),
              contentPreview: truncatePreview(currentPlan, 600),
            });

            // Extract subtasks from plan
            const planItems = extractActionItems(currentPlan);
            if (planItems.length > 0) {
              pendingSubtasks = [];
              for (let si = 0; si < planItems.length; si++) {
                const subId = `${planStepId}-sub-${si}`;
                const sub = {
                  parentStepId: planStepId,
                  id: subId,
                  label: planItems[si],
                  status: "pending" as StepStatus,
                  index: si,
                  total: planItems.length,
                };
                pendingSubtasks.push(sub);
                send({ event: "subtask", ...sub });
              }
            }

            context.push({
              role: "assistant",
              content: `[PLANNING ROUND ${round}]\n${currentPlan}`,
            });
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: planResult.tokens,
              content: currentPlan,
              loop: "planning",
              durationMs: Date.now() - planStart,
              success: true,
            });

            // ──── EXECUTION PHASE ────
            const execStepId = stepId();
            send({
              event: "step",
              id: execStepId,
              label:
                round === 1
                  ? "Executing Task"
                  : `Executing (Refined, Round ${round})`,
              type: "code",
              status: "running",
              loop: "execution",
              iteration: round,
            });

            const execMessages: ChatMessage[] =
              round === 1
                ? buildLoopMessages("execution", task, context, metaPromptBlock)
                : buildDeepReasoningMessages(
                    "re-execute",
                    task,
                    context,
                    currentPlan,
                    currentOutput,
                    refinementHistory,
                    metaPromptBlock,
                  );

            const execStart = Date.now();
            injectNudges(execMessages);
            const execResult = await callLLMStreaming(
              llm,
              execMessages,
              (chunk) => {
                // All deep-reasoning rounds emit as "thinking" — the final
                // answer will be sent separately in the "result" event
                send({
                  event: "thinking",
                  content: chunk,
                  phase: "execution",
                  round,
                });
              },
              jobAbort.signal,
            );
            currentOutput = execResult.content;
            totalTokens += execResult.tokens;

            // Complete pending subtasks
            for (const sub of pendingSubtasks) {
              if (sub.status !== "completed") {
                sub.status = "running";
                send({
                  event: "subtask",
                  parentStepId: sub.parentStepId,
                  id: sub.id,
                  label: sub.label,
                  status: "running",
                  index: sub.index,
                  total: sub.total,
                });
                await sleep(100);
                sub.status = "completed";
                send({
                  event: "subtask",
                  parentStepId: sub.parentStepId,
                  id: sub.id,
                  label: sub.label,
                  status: "completed",
                  index: sub.index,
                  total: sub.total,
                });
              }
            }

            send({
              event: "step",
              id: execStepId,
              label:
                round === 1
                  ? "Executing Task"
                  : `Executing (Refined, Round ${round})`,
              type: "code",
              status: "completed",
              loop: "execution",
              iteration: round,
              durationMs: Date.now() - execStart,
              detail: getLoopDetail(
                "execution",
                execResult.tokens,
                currentOutput,
              ),
              contentPreview: truncatePreview(currentOutput, 600),
            });

            context.push({
              role: "assistant",
              content: `[EXECUTION ROUND ${round}]\n${currentOutput}`,
            });
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: execResult.tokens,
              content: currentOutput,
              loop: "execution",
              durationMs: Date.now() - execStart,
              success: true,
            });

            // ──── EVALUATION PHASE ────
            const evalStepId = stepId();
            send({
              event: "step",
              id: evalStepId,
              label: `Evaluating Output (Round ${round})`,
              type: "eval",
              status: "running",
              loop: "evaluation",
              iteration: round,
            });

            const evalMessages = buildDeepReasoningMessages(
              "evaluate",
              task,
              context,
              currentPlan,
              currentOutput,
              refinementHistory,
              metaPromptBlock,
            );
            const evalStart = Date.now();
            injectNudges(evalMessages);
            const evalResult = await callLLM(
              llm,
              evalMessages,
              jobAbort.signal,
            );
            totalTokens += evalResult.tokens;

            const evalItems = extractEvalCriteria(evalResult.content);
            for (let si = 0; si < evalItems.length; si++) {
              send({
                event: "subtask",
                parentStepId: evalStepId,
                id: `${evalStepId}-eval-${si}`,
                label: evalItems[si].label,
                status: evalItems[si].pass ? "completed" : "error",
                index: si,
                total: evalItems.length,
              });
            }

            const passCount = evalItems.filter((e) => e.pass).length;
            const passRate =
              evalItems.length > 0 ? passCount / evalItems.length : 1;
            converged = passRate >= PASS_THRESHOLD;

            send({
              event: "step",
              id: evalStepId,
              label: `Evaluating Output (Round ${round})`,
              type: "eval",
              status: "completed",
              loop: "evaluation",
              iteration: round,
              durationMs: Date.now() - evalStart,
              detail: `${passCount}/${evalItems.length} checks passed (${Math.round(passRate * 100)}%) — ${converged ? "✅ CONVERGED" : "⚠️ Needs refinement"}`,
              contentPreview: truncatePreview(evalResult.content, 600),
            });

            context.push({
              role: "assistant",
              content: `[EVALUATION ROUND ${round}]\n${evalResult.content}`,
            });
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: evalResult.tokens,
              content: evalResult.content,
              loop: "evaluation",
              durationMs: Date.now() - evalStart,
              success: true,
            });

            // ──── CRITIC PHASE ────
            const criticStepId = stepId();
            send({
              event: "step",
              id: criticStepId,
              label: `Critic Review (Round ${round})`,
              type: "think",
              status: "running",
              loop: "critic",
              iteration: round,
            });

            const criticMessages = buildDeepReasoningMessages(
              "critic",
              task,
              context,
              currentPlan,
              currentOutput,
              refinementHistory,
              metaPromptBlock,
            );
            const criticStart = Date.now();
            injectNudges(criticMessages);
            const criticResult = await callLLM(
              llm,
              criticMessages,
              jobAbort.signal,
            );
            totalTokens += criticResult.tokens;

            const findings = extractCriticFindings(criticResult.content);
            for (let si = 0; si < findings.length; si++) {
              send({
                event: "subtask",
                parentStepId: criticStepId,
                id: `${criticStepId}-crit-${si}`,
                label: findings[si],
                status: "completed",
                index: si,
                total: findings.length,
              });
            }

            send({
              event: "step",
              id: criticStepId,
              label: `Critic Review (Round ${round})`,
              type: "think",
              status: "completed",
              loop: "critic",
              iteration: round,
              durationMs: Date.now() - criticStart,
              detail:
                findings.length > 0
                  ? `${findings.length} findings noted`
                  : "No issues detected",
              contentPreview: truncatePreview(criticResult.content, 600),
            });

            context.push({
              role: "assistant",
              content: `[CRITIC ROUND ${round}]\n${criticResult.content}`,
            });
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: criticResult.tokens,
              content: criticResult.content,
              loop: "critic",
              durationMs: Date.now() - criticStart,
              success: true,
            });

            // ──── REFINEMENT DECISION ────
            if (!converged && round < MAX_ROUNDS) {
              const refineStepId = stepId();
              send({
                event: "step",
                id: refineStepId,
                label: `Deciding: Refine or Backtrack`,
                type: "think",
                status: "running",
                loop: "refinement",
                iteration: round,
              });

              const refineMessages = buildDeepReasoningMessages(
                "refine-decision",
                task,
                context,
                currentPlan,
                currentOutput,
                refinementHistory,
                metaPromptBlock,
              );
              const refineStart = Date.now();
              injectNudges(refineMessages);
              const refineResult = await callLLM(
                llm,
                refineMessages,
                jobAbort.signal,
              );
              totalTokens += refineResult.tokens;

              const decision = parseRefinementDecision(refineResult.content);
              refinementHistory.push(
                `Round ${round}: ${decision.action} — ${decision.reason}`,
              );

              send({
                event: "subtask",
                parentStepId: refineStepId,
                id: `${refineStepId}-decision`,
                label: `Decision: ${decision.action.toUpperCase()}`,
                status: decision.action === "backtrack" ? "error" : "completed",
                index: 0,
                total: 2,
              });
              send({
                event: "subtask",
                parentStepId: refineStepId,
                id: `${refineStepId}-reason`,
                label: decision.reason.slice(0, 80),
                status: "completed",
                index: 1,
                total: 2,
              });

              send({
                event: "step",
                id: refineStepId,
                label: `Deciding: Refine or Backtrack`,
                type: "think",
                status: "completed",
                loop: "refinement",
                iteration: round,
                durationMs: Date.now() - refineStart,
                detail: `${decision.action === "backtrack" ? "🔄 Backtracking" : "🔧 Refining"}: ${decision.reason.slice(0, 60)}`,
                contentPreview: truncatePreview(refineResult.content, 600),
              });

              context.push({
                role: "assistant",
                content: `[REFINEMENT DECISION ROUND ${round}]\n${refineResult.content}`,
              });
              totalIterations++;
              persistIteration({
                number: totalIterations,
                tokens: refineResult.tokens,
                content: refineResult.content,
                loop: "refinement",
                durationMs: Date.now() - refineStart,
                success: true,
              });

              if (decision.action === "backtrack") {
                currentPlan = "";
                currentOutput = "";
              }
            } else if (converged) {
              const synthStepId = stepId();
              send({
                event: "step",
                id: synthStepId,
                label: "Final Synthesis",
                type: "write",
                status: "running",
                loop: "refinement",
                iteration: round,
                detail: `Converged after ${round} round${round > 1 ? "s" : ""}`,
              });
              await sleep(300);
              send({
                event: "step",
                id: synthStepId,
                label: "Final Synthesis",
                type: "write",
                status: "completed",
                loop: "refinement",
                iteration: round,
                durationMs: 300,
                detail: `✅ Converged after ${round} round${round > 1 ? "s" : ""} · ${refinementHistory.length} refinements applied`,
              });
            }
          }

          const totalDuration = Date.now() - startTime;
          send({ event: "stream", content: "", done: true });
          send({
            event: "result",
            content: `Deep reasoning completed in ${round} round${round > 1 ? "s" : ""}${converged ? " (converged)" : " (max rounds reached)"}`,
            finalAnswer: currentOutput,
            tokens: totalTokens,
            durationMs: totalDuration,
            loops: recipe.loops,
            iterations: totalIterations,
          });

          await finalizeRun({
            success: true,
            totalTokens,
            totalIterations,
            summary: currentOutput,
            durationMs: totalDuration,
          });
          return;
        }

        // ─── Adversarial Duel: competitive order-2 engine ───
        if (recipeId === "adversarial-duel") {
          const MAX_ROUNDS = 3;
          let round = 0;
          let scoreboard = {
            alpha: 0,
            beta: 0,
            rounds: [] as Array<{
              winner: string;
              alphaScore: number;
              betaScore: number;
              rationale: string;
            }>,
          };
          let lastVerdictSummary = "";
          let feedbackAlpha = "";
          let feedbackBeta = "";
          let bestOutput = "";

          while (round < MAX_ROUNDS) {
            round++;

            // ──── ARENA PHASE ────
            const arenaStepId = stepId();
            send({
              event: "step",
              id: arenaStepId,
              label: `Arena — Round ${round} of ${MAX_ROUNDS}`,
              type: "plan",
              status: "running",
              loop: "planning",
              iteration: round,
              detail:
                round === 1
                  ? "Setting the initial challenge"
                  : `Scores: α=${scoreboard.alpha} β=${scoreboard.beta} · Preparing round ${round}`,
            });

            const arenaMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `${metaPromptBlock ? metaPromptBlock + "\n\n" : ""}You are the ARENA of an adversarial duel pipeline. You manage a competition between Agent α and Agent β.

Your job:
1. Present the challenge clearly (same task for both agents)
2. Include the current scoreboard
3. ${round === 1 ? "This is Round 1 — set the initial challenge" : `This is Round ${round} — incorporate the Arbiter's previous verdict`}

Current scoreboard: α=${scoreboard.alpha} β=${scoreboard.beta}
${lastVerdictSummary ? `\nPrevious verdict: ${lastVerdictSummary}` : ""}

Output a clear CHALLENGE section that both agents will receive.`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];

            const arenaStart = Date.now();
            injectNudges(arenaMessages);
            const arenaResult = await callLLM(
              llm,
              arenaMessages,
              jobAbort.signal,
            );
            totalTokens += arenaResult.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: arenaResult.tokens,
              content: arenaResult.content,
              loop: "planning",
              durationMs: Date.now() - arenaStart,
              success: true,
            });

            send({
              event: "step",
              id: arenaStepId,
              label: `Arena — Round ${round} of ${MAX_ROUNDS}`,
              type: "plan",
              status: "completed",
              loop: "planning",
              iteration: round,
              durationMs: 500,
              detail: `Challenge set · Scores: α=${scoreboard.alpha} β=${scoreboard.beta}`,
              contentPreview: truncatePreview(arenaResult.content, 400),
            });

            const challenge = arenaResult.content;

            // ──── AGENT α PHASE ────
            const alphaStepId = stepId();
            send({
              event: "step",
              id: alphaStepId,
              label: `Agent α — Round ${round}`,
              type: "code",
              status: "running",
              loop: "execution",
              iteration: round,
              detail: feedbackAlpha
                ? "Incorporating Arbiter feedback"
                : "Working on challenge",
            });

            const alphaMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `You are Agent α in an adversarial duel. You compete against Agent β to produce the BEST solution.

CHALLENGE:\n${challenge}
${feedbackAlpha ? `\nARBITER FEEDBACK FROM PREVIOUS ROUND:\n${feedbackAlpha}` : ""}

Be thorough, creative, and produce your best work. The Arbiter will compare your solution with your rival's.`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];
            injectNudges(alphaMessages);

            let alphaSolution = "";
            const alphaStart = Date.now();
            const alphaRes = await callLLMStreaming(
              llm,
              alphaMessages,
              (chunk) => {
                send({ event: "stream", content: chunk, done: false });
              },
              jobAbort.signal,
            );
            alphaSolution = alphaRes.content;
            totalTokens += alphaRes.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: alphaRes.tokens,
              content: alphaSolution,
              loop: "execution",
              durationMs: Date.now() - alphaStart,
              success: true,
            });

            send({
              event: "step",
              id: alphaStepId,
              label: `Agent α — Round ${round}`,
              type: "code",
              status: "completed",
              loop: "execution",
              iteration: round,
              durationMs: 800,
              detail: `${alphaRes.tokens} tokens · Solution submitted`,
              contentPreview: truncatePreview(alphaSolution, 400),
            });

            // ──── AGENT β PHASE ────
            const betaStepId = stepId();
            send({
              event: "step",
              id: betaStepId,
              label: `Agent β — Round ${round}`,
              type: "code",
              status: "running",
              loop: "execution",
              iteration: round,
              detail: feedbackBeta
                ? "Incorporating Arbiter feedback"
                : "Working on challenge",
            });

            const betaMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `You are Agent β in an adversarial duel. You compete against Agent α to produce the BEST solution.

CHALLENGE:\n${challenge}
${feedbackBeta ? `\nARBITER FEEDBACK FROM PREVIOUS ROUND:\n${feedbackBeta}` : ""}

Be thorough, creative, and produce your best work. The Arbiter will compare your solution with your rival's.`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];

            injectNudges(betaMessages);
            const betaStart = Date.now();
            const betaRes = await callLLM(llm, betaMessages, jobAbort.signal);
            const betaSolution = betaRes.content;
            totalTokens += betaRes.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: betaRes.tokens,
              content: betaSolution,
              loop: "execution",
              durationMs: Date.now() - betaStart,
              success: true,
            });

            send({
              event: "step",
              id: betaStepId,
              label: `Agent β — Round ${round}`,
              type: "code",
              status: "completed",
              loop: "execution",
              iteration: round,
              durationMs: 800,
              detail: `${betaRes.tokens} tokens · Solution submitted`,
              contentPreview: truncatePreview(betaSolution, 400),
            });

            // ──── ARBITER PHASE ────
            const arbiterStepId = stepId();
            send({
              event: "step",
              id: arbiterStepId,
              label: `Arbiter — Judging Round ${round}`,
              type: "eval",
              status: "running",
              loop: "evaluation",
              iteration: round,
              detail: "Comparing both solutions side-by-side",
            });

            const arbiterMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `You are the impartial ARBITER of an adversarial duel. You must compare two solutions fairly.

SCORING: Rate each solution 1-10 on these criteria:
- Correctness
- Completeness
- Code Quality / Clarity
- Edge Cases
- Creativity / Elegance

FORMAT YOUR RESPONSE EXACTLY:
ALPHA_SCORE: <number>
BETA_SCORE: <number>
WINNER: <alpha|beta|tie>
RATIONALE: <one paragraph explaining why>

FEEDBACK_ALPHA: <specific improvements for α>
FEEDBACK_BETA: <specific improvements for β>

Now compare the two solutions:

─── AGENT α SOLUTION ───
${alphaSolution.slice(0, 2000)}

─── AGENT β SOLUTION ───
${betaSolution.slice(0, 2000)}`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];

            const arbiterStart = Date.now();
            injectNudges(arbiterMessages);
            const arbiterRes = await callLLM(
              llm,
              arbiterMessages,
              jobAbort.signal,
            );
            totalTokens += arbiterRes.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: arbiterRes.tokens,
              content: arbiterRes.content,
              loop: "evaluation",
              durationMs: Date.now() - arbiterStart,
              success: true,
            });

            // Parse verdict
            const arbiterContent = arbiterRes.content;
            const alphaScoreMatch =
              arbiterContent.match(/ALPHA_SCORE:\s*(\d+)/i);
            const betaScoreMatch = arbiterContent.match(/BETA_SCORE:\s*(\d+)/i);
            const winnerMatch = arbiterContent.match(
              /WINNER:\s*(alpha|beta|tie)/i,
            );
            const rationaleMatch = arbiterContent.match(
              /RATIONALE:\s*([\s\S]*?)(?:\n\n|FEEDBACK)/i,
            );
            const feedAlphaMatch = arbiterContent.match(
              /FEEDBACK_ALPHA:\s*([\s\S]*?)(?:\n\n|FEEDBACK_BETA|$)/i,
            );
            const feedBetaMatch = arbiterContent.match(
              /FEEDBACK_BETA:\s*([\s\S]*?)$/i,
            );

            const alphaScore = alphaScoreMatch
              ? parseInt(alphaScoreMatch[1])
              : 5;
            const betaScore = betaScoreMatch ? parseInt(betaScoreMatch[1]) : 5;
            const roundWinner = winnerMatch
              ? winnerMatch[1].toLowerCase()
              : alphaScore >= betaScore
                ? "alpha"
                : "beta";
            const rationale = rationaleMatch
              ? rationaleMatch[1].trim()
              : "Close competition";
            feedbackAlpha = feedAlphaMatch ? feedAlphaMatch[1].trim() : "";
            feedbackBeta = feedBetaMatch ? feedBetaMatch[1].trim() : "";

            scoreboard.alpha += alphaScore;
            scoreboard.beta += betaScore;
            scoreboard.rounds.push({
              winner: roundWinner,
              alphaScore,
              betaScore,
              rationale,
            });

            lastVerdictSummary = `Round ${round}: ${roundWinner === "tie" ? "TIE" : `${roundWinner.toUpperCase()} wins`} (α=${alphaScore}, β=${betaScore}). ${rationale.slice(0, 100)}`;

            // Show subtasks for the scoring breakdown
            const criteria = [
              "Correctness",
              "Completeness",
              "Code Quality",
              "Edge Cases",
              "Creativity",
            ];
            for (let ci = 0; ci < criteria.length; ci++) {
              send({
                event: "subtask",
                parentStepId: arbiterStepId,
                id: `${arbiterStepId}-crit-${ci}`,
                label: `${criteria[ci]}: α vs β`,
                status: "completed",
                index: ci,
                total: criteria.length,
              });
            }

            // Prize emoji for winner
            const winnerEmoji =
              roundWinner === "alpha"
                ? "🏆 α wins"
                : roundWinner === "beta"
                  ? "🏆 β wins"
                  : "🤝 Tie";

            send({
              event: "step",
              id: arbiterStepId,
              label: `Arbiter — Round ${round} Verdict`,
              type: "eval",
              status: "completed",
              loop: "evaluation",
              iteration: round,
              durationMs: 600,
              detail: `${winnerEmoji} · α=${alphaScore}/10 β=${betaScore}/10 · Total: α=${scoreboard.alpha} β=${scoreboard.beta}`,
              contentPreview: truncatePreview(arbiterContent, 600),
            });

            // Thinking event with round summary
            send({
              event: "thinking",
              content: `Round ${round}: ${winnerEmoji}\nα: ${alphaScore}/10 | β: ${betaScore}/10\n${rationale}`,
              phase: "arbiter",
              round,
            });

            // Use winner's output as the best
            bestOutput = roundWinner === "beta" ? betaSolution : alphaSolution;

            // Check for early victory (3+ point lead after round 2+)
            if (
              round >= 2 &&
              Math.abs(scoreboard.alpha - scoreboard.beta) >= 3 * round
            ) {
              send({
                event: "thinking",
                content: `Early victory declared! ${scoreboard.alpha > scoreboard.beta ? "Agent α" : "Agent β"} leads by ${Math.abs(scoreboard.alpha - scoreboard.beta)} points.`,
                phase: "arena",
                round,
              });
              break;
            }
          }

          // ─── Final result ───
          const overallWinner =
            scoreboard.alpha > scoreboard.beta
              ? "Agent α"
              : scoreboard.beta > scoreboard.alpha
                ? "Agent β"
                : "Tie";
          const totalDuration = Date.now() - startTime;
          send({ event: "stream", content: "", done: true });
          send({
            event: "result",
            content: `Adversarial Duel completed: ${overallWinner} wins after ${round} round${round > 1 ? "s" : ""} (α=${scoreboard.alpha}, β=${scoreboard.beta})`,
            finalAnswer: bestOutput,
            tokens: totalTokens,
            durationMs: totalDuration,
            loops: recipe.loops,
            iterations: totalIterations,
          });

          await finalizeRun({
            success: true,
            totalTokens,
            totalIterations,
            summary: `${overallWinner} wins (α=${scoreboard.alpha}, β=${scoreboard.beta})`,
            durationMs: totalDuration,
          });
          return;
        }

        // ─── Supervised Coder: team simulation engine ───
        if (recipeId === "supervised-coder") {
          const MAX_ROUNDS = 3;
          let round = 0;
          let currentTask = "";
          let lastResult = "";
          let lastVerdict = "";
          let corrections = "";
          let bestOutput = "";

          while (round < MAX_ROUNDS) {
            round++;

            // ──── PLANNER (Tech Lead) PHASE ────
            const planStepId = stepId();
            send({
              event: "step",
              id: planStepId,
              label: `Tech Lead — Sprint ${round}`,
              type: "plan",
              status: "running",
              loop: "planning",
              iteration: round,
              detail:
                round === 1
                  ? "Reading specs and creating first task"
                  : `Reviewing verdict: ${lastVerdict.slice(0, 50)}`,
            });

            const planMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `${metaPromptBlock ? metaPromptBlock + "\n\n" : ""}You are the TECH LEAD (Planner) of a supervised coding pipeline.

Your job: read the task, and select ONE concrete, verifiable sub-task for the Developer.
${round === 1 ? "" : `\nPREVIOUS REVIEWER VERDICT: ${lastVerdict}\nCORRECTIONS: ${corrections}`}
${lastResult ? `\nLAST DEVELOPER OUTPUT SUMMARY: ${lastResult.slice(0, 300)}` : ""}

Output:
TASK: <specific task description>
EXPECTED: <what "done" looks like>`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];

            const planStart = Date.now();
            injectNudges(planMessages);
            const planRes = await callLLM(llm, planMessages, jobAbort.signal);
            currentTask = planRes.content;
            totalTokens += planRes.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: planRes.tokens,
              content: currentTask,
              loop: "planning",
              durationMs: Date.now() - planStart,
              success: true,
            });

            send({
              event: "step",
              id: planStepId,
              label: `Tech Lead — Sprint ${round}`,
              type: "plan",
              status: "completed",
              loop: "planning",
              iteration: round,
              durationMs: 400,
              detail: `Task assigned to Developer`,
              contentPreview: truncatePreview(currentTask, 300),
            });

            // ──── DEVELOPER (Coder) PHASE ────
            const codeStepId = stepId();
            send({
              event: "step",
              id: codeStepId,
              label: `Developer — Sprint ${round}`,
              type: "code",
              status: "running",
              loop: "execution",
              iteration: round,
              detail: corrections
                ? "Applying reviewer corrections"
                : "Implementing task",
            });

            const codeMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `You are the DEVELOPER in a supervised coding pipeline. Implement the task assigned by the Tech Lead.

ASSIGNED TASK:\n${currentTask}
${corrections ? `\nREVIEWER CORRECTIONS TO APPLY:\n${corrections}` : ""}

Show your implementation clearly. Include code, test results, and file changes.`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];

            injectNudges(codeMessages);
            const codeRes = await callLLMStreaming(
              llm,
              codeMessages,
              (chunk) => {
                send({ event: "stream", content: chunk, done: false });
              },
              jobAbort.signal,
            );
            const codeStart = Date.now();
            lastResult = codeRes.content;
            bestOutput = lastResult;
            totalTokens += codeRes.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: codeRes.tokens,
              content: lastResult,
              loop: "execution",
              durationMs: Date.now() - codeStart,
              success: true,
            });

            send({
              event: "step",
              id: codeStepId,
              label: `Developer — Sprint ${round}`,
              type: "code",
              status: "completed",
              loop: "execution",
              iteration: round,
              durationMs: 800,
              detail: `${codeRes.tokens} tokens · Implementation submitted`,
              contentPreview: truncatePreview(lastResult, 400),
            });

            // ──── REVIEWER (Code Reviewer) PHASE ────
            const reviewStepId = stepId();
            send({
              event: "step",
              id: reviewStepId,
              label: `Code Reviewer — Sprint ${round}`,
              type: "eval",
              status: "running",
              loop: "evaluation",
              iteration: round,
              detail: "Independently verifying Developer's work",
            });

            const reviewMessages: ChatMessage[] = [
              {
                role: "system" as const,
                content: `You are the CODE REVIEWER in a supervised coding pipeline. You are the quality gate.

ASSIGNED TASK (from Tech Lead):\n${currentTask}

DEVELOPER'S SUBMISSION:\n${lastResult.slice(0, 2000)}

Verify independently. Check correctness, edge cases, code quality.

FORMAT YOUR RESPONSE:
VERDICT: <PASS|FAIL>
ASSESSMENT: <what you checked and found>
${`CORRECTIONS: <if FAIL, specific corrections needed>`}`,
              },
              { role: "user" as const, content: `Task: ${task}` },
            ];

            const reviewStart = Date.now();
            injectNudges(reviewMessages);
            const reviewRes = await callLLM(
              llm,
              reviewMessages,
              jobAbort.signal,
            );
            totalTokens += reviewRes.tokens;
            totalIterations++;
            persistIteration({
              number: totalIterations,
              tokens: reviewRes.tokens,
              content: reviewRes.content,
              loop: "evaluation",
              durationMs: Date.now() - reviewStart,
              success: true,
            });

            const reviewContent = reviewRes.content;
            const verdictMatch = reviewContent.match(/VERDICT:\s*(PASS|FAIL)/i);
            const passed = verdictMatch
              ? verdictMatch[1].toUpperCase() === "PASS"
              : false;
            lastVerdict = passed ? "PASS" : "FAIL";
            const correctionsMatch = reviewContent.match(
              /CORRECTIONS:\s*([\s\S]*)/i,
            );
            corrections = passed ? "" : correctionsMatch?.[1]?.trim() || "";

            // Show review criteria as subtasks
            const evalItems = extractEvalCriteria(reviewContent);
            for (let ei = 0; ei < evalItems.length; ei++) {
              send({
                event: "subtask",
                parentStepId: reviewStepId,
                id: `${reviewStepId}-eval-${ei}`,
                label: evalItems[ei].label,
                status: evalItems[ei].pass ? "completed" : "error",
                index: ei,
                total: evalItems.length,
              });
            }

            send({
              event: "step",
              id: reviewStepId,
              label: `Code Reviewer — Sprint ${round}`,
              type: "eval",
              status: passed ? "completed" : "error",
              loop: "evaluation",
              iteration: round,
              durationMs: 500,
              detail: passed
                ? `✅ APPROVED — Sprint ${round} complete`
                : `❌ REJECTED — Corrections sent to Developer`,
              contentPreview: truncatePreview(reviewContent, 400),
            });

            send({
              event: "thinking",
              content: `Sprint ${round}: ${passed ? "✅ PASS" : "❌ FAIL"}\n${corrections ? `Corrections: ${corrections.slice(0, 150)}` : "All checks passed"}`,
              phase: "reviewer",
              round,
            });

            // If passed, move to next task; if all done, break
            if (passed) {
              corrections = "";
            }
          }

          const totalDuration = Date.now() - startTime;
          send({ event: "stream", content: "", done: true });
          send({
            event: "result",
            content: `Supervised coding completed: ${round} sprint${round > 1 ? "s" : ""} executed`,
            finalAnswer: bestOutput,
            tokens: totalTokens,
            durationMs: totalDuration,
            loops: recipe.loops,
            iterations: totalIterations,
          });

          await finalizeRun({
            success: true,
            totalTokens,
            totalIterations,
            summary: `${round} sprints completed`,
            durationMs: totalDuration,
          });
          return;
        }

        // ─── Sequential loop execution (non-deep-reasoning recipes) ───
        let lastExecutionOutput = "";
        for (const loopName of recipe.loops) {
          totalIterations++;

          const loopStepId = stepId();
          const loopLabel = getLoopLabel(loopName);
          const loopType = getLoopStepType(loopName);

          send({
            event: "step",
            id: loopStepId,
            label: loopLabel,
            type: loopType,
            status: "running",
            loop: loopName,
            iteration: totalIterations,
          });

          const loopMessages = buildLoopMessages(
            loopName,
            task,
            context,
            metaPromptBlock,
          );
          injectNudges(loopMessages);
          const loopStart = Date.now();

          try {
            let loopContent = "";
            let loopTokens = 0;

            // Stream execution loop, non-stream others
            if (loopName === "execution") {
              const result = await callLLMStreaming(
                llm,
                loopMessages,
                (chunk) => {
                  send({ event: "stream", content: chunk, done: false });
                },
                jobAbort.signal,
              );
              loopContent = result.content;
              loopTokens = result.tokens;
              lastExecutionOutput = loopContent;
            } else {
              const result = await callLLM(llm, loopMessages, jobAbort.signal);
              loopContent = result.content;
              loopTokens = result.tokens;
            }

            totalTokens += loopTokens;
            const loopDuration = Date.now() - loopStart;

            send({
              event: "step",
              id: loopStepId,
              label: loopLabel,
              type: loopType,
              status: "completed",
              loop: loopName,
              iteration: totalIterations,
              durationMs: loopDuration,
              detail: getLoopDetail(loopName, loopTokens, loopContent),
              contentPreview: truncatePreview(loopContent, 600),
            });

            // Subtask processing per loop type
            if (loopName === "execution" && pendingSubtasks.length > 0) {
              for (const sub of pendingSubtasks.filter(
                (s) => s.status !== "completed",
              )) {
                sub.status = "running";
                send({
                  event: "subtask",
                  parentStepId: sub.parentStepId,
                  id: sub.id,
                  label: sub.label,
                  status: "running",
                  index: sub.index,
                  total: sub.total,
                });
                await sleep(150 + Math.random() * 200);
                sub.status = "completed";
                send({
                  event: "subtask",
                  parentStepId: sub.parentStepId,
                  id: sub.id,
                  label: sub.label,
                  status: "completed",
                  index: sub.index,
                  total: sub.total,
                });
              }
            }

            if (loopName === "planning") {
              const actionItems = extractActionItems(loopContent);
              if (actionItems.length > 0) {
                send({
                  event: "step",
                  id: stepId(),
                  label: "Analyzing task structure",
                  type: "search",
                  status: "completed",
                  durationMs: 120,
                  detail: `Extracted ${actionItems.length} action items`,
                });

                for (let si = 0; si < actionItems.length; si++) {
                  const subId = `${loopStepId}-sub-${si}`;
                  const sub = {
                    parentStepId: loopStepId,
                    id: subId,
                    label: actionItems[si],
                    status: "pending" as StepStatus,
                    index: si,
                    total: actionItems.length,
                  };
                  pendingSubtasks.push(sub);
                  send({ event: "subtask", ...sub });
                }
              } else {
                send({
                  event: "step",
                  id: stepId(),
                  label: "Analyzing task structure",
                  type: "search",
                  status: "completed",
                  durationMs: 120,
                  detail: `Plan structured`,
                });
              }
            }

            if (loopName === "evaluation") {
              const evalItems = extractEvalCriteria(loopContent);
              if (evalItems.length > 0) {
                for (let si = 0; si < evalItems.length; si++) {
                  send({
                    event: "subtask",
                    parentStepId: loopStepId,
                    id: `${loopStepId}-eval-${si}`,
                    label: evalItems[si].label,
                    status: evalItems[si].pass ? "completed" : "error",
                    index: si,
                    total: evalItems.length,
                  });
                }
              }

              send({
                event: "step",
                id: stepId(),
                label: "Validating output",
                type: "eval",
                status: "completed",
                durationMs: 80,
                detail:
                  evalItems.length > 0
                    ? `${evalItems.filter((e) => e.pass).length}/${evalItems.length} checks passed`
                    : "Quality checks passed",
              });

              for (const sub of pendingSubtasks.filter(
                (s) => s.status !== "completed",
              )) {
                sub.status = "completed";
                send({
                  event: "subtask",
                  parentStepId: sub.parentStepId,
                  id: sub.id,
                  label: sub.label,
                  status: "completed",
                  index: sub.index,
                  total: sub.total,
                });
                await sleep(80);
              }
            }

            if (loopName === "critic") {
              const criticFindings = extractCriticFindings(loopContent);
              if (criticFindings.length > 0) {
                for (let si = 0; si < criticFindings.length; si++) {
                  send({
                    event: "subtask",
                    parentStepId: loopStepId,
                    id: `${loopStepId}-crit-${si}`,
                    label: criticFindings[si],
                    status: "completed",
                    index: si,
                    total: criticFindings.length,
                  });
                }
              }

              send({
                event: "step",
                id: stepId(),
                label: "Checking for stagnation",
                type: "eval",
                status: "completed",
                durationMs: 60,
                detail:
                  criticFindings.length > 0
                    ? `${criticFindings.length} findings noted`
                    : "No circular patterns detected",
              });
            }

            if (loopName === "memory") {
              send({
                event: "step",
                id: stepId(),
                label: "Compressing context",
                type: "write",
                status: "completed",
                durationMs: 90,
                detail: `Context compressed: ${loopContent.length} chars → summary stored`,
              });
            }

            context.push({
              role: "assistant",
              content: `[${loopName.toUpperCase()} LOOP OUTPUT]\n${loopContent}`,
            });
            persistIteration({
              number: totalIterations,
              tokens: loopTokens,
              content: loopContent,
              loop: loopName,
              durationMs: loopDuration,
              success: true,
            });
          } catch (loopError) {
            // Re-throw cancellation errors so the outer catch handles them
            if (
              loopError instanceof JobCancelledError ||
              (loopError instanceof DOMException &&
                (loopError as DOMException).name === "AbortError") ||
              jobAbort.signal.aborted
            ) {
              throw loopError;
            }
            send({
              event: "step",
              id: loopStepId,
              label: loopLabel,
              type: loopType,
              status: "error",
              loop: loopName,
              detail: (loopError as Error).message,
              durationMs: Date.now() - loopStart,
            });
          }
        }

        // ─── Final: send result ───
        const totalDuration = Date.now() - startTime;
        send({ event: "stream", content: "", done: true });
        send({
          event: "result",
          content: "Agent task completed",
          finalAnswer: lastExecutionOutput,
          tokens: totalTokens,
          durationMs: totalDuration,
          loops: recipe.loops,
          iterations: totalIterations,
        });

        await finalizeRun({
          success: true,
          totalTokens,
          totalIterations,
          summary: lastExecutionOutput,
          durationMs: totalDuration,
        });

        // ── Persist task+result into semantic memory for future context ──
        // Write to the memory bank if specified, otherwise to the session namespace.
        if (storage && lastExecutionOutput && body.sessionId) {
          try {
            const memNs = body.memoryNamespace
              ? ["memory-bank", body.memoryNamespace]
              : ["chat", body.sessionId];
            // Store the task itself
            await storage.memory.put(memNs, `task-${runExternalId}`, {
              text: task,
              role: "user",
              sessionId: body.sessionId,
              messageType: "task",
            });
            // Store the agent result (truncated for embedding)
            await storage.memory.put(memNs, `result-${runExternalId}`, {
              text: lastExecutionOutput.slice(0, 4000),
              role: "agent",
              sessionId: body.sessionId,
              messageType: "result",
              model,
              recipe: recipeId,
              tokens: totalTokens,
            });
          } catch {
            // Memory storage is best-effort
          }
        }
      } catch (error) {
        // Treat both our own JobCancelledError AND native AbortError
        // (thrown by provider SDKs when the AbortSignal fires) as cancellation.
        const isCancelled =
          error instanceof JobCancelledError ||
          (error instanceof DOMException && error.name === "AbortError") ||
          jobAbort.signal.aborted;

        if (isCancelled) {
          // User-initiated cancellation — emit a dedicated event
          send({
            event: "cancelled",
            message: "Task stopped by user",
          } as unknown as SSEPayload);
          await finalizeRun({
            success: false,
            totalTokens,
            totalIterations,
            summary: "Cancelled by user",
            durationMs: Date.now() - startTime,
            status: "cancelled",
          });
        } else {
          send({
            event: "error",
            message: (error as Error).message,
          });
          await finalizeRun({
            success: false,
            totalTokens,
            totalIterations,
            summary: (error as Error).message,
            durationMs: Date.now() - startTime,
          });
        }
      } finally {
        // Clean up infrastructure connections
        if (storage) storage.close().catch(() => {});
        if (redisBus) redisBus.disconnect().catch(() => {});
        // Signal observers that the job is done
        jobEmitter.emit("done");
        unregisterJob(runExternalId);
      }
    })();

    // Anchor the job in the process-wide store so it survives client disconnect
    // and is visible to nudge/cancel routes via the shared job-store.
    registerJob(runExternalId, {
      promise: jobPromise,
      emitter: jobEmitter,
      abort: jobAbort,
    });

    // ── SSE Observer Stream: subscribes to job events ──
    // If the client disconnects, the subscription is removed but the job keeps running.
    const stream = new ReadableStream({
      start(controller) {
        const onEvent = (payload: SSEPayload) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
            );
          } catch {
            // Client disconnected — stop listening, job continues in background
            jobEmitter.off("sse", onEvent);
          }
        };
        const onDone = () => {
          jobEmitter.off("sse", onEvent);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        jobEmitter.on("sse", onEvent);
        jobEmitter.once("done", onDone);

        // Clean up subscription when client disconnects
        request.signal.addEventListener("abort", () => {
          jobEmitter.off("sse", onEvent);
          jobEmitter.off("done", onDone);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
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

// ── Loop → UI helpers ───────────────────────────────────

function getLoopLabel(loop: string): string {
  const labels: Record<string, string> = {
    planning: "Strategic Planning",
    execution: "Executing Task",
    evaluation: "Evaluating Output",
    critic: "Critic Review",
    memory: "Memory Consolidation",
    refinement: "Refinement Gate",
  };
  return labels[loop] || `${loop} Loop`;
}

function getLoopStepType(loop: string): StepType {
  const map: Record<string, StepType> = {
    planning: "plan",
    execution: "code",
    evaluation: "eval",
    critic: "think",
    memory: "write",
    refinement: "think",
  };
  return map[loop] || "think";
}

function getLoopDetail(loop: string, tokens: number, content: string): string {
  const lines = content.split("\n").filter(Boolean).length;
  const base = `${tokens || "?"} tokens · ${lines} lines`;

  const extras: Record<string, string> = {
    planning: `${base} · Strategy defined`,
    execution: `${base} · Task output generated`,
    evaluation: `${base} · Verification complete`,
    critic: `${base} · Reviewed for quality`,
    memory: `${base} · Context summarized`,
    refinement: `${base} · Decision made`,
  };
  return extras[loop] || base;
}

function buildLoopMessages(
  loop: string,
  task: string,
  context: Array<{ role: string; content: string }>,
  metaBlock?: string,
): ChatMessage[] {
  const systemPrompts: Record<string, string> = {
    planning: `You are the PLANNING loop of a multi-loop agentic engine. Your job is to analyze the user's task and create a structured, step-by-step plan. Output a numbered list of concrete actions. Be strategic — think about dependencies, risks, and optimal ordering. Do NOT execute the task, only plan it.`,

    execution: `You are the EXECUTION loop of a multi-loop agentic engine. Your job is to carry out the task based on any planning context provided. Be thorough, write high-quality code or content. If you have a plan from a previous loop, follow it step by step. Show your work clearly.`,

    evaluation: `You are the EVALUATION loop of a multi-loop agentic engine. Your job is to verify the output from the execution loop. Check for: correctness, completeness, edge cases, potential bugs, code quality. Output a structured assessment with PASS/FAIL for each criterion and an overall verdict.`,

    critic: `You are the CRITIC loop (Anti-Ralph) of a multi-loop agentic engine. Your job is to detect: circular reasoning, repeated mistakes, scope creep, stagnation, and quality degradation. If you detect problems, flag them clearly with severity (LOW/MEDIUM/HIGH/CRITICAL). If everything looks good, say so briefly.`,

    memory: `You are the MEMORY loop of a multi-loop agentic engine. Your job is to compress and summarize the conversation context so far. Extract: key decisions made, important facts, code artifacts produced, and remaining tasks. Output a concise summary that a fresh agent could use to continue the work.`,

    refinement: `You are the REFINEMENT loop of a multi-loop agentic engine. Analyze evaluation metrics and critic feedback to decide: CONVERGE (quality sufficient), REFINE (fix specific issues), or BACKTRACK (fundamental rethink needed).`,
  };

  const loopPrompt = systemPrompts[loop] || systemPrompts.execution;
  const fullSystemPrompt = metaBlock
    ? `${metaBlock}\n\n${loopPrompt}`
    : loopPrompt;

  return [
    {
      role: "system" as const,
      content: fullSystemPrompt,
    },
    ...context.map((c) => ({
      role: c.role as "user" | "assistant" | "system",
      content: c.content,
    })),
    { role: "user" as const, content: `Task: ${task}` },
  ];
}

// ── Deep Reasoning Helpers ───────────────────────────────

function buildDeepReasoningMessages(
  phase: "replan" | "re-execute" | "evaluate" | "critic" | "refine-decision",
  task: string,
  context: Array<{ role: string; content: string }>,
  currentPlan: string,
  currentOutput: string,
  refinementHistory: string[],
  metaBlock?: string,
): ChatMessage[] {
  const historyBlock =
    refinementHistory.length > 0
      ? `\n\nREFINEMENT HISTORY:\n${refinementHistory.map((h, i) => `  ${i + 1}. ${h}`).join("\n")}`
      : "";

  const prompts: Record<string, string> = {
    replan: `You are the PLANNING loop of a deep reasoning agent performing iterative refinement.

The previous execution was evaluated and found lacking. You must now RE-PLAN the approach.
Consider what went wrong, what was missed, and how to improve.

CURRENT PLAN (to be revised):
${currentPlan || "(none — building from scratch)"}

PREVIOUS OUTPUT SUMMARY:
${currentOutput ? currentOutput.slice(0, 500) : "(none)"}
${historyBlock}

Create an improved, numbered step-by-step plan. Be specific about what changes are needed.`,

    "re-execute": `You are the EXECUTION loop of a deep reasoning agent performing iterative refinement.

You are re-executing based on a revised plan. Incorporate ALL feedback from previous rounds.
Do NOT repeat the same mistakes. Focus on the areas flagged for improvement.

REVISED PLAN:\n${currentPlan}
${historyBlock}

Produce the improved output. Show your work clearly.`,

    evaluate: `You are the EVALUATION loop of a deep reasoning agent.
Your job is to rigorously evaluate the output against the original task requirements.

For EACH criterion, output exactly one of these formats:
  ✅ Criterion Name: PASS — brief explanation
  ❌ Criterion Name: FAIL — what's wrong

Evaluate at minimum: Correctness, Completeness, Edge Cases, Code Quality, Clarity.
Be strict — only PASS criteria that are genuinely met.

TASK: ${task}
OUTPUT TO EVALUATE:\n${currentOutput.slice(0, 1500)}`,

    critic: `You are the CRITIC loop of a deep reasoning agent.
Look for systemic issues: circular reasoning, repeated mistakes across rounds, scope creep, stagnation.

If you detect problems, flag them with severity:
  CRITICAL: ... (blocks progress entirely)
  HIGH: ... (significant quality issue)
  MEDIUM: ... (notable but not blocking)
  LOW: ... (minor improvement possible)

If everything looks good, say "No critical issues detected."
${historyBlock}`,

    "refine-decision": `You are the REFINEMENT DECISION engine of a deep reasoning agent.
Based on the evaluation and critic feedback, decide the next action.

You MUST output EXACTLY one of these two decisions on the first line:
DECISION: REFINE
DECISION: BACKTRACK

Then explain WHY on the next line:
REASON: <your explanation>

Rules:
- REFINE = keep the current approach but fix specific issues
- BACKTRACK = the approach is fundamentally flawed, start over with a new strategy
- If most checks passed but a few failed → REFINE
- If the approach is completely wrong or circular → BACKTRACK
${historyBlock}`,
  };

  const phasePrompt = prompts[phase] || prompts["evaluate"];
  const fullSystemPrompt = metaBlock
    ? `${metaBlock}\n\n${phasePrompt}`
    : phasePrompt;

  return [
    {
      role: "system" as const,
      content: fullSystemPrompt,
    },
    ...context.slice(-4).map((c) => ({
      role: c.role as "user" | "assistant" | "system",
      content: c.content,
    })),
    { role: "user" as const, content: `Task: ${task}` },
  ];
}

function parseRefinementDecision(content: string): {
  action: "refine" | "backtrack";
  reason: string;
} {
  const lower = content.toLowerCase();
  const action: "refine" | "backtrack" = lower.includes("backtrack")
    ? "backtrack"
    : "refine";

  const reasonMatch = content.match(/REASON:\s*(.*)/i);
  const reason = reasonMatch
    ? reasonMatch[1].trim()
    : content
        .split("\n")
        .find((l) => l.trim().length > 10 && !l.includes("DECISION"))
        ?.trim() || "Continuing refinement";

  return { action, reason };
}

// ── Parsing Utilities ───────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function truncatePreview(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  const cut = content.slice(0, maxLen);
  const lastNewline = cut.lastIndexOf("\n");
  return (lastNewline > maxLen * 0.5 ? cut.slice(0, lastNewline) : cut) + "\n…";
}

function extractEvalCriteria(
  content: string,
): Array<{ label: string; pass: boolean }> {
  const results: Array<{ label: string; pass: boolean }> = [];
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const passMatch = line.match(/(?:✅|PASS|pass|\[x\])\s*[-:·]?\s*(.*)/i);
    if (passMatch && passMatch[1].length > 2) {
      results.push({
        label: passMatch[1]
          .replace(/[-:]\s*(PASS|FAIL)/gi, "")
          .trim()
          .slice(0, 60),
        pass: true,
      });
      continue;
    }
    const failMatch = line.match(/(?:❌|FAIL|fail|\[ \])\s*[-:·]?\s*(.*)/i);
    if (failMatch && failMatch[1].length > 2) {
      results.push({
        label: failMatch[1]
          .replace(/[-:]\s*(PASS|FAIL)/gi, "")
          .trim()
          .slice(0, 60),
        pass: false,
      });
      continue;
    }
    const criterionMatch = line.match(
      /^[-*•]?\s*\**(.+?)\**\s*[-:]\s*(PASS|FAIL)/i,
    );
    if (criterionMatch) {
      results.push({
        label: criterionMatch[1].trim().slice(0, 60),
        pass: criterionMatch[2].toUpperCase() === "PASS",
      });
    }
  }
  return results;
}

function extractCriticFindings(content: string): string[] {
  const findings: string[] = [];
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const severityMatch = line.match(
      /(?:⚠️|🔴|🟡|🟢)?\s*(?:[-*•])?\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*[-:]\s*(.*)/i,
    );
    if (severityMatch && severityMatch[2].length > 3) {
      const severity = severityMatch[1].toUpperCase();
      const desc = severityMatch[2].trim().slice(0, 60);
      findings.push(`[${severity}] ${desc}`);
    }
  }
  return findings;
}

function extractActionItems(content: string): string[] {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: string[] = [];

  for (const line of lines) {
    const numberedMatch = line.match(
      /^(?:\d+[\.\)]\s*|step\s+\d+[:\.\)]\s*)(.*)/i,
    );
    if (numberedMatch && numberedMatch[1].length > 3) {
      const clean = numberedMatch[1]
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .trim();
      const short =
        clean.length > 80
          ? clean.slice(0, 77).replace(/\s+\S*$/, "") + "…"
          : clean;
      items.push(short);
      continue;
    }
    const bulletMatch = line.match(/^[-*•]\s+(.*)/);
    if (bulletMatch && bulletMatch[1].length > 3) {
      const clean = bulletMatch[1]
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .trim();
      const short =
        clean.length > 80
          ? clean.slice(0, 77).replace(/\s+\S*$/, "") + "…"
          : clean;
      items.push(short);
    }
  }
  return items;
}
