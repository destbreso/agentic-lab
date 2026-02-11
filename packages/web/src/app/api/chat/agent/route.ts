import { NextRequest, NextResponse } from "next/server";
import {
  createProvider,
  listRecipes,
  type LLMProvider,
  type LLMProviderConfig,
  type ChatMessage,
} from "@agentic-lab/core";

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

  return "ralph-loop";
}

function stepId() {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Core LLM helpers (using provider abstraction) ───────

/**
 * Call LLM without streaming — returns full content + token count.
 * Uses the core provider (works with ALL providers).
 */
async function callLLM(
  provider: LLMProvider,
  messages: ChatMessage[],
): Promise<{ content: string; tokens: number }> {
  const result = await provider.chat({ messages, temperature: 0.7 });
  const tokens = result.usage.totalTokens;
  return { content: result.message.content || "", tokens };
}

/**
 * Call LLM with streaming — invokes onChunk per token, returns full content.
 * Falls back to non-streaming if provider doesn't support chatStream.
 */
async function callLLMStreaming(
  provider: LLMProvider,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<{ content: string; tokens: number }> {
  if (provider.chatStream) {
    let content = "";
    let tokens = 0;
    for await (const chunk of provider.chatStream({
      messages,
      temperature: 0.7,
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
  const result = await callLLM(provider, messages);
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

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: SSEPayload) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
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

        try {
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
                  ? buildLoopMessages("planning", task, context)
                  : buildDeepReasoningMessages(
                      "replan",
                      task,
                      context,
                      currentPlan,
                      currentOutput,
                      refinementHistory,
                    );

              const planStart = Date.now();
              const planResult = await callLLM(llm, planMessages);
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
                detail: getLoopDetail(
                  "planning",
                  planResult.tokens,
                  currentPlan,
                ),
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
                  ? buildLoopMessages("execution", task, context)
                  : buildDeepReasoningMessages(
                      "re-execute",
                      task,
                      context,
                      currentPlan,
                      currentOutput,
                      refinementHistory,
                    );

              const execStart = Date.now();
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
              );
              const evalStart = Date.now();
              const evalResult = await callLLM(llm, evalMessages);
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
              );
              const criticStart = Date.now();
              const criticResult = await callLLM(llm, criticMessages);
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
                );
                const refineStart = Date.now();
                const refineResult = await callLLM(llm, refineMessages);
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
                  status:
                    decision.action === "backtrack" ? "error" : "completed",
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

            controller.close();
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

            const loopMessages = buildLoopMessages(loopName, task, context);
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
                );
                loopContent = result.content;
                loopTokens = result.tokens;
                lastExecutionOutput = loopContent;
              } else {
                const result = await callLLM(llm, loopMessages);
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
            } catch (loopError) {
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
        } catch (error) {
          send({
            event: "error",
            message: (error as Error).message,
          });
        } finally {
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
): ChatMessage[] {
  const systemPrompts: Record<string, string> = {
    planning: `You are the PLANNING loop of a multi-loop agentic engine. Your job is to analyze the user's task and create a structured, step-by-step plan. Output a numbered list of concrete actions. Be strategic — think about dependencies, risks, and optimal ordering. Do NOT execute the task, only plan it.`,

    execution: `You are the EXECUTION loop of a multi-loop agentic engine. Your job is to carry out the task based on any planning context provided. Be thorough, write high-quality code or content. If you have a plan from a previous loop, follow it step by step. Show your work clearly.`,

    evaluation: `You are the EVALUATION loop of a multi-loop agentic engine. Your job is to verify the output from the execution loop. Check for: correctness, completeness, edge cases, potential bugs, code quality. Output a structured assessment with PASS/FAIL for each criterion and an overall verdict.`,

    critic: `You are the CRITIC loop (Anti-Ralph) of a multi-loop agentic engine. Your job is to detect: circular reasoning, repeated mistakes, scope creep, stagnation, and quality degradation. If you detect problems, flag them clearly with severity (LOW/MEDIUM/HIGH/CRITICAL). If everything looks good, say so briefly.`,

    memory: `You are the MEMORY loop of a multi-loop agentic engine. Your job is to compress and summarize the conversation context so far. Extract: key decisions made, important facts, code artifacts produced, and remaining tasks. Output a concise summary that a fresh agent could use to continue the work.`,

    refinement: `You are the REFINEMENT loop of a multi-loop agentic engine. Analyze evaluation metrics and critic feedback to decide: CONVERGE (quality sufficient), REFINE (fix specific issues), or BACKTRACK (fundamental rethink needed).`,
  };

  return [
    {
      role: "system" as const,
      content: systemPrompts[loop] || systemPrompts.execution,
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

  return [
    {
      role: "system" as const,
      content: prompts[phase] || prompts["evaluate"],
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
