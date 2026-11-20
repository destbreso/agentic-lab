// ============================================
// OpenAI Provider: GPT models + compatible APIs
// ============================================

import OpenAI from "openai";
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ChatMessage,
  ToolDefinition,
} from "../types/llm.js";
import { withRetry } from "../utils/retry.js";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  callSignal,
  rethrowCallError,
} from "./call-limits.js";
import { learnRefused, refusedNote, refusedParam, refusedParams, type RefusableParam } from "./refused-params.js";

/** A tool call's own fields; anything else the server sent with it is echoed back to that server. */
const CALL_FIELDS = new Set(["id", "type", "function", "index"]);

function extraFields(tc: object): Record<string, unknown> | undefined {
  const extra = Object.fromEntries(Object.entries(tc).filter(([k, v]) => !CALL_FIELDS.has(k) && v !== undefined && v !== null));
  return Object.keys(extra).length ? extra : undefined;
}

/**
 * Gemini's OpenAI endpoint answers an error as a one-element JSON array, which
 * the SDK reads as "no body" and loses the message ("Please pass a valid API
 * key"): the array is unwrapped so the error says what the server said.
 */
const readableErrors = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const res = await globalThis.fetch(url, init);
  if (res.ok) return res;
  const text = await res.text();
  let body = text;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "object") body = JSON.stringify(parsed[0]);
  } catch {
    /* not JSON: passed on as it came */
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
};

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    // Infer provider name from baseUrl when used for OpenRouter/Google/etc.
    this.name = config.name || this.inferProviderName(config.baseUrl);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || "https://api.openai.com/v1",
      // Only Google's endpoint answers errors as arrays; every other server keeps the SDK's own transport.
      ...(this.name === "google" ? { fetch: readableErrors as unknown as NonNullable<ConstructorParameters<typeof OpenAI>[0]>["fetch"] } : {}),
    });
  }

  /** The key a refused field is remembered under: this server and this model. */
  private get paramsKey(): string {
    return `${this.client.baseURL} ${this.model}`;
  }

  /** A request's sampling and limit fields, without the ones this model is known to refuse. */
  private tuning(options: ChatCompletionOptions): { temperature?: number; max_tokens?: number; max_completion_tokens?: number } {
    const refused = refusedParams(this.paramsKey);
    const limit = options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS;
    return {
      ...(refused.has("temperature") ? {} : { temperature: options.temperature ?? this.config.temperature ?? 0.7 }),
      ...(refused.has("max_tokens") ? { max_completion_tokens: limit } : { max_tokens: limit }),
    };
  }

  /**
   * Sends a request built from the current tuning; when the model refuses one
   * of its fields, learns it and sends it again without it (twice at most).
   */
  private async withTuning<T>(options: ChatCompletionOptions, send: (tuning: ReturnType<OpenAIProvider["tuning"]>) => Promise<T>): Promise<{ value: T; note?: string }> {
    const notes: string[] = [];
    for (let attempt = 0; ; attempt++) {
      const tuning = this.tuning(options);
      try {
        const value = await send(tuning);
        return { value, ...(notes.length ? { note: notes.join("; ") } : {}) };
      } catch (err) {
        const sent = (["temperature", "max_tokens"] as RefusableParam[]).filter((p) => p in tuning);
        const param = attempt < 2 ? refusedParam(err, sent) : null;
        if (!param) throw err;
        learnRefused(this.paramsKey, param);
        notes.push(refusedNote(param));
      }
    }
  }

  private inferProviderName(baseUrl?: string): string {
    if (!baseUrl) return "openai";
    if (baseUrl.includes("openrouter")) return "openrouter";
    if (
      baseUrl.includes("googleapis") ||
      baseUrl.includes("generativelanguage")
    )
      return "google";
    return "openai";
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const messages = this.convertMessages(options.messages);
    const tools = options.tools?.length ? this.convertTools(options.tools) : undefined;
    const call = callSignal(
      options.signal,
      options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    );

    let response;
    let note: string | undefined;
    try {
      ({ value: response, note } = await this.withTuning(options, (tuning) => {
        const params = { model: this.model, messages, tools, ...tuning };
        return withRetry(
          () =>
            options.onText
              ? this.streamed(params, call.signal, options.onText)
              : this.client.chat.completions.create({ ...params, stream: false }, { signal: call.signal }),
          { signal: call.signal },
        );
      }));
    } catch (err) {
      rethrowCallError(err, call, this.name);
    }

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments) as Record<
          string,
          unknown
        >;
      } catch {
        // LLM returned malformed JSON: pass the raw string as a fallback
        parsedArgs = { _raw: tc.function.arguments };
      }
      const fields = extraFields(tc);
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
        ...(fields ? { echo: { provider: this.name, fields } } : {}),
      };
    });

    return {
      message: {
        role: "assistant",
        content: choice.message.content || "",
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: toolCalls?.length
        ? "tool_calls"
        : choice.finish_reason === "length"
          ? "length"
          : "stop",
      model: response.model,
      raw: response,
      ...(note ? { note } : {}),
    };
  }

  /**
   * One completion streamed, the text handed on as it comes, folded back into
   * the shape a non-streaming completion has: the content, each tool call put
   * together from its pieces by index, and the usage when the server sends it.
   */
  private async streamed(
    params: Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, "stream">,
    signal: AbortSignal,
    onText: (delta: string) => void,
  ): Promise<OpenAI.ChatCompletion> {
    const stream = await this.client.chat.completions.create(
      { ...params, stream: true, stream_options: { include_usage: true } },
      { signal },
    );
    let content = "";
    let model = params.model;
    let finish: OpenAI.ChatCompletion.Choice["finish_reason"] = "stop";
    let usage: OpenAI.CompletionUsage | undefined;
    const calls: Array<{ id: string; name: string; args: string; extra?: Record<string, unknown> }> = [];
    let started = false;
    try {
      for await (const chunk of stream) {
        started = true;
        if (chunk.model) model = chunk.model;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const text = choice.delta?.content ?? "";
        if (text) {
          content += text;
          onText(text);
        }
        for (const tc of choice.delta?.tool_calls ?? []) {
          // Gemini sends each call whole with no index: a new id starts a new call, a piece without one continues the last.
          const last = calls.length - 1;
          const index = typeof tc.index === "number" ? tc.index : tc.id && (last < 0 || (calls[last].id && calls[last].id !== tc.id)) ? calls.length : Math.max(last, 0);
          const at = (calls[index] ??= { id: "", name: "", args: "" });
          if (tc.id) at.id = tc.id;
          if (tc.function?.name) at.name += tc.function.name;
          if (tc.function?.arguments) at.args += tc.function.arguments;
          const extra = extraFields(tc);
          if (extra) at.extra = { ...at.extra, ...extra };
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (err) {
      // A retry after text was handed on would hand it on twice.
      if (started && err && typeof err === "object") Object.assign(err, { noRetry: true });
      throw err;
    }
    // A server that ignores stream: true sends one JSON body the stream reader cannot see: ask again, plainly.
    if (!started) return this.client.chat.completions.create({ ...params, stream: false }, { signal });
    const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c.extra, id: c.id || `call-${i}`, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } }));
    return {
      id: "stream",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, finish_reason: finish, logprobs: null, message: { role: "assistant", content, refusal: null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } }],
      ...(usage ? { usage } : {}),
    } as OpenAI.ChatCompletion;
  }

  async *chatStream(
    options: ChatCompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const messages = this.convertMessages(options.messages);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const { value: stream } = await this.withTuning(options, (tuning) =>
      this.client.chat.completions.create(
        { model: this.model, messages, tools, ...tuning, stream: true },
        options.signal ? { signal: options.signal } : undefined,
      ),
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: "text", text: delta.content };
      }
    }
    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    const models: string[] = [];
    for await (const model of response) {
      models.push(model.id);
    }
    return models;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private convertMessages(
    messages: ChatMessage[],
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId || "",
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            ...(tc.echo?.provider === this.name ? tc.echo.fields : {}),
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as Record<string, unknown>,
      },
    }));
  }
}
