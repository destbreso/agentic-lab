// ============================================
// OpenAI Provider — GPT models + compatible APIs
// ============================================

import OpenAI from 'openai';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ChatMessage,
  ToolDefinition,
} from '../types/llm.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.openai.com/v1',
    });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const messages = this.convertMessages(options.messages);
    const tools = options.tools ? this.convertTools(options.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream: false,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      message: {
        role: 'assistant',
        content: choice.message.content || '',
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
      model: response.model,
      raw: response,
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const messages = this.convertMessages(options.messages);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text', text: delta.content };
      }
    }
    yield { type: 'done' };
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

  private convertMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId || '',
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
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
