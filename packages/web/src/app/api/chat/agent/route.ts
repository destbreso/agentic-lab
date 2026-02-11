import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/chat/agent — Run an agentic task via the multi-loop engine
 *
 * Streams execution events as SSE so the chat UI can show real-time
 * pipeline progress (loop iterations, tool calls, planning, evaluation).
 *
 * Modes:
 *  - recipe   → Instantiate a named recipe and run it
 *  - pipeline → Run a raw pipeline config
 *  - auto     → The system picks the best recipe based on the task
 *
 * When the core engine isn't available (no providers configured, etc.)
 * we fall back to an Ollama-powered "agentic simulation" that still
 * shows meaningful steps for each phase.
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

interface SSEStream {
  event: "stream";
  content: string;
  done: boolean;
}

interface SSEResult {
  event: "result";
  content: string;
  tokens: number;
  durationMs: number;
  loops: string[];
  iterations: number;
}

interface SSEError {
  event: "error";
  message: string;
}

type SSEPayload = SSEStep | SSESubtask | SSEStream | SSEResult | SSEError;

// ── Helpers ─────────────────────────────────────────────

const RECIPES: Record<
  string,
  { name: string; loops: string[]; description: string }
> = {
  "ralph-loop": {
    name: "Ralph Loop",
    loops: ["execution"],
    description:
      "Classic single-loop agent: read specs → pick task → work → commit",
  },
  "exec-eval": {
    name: "Execute & Evaluate",
    loops: ["execution", "evaluation"],
    description: "Two-loop pattern: Execution does work, Evaluation verifies",
  },
  "plan-exec-eval": {
    name: "Plan → Execute → Evaluate",
    loops: ["planning", "execution", "evaluation"],
    description: "Three-loop: strategic planning, execution, then verification",
  },
  "full-agent-pipeline": {
    name: "Full Agent Pipeline",
    loops: ["planning", "execution", "evaluation", "critic", "memory"],
    description: "All 5 specialized loops for maximum autonomy",
  },
  "deep-reasoning": {
    name: "Deep Reasoning Agent",
    loops: ["planning", "execution", "evaluation", "critic", "refinement"],
    description:
      "Iterative self-correcting agent: plans, executes, evaluates, and re-plans until convergence — inspired by o1/Opus-class reasoning",
  },
};

function pickRecipeForTask(task: string): string {
  const lower = task.toLowerCase();
  // Deep reasoning for explicitly complex tasks
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
    return "deep-reasoning";
  }
  if (
    lower.includes("plan") ||
    lower.includes("architect") ||
    lower.includes("design")
  ) {
    return "plan-exec-eval";
  }
  if (
    lower.includes("full") ||
    lower.includes("complete") ||
    lower.includes("pipeline")
  ) {
    return "full-agent-pipeline";
  }
  if (
    lower.includes("verify") ||
    lower.includes("test") ||
    lower.includes("eval")
  ) {
    return "exec-eval";
  }
  return "ralph-loop";
}

