// ============================================
// Context Window Management
// ============================================
// Keeps a message array within a budget during long tool-loops, so the
// conversation cannot grow without bound and blow past the model's context
// window (the old behavior: `messages` grew unbounded across up to
// maxToolRounds=20 rounds).
//
// The tricky part is tool-call/tool-result pairing: OpenAI/Anthropic reject a
// `tool` message whose corresponding assistant `tool_calls` is missing. So
// pruning must never leave an orphan `tool` message at the start of the kept
// window. We keep the head (system + first user/task), drop from the middle,
// and keep the most recent messages — dropping any leading orphan tool
// results in the kept tail.

import type { ChatMessage } from "../types/llm.js";

export interface PruneOptions {
  /** Max number of messages to keep (0 = unlimited). */
  maxMessages?: number;
  /** Approximate character budget across message contents (0 = unlimited). */
  maxChars?: number;
  /** Always keep leading system messages. Default: true. */
  preserveSystem?: boolean;
  /** Always keep the first user message (the task/prompt). Default: true. */
  preserveFirstUser?: boolean;
  /** Always keep at least the last N messages. Default: 8. */
  preserveRecent?: number;
  /** Insert a notice where messages were dropped. Default: true. */
  insertNotice?: boolean;
}

const DEFAULTS: Required<PruneOptions> = {
  maxMessages: 40,
  maxChars: 48_000,
  preserveSystem: true,
  preserveFirstUser: true,
  preserveRecent: 8,
  insertNotice: true,
};

/** Approximate character length of a message (content + serialized tool calls). */
function charLen(m: ChatMessage): number {
  let n = (m.content || "").length;
  if (m.toolCalls && m.toolCalls.length) {
    n += JSON.stringify(m.toolCalls).length;
  }
  return n;
}

/** Approximate total character size of a message array. */
export function estimateChars(messages: ChatMessage[]): number {
  let sum = 0;
  for (const m of messages) sum += charLen(m);
  return sum;
}

/** Remove leading `tool` messages (their assistant tool_call was dropped). */
function dropLeadingOrphanTools(slice: ChatMessage[]): ChatMessage[] {
  let start = 0;
  while (start < slice.length && slice[start].role === "tool") start++;
  return slice.slice(start);
}

/**
 * Prune a message array to fit within budget while preserving:
 *  - leading system messages,
 *  - the first user message (the task),
 *  - the most recent messages,
 *  - tool-call/tool-result pairing (never a leading orphan `tool` message).
 *
 * Returns a NEW array; never mutates the input. Returns a copy unchanged when
 * already within budget.
 */
export function pruneMessages(
  messages: ChatMessage[],
  options: PruneOptions = {},
): ChatMessage[] {
  const opts = { ...DEFAULTS, ...options };
  if (messages.length === 0) return [];

  const overCount = opts.maxMessages > 0 && messages.length > opts.maxMessages;
  const overChars = opts.maxChars > 0 && estimateChars(messages) > opts.maxChars;
  if (!overCount && !overChars) return [...messages];

  // 1. Head: leading system messages.
  const head: ChatMessage[] = [];
  let i = 0;
  if (opts.preserveSystem) {
    while (i < messages.length && messages[i].role === "system") {
      head.push(messages[i]);
      i++;
    }
  }

  // 2. First user message (the task), if requested.
  let firstUser: ChatMessage | null = null;
  if (opts.preserveFirstUser) {
    for (let j = i; j < messages.length; j++) {
      if (messages[j].role === "user") {
        firstUser = messages[j];
        break;
      }
    }
  }

  // 3. Tail: the most recent messages, dropping leading orphan tool results.
  const rest = messages.slice(i);
  const keepRecent = Math.min(opts.preserveRecent, rest.length);
  let tail = dropLeadingOrphanTools(rest.slice(rest.length - keepRecent));

  // Compose: head + (firstUser if not already kept) + notice + tail.
  const result: ChatMessage[] = [...head];
  const tailSet = new Set(tail);
  if (firstUser && !tailSet.has(firstUser) && !head.includes(firstUser)) {
    result.push(firstUser);
  }

  if (opts.insertNotice) {
    const droppedCount = messages.length - result.length - tail.length;
    if (droppedCount > 0) {
      result.push({
        role: "system",
        content:
          `[context-window] ${droppedCount} earlier message(s) were truncated ` +
          "to stay within the context budget. Rely on the plan and files for full history.",
      });
    }
  }

  result.push(...tail);
  return result;
}
