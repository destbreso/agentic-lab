// ============================================
// Anthropic Provider — Claude models
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ChatMessage,
  ToolDefinition,
} from '../types/llm.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    // Extract system message
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const nonSystemMessages = options.messages.filter((m) => m.role !== 'system');

    const messages = this.convertMessages(nonSystemMessages);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const requestOpts: Anthropic.RequestOptions = {};
    if (options.signal) requestOpts.signal = options.signal;

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
        system: systemMessage?.content,
        messages,
        tools,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
      },
      requestOpts,
    );

    // Extract text and tool calls from content blocks
    let text = '';
    const toolCalls: ChatCompletionResult['message']['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      message: {
        role: 'assistant',
        content: text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      model: response.model,
      raw: response,
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const nonSystemMessages = options.messages.filter((m) => m.role !== 'system');
    const messages = this.convertMessages(nonSystemMessages);

    const streamOpts: Anthropic.RequestOptions = {};
    if (options.signal) streamOpts.signal = options.signal;

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
        system: systemMessage?.content,
        messages,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
      },
      streamOpts,
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if ('text' in delta) {
          yield { type: 'text', text: delta.text };
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: 'done',
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      },
    };
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a list models endpoint yet
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-3-5-20241022',
    ];
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check — count tokens on a tiny message
      const result = await this.client.messages.countTokens({
        model: this.model,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return result.input_tokens > 0;
    } catch {
      return false;
    }
  }

  private convertMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: m.toolCallId || '',
              content: m.content,
            },
          ],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        return { role: 'assistant' as const, content };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters.properties,
        required: t.parameters.required,
      },
    }));
  }
}
