// ============================================
// Provider recorder and replay
// ============================================
// A recorder wraps the provider a role calls and reports each call, exactly
// as sent and as answered, to the run's step log. Replay builds, from a run's
// step records, one provider per role that answers with that role's recorded
// replies in order, so a recorded run can be run again without a model.

import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  LLMProvider,
} from "../types/llm.js";
import type { RecordedCall, StepRecord } from "../types/step.js";

export type CallSink = (call: Omit<RecordedCall, "seq">) => void;

/** The context window a provider asks for, when it sets one (Ollama's num_ctx). */
function contextWindowOf(provider: LLMProvider): number | undefined {
  const value = (provider as { contextWindow?: unknown }).contextWindow;
  return typeof value === "number" ? value : undefined;
}

/** Wrap a provider so every call is reported to `sink`, failures included. */
export function recordingProvider(provider: LLMProvider, sink: CallSink): LLMProvider {
  const wrapped: LLMProvider = {
    get name() {
      return provider.name;
    },
    async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
      // No call starts once its turn or its run is aborted, whatever the provider does with the signal.
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      // A copy now: the loop keeps appending to its own array after the call.
      const messages = structuredClone(options.messages);
      const startedAt = new Date();
      const base = {
        provider: provider.name,
        messages,
        tools: (options.tools ?? []).map((t) => t.name),
        options: {
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(contextWindowOf(provider) !== undefined ? { contextWindow: contextWindowOf(provider) } : {}),
        },
        startedAt: startedAt.toISOString(),
      };
      try {
        const result = await provider.chat(options);
        sink({
          ...base,
          reply: {
            content: result.message.content ?? "",
            ...(result.message.toolCalls?.length ? { toolCalls: structuredClone(result.message.toolCalls) } : {}),
            ...(result.serverToolResults?.length ? { serverToolResults: structuredClone(result.serverToolResults) } : {}),
            finishReason: result.finishReason,
            model: result.model,
          },
          usage: { ...result.usage },
          durationMs: Date.now() - startedAt.getTime(),
        });
        return result;
      } catch (error) {
        sink({
          ...base,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          error: (error as Error).message,
          durationMs: Date.now() - startedAt.getTime(),
        });
        throw error;
      }
    },
    listModels: () => provider.listModels(),
    healthCheck: () => provider.healthCheck(),
  };
  if (provider.chatStream) wrapped.chatStream = (options) => provider.chatStream!(options);
  // Keep what the provider says about itself visible through the wrapper.
  const contextWindow = contextWindowOf(provider);
  if (contextWindow !== undefined) Object.assign(wrapped, { contextWindow });
  return wrapped;
}

/** The role a provider is built for. */
export interface RoleRef {
  id: string;
  name: string;
  category: string;
  type: string;
}

/**
 * One provider per role that answers with the replies recorded for that role,
 * in order. A call past the last recorded reply fails loudly: the replay has
 * gone somewhere the recording never went.
 */
export function replayProviders(steps: StepRecord[]): (role: RoleRef) => LLMProvider {
  const byRole = new Map<string, RecordedCall[]>();
  for (const step of [...steps].sort((a, b) => a.seq - b.seq)) {
    const calls = byRole.get(step.role) ?? [];
    calls.push(...[...step.calls].sort((a, b) => a.seq - b.seq));
    byRole.set(step.role, calls);
  }
  return (role) => {
    const queue = [...(byRole.get(role.id) ?? [])];
    return {
      name: "replay",
      async chat(): Promise<ChatCompletionResult> {
        const call = queue.shift();
        if (!call) throw new Error(`replay: no recorded reply left for ${role.id}`);
        if (!call.reply) throw new Error(`replay: the recorded call failed: ${call.error ?? "no reply"}`);
        const toolCalls = call.reply.toolCalls?.length ? structuredClone(call.reply.toolCalls) : undefined;
        return {
          message: { role: "assistant", content: call.reply.content, ...(toolCalls ? { toolCalls } : {}) },
          usage: { ...call.usage },
          finishReason: call.reply.finishReason as ChatCompletionResult["finishReason"],
          model: call.reply.model,
        };
      },
      listModels: async () => ["replay"],
      healthCheck: async () => true,
    };
  };
}
