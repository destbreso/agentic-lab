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
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  callSignal,
  fetchWithSignal,
  rethrowCallError,
} from './call-limits.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private client: Ollama;
  private host: string;
  private model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.host = config.baseUrl || 'http://localhost:11434';
    this.client = new Ollama({ host: this.host });
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
