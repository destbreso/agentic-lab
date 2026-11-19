// ============================================
// Scripted provider for tests
// ============================================
// A mock LLMProvider that answers by role. The role is recognised from the
// system prompt each built-in loop sends, every call is recorded, and the
// script decides each reply. No network, no tokens.

import type { ChatCompletionOptions, ChatCompletionResult, LLMProvider, ToolDefinition } from "../types/llm.js";

export type Role = "plan" | "do" | "check" | "critique" | "decide" | "memory" | "other";

export interface ScriptedCall {
  role: Role;
  /** 1-based count of calls this role has received so far. */
  turn: number;
  system: string;
  /** Every non-system message, joined: what the role was shown. */
  prompt: string;
  tools: string[];
  maxTokens?: number;
  signal?: AbortSignal;
  options: ChatCompletionOptions;
}

export interface ScriptedReply {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

export function roleOf(system: string): Role {
  if (system.includes("execution loop")) return "do";
  if (system.includes("evaluation agent")) return "check";
  if (system.includes("strategic planning agent")) return "plan";
  if (system.includes("CRITIC agent")) return "critique";
  if (system.includes("REFINEMENT DECISION")) return "decide";
  if (system.toLowerCase().includes("memory")) return "memory";
  return "other";
}

const DEFAULT_REPLIES: Record<Role, string> = {
  plan: "STRATEGY: continue\nREASONING: start\nNEXT_TASK: do the task",
  do: "done",
  check: '{"verdict":"pass","evidence":["looked"],"corrections":[],"confidence":0.9}',
  critique: '{"status":"ok","issues":[],"intervention":"none","reasoning":"fine"}',
  decide: '{"decision":"converge","reason":"good","corrections":[]}',
  memory: '{"summary":"s","isMilestone":false,"milestoneDescription":"","memories":[],"noiseFiltered":""}',
  other: "ok",
};

export interface ScriptedProvider extends LLMProvider {
  calls: ScriptedCall[];
  /** Prompts a role received, in order. */
  promptsOf(role: Role): string[];
}

/**
 * Build a provider that answers through `script`. Return undefined from the
 * script to fall back to a default reply for the role (Check passes, Decide
 * converges). A script may throw, or await the call's signal.
 */
export function scriptedProvider(
  script: (call: ScriptedCall) => ScriptedReply | string | undefined | Promise<ScriptedReply | string | undefined> = () => undefined,
  name = "scripted",
): ScriptedProvider {
  const calls: ScriptedCall[] = [];
  const turns = new Map<Role, number>();
  let toolSeq = 0;
  return {
    name,
    calls,
    promptsOf: (role) => calls.filter((c) => c.role === role).map((c) => c.prompt),
    async chat(options): Promise<ChatCompletionResult> {
      const system = options.messages.find((m) => m.role === "system")?.content ?? "";
      const role = roleOf(system);
      const turn = (turns.get(role) ?? 0) + 1;
      turns.set(role, turn);
      const call: ScriptedCall = {
        role,
        turn,
        system,
        prompt: options.messages
          .filter((m) => m.role !== "system")
          .map((m) => m.content)
          .join("\n"),
        tools: (options.tools ?? []).map((t: ToolDefinition) => t.name),
        maxTokens: options.maxTokens,
        signal: options.signal,
        options,
      };
      calls.push(call);
      const raw = (await script(call)) ?? DEFAULT_REPLIES[role];
      const reply: ScriptedReply = typeof raw === "string" ? { content: raw } : raw;
      const toolCalls = reply.toolCalls?.map((tc) => ({ id: `tc-${++toolSeq}`, ...tc }));
      // Asked to stream, it hands its text on a word at a time, as a model would.
      if (options.onText && reply.content) for (const piece of reply.content.match(/\S+\s*/g) ?? []) options.onText(piece);
      return {
        message: { role: "assistant", content: reply.content ?? "", toolCalls },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: toolCalls?.length ? "tool_calls" : "stop",
        model: "scripted",
      };
    },
    listModels: async () => ["scripted"],
    healthCheck: async () => true,
  };
}

/** Resolve when the signal aborts, rejecting with an AbortError like the providers do. */
export function untilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) return fail();
    signal?.addEventListener("abort", fail, { once: true });
  });
}
