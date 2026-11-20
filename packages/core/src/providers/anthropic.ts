// ============================================
// Anthropic Provider: Claude models
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ChatMessage,
  ServerToolResult,
  ToolDefinition,
} from '../types/llm.js';
import { withRetry } from '../utils/retry.js';
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  callSignal,
  rethrowCallError,
} from './call-limits.js';
import { learnRefused, refusedNote, refusedParam, refusedParams } from './refused-params.js';

/** How many times one call follows a server tool's pause_turn before it gives up. */
const MAX_PAUSE_RESUMES = 5;

/** One advisor_tool_result block, whatever its payload: plain advice, sealed advice, or an error. */
function advisorResult(block: Record<string, any>): ServerToolResult {
  const c = (block.content ?? {}) as Record<string, any>;
  const base = { tool: 'advisor', id: String(block.tool_use_id ?? '') };
  const stop = typeof c.stop_reason === 'string' ? { stopReason: c.stop_reason } : {};
  if (c.type === 'advisor_result') return { ...base, kind: 'text', text: String(c.text ?? ''), ...stop };
  if (c.type === 'advisor_redacted_result') return { ...base, kind: 'sealed', ...stop };
  return { ...base, kind: 'error', errorCode: String(c.error_code ?? c.type ?? 'unknown') };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  /** The model this provider calls. */
  readonly model: string;
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  /** The key a refused field is remembered under: this server and this model. */
  private get paramsKey(): string {
    return `${this.client.baseURL} ${this.model}`;
  }

  /** The temperature, unless this model is known to refuse it. */
  private sampling(options: ChatCompletionOptions): { temperature?: number } {
    return refusedParams(this.paramsKey).has('temperature') ? {} : { temperature: options.temperature ?? this.config.temperature ?? 0.7 };
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    // Extract system message
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const nonSystemMessages = options.messages.filter((m) => m.role !== 'system');

    const messages = this.convertMessages(nonSystemMessages);
    const tools = [
      ...(options.tools?.length ? this.convertTools(options.tools) : []),
      // Server tools go as the provider defines them; the SDK this lab pins predates their types.
      ...((options.serverTools ?? []) as unknown as Anthropic.Tool[]),
    ];
    const call = callSignal(
      options.signal,
      options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    );
    const headers = options.betas?.length ? { 'anthropic-beta': options.betas.join(',') } : undefined;

    // A server tool can pause the turn (pause_turn): send the content back unchanged and go on.
    const content: Anthropic.ContentBlock[] = [];
    let response!: Anthropic.Message;
    let inputTokens = 0;
    let outputTokens = 0;
    const iterations: Array<Record<string, unknown>> = [];
    const notes: string[] = [];
    for (let resumes = 0; ; resumes++) {
      const turn: Anthropic.MessageParam[] = content.length ? [...messages, { role: 'assistant', content: content as unknown as Anthropic.ContentBlockParam[] }] : messages;
      try {
        for (let attempt = 0; ; attempt++) {
          const params: Anthropic.MessageCreateParamsNonStreaming = {
            model: this.model,
            max_tokens: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: systemMessage?.content,
            messages: turn,
            tools: tools.length ? tools : undefined,
            ...this.sampling(options),
          };
          const requestOptions = { signal: call.signal, ...(headers ? { headers } : {}) };
          // Streamed when the caller reads the text as it comes; a server tool's turn is never streamed.
          const streams = Boolean(options.onText) && !options.serverTools?.length;
          try {
            response = await withRetry(
              () => (streams ? this.streamed(params, requestOptions, options.onText!) : this.client.messages.create(params, requestOptions)),
              { signal: call.signal },
            );
            break;
          } catch (err) {
            // Claude's current models refuse temperature: learned from the 400, then left out.
            const param = attempt === 0 && 'temperature' in params ? refusedParam(err, ['temperature']) : null;
            if (!param) throw err;
            learnRefused(this.paramsKey, param);
            notes.push(refusedNote(param));
          }
        }
      } catch (err) {
        rethrowCallError(err, call, this.name);
      }
      content.push(...response.content);
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      iterations.push(...(((response.usage as unknown as { iterations?: Array<Record<string, unknown>> }).iterations) ?? []));
      if ((response.stop_reason as string) !== 'pause_turn' || resumes >= MAX_PAUSE_RESUMES) break;
    }

    // Extract text, tool calls and the server tools' results from the content blocks.
    let text = '';
    const toolCalls: ChatCompletionResult['message']['toolCalls'] = [];
    const serverResults: ServerToolResult[] = [];
    let serverBlocks = false;
    for (const block of content as unknown as Array<Record<string, any>>) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input as Record<string, unknown> });
      } else if (block.type === 'server_tool_use') {
        serverBlocks = true;
      } else if (block.type === 'advisor_tool_result') {
        serverBlocks = true;
        serverResults.push(advisorResult(block));
      } else if (typeof block.type === 'string' && block.type.endsWith('_tool_result')) {
        serverBlocks = true;
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        // A model that thinks needs its thinking blocks back unchanged beside its tool calls.
        serverBlocks = true;
      }
    }
    // The advisor's tokens are reported apart from the executor's, one iteration per consultation, in order.
    const advisorUsage = iterations.filter((it) => it.type === 'advisor_message');
    serverResults.forEach((r, i) => {
      const it = advisorUsage[i];
      if (!it) return;
      const input = Number(it.input_tokens ?? 0) + Number(it.cache_read_input_tokens ?? 0) + Number(it.cache_creation_input_tokens ?? 0);
      const output = Number(it.output_tokens ?? 0);
      r.usage = { inputTokens: input, outputTokens: output, totalTokens: input + output };
      if (typeof it.model === 'string') r.model = it.model;
    });

    return {
      message: {
        role: 'assistant',
        content: text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ...(serverBlocks ? { providerContent: structuredClone(content) as unknown[] } : {}),
      },
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason:
        response.stop_reason === 'tool_use'
          ? 'tool_calls'
          : response.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop',
      model: response.model,
      raw: response,
      ...(serverResults.length ? { serverToolResults: serverResults } : {}),
      ...(notes.length ? { note: notes.join('; ') } : {}),
    };
  }

  /** One message streamed, its text handed on as it comes; the final message is what a create call returns. */
  private async streamed(
    params: Anthropic.MessageCreateParamsNonStreaming,
    requestOptions: Anthropic.RequestOptions,
    onText: (delta: string) => void,
  ): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream(params, requestOptions);
    let started = false;
    stream.on('text', (delta) => {
      started = true;
      onText(delta);
    });
    try {
      return await stream.finalMessage();
    } catch (err) {
      // A retry after text was handed on would hand it on twice.
      if (started && err && typeof err === 'object') Object.assign(err, { noRetry: true });
      throw err;
    }
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const nonSystemMessages = options.messages.filter((m) => m.role !== 'system');
    const messages = this.convertMessages(nonSystemMessages);

    const streamOpts: Anthropic.RequestOptions = {};
    if (options.signal) streamOpts.signal = options.signal;

    for (let attempt = 0; ; attempt++) {
      const sampling = this.sampling(options);
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: systemMessage?.content,
          messages,
          ...sampling,
        },
        streamOpts,
      );
      let yielded = false;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if ('text' in delta) {
              yielded = true;
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
        return;
      } catch (err) {
        const param = !yielded && attempt === 0 && 'temperature' in sampling ? refusedParam(err, ['temperature']) : null;
        if (!param) throw err;
        learnRefused(this.paramsKey, param);
      }
    }
  }

  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of this.client.models.list()) models.push(model.id);
    return models;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check: count tokens on a tiny message
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
      // Content a server tool produced goes back exactly as the provider returned it.
      if (m.role === 'assistant' && m.providerContent?.length) {
        return { role: 'assistant' as const, content: m.providerContent as Anthropic.ContentBlockParam[] };
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