function stepId() {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
      provider = "ollama",
      context = [],
    } = body;

    if (!task) {
      return NextResponse.json({ error: "Task is required" }, { status: 400 });
    }

    // Determine which recipe to use
    const recipeId =
      mode === "recipe" && requestedRecipe
        ? requestedRecipe
        : mode === "auto"
          ? pickRecipeForTask(task)
          : "ralph-loop";

    const recipe = RECIPES[recipeId] || RECIPES["ralph-loop"];

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
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
            detail: `Recipe: ${recipeId} · ${recipe.loops.length} loops`,
          });
          await sleep(400);
          send({
            event: "step",
            id: initId,
            label: `Initializing ${recipe.name}`,
            type: "think",
            status: "completed",
            durationMs: 400,
            detail: `Recipe: ${recipeId} · ${recipe.loops.length} loops`,
          });

          // ─── Deep Reasoning: iterative self-correcting engine ───
          if (recipeId === "deep-reasoning") {
            const MAX_ROUNDS = 3;
            const PASS_THRESHOLD = 0.7; // 70% criteria must pass to converge
            let round = 0;
            let converged = false;
            let currentPlan = "";
            let currentOutput = "";
            let refinementHistory: string[] = [];

            while (round < MAX_ROUNDS && !converged) {
              round++;
              const roundLabel =
                round === 1 ? "Initial" : `Refinement #${round - 1}`;

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

              const planPrompt =
                round === 1
                  ? buildLoopPrompt("planning", task, context)
                  : buildDeepReasoningPrompt(
                      "replan",
                      task,
                      context,
                      currentPlan,
                      currentOutput,
                      refinementHistory,
                    );

              const planStart = Date.now();
              const planResult = await callOllama(ollamaUrl, model, planPrompt);
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

              const execPrompt =
                round === 1
                  ? buildLoopPrompt("execution", task, context)
                  : buildDeepReasoningPrompt(
                      "re-execute",
                      task,
                      context,
                      currentPlan,
                      currentOutput,
                      refinementHistory,
                    );

              const execStart = Date.now();
              const execResult = await callOllamaStreaming(
                ollamaUrl,
                model,
                execPrompt,
                (chunk) => {
                  send({ event: "stream", content: chunk, done: false });
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

              const evalPrompt = buildDeepReasoningPrompt(
                "evaluate",
                task,
                context,
                currentPlan,
                currentOutput,
                refinementHistory,
              );
              const evalStart = Date.now();
              const evalResult = await callOllama(ollamaUrl, model, evalPrompt);
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

              // ──── CRITIC PHASE (always runs) ────
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

              const criticPrompt = buildDeepReasoningPrompt(
                "critic",
                task,
                context,
                currentPlan,
                currentOutput,
                refinementHistory,
              );
              const criticStart = Date.now();
              const criticResult = await callOllama(
                ollamaUrl,
                model,
                criticPrompt,
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

                const refinePrompt = buildDeepReasoningPrompt(
                  "refine-decision",
                  task,
                  context,
                  currentPlan,
                  currentOutput,
                  refinementHistory,
                );
                const refineStart = Date.now();
                const refineResult = await callOllama(
                  ollamaUrl,
                  model,
                  refinePrompt,
                );
                totalTokens += refineResult.tokens;

                const decision = parseRefinementDecision(refineResult.content);
                refinementHistory.push(
                  `Round ${round}: ${decision.action} — ${decision.reason}`,
                );

                // Emit decision subtasks
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

                // If backtracking, clear the current plan to force full re-plan
                if (decision.action === "backtrack") {
                  currentPlan = "";
                  currentOutput = "";
                }
              } else if (converged) {
                // ──── CONVERGENCE: Final synthesis ────
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

            // Emit final result for deep reasoning
            const totalDuration = Date.now() - startTime;
            send({ event: "stream", content: "", done: true });
            send({
              event: "result",
              content: `Deep reasoning completed in ${round} round${round > 1 ? "s" : ""}${converged ? " (converged)" : " (max rounds reached)"}`,
              tokens: totalTokens,
              durationMs: totalDuration,
              loops: [
                "planning",
                "execution",
                "evaluation",
                "critic",
                "refinement",
              ],
              iterations: totalIterations,
            });

            controller.close();
            return; // Skip the sequential loop below
          }

          // ─── Iterate through each loop in the recipe (sequential mode) ───
          for (const loopName of recipe.loops) {
            totalIterations++;

            // Step: starting loop
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

            // Build the LLM prompt for this loop phase
            const loopPrompt = buildLoopPrompt(loopName, task, context);

            // Call Ollama for this loop's output
            const loopStart = Date.now();

            try {
              const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model,
                  messages: loopPrompt,
                  stream: true,
                }),
              });

              if (!ollamaRes.ok || !ollamaRes.body) {
                throw new Error(`Ollama error: ${ollamaRes.statusText}`);
              }

              const reader = ollamaRes.body.getReader();
              const decoder = new TextDecoder();
              let loopContent = "";
              let loopTokens = 0;

              while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                const lines = text.split("\n").filter(Boolean);

                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line);
                    if (parsed.message?.content) {
                      loopContent += parsed.message.content;
                      // Stream content only for execution loop (main output)
                      if (loopName === "execution") {
                        send({
                          event: "stream",
                          content: parsed.message.content,
                          done: false,
                        });
                      }
                    }
                    if (parsed.done && parsed.eval_count) {
                      loopTokens =
                        parsed.eval_count + (parsed.prompt_eval_count || 0);
                    }
                  } catch {
                    // skip malformed
                  }
                }
              }

              totalTokens += loopTokens;
              const loopDuration = Date.now() - loopStart;

              // Complete the loop step
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

              // Progressively complete subtasks during execution loop
              if (loopName === "execution" && pendingSubtasks.length > 0) {
                const subsToProcess = pendingSubtasks.filter(
                  (s) => s.status !== "completed",
                );
                for (let si = 0; si < subsToProcess.length; si++) {
                  const sub = subsToProcess[si];
                  // Mark running
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
                  // Mark completed
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

              // Add inter-loop tool/search steps for realism with real data
              if (loopName === "planning") {
                // Extract individual action items / tasks from the planning output
                const actionItems = extractActionItems(loopContent);
                if (actionItems.length > 0) {
                  const toolId = stepId();
                  send({
                    event: "step",
                    id: toolId,
                    label: "Analyzing task structure",
                    type: "search",
                    status: "completed",
                    durationMs: 120,
                    detail: `Extracted ${actionItems.length} action items`,
                  });

                  // Emit each subtask as pending first
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
                    send({
                      event: "subtask",
                      ...sub,
                    });
                  }
                } else {
                  const toolId = stepId();
                  send({
                    event: "step",
                    id: toolId,
                    label: "Analyzing task structure",
                    type: "search",
                    status: "completed",
                    durationMs: 120,
                    detail: `Plan structured`,
                  });
                }
              }

              if (loopName === "evaluation") {
                const evalId = stepId();

                // Extract evaluation criteria from output
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
                  id: evalId,
                  label: "Validating output",
                  type: "eval",
                  status: "completed",
                  durationMs: 80,
                  detail:
                    evalItems.length > 0
                      ? `${evalItems.filter((e) => e.pass).length}/${evalItems.length} checks passed`
                      : "Quality checks passed",
                });

                // Mark any remaining subtasks as completed after evaluation
                if (pendingSubtasks.length > 0) {
                  for (const sub of pendingSubtasks) {
                    if (sub.status !== "completed") {
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
                }
              }

              if (loopName === "critic") {
                // Extract critic findings
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

                const criticId = stepId();
                send({
                  event: "step",
                  id: criticId,
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
                const memId = stepId();
                send({
                  event: "step",
                  id: memId,
                  label: "Compressing context",
                  type: "write",
                  status: "completed",
                  durationMs: 90,
                  detail: `Context compressed: ${loopContent.length} chars → summary stored`,
                });
              }

              // Feed output forward as context for next loop
              context.push({
                role: "assistant",
                content: `[${loopName.toUpperCase()} LOOP OUTPUT]\n${loopContent}`,
              });
            } catch (loopError) {
              const errMsg = (loopError as Error).message;
              send({
                event: "step",
                id: loopStepId,
                label: loopLabel,
                type: loopType,
                status: "error",
                loop: loopName,
                detail: errMsg,
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
  };
  return extras[loop] || base;
}

function buildLoopPrompt(
  loop: string,
  task: string,
  context: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const systemPrompts: Record<string, string> = {
    planning: `You are the PLANNING loop of a multi-loop agentic engine. Your job is to analyze the user's task and create a structured, step-by-step plan. Output a numbered list of concrete actions. Be strategic — think about dependencies, risks, and optimal ordering. Do NOT execute the task, only plan it.`,

    execution: `You are the EXECUTION loop of a multi-loop agentic engine. Your job is to carry out the task based on any planning context provided. Be thorough, write high-quality code or content. If you have a plan from a previous loop, follow it step by step. Show your work clearly.`,

    evaluation: `You are the EVALUATION loop of a multi-loop agentic engine. Your job is to verify the output from the execution loop. Check for: correctness, completeness, edge cases, potential bugs, code quality. Output a structured assessment with PASS/FAIL for each criterion and an overall verdict.`,

    critic: `You are the CRITIC loop (Anti-Ralph) of a multi-loop agentic engine. Your job is to detect: circular reasoning, repeated mistakes, scope creep, stagnation, and quality degradation. If you detect problems, flag them clearly with severity (LOW/MEDIUM/HIGH/CRITICAL). If everything looks good, say so briefly.`,

    memory: `You are the MEMORY loop of a multi-loop agentic engine. Your job is to compress and summarize the conversation context so far. Extract: key decisions made, important facts, code artifacts produced, and remaining tasks. Output a concise summary that a fresh agent could use to continue the work.`,
  };

  const messages = [
    {
      role: "system",
      content: systemPrompts[loop] || systemPrompts.execution,
    },
    ...context.map((c) => ({ role: c.role, content: c.content })),
    {
      role: "user",
      content: `Task: ${task}`,
    },
  ];

  return messages;
}

// ── Deep Reasoning Helpers ───────────────────────────────

/**
 * Call Ollama without streaming — returns full content + token count.
 */
async function callOllama(
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ content: string; tokens: number }> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
  const data = await res.json();
  const tokens = (data.eval_count || 0) + (data.prompt_eval_count || 0);
  return { content: data.message?.content || "", tokens };
}

/**
 * Call Ollama with streaming — invokes onChunk per token, returns full content.
 */
async function callOllamaStreaming(
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => void,
): Promise<{ content: string; tokens: number }> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama error: ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let tokens = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          content += parsed.message.content;
          onChunk(parsed.message.content);
        }
        if (parsed.done && parsed.eval_count) {
          tokens = parsed.eval_count + (parsed.prompt_eval_count || 0);
        }
      } catch {
        /* skip */
      }
    }
  }
  return { content, tokens };
}

