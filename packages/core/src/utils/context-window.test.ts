// ============================================
// Context Window Management — Unit Tests
// ============================================

import { describe, it, expect } from "vitest";
import { pruneMessages, estimateChars } from "./context-window.js";
import type { ChatMessage } from "../types/llm.js";

const sys: ChatMessage = { role: "system", content: "SYSTEM" };
const task: ChatMessage = { role: "user", content: "THE TASK" };

/** Build a conversation: system, user, then N tool rounds. */
function convo(rounds: number): ChatMessage[] {
  const msgs: ChatMessage[] = [sys, task];
  for (let r = 0; r < rounds; r++) {
    msgs.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id: `tc${r}`, name: "file_read", arguments: { path: "x" } }],
    });
    msgs.push({ role: "tool", content: `result ${r}`, toolCallId: `tc${r}` });
  }
  return msgs;
}

describe("pruneMessages", () => {
  it("returns a copy unchanged when within budget", () => {
    const input = convo(2);
    const out = pruneMessages(input, { maxMessages: 100, maxChars: 0 });
    expect(out).toEqual(input);
    expect(out).not.toBe(input); // new array
  });

  it("never mutates the input array", () => {
    const input = convo(30);
    const before = input.length;
    pruneMessages(input, { maxMessages: 10 });
    expect(input.length).toBe(before);
  });

  it("caps the number of messages when over maxMessages", () => {
    const input = convo(30); // 2 + 60 = 62 messages
    const out = pruneMessages(input, {
      maxMessages: 12,
      maxChars: 0,
      preserveRecent: 6,
    });
    expect(out.length).toBeLessThan(input.length);
  });

  it("preserves the system message and the first user task", () => {
    const out = pruneMessages(convo(30), { maxMessages: 10 });
    expect(out[0]).toEqual(sys);
    expect(out.some((m) => m.role === "user" && m.content === "THE TASK")).toBe(
      true,
    );
  });

  it("keeps the most recent messages", () => {
    const input = convo(30);
    const last = input[input.length - 1];
    const out = pruneMessages(input, { maxMessages: 10 });
    expect(out[out.length - 1]).toEqual(last);
  });

  it("never leaves an orphan leading tool message in the tail", () => {
    const input = convo(30);
    const out = pruneMessages(input, { maxMessages: 9, preserveRecent: 5 });
    // After head (system) + task + notice, the first tail message must not be
    // an orphan `tool` whose assistant tool_call was dropped.
    // Find the first message after the truncation notice.
    const noticeIdx = out.findIndex((m) =>
      (m.content || "").startsWith("[context-window]"),
    );
    const tailStart = noticeIdx >= 0 ? noticeIdx + 1 : 0;
    if (out[tailStart]) {
      expect(out[tailStart].role).not.toBe("tool");
    }
    // And every tool message must have a preceding assistant tool_call id.
    const seen = new Set<string>();
    for (const m of out) {
      if (m.role === "assistant" && m.toolCalls) {
        for (const tc of m.toolCalls) seen.add(tc.id);
      }
      if (m.role === "tool" && m.toolCallId) {
        expect(seen.has(m.toolCallId)).toBe(true);
      }
    }
  });

  it("inserts a truncation notice when messages are dropped", () => {
    const out = pruneMessages(convo(30), { maxMessages: 10 });
    expect(out.some((m) => (m.content || "").includes("[context-window]"))).toBe(
      true,
    );
  });

  it("prunes when over the character budget even if message count is small", () => {
    const big: ChatMessage[] = [
      sys,
      task,
      { role: "assistant", content: "x".repeat(50_000) },
      { role: "user", content: "recent" },
    ];
    const out = pruneMessages(big, {
      maxMessages: 0,
      maxChars: 10_000,
      preserveRecent: 1,
    });
    expect(estimateChars(out)).toBeLessThan(estimateChars(big));
    expect(out[out.length - 1].content).toBe("recent");
  });

  it("handles an empty array", () => {
    expect(pruneMessages([])).toEqual([]);
  });
});
