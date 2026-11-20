import { NextRequest, NextResponse } from "next/server";
import { EventEmitter } from "events";
import {
  createStorageWithRedis,
  listRecipes,
  taskKey,
  type LoopCategory,
  type RunEvent,
  type Storage,
  type RedisEventBus,
} from "jig-core";
import { checksFromBody, memoryNamespace, recallMemories, startAgentRun, type ChatMemoryScope } from "@/lib/agent-run";
import { registerJob, unregisterJob } from "./job-store";

/**
 * POST /api/chat/agent: run a task on a topology, streaming its events.
 *
 * An adapter over TopologyRun, the engine the builder, the CLI and the
 * benchmarks run through too. It streams two things over SSE: every engine
 * event unchanged (`event: "engine"`), and the step/subtask/result events the
 * chat page draws, derived from them. Steering and cancelling reach the
 * session through the run registry (see ./nudge and ./cancel).
 */

interface AgentRequest {
  task: string;
  mode?: "recipe" | "pipeline" | "auto";
  recipe?: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  memoryNamespace?: string;
  memoryEnabled?: boolean;
  /** How far back recall reaches: "session" (default), "task", "shared" or "off". */
  memoryScope?: ChatMemoryScope;
  workingDir?: string;
  maxRounds?: number;
  context?: Array<{ role: string; content: string }>;
}

type StepType = "think" | "plan" | "tool" | "code" | "search" | "write" | "eval";

/** Pick a topology from the task's words when the client asks for "auto". */
function pickRecipeForTask(task: string, available: Set<string>): string {
  const lower = task.toLowerCase();
  const has = (...words: string[]) => words.some((w) => lower.includes(w));
  const choose = (id: string) => (available.has(id) ? id : "ralph-loop");
  if (has("deep", "reason", "complex", "hard", "difficult", "think step by step", "refine")) return choose("deep-reasoning");
  if (has("compete", "duel", "adversarial", "tournament", "versus", "compare", "battle")) return choose("adversarial-duel");
  if (has("supervise", "team", "code review", "supervised", "review my", "pair program")) return choose("supervised-coder");
  if (has("full", "complete", "pipeline", "plan", "architect", "design")) return choose("full-agent-pipeline");
  if (has("verify", "test", "eval")) return choose("exec-eval");
  return "ralph-loop";
}

const STEP_TYPE: Record<LoopCategory, StepType> = {
  planning: "plan",
  execution: "code",
  evaluation: "eval",
  critic: "think",
  memory: "think",
  refinement: "think",
  custom: "think",
};

