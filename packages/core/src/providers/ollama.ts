// ============================================
// Ollama Provider — Local LLM via Ollama
// ============================================

import { Ollama } from 'ollama';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ChatMessage,
  ToolDefinition,
} from '../types/llm.js';
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

    let response;
    try {
      response = await withRetry(
        () =>
          client.chat({
            model: this.model,
            messages,
            options: {
              temperature: options.temperature ?? this.config.temperature ?? 0.7,
              num_predict: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
              num_ctx: this.contextWindow,
            },
            tools: options.tools?.length ? this.convertTools(options.tools) : undefined,
            stream: false,
          }),
        { signal: call.signal },
      );
    } catch (err) {
      rethrowCallError(err, call, this.name);
    }

    const toolCalls = response.message.tool_calls?.map((tc, i) => ({
      id: `ollama-tc-${Date.now()}-${i}`,
      name: tc.function.name,
      arguments: tc.function.arguments as Record<string, unknown>,
    }));

    return {
      message: {
        role: 'assistant',
        content: response.message.content || '',
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
        totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
      },
      finishReason: toolCalls?.length
        ? 'tool_calls'
        : (response as { done_reason?: string }).done_reason === 'length'
          ? 'length'
          : 'stop',
      model: response.model,
    };
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
