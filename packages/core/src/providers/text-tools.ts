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
      // The tools go with the first system message only: a later one (pruning inserts a summary) would repeat them.
      out.push({ role: "system", content: hasSystem ? m.content : `${m.content}\n\n${toolProtocol(tools)}` });
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

/**
 * The <tool_call> blocks of a reply, and the text around them. A call to a tool that does not exist is read like
 * any other, so the role is told so. `unreadable` counts the blocks that hold JSON no repair could read.
 */
export function toolCallsInText(text: string, tools: readonly ToolDefinition[] = []): { calls: Array<Omit<ToolCall, "id">>; rest: string; unreadable: number } {
  const calls: Array<Omit<ToolCall, "id">> = [];
  let unreadable = 0;
  const take = (body: string): boolean => {
    const call = readCall(body, tools);
    if (call) calls.push(call);
    else if (body.trim().startsWith("{")) unreadable++;
    return Boolean(call);
  };
  // A block never spans another opening tag: a <tool_call> mentioned before the real one does not swallow it.
  let rest = text.replace(/<tool_call>((?:(?!<tool_call>)[\s\S])*?)<\/tool_call>/g, (block, body: string) => (take(body) ? "" : block));
  // A reply that ends inside its last call, the closing tag never written.
  const open = rest.lastIndexOf(TOOL_CALL_OPEN);
  if (open >= 0 && !rest.slice(open).includes("</tool_call>") && take(rest.slice(open + TOOL_CALL_OPEN.length))) rest = rest.slice(0, open);
  return { calls, rest: rest.trim(), unreadable };
}

function readCall(body: string, tools: readonly ToolDefinition[]): Omit<ToolCall, "id"> | null {
  const parsed = (parseLenientJson(body) ?? repairWithSchema(body, tools)) as { name?: unknown; arguments?: unknown; parameters?: unknown } | undefined;
  if (!parsed || typeof parsed !== "object" || typeof parsed.name !== "string") return null;
  // Llama's format names the arguments "parameters".
  const raw = parsed.arguments ?? parsed.parameters;
  const args = typeof raw === "string" ? parseLenientJson(raw) : raw;
  return { name: parsed.name, arguments: args && typeof args === "object" ? (args as Record<string, unknown>) : {} };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A call no JSON repair could read, read again with the tool's own parameter names: each value runs from its key
 * to the next key the tool has, so quotes left unescaped in code (", ".join(xs)) stay inside their value.
 */
function repairWithSchema(body: string, tools: readonly ToolDefinition[]): unknown {
  const head = /^\s*\{\s*"name"\s*:\s*"([^"\\]+)"\s*,\s*"(?:arguments|parameters)"\s*:\s*\{/.exec(body);
  if (!head) return undefined;
  const keys = Object.keys(tools.find((t) => t.name === head[1])?.parameters.properties ?? {});
  const tail = /\}\s*\}\s*$/.exec(body);
  if (!keys.length || !tail || tail.index < head[0].length) return undefined;
  const inner = body.slice(head[0].length, tail.index);
  const starts = keys
    .map((k) => ({ k, m: new RegExp(`(?:^|,)\\s*"${escapeRegExp(k)}"\\s*:\\s*`).exec(inner) }))
    .filter((s): s is { k: string; m: RegExpExecArray } => s.m !== null)
    .sort((a, b) => a.m.index - b.m.index);
  if (!starts.length || inner.slice(0, starts[0].m.index).trim()) return undefined;
  const args: Record<string, unknown> = {};
  for (const [i, s] of starts.entries()) {
    const end = i + 1 < starts.length ? starts[i + 1].m.index : inner.length;
    const value = readValue(inner.slice(s.m.index + s.m[0].length, end).trim());
    if (value === undefined) return undefined;
    args[s.k] = value;
  }
  return { name: head[1], arguments: args };
}

/** One value of a call: JSON, or a string whose own quotes and control characters were left unescaped. */
function readValue(raw: string): unknown {
  const json = parseLenientJson(raw);
  if (json !== undefined) return json;
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  const inner = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "\\") {
      const next = inner[i + 1];
      if (next !== undefined && `"\\/bfnrtu`.includes(next)) {
        out += c + next;
        i++;
      } else out += "\\\\";
    } else if (c === '"') out += '\\"';
    else if (c < " ") out += c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += c;
  }
  try {
    return JSON.parse(`"${out}"`);
  } catch {
    return undefined;
  }
}
