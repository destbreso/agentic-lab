// ============================================
// Ollama Provider: Local LLM via Ollama
// ============================================

import { Ollama } from 'ollama';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ChatMessage,
  ToolCall,
  ToolDefinition,
} from '../types/llm.js';
import { TOOL_CALL_OPEN, asTextConversation, heldBack, toolCallsInText } from './text-tools.js';
import { withRetry } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  callSignal,
  fetchWithSignal,
  rethrowCallError,
} from './call-limits.js';

/**
 * For a model that calls tools in another format (Ollama parses those), an empty reply after this many generated
 * tokens, with tools offered, is a tool call Ollama could not parse: it drops a call whose JSON arguments are
 * invalid (code with unescaped quotes) and returns nothing.
 */
export const LOST_CALL_MIN_TOKENS = 8;

/** What a model whose <tool_call> could not be read is told, once. */
export const UNREADABLE_CALL_NUDGE =
  'Your last <tool_call> could not be read as JSON. Write that call again: one <tool_call> block holding {"name": ..., "arguments": {...}} as valid JSON, with every double quote inside a string written as \\" and every newline as \\n.';

/**
 * The context window asked of Ollama when nothing else says. Ollama's own
 * default is a few thousand tokens and it cuts a longer prompt silently, so a
 * long tool loop loses its start. 16,384 holds what pruneMessages keeps (about
 * 48,000 characters, some 12,000 tokens) plus the default output limit.
 */
export const DEFAULT_OLLAMA_NUM_CTX = 16_384;

