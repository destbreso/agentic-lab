// A Models for session tests: one scripted provider for every reference, which
// answers by role, streams Do's answer a word at a time, and can make Do run
// a shell command or write a file on its first call. No network, no tokens.

import { playRoleOf, type ChatCompletionResult, type LLMProvider } from "jig-core";
import type { Models } from "../session/models.js";

export interface ScriptOptions {
  /** Do's answer. */
  answer?: string;
  /** A shell command Do runs on its first call of each turn. */
  shell?: string;
  /** A question Do puts to jig_help on its first call of each turn. */
  help?: string;
  /** Records the tools each role is offered, by role. */
  offered?: Record<string, string[]>;
  /** A file Do reads on its first call of each turn. */
  read?: string;
  /** A file Do writes on its first call of each turn. */
  write?: { path: string; content: string };
  /** Do answers with what its last tool call returned (to see a denial's words reach it). */
  answerFromTool?: boolean;
  /** Milliseconds each model call takes. */
  delayMs?: number;
}

export function scriptedModels(options: ScriptOptions = {}): Models & { refs: string[] } {
  const refs: string[] = [];
  const provider = (ref: string): LLMProvider => ({
    name: "scripted",
    async chat(o): Promise<ChatCompletionResult> {
      const system = o.messages.find((m) => m.role === "system")?.content ?? "";
      const role = playRoleOf(system);
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
      const toolsSoFar = o.messages.filter((m) => m.role === "tool").length;
      if (role === "do" && options.shell && toolsSoFar === 0) {
        return { message: { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "shell", arguments: { command: options.shell } }] }, usage, finishReason: "tool_calls", model: ref };
      }
      if (options.offered) options.offered[role] = (o.tools ?? []).map((t) => t.name);
      if (role === "do" && options.help && toolsSoFar === 0) {
        return { message: { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "jig_help", arguments: { query: options.help } }] }, usage, finishReason: "tool_calls", model: ref };
      }
      if (role === "do" && options.read && toolsSoFar === 0) {
        return { message: { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "file_read", arguments: { path: options.read } }] }, usage, finishReason: "tool_calls", model: ref };
      }
      if (role === "do" && options.write && toolsSoFar === 0) {
        return { message: { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "file_write", arguments: { ...options.write } }] }, usage, finishReason: "tool_calls", model: ref };
      }
      const lastTool = o.messages.filter((m) => m.role === "tool").at(-1)?.content;
      const content =
        role === "do"
          ? options.answerFromTool && lastTool
            ? `Heard: ${lastTool}`
            : (options.answer ?? "Done: the file says hi.")
          : role === "check"
            ? '{"verdict":"pass","evidence":["looked"],"corrections":[],"confidence":0.9}'
            : role === "decide"
              ? '{"decision":"converge","reason":"good","corrections":[]}'
              : role === "critique"
                ? '{"status":"ok","issues":[],"intervention":"none","reasoning":"fine"}'
                : "STRATEGY: continue\nREASONING: start\nNEXT_TASK: do the task";
      if (o.onText) for (const w of content.match(/\S+\s*/g) ?? []) o.onText(w);
      return { message: { role: "assistant", content }, usage, finishReason: "stop", model: ref };
    },
    listModels: async () => ["scripted-a", "scripted-b"],
    healthCheck: async () => true,
  });
  return {
    refs,
    defaultRef: "scripted/scripted-a",
    entries: () => ["scripted"],
    provider(ref) {
      if (!ref.startsWith("scripted/")) throw new Error(`no provider named ${ref.split("/")[0]} is configured (configured: scripted)`);
      refs.push(ref);
      return provider(ref);
    },
    list: async () => [{ entry: "scripted", models: ["scripted-a", "scripted-b"] }],
  };
}
