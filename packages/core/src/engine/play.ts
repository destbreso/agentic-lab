// ============================================
// A dry run: a scripted model, so a topology can be seen moving without one
// ============================================
// `jig show <topology> --play` runs the topology on this provider in
// a scratch directory. It answers by role, from the system prompt each of the
// lab's engines sends, with the same small story in every topology: Do writes
// a file with its tools and consults where the topology lets it, Check fails
// the first round and passes the next, Decide sends the work back once and
// then converges. Each call waits a moment, so the run can be watched. It
// spends no tokens and reports none.

import type { ChatCompletionOptions, ChatCompletionResult, LLMProvider } from "../types/llm.js";

export type PlayRole = "plan" | "do" | "check" | "critique" | "decide" | "memory" | "advisor" | "other";

/** The role a call is for, from the system prompt the lab's engines send. */
export function playRoleOf(system: string): PlayRole {
  if (system.includes("execution loop")) return "do";
  if (system.includes("evaluation agent")) return "check";
  if (system.includes("strategic planning agent")) return "plan";
  if (system.includes("CRITIC agent")) return "critique";
  if (system.includes("REFINEMENT DECISION")) return "decide";
  if (system.startsWith("You are an advisor")) return "advisor";
  if (system.toLowerCase().includes("memory")) return "memory";
  return "other";
}

export interface PlayOptions {
  /** How long each call waits before it answers, in milliseconds (default 700). */
  delayMs?: number;
  /** Awaited before each answer: a paused player holds it. */
  gate?: () => Promise<void>;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

const NO_TOKENS = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** A provider that plays a topology's run. One per run: it counts turns. */
export function playProvider(options: PlayOptions = {}): LLMProvider {
  const delay = options.delayMs ?? 700;
  const turns = new Map<PlayRole, number>();
  let seq = 0;
  const reply = (content: string, toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>): ChatCompletionResult => ({
    message: { role: "assistant", content, ...(toolCalls ? { toolCalls: toolCalls.map((c) => ({ id: `play-${++seq}`, ...c })) } : {}) },
    usage: { ...NO_TOKENS },
    finishReason: toolCalls ? "tool_calls" : "stop",
    model: "dry run",
  });
  return {
    name: "dry-run",
    listModels: async () => ["dry run"],
    healthCheck: async () => true,
    async chat(o: ChatCompletionOptions): Promise<ChatCompletionResult> {
      await wait(delay, o.signal);
      await options.gate?.();
      if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const system = o.messages.find((m) => m.role === "system")?.content ?? "";
      const role = playRoleOf(system);
      // A turn is counted on its first call: the one with no tool result yet.
      const results = o.messages.filter((m) => m.role === "tool");
      if (results.length === 0) turns.set(role, (turns.get(role) ?? 0) + 1);
      const turn = turns.get(role) ?? 1;
      const tools = new Set((o.tools ?? []).map((t) => t.name));
      switch (role) {
        case "plan":
          return reply("STRATEGY: continue\nREASONING: a dry run\nNEXT_TASK: do the task and write it down");
        case "do": {
          const consult = [...tools].find((t) => t.startsWith("consult_"));
          const asked = o.messages.some((m) => m.toolCalls?.some((c) => c.name.startsWith("consult_")));
          if (consult && !asked) {
            const params = o.tools?.find((t) => t.name === consult)?.parameters.required ?? [];
            return reply("", [{ name: consult, arguments: params.includes("question") ? { question: "Is the file I am about to write the right answer?" } : {} }]);
          }
          if (results.length === (consult ? 1 : 0) && tools.has("file_write")) {
            // The second turn also ticks the plan, so a topology that repeats while its plan is open stops.
            const write = turn >= 2 ? { path: "PLAN.md", content: "- [x] the task\n" } : { path: "dry-run.txt", content: `turn ${turn} of a dry run\n` };
            return reply("", [{ name: "file_write", arguments: write }]);
          }
          return reply(`Turn ${turn}: wrote the file. This is a dry run: no model was called.`);
        }
        case "check":
          return reply(
            turn === 1
              ? JSON.stringify({ verdict: "fail", evidence: ["the file is not there yet"], corrections: ["write the file again"], confidence: 0.6 })
              : JSON.stringify({ verdict: "pass", evidence: ["the file is there"], corrections: [], confidence: 0.9 }),
          );
        case "critique":
          return reply(JSON.stringify({ status: "ok", issues: [], intervention: "none", reasoning: "a dry run" }));
        case "decide":
          return reply(
            turn === 1
              ? JSON.stringify({ decision: "refine", reason: "the check did not pass", corrections: ["write the file again"] })
              : JSON.stringify({ decision: "converge", reason: "the check passed", corrections: [] }),
          );
        case "advisor":
          return reply("Read the file back before you answer.");
        case "memory":
          return reply(JSON.stringify({ summary: "a dry run", isMilestone: false, milestoneDescription: "", memories: [], noiseFiltered: "" }));
        default:
          return reply("ok");
      }
    },
  };
}
