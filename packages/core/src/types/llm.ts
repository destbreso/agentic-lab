// ============================================
// LLM Provider Types
// ============================================

/** Role of a message in the conversation */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** A single message in the conversation */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  /**
   * An assistant message's content as the provider returned it, sent back
   * verbatim on the next call of the turn: server tools (Anthropic's advisor)
   * need their blocks returned unchanged.
   */
  providerContent?: unknown[];
}

/** One result of a tool the provider ran on its side (Anthropic's advisor_20260301). */
export interface ServerToolResult {
  tool: string;
  /** The provider's id for the call. */
  id: string;
  /** text: readable advice; sealed: encrypted, unreadable by the lab; error: the call failed. */
  kind: "text" | "sealed" | "error";
  text?: string;
  errorCode?: string;
  stopReason?: string;
  /** The model that answered, and its tokens, when the provider reports them. */
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** Tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Definition of a tool the LLM can use */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter;
}

/** JSON Schema–style parameter definition */
export interface ToolParameter {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
      default?: unknown;
    }
  >;
  required?: string[];
}

/** Result from executing a tool */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

/** Options for a chat completion request */
export interface ChatCompletionOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  stream?: boolean;
  /** Optional AbortSignal to cancel an in-flight request */
  signal?: AbortSignal;
  /** Per-call timeout (ms) for non-streaming calls. Defaults to the provider's. */
  timeoutMs?: number;
  /** Tools the provider runs itself, in its own shape (Anthropic only). */
  serverTools?: Array<Record<string, unknown>>;
  /** Beta features to ask the provider for (Anthropic's anthropic-beta header). */
  betas?: string[];
  /**
   * Called with each piece of the answer's text as the model writes it. A
   * provider that can stream does, and still returns the whole result; one
   * that cannot ignores it, and the text arrives with the result.
   */
  onText?: (delta: string) => void;
}

/** Result from a chat completion request */
export interface ChatCompletionResult {
  message: ChatMessage;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: "stop" | "tool_calls" | "length" | "error";
  model: string;
  raw?: unknown;
  /** Results of tools the provider ran itself during the call. Their tokens are not in `usage`. */
  serverToolResults?: ServerToolResult[];
}

/** Chunk from a streaming chat completion */
export interface StreamChunk {
  type: "text" | "tool_call" | "done" | "error";
  text?: string;
  toolCall?: ToolCall;
  error?: string;
  usage?: ChatCompletionResult["usage"];
}

/** Configuration for an LLM provider */
export interface LLMProviderConfig {
  /** Optional display name for the provider (used by OpenAI-compatible providers) */
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Per-call timeout (ms) for non-streaming calls. */
  timeoutMs?: number;
  /**
   * The context window to ask for, in tokens, where the provider lets the
   * caller choose it (Ollama's num_ctx). Other providers ignore it.
   */
  contextWindow?: number;
  /** Extra provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * Abstract interface for LLM providers.
 * All providers (Ollama, OpenAI, Anthropic, etc.) must implement this.
 */
export interface LLMProvider {
  /** Unique identifier for the provider */
  readonly name: string;

  /** Send a chat completion request */
  chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;

  /** Stream a chat completion (optional — falls back to non-stream) */
  chatStream?(options: ChatCompletionOptions): AsyncGenerator<StreamChunk>;

  /** List available models from this provider */
  listModels(): Promise<string[]>;

  /** Check if the provider is reachable */
  healthCheck(): Promise<boolean>;
}