/** The num_ctx to ask for, and where it came from: the provider's config, OLLAMA_NUM_CTX, or the default. */
export function resolveNumCtx(
  config: Pick<LLMProviderConfig, 'contextWindow'>,
  env: NodeJS.ProcessEnv = process.env,
): { numCtx: number; source: 'config' | 'env' | 'default' } {
  if (config.contextWindow && config.contextWindow > 0) return { numCtx: config.contextWindow, source: 'config' };
  const fromEnv = Number.parseInt(env.OLLAMA_NUM_CTX ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return { numCtx: fromEnv, source: 'env' };
  return { numCtx: DEFAULT_OLLAMA_NUM_CTX, source: 'default' };
}

const announced = new Set<string>();

/**
 * Whether each model (by host and name) writes its tool calls as <tool_call> blocks, read once from its chat
 * template. Those models are given the tools and the conversation as text and their calls are read here, never
 * by Ollama's parser, which drops a call whose JSON it cannot read (code with an unescaped """) and keeps only
 * the text before it, and whose template leaves an assistant message's calls out of the history when the
 * message has text, so the model reads its own earlier turns as plans that did nothing.
 */
const textToolModels = new Map<string, boolean>();

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  /** The context window this provider asks Ollama for on every call (num_ctx). */
  readonly contextWindow: number;
  /** Where that number came from. */
  readonly contextWindowSource: 'config' | 'env' | 'default';
  private client: Ollama;
  private host: string;
  private model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.host = config.baseUrl || 'http://localhost:11434';
    this.client = new Ollama({ host: this.host });
    const { numCtx, source } = resolveNumCtx(config);
    this.contextWindow = numCtx;
    this.contextWindowSource = source;
    // Say what it chose, once per model and window, on stderr.
    const key = `${this.model}:${numCtx}`;
    if (!announced.has(key)) {
      announced.add(key);
      createLogger({ level: 'info', prefix: 'ollama' }).info(
        `${this.model}: num_ctx ${numCtx} (${source === 'default' ? 'the default; set OLLAMA_NUM_CTX or contextWindow to change it' : `from ${source === 'env' ? 'OLLAMA_NUM_CTX' : 'the provider config'}`})`,
      );
    }
  }

  /** The ollama client passes no signal on non-streaming calls, so each call gets a client bound to its own. */
  private clientFor(signal: AbortSignal): Ollama {
    return new Ollama({ host: this.host, fetch: fetchWithSignal(signal) });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const messages = this.convertMessages(options.messages);
    const call = callSignal(
      options.signal,
      options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    );
    if (call.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const client = this.clientFor(call.signal);

    const tools = options.tools?.length ? options.tools : undefined;
    let asText = false;
    try {
      asText = tools ? await this.writesToolCallsAsText(client) : false;
    } catch (err) {
      rethrowCallError(err, call, this.name);
    }
    const request = {
      model: this.model,
      messages: asText ? asTextConversation(options.messages, tools!) : messages,
      options: {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        num_predict: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
        num_ctx: this.contextWindow,
      },
      tools: tools && !asText ? this.convertTools(tools) : undefined,
    };
    let response;
    try {
      response = options.onText
        ? await withRetry(() => this.streamed(client, request, options.onText!, call.signal, asText), { signal: call.signal })
        : await withRetry(() => client.chat({ ...request, stream: false }), { signal: call.signal });
    } catch (err) {
      rethrowCallError(err, call, this.name);
    }

    const idOf = (i: number) => `ollama-tc-${Date.now()}-${i}`;
    let toolCalls: ToolCall[] | undefined = response.message.tool_calls?.map((tc, i) => ({
      id: idOf(i),
      name: tc.function.name,
      arguments: tc.function.arguments as Record<string, unknown>,
    }));
    let content = response.message.content || '';
    let inputTokens = response.prompt_eval_count ?? 0;
    let outputTokens = response.eval_count ?? 0;
    let length = (response as { done_reason?: string }).done_reason === 'length';
    let note: string | undefined;

    if (tools && !toolCalls?.length) {
      const inText = toolCallsInText(content, tools);
      if (inText.calls.length) {
        toolCalls = inText.calls.map((c, i) => ({ id: idOf(i), ...c }));
        content = inText.rest;
        if (!asText) note = 'the tool call came back as text in the reply, and was read from it';
      } else if (asText && inText.unreadable) {
        // A call no repair could read is asked for once more, saying what went wrong, instead of ending the turn on it.
        try {
          const again = await withRetry(
            () => client.chat({ ...request, messages: [...request.messages, { role: 'assistant', content }, { role: 'user', content: UNREADABLE_CALL_NUDGE }], stream: false }),
            { signal: call.signal },
          );
          inputTokens += again.prompt_eval_count ?? 0;
          outputTokens += again.eval_count ?? 0;
          const second = toolCallsInText(again.message.content || '', tools);
          if (second.calls.length) {
            toolCalls = second.calls.map((c, i) => ({ id: idOf(i), ...c }));
            content = second.rest;
            note = 'a tool call in the reply could not be read; asked once more, the call was read';
          } else {
            note = 'a tool call in the reply could not be read, nor when asked once more, so the turn ended on it';
          }
        } catch (err) {
          if (call.signal.aborted) rethrowCallError(err, call, this.name);
          note = `a tool call in the reply could not be read; asking once more failed: ${(err as Error).message}`;
        }
      } else if (!asText && !content.trim() && outputTokens >= LOST_CALL_MIN_TOKENS) {
        // The call Ollama could not parse is asked for again as text, and read here.
        const lost = outputTokens;
        try {
          const again = await withRetry(
            () => client.chat({ model: this.model, messages: asTextConversation(options.messages, options.tools!), options: request.options, stream: false }),
            { signal: call.signal },
          );
          inputTokens += again.prompt_eval_count ?? 0;
          outputTokens += again.eval_count ?? 0;
          const recovered = toolCallsInText(again.message.content || '', tools);
          if (recovered.calls.length) {
            toolCalls = recovered.calls.map((c, i) => ({ id: idOf(i), ...c }));
            content = recovered.rest;
            note = `Ollama returned an empty reply after ${lost} tokens, a tool call it could not parse; asked again as text, the call was read from the reply`;
          } else {
            content = again.message.content || '';
            length = (again as { done_reason?: string }).done_reason === 'length';
            note = `Ollama returned an empty reply after ${lost} tokens; asked again as text, the reply held no tool call`;
          }
        } catch (err) {
          if (call.signal.aborted) rethrowCallError(err, call, this.name);
          note = `Ollama returned an empty reply after ${lost} tokens; asking again as text failed: ${(err as Error).message}`;
        }
      }
    }

    return {
      message: {
        role: 'assistant',
        content,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      finishReason: toolCalls?.length ? 'tool_calls' : length ? 'length' : 'stop',
      model: response.model,
      ...(note ? { note } : {}),
    };
  }

  /** Whether this model's chat template writes tool calls as <tool_call> blocks (see textToolModels). */
  private async writesToolCallsAsText(client: Ollama): Promise<boolean> {
    const key = `${this.host} ${this.model}`;
    const known = textToolModels.get(key);
    if (known !== undefined) return known;
    let asText: boolean;
    try {
      const shown = await client.show({ model: this.model });
      asText = (shown.template ?? '').includes(TOOL_CALL_OPEN);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      // A server that cannot show the model keeps Ollama's own tool calling; not remembered, so it is asked again.
      return false;
    }
    textToolModels.set(key, asText);
    return asText;
  }

  /**
   * One call streamed, the text handed to onText as it comes, folded back into
   * the shape a non-streaming call returns: the content, every tool call, and
   * the counts from the last chunk. A retry after text was handed on would
   * repeat it, so only a call that failed before its first chunk is retried.
   * With tool calls written as text, nothing from the first <tool_call> on is
   * handed on: it is a call, not part of the answer.
   */
  private async streamed(
    client: Ollama,
    request: Parameters<Ollama['chat']>[0],
    onText: (delta: string) => void,
    signal: AbortSignal,
    holdCalls = false,
  ): Promise<Awaited<ReturnType<Ollama['chat']>>> {
    const stream = await client.chat({ ...request, stream: true });
    let shown = 0;
    let content = '';
    const toolCalls: NonNullable<Awaited<ReturnType<Ollama['chat']>>['message']['tool_calls']> = [];
    let last: Record<string, unknown> = {};
    let started = false;
    try {
      for await (const chunk of stream) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        started = true;
        const text = chunk.message?.content ?? '';
        if (text) {
          content += text;
          const safe = holdCalls ? heldBack(content, TOOL_CALL_OPEN) : content.length;
          if (safe > shown) {
            onText(content.slice(shown, safe));
            shown = safe;
          }
        }
        if (chunk.message?.tool_calls?.length) toolCalls.push(...chunk.message.tool_calls);
        if (chunk.done) last = chunk as unknown as Record<string, unknown>;
      }
    } catch (err) {
      if (started) Object.assign(err as object, { noRetry: true });
      throw err;
    }
    // What was held back as a possible start of a call and was not one.
    if (holdCalls && !content.includes(TOOL_CALL_OPEN) && shown < content.length) onText(content.slice(shown));
    return {
      ...(last as object),
      model: String(last.model ?? this.model),
      message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    } as Awaited<ReturnType<Ollama['chat']>>;
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const messages = this.convertMessages(options.messages);
    const client = options.signal ? this.clientFor(options.signal) : this.client;

    const stream = await client.chat({
      model: this.model,
      messages,
      options: {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        num_predict: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
        num_ctx: this.contextWindow,
      },
      stream: true,
    });

    for await (const chunk of stream) {
      // Check abort between chunks for responsive cancellation
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (chunk.message?.content) {
        yield { type: 'text', text: chunk.message.content };
      }

      if (chunk.done) {
        yield {
          type: 'done',
          usage: {
            inputTokens: chunk.prompt_eval_count ?? 0,
            outputTokens: chunk.eval_count ?? 0,
            totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
          },
        };
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.list();
    return response.models.map((m) => m.name);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  // Assistant tool calls are sent back with the conversation: without them the
  // model sees tool results it never asked for and tends to call the tool again.
  private convertMessages(messages: ChatMessage[]) {
    return messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.role === 'assistant' && m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
        : {}),
    }));
  }

  private convertTools(tools: ToolDefinition[]) {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as Record<string, unknown>,
      },
    }));
  }
}
