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

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private client: Ollama;
  private model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.client = new Ollama({
      host: config.baseUrl || 'http://localhost:11434',
    });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const messages = this.convertMessages(options.messages);

    const abortFn = options.signal
      ? () => { if (options.signal!.aborted) throw new DOMException('Aborted', 'AbortError'); }
      : undefined;
    if (abortFn) abortFn();

    const response = await withRetry(
      () =>
        this.client.chat({
          model: this.model,
          messages,
          options: {
            temperature: options.temperature ?? this.config.temperature ?? 0.7,
            num_predict: options.maxTokens ?? this.config.maxTokens,
          },
          tools: options.tools ? this.convertTools(options.tools) : undefined,
          stream: false,
        }),
      { signal: options.signal },
    );

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
      finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
      model: response.model,
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const messages = this.convertMessages(options.messages);

    const stream = await this.client.chat({
      model: this.model,
      messages,
      options: {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        num_predict: options.maxTokens ?? this.config.maxTokens,
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

  private convertMessages(messages: ChatMessage[]) {
    return messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
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