const preview = (text: string, max = 600) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The chat page's events for one engine event. */
function chatEventsFor(e: RunEvent, runId: string): Array<Record<string, unknown>> {
  switch (e.type) {
    case "run:start":
      return [
        {
          event: "step",
          id: `${runId}-start`,
          label: `Running ${e.topology.name}`,
          type: "think",
          status: "completed",
          detail: `${e.order.length} roles: ${e.roles.map((r) => r.name).join(" → ")}`,
        },
      ];
    case "role:start":
      return [
        {
          event: "step",
          id: `${runId}-r${e.round}-${e.role}`,
          label: `${e.name} (round ${e.round})`,
          type: STEP_TYPE[e.category],
          status: "running",
          loop: e.category,
          iteration: e.round,
        },
      ];
    case "role:end": {
      const stepId = `${runId}-r${e.round}-${e.role}`;
      const detail = [
        e.verdict ? `verdict: ${e.verdict}` : "",
        e.decision ? `decision: ${e.decision}` : "",
        `${e.tokens.totalTokens} tokens`,
        e.toolCalls.length ? `${e.toolCalls.length} tool calls` : "",
        e.errors.length ? `failed: ${e.errors.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const out: Array<Record<string, unknown>> = [
        {
          event: "step",
          id: stepId,
          label: `${e.name} (round ${e.round})`,
          type: STEP_TYPE[e.category],
          status: e.success ? "completed" : "error",
          loop: e.category,
          iteration: e.round,
          durationMs: e.durationMs,
          detail,
          contentPreview: preview(e.output),
        },
      ];
      e.toolCalls.forEach((tc, i) =>
        out.push({
          event: "subtask",
          parentStepId: stepId,
          id: `${stepId}-tool-${i}`,
          label: `${tc.name} ${tc.args}`,
          status: tc.ok ? "completed" : "error",
          index: i,
          total: e.toolCalls.length,
        }),
      );
      if (e.output) out.push({ event: "thinking", content: `${e.output}\n`, phase: e.category, round: e.round });
      return out;
    }
    case "round:end":
      return [
        {
          event: "step",
          id: `${runId}-r${e.round}-end`,
          label: `Round ${e.round}: ${e.verdict ?? "no verdict"}`,
          type: "think",
          status: "completed",
          loop: "refinement",
          iteration: e.round,
          detail: e.next ? `${e.reason}; next round starts at ${e.next}` : e.reason,
        },
      ];
    case "consult:end":
      return [
        {
          event: "step",
          id: `${runId}-r${e.round}-${e.from}-consult-${e.to}-${Date.now()}`,
          label: `${e.from} consulted ${e.name} (round ${e.round})`,
          type: "think",
          status: e.error ? "error" : "completed",
          loop: "consult",
          iteration: e.round,
          detail: e.error ?? `${e.tokens.totalTokens} tokens${e.sealed ? " · sealed advice" : ""}${e.real ? " · the provider's advisor tool" : ""}`,
        },
      ];
    case "steer:queued":
      return [
        {
          event: "steering:nudge",
          nudge: { id: e.id, message: e.message, priority: e.priority, createdAt: new Date().toISOString() },
        },
      ];
    case "steer:delivered":
      return [{ event: "steering:consumed", nudges: [{ id: e.id }], injectionPoint: `${e.role}, round ${e.round}` }];
    case "steer:dropped":
      return [
        {
          event: "step",
          id: `${runId}-${e.id}`,
          label: "Steering not delivered",
          type: "think",
          status: "error",
          detail: e.reason,
          loop: "steering",
        },
      ];
    default:
      return [];
  }
}

export async function POST(request: NextRequest) {
  let body: AgentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { task, mode = "auto", recipe: requested, model, provider: providerName = "ollama", context = [] } = body;
  if (!task) {
    return NextResponse.json({ error: "Task is required" }, { status: 400 });
  }

  // The task's checks and the settings an experiment varies, validated before anything runs.
  let checks: ReturnType<typeof checksFromBody>;
  try {
    checks = checksFromBody(body as unknown as Record<string, unknown>);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const available = new Set(listRecipes().map((r) => r.id));
  const topology =
    mode === "recipe" && requested ? requested : mode === "auto" ? pickRecipeForTask(task, available) : "ralph-loop";
  if (!available.has(topology)) {
    return NextResponse.json({ error: `Unknown topology "${topology}"` }, { status: 400 });
  }

  // Storage and the event bus are optional: the run goes ahead without them.
  let storage: Storage | null = null;
  let redisBus: RedisEventBus | null = null;
  try {
    const infra = await createStorageWithRedis();
    storage = infra.storage;
    redisBus = infra.redis ?? null;
  } catch {
    /* no infrastructure */
  }

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Memories recalled for this task: from the chosen bank, else within its scope
  // (this conversation by default), never from an unrelated task unless asked.
  const memoryEnabled = body.memoryEnabled !== false;
  const memoryScope: ChatMemoryScope = memoryEnabled ? (body.memoryScope ?? "session") : "off";
  const recalled = await recallMemories(storage, task, {
    bank: memoryEnabled ? body.memoryNamespace : undefined,
    scope: memoryScope,
    sessionId: body.sessionId,
  });
  const memories = recalled.memories;
  const memorySearchType = recalled.searchType;
  const memoryNs = recalled.namespace;

  // Events go to the SSE observers, and the chat page's events also to Redis
  // and the event store, so a page that reconnects can follow the run.
  const jobEmitter = new EventEmitter();
  jobEmitter.setMaxListeners(50);
  const send = (payload: Record<string, unknown>, broadcast = true) => {
    jobEmitter.emit("sse", payload);
    if (!broadcast) return;
    const eventType = String(payload.event);
    redisBus
      ?.publishEvent(runId, { id: Date.now(), runId, eventType, payload, createdAt: new Date().toISOString() })
      .catch(() => {});
    storage?.events.emit(runId, eventType, payload).catch(() => {});
  };

  const abort = new AbortController();
  let roleNames: string[] = [];
  let roleTurns = 0;
  let handle: Awaited<ReturnType<typeof startAgentRun>>;
  try {
    handle = await startAgentRun(
      {
        task,
        topology,
        provider: providerName,
        model,
        workingDir: body.workingDir,
        context,
        memories,
        maxRounds: body.maxRounds,
        ...checks,
        runId,
        tags: [topology, providerName],
        config: { mode, sessionId: body.sessionId, chatMemoryScope: memoryScope, memoryNamespace: memoryNs },
      },
      {
        storage,
        onEvent: (e) => {
          if (e.type === "run:start") roleNames = e.roles.map((r) => r.name);
          if (e.type === "role:end") roleTurns++;
          send({ event: "engine", ...e }, false);
          for (const p of chatEventsFor(e, runId)) send(p);
        },
      },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  abort.signal.addEventListener("abort", () => handle.session.stop("stopped by the user"));

  const job = (async () => {
    await Promise.resolve(); // let the SSE observer subscribe first
    send({ event: "run_id", runId });
    send({ event: "memory", phase: "retrieval", searchType: memorySearchType, memoriesFound: memories.length > 0, namespace: memoryNs });
    try {
      const run = await handle.done;
      send({ event: "stream", content: "", done: true });
      send({
        event: "result",
        content: `${run.outcome}: ${run.reason}`,
        finalAnswer: run.answer,
        tokens: run.result.finalState.totalTokens.totalTokens,
        durationMs: run.result.totalDurationMs,
        loops: roleNames,
        iterations: roleTurns,
        outcome: run.outcome,
        topologyOutcome: run.result.outcome,
        success: run.success,
        verdict: run.result.verdict,
        measured: run.measured,
        rounds: run.result.totalCycles,
      });
      if (run.outcome === "stopped") send({ event: "cancelled", message: run.reason });
      else if (run.result.errors.length > 0) send({ event: "error", message: run.result.errors.join("; ") });

      // Keep the task and the answer for later: in the bank or this conversation,
      // and under the task's own key, so a "task" recall finds it from any conversation.
      if (memoryEnabled && storage && run.answer && body.sessionId) {
        const home = memoryNamespace(task, { bank: body.memoryNamespace, scope: "session", sessionId: body.sessionId })!;
        const places = body.memoryNamespace ? [home] : [home, ["task", taskKey(task)]];
        try {
          for (const ns of places) {
            await storage.memory.put(ns, `task-${runId}`, { text: task, role: "user", sessionId: body.sessionId, messageType: "task" });
            await storage.memory.put(ns, `result-${runId}`, {
              text: run.answer.slice(0, 4000),
              role: "agent",
              sessionId: body.sessionId,
              messageType: "result",
              model,
              recipe: topology,
              outcome: run.outcome,
            });
          }
          send({ event: "memory", phase: "saved", namespace: home });
        } catch {
          /* best-effort */
        }
      }
    } catch (error) {
      send({ event: "error", message: (error as Error).message });
    } finally {
      storage?.close().catch(() => {});
      redisBus?.disconnect().catch(() => {});
      jobEmitter.emit("done");
      unregisterJob(runId);
    }
  })();

  // The job outlives the request: a client that disconnects can come back.
  registerJob(runId, { promise: job, emitter: jobEmitter, abort });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const onEvent = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
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
}
