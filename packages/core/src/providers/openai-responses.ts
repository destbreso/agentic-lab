// ============================================
// OpenAI's Responses API: reasoning models that reason before a tool call
// ============================================
// On /v1/chat/completions OpenAI's reasoning models refuse a reasoning effort
// when function tools are offered ("use /v1/responses or set reasoning_effort
// to 'none'"), so with tools they did not reason at all: probed on
// gpt-5.4-nano, Do wrote a guessed GSM8K answer with its first call (22
// output tokens) and did the arithmetic only in its closing text, which then
// claimed the right number. Through the Responses API at effort low the same
// turn reasoned first and wrote the right answer, 3 of 3. Requests are
// stateless (store: false): each turn's encrypted reasoning comes back with it
// and is sent back with it.

import type { ChatMessage, LLMProviderConfig, ToolCall, ToolDefinition } from "../types/llm.js";

/** The tag of the items this API needs back (ChatMessage.providerItems). */
export const RESPONSES_ITEMS = "openai-responses";

export type ReasoningEffort = NonNullable<LLMProviderConfig["reasoningEffort"]>;

/**
 * The effort asked for when none is configured. OpenAI's own default for its
 * current reasoning models is none, which with tools reads as a model that
 * acts first and thinks afterwards; low was enough for the probed turn.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

type Item = Record<string, unknown>;

/** The request's instructions and input items, from a conversation. */
export function responsesInput(messages: ChatMessage[]): { instructions?: string; input: Item[] } {
  let instructions: string | undefined;
  const input: Item[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (instructions === undefined) instructions = m.content;
      else input.push({ role: "developer", content: m.content });
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.toolCallId ?? "", output: m.content });
    } else if (m.role === "assistant") {
      // A turn this API produced goes back exactly as it came, its reasoning with it.
      if (m.providerItems?.provider === RESPONSES_ITEMS) {
        input.push(...(m.providerItems.items as Item[]));
        continue;
      }
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const tc of m.toolCalls ?? []) input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) });
    } else {
      input.push({ role: "user", content: m.content });
    }
  }
  return { ...(instructions !== undefined ? { instructions } : {}), input };
}

export function responsesTools(tools: ToolDefinition[]): Item[] {
  return tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
}

export interface ReadResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length";
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  model: string;
  /** The turn's items, when it holds reasoning to send back. */
  items?: unknown[];
}

/** A response's text, tool calls and reasoning. */
export function readResponse(response: Record<string, any>): ReadResponse {
  const output: Item[] = Array.isArray(response.output) ? response.output : [];
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const o of output as Array<Record<string, any>>) {
    if (o.type === "message") {
      for (const c of (o.content ?? []) as Array<Record<string, any>>) {
        if (c.type === "output_text") content += String(c.text ?? "");
        else if (c.type === "refusal") content += String(c.refusal ?? "");
      }
    } else if (o.type === "function_call") {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(String(o.arguments ?? "{}")) as Record<string, unknown>;
      } catch {
        args = { _raw: o.arguments };
      }
      toolCalls.push({ id: String(o.call_id ?? o.id ?? `call-${toolCalls.length}`), name: String(o.name), arguments: args });
    }
  }
  const input = Number(response.usage?.input_tokens ?? 0);
  const out = Number(response.usage?.output_tokens ?? 0);
  const cut = response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens";
  return {
    content,
    ...(toolCalls.length ? { toolCalls } : {}),
    finishReason: toolCalls.length ? "tool_calls" : cut ? "length" : "stop",
    usage: { inputTokens: input, outputTokens: out, totalTokens: input + out },
    model: String(response.model ?? ""),
    ...(output.some((o) => o.type === "reasoning") ? { items: structuredClone(output) } : {}),
  };
}

/** Whether a server is OpenAI's own, the one that speaks the Responses API. */
export function isOpenAIHost(baseURL: string): boolean {
  try {
    return new URL(baseURL).host === "api.openai.com";
  } catch {
    return false;
  }
}
