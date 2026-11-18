// ============================================
// Agent runs (web)
// ============================================
// The one way the web runs a topology: the chat, the builder and the
// benchmarks all come here, and this runs AgentSession, the engine the CLI
// uses too. It builds the provider, tools and skills, folds the conversation
// and recalled memories into the task, and keeps the run record.

import {
  AgentSession,
  buildMetaKnowledgePrompt,
  createDefaultToolkit,
  detectMetaQuestion,
  type AgentRunResult,
  type Recipe,
  type SessionEvent,
  type Storage,
} from "@agentic-lab/core";
import { createWebProvider } from "@/lib/pipeline-build";
import { getSkills } from "@/lib/skills-store";

export interface AgentRunRequest {
  task: string;
  /** A registered topology id, or a definition (the builder's graph). */
  topology: string | Recipe;
  provider?: string;
  model?: string;
  workingDir?: string;
  /** Earlier messages of the conversation, oldest first. */
  context?: Array<{ role: string; content: string }>;
  /** Memories recalled for this task, already formatted. */
  memories?: string[];
  maxRounds?: number;
  runId?: string;
  tags?: string[];
  config?: Record<string, unknown>;
}

export interface AgentRunHandle {
  session: AgentSession;
  done: Promise<AgentRunResult>;
}

/** Rough cost per 1K tokens, for the usage record. Local models cost nothing. */
const COST_PER_1K: Record<string, number> = {
  "openai:gpt-4o": 0.005,
  "openai:gpt-4o-mini": 0.00015,
  "anthropic:claude-3-opus": 0.015,
  "anthropic:claude-3-sonnet": 0.003,
  "anthropic:claude-3-haiku": 0.00025,
  openrouter: 0.002,
};

export interface RecalledMemories {
  memories: string[];
  searchType: "semantic" | "text-fallback" | "none";
  namespace: string[];
}

/**
 * Memories for a task, from a bank when one is named, else the chat namespace:
 * semantic search first, then a keyword filter over the stored text.
 */
export async function recallMemories(
  storage: Storage | null,
  task: string,
  bank?: string,
): Promise<RecalledMemories> {
  const namespace = bank ? ["memory-bank", bank] : ["chat"];
  const none: RecalledMemories = { memories: [], searchType: "none", namespace };
  if (!storage) return none;
  let found: Awaited<ReturnType<Storage["memory"]["search"]>> = [];
  let searchType: RecalledMemories["searchType"] = "none";
  try {
    found = await storage.memory.semanticSearch(namespace, task, { limit: 5 });
    if (found.length > 0) searchType = "semantic";
  } catch {
    /* no vector search */
  }
  if (found.length === 0) {
    try {
      const keywords = task.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      found = (await storage.memory.search(namespace, { limit: 200 }))
        .filter((m) => keywords.some((k) => String(m.value.text ?? "").toLowerCase().includes(k)))
        .slice(0, 5);
      if (found.length > 0) searchType = "text-fallback";
    } catch {
      return none;
    }
  }
  return {
    memories: found.map(
      (m) => `[${String(m.value.role ?? "unknown")}]: ${String(m.value.text ?? JSON.stringify(m.value)).slice(0, 500)}`,
    ),
    searchType,
    namespace,
  };
}

/** The task the topology receives: the request, then what it was said in reply to. */
export function composeTask(req: Pick<AgentRunRequest, "task" | "context" | "memories">): string {
  const parts = [req.task];
  if (detectMetaQuestion(req.task) >= 0.5) {
    parts.push(`## About this system\n\n${buildMetaKnowledgePrompt({})}`);
  }
  const context = (req.context ?? []).filter((c) => c.content?.trim());
  if (context.length > 0) {
    parts.push(
      "## Earlier in this conversation\n\n" +
        context.map((c) => `${c.role}: ${c.content.slice(0, 1500)}`).join("\n\n"),
    );
  }
  if (req.memories?.length) {
    parts.push(`## Recalled from earlier conversations\n\n${req.memories.join("\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * Start a run. The session is returned at once, so the caller can stream its
 * events and steer or stop it; `done` resolves with the outcome.
 */
export async function startAgentRun(
  req: AgentRunRequest,
  opts: { onEvent?: (event: SessionEvent) => void; storage?: Storage | null } = {},
): Promise<AgentRunHandle> {
  const providerName = req.provider ?? "ollama";
  const model = req.model ?? process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.1";
  const provider = createWebProvider(providerName, model);
  const skills = await getSkills();

  const session = new AgentSession({
    provider,
    tools: createDefaultToolkit(),
    topology: req.topology,
    skills,
    workingDir: req.workingDir || process.cwd(),
    providerFactory: (brain: { provider?: string; model?: string }) =>
      createWebProvider(brain.provider ?? providerName, brain.model ?? model),
    maxRounds: req.maxRounds,
    storage: opts.storage ?? undefined,
    runId: req.runId,
    runInfo: {
      provider: providerName,
      model,
      tags: req.tags,
      config: req.config,
      costOf: (usage) => {
        const rate = COST_PER_1K[`${providerName}:${model}`] ?? COST_PER_1K[providerName] ?? 0;
        return (usage.totalTokens / 1000) * rate;
      },
    },
  });
  if (opts.onEvent) session.on("event", opts.onEvent);

  const done = session.run(composeTask(req));
  return { session, done };
}
