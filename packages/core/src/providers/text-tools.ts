// ============================================
// Tool calls written as text, read back leniently
// ============================================
// Open models such as Qwen and the Hermes family are trained to call tools by
// writing <tool_call>{"name": ..., "arguments": ...}</tool_call>. A server that
// parses those calls for us can lose one: Ollama drops a call whose JSON
// arguments are invalid (code with unescaped """, say) and returns only the
// text before it, so a role that had done the work looked as if it had only
// said what it would do (or, with no text before the call, said nothing).
// These helpers give a model the tools and the conversation in that format and
// read its calls themselves, repairing what a model commonly gets wrong in JSON.

import type { ChatMessage, ToolCall, ToolDefinition } from "../types/llm.js";

export const TOOL_CALL_OPEN = "<tool_call>";

/**
 * How much of a streamed reply can be shown while its tool calls are held back: everything before `open`, or,
 * while it has not come, everything but a tail that could be its start.
 */
export function heldBack(text: string, open: string): number {
  const at = text.indexOf(open);
  if (at >= 0) return at;
  for (let n = Math.min(open.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(open.slice(0, n))) return text.length - n;
  }
  return text.length;
}

/** The tool block those models are trained on, for the end of the system prompt. */
export function toolProtocol(tools: ToolDefinition[]): string {
  const sigs = tools.map((t) => JSON.stringify({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return [
    "# Tools",
    "",
    "You may call one or more functions to assist with the user query.",
    "",
    "You are provided with function signatures within <tools></tools> XML tags:",
    "<tools>",
    ...sigs,
    "</tools>",
    "",
    "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:",
    "<tool_call>",
    '{"name": <function-name>, "arguments": <args-json-object>}',
    "</tool_call>",
  ].join("\n");
}

/** The conversation with its tool calls and results as text, and the tools described in the system prompt. */
export function asTextConversation(messages: ChatMessage[], tools: ToolDefinition[]): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  let hasSystem = false;
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: `${m.content}\n\n${toolProtocol(tools)}` });
      hasSystem = true;
    } else if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).map((c) => `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.arguments })}\n</tool_call>`);
      out.push({ role: "assistant", content: [m.content ?? "", ...calls].filter((x) => x.trim()).join("\n") });
    } else if (m.role === "tool") {
      out.push({ role: "user", content: `<tool_response>\n${m.content}\n</tool_response>` });
    } else {
      out.push({ role: "user", content: m.content });
    }
  }
  if (!hasSystem) out.unshift({ role: "system", content: toolProtocol(tools) });
  return out;
}

const MAX_REPAIRS = 1000;

/**
 * JSON.parse, and when it fails, the two mistakes models make most, repaired one at a time: a quote inside a
 * string left unescaped (the parser took it as the string's end; the last such quote before the error is
 * escaped) and a raw control character inside a string (escaped). Undefined when the text is not JSON at all.
 */
export function parseLenientJson(text: string): unknown {
  let s = text.trim();
  for (let i = 0; i < MAX_REPAIRS; i++) {
    try {
      return JSON.parse(s);
    } catch (e) {
      const msg = (e as Error).message;
      const at = /position (\d+)/.exec(msg);
      if (!at) return undefined;
      const pos = Number(at[1]);
      if (/control character/i.test(msg)) {
        const ch = s[pos];
        const esc = ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
        s = s.slice(0, pos) + esc + s.slice(pos + 1);
        continue;
      }
      let q = pos - 1;
      while (q > 0 && !(s[q] === '"' && s[q - 1] !== "\\")) q--;
      if (q <= 0) return undefined;
      s = `${s.slice(0, q)}\\${s.slice(q)}`;
    }
  }
  return undefined;
}

/** The <tool_call> blocks of a reply that name a known tool, and the text around them. */
export function toolCallsInText(text: string, known: ReadonlySet<string>): { calls: Array<Omit<ToolCall, "id">>; rest: string } {
  const calls: Array<Omit<ToolCall, "id">> = [];
  const rest = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (block, body: string) => {
    const parsed = parseLenientJson(body) as { name?: unknown; arguments?: unknown } | undefined;
    if (!parsed || typeof parsed.name !== "string" || !known.has(parsed.name)) return block;
    const args = typeof parsed.arguments === "string" ? parseLenientJson(parsed.arguments) : parsed.arguments;
    calls.push({ name: parsed.name, arguments: args && typeof args === "object" ? (args as Record<string, unknown>) : {} });
    return "";
  });
  return { calls, rest: rest.trim() };
}