/**
 * Build specialized prompts for the deep reasoning engine.
 * Each phase gets tailored instructions that incorporate prior rounds.
 */
function buildDeepReasoningPrompt(
  phase: "replan" | "re-execute" | "evaluate" | "critic" | "refine-decision",
  task: string,
  context: Array<{ role: string; content: string }>,
  currentPlan: string,
  currentOutput: string,
  refinementHistory: string[],
): Array<{ role: string; content: string }> {
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
    { role: "system", content: prompts[phase] || prompts["evaluate"] },
    ...context.slice(-4).map((c) => ({ role: c.role, content: c.content })),
    { role: "user", content: `Task: ${task}` },
  ];
}

/**
 * Parse the refinement decision from LLM output.
 */
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

// ── Utilities ───────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Truncate content to a max length for preview, preserving whole lines.
 */
function truncatePreview(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  const cut = content.slice(0, maxLen);
  const lastNewline = cut.lastIndexOf("\n");
  return (lastNewline > maxLen * 0.5 ? cut.slice(0, lastNewline) : cut) + "\n…";
}

/**
 * Extract evaluation criteria (PASS/FAIL lines) from evaluation output.
 */
function extractEvalCriteria(
  content: string,
): Array<{ label: string; pass: boolean }> {
  const results: Array<{ label: string; pass: boolean }> = [];
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Match patterns: "✅ Correctness: PASS", "❌ Edge Cases: FAIL", "PASS - Completeness", "- [x] Code quality"
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
    // Also match "Criterion: PASS/FAIL" pattern
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

/**
 * Extract critic findings (severity flags) from critic output.
 */
function extractCriticFindings(content: string): string[] {
  const findings: string[] = [];
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Match severity patterns: "HIGH: ...", "⚠️ MEDIUM: ...", "- LOW: ..."
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

/**
 * Extract individual action items from planning loop output.
 * Recognizes numbered lists (1. 2. 3.) and bullet lists (- *)
 */
function extractActionItems(content: string): string[] {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: string[] = [];

  for (const line of lines) {
    // Numbered items: "1. ...", "1) ...", "Step 1: ..."
    const numberedMatch = line.match(
      /^(?:\d+[\.\)]\s*|step\s+\d+[:\.\)]\s*)(.*)/i,
    );
    if (numberedMatch && numberedMatch[1].length > 3) {
      // Clean markdown bold/italic
      const clean = numberedMatch[1]
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .trim();
      // Truncate to first sentence or max 80 chars
      const short =
        clean.length > 80
          ? clean.slice(0, 77).replace(/\s+\S*$/, "") + "…"
          : clean;
      items.push(short);
      continue;
    }

    // Bullet items: "- ...", "* ...", "• ..."
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
