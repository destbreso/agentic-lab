// ============================================
// Step records: what each role saw and did, one record per turn
// ============================================
// A step is one role's turn in a round: the inputs it was given, each with
// its provenance, the exact messages sent to its model and what came back,
// what it emitted, its tokens and its time. A run's steps are enough to
// replay it: the same replies give the same prompts, byte for byte.

import type { ChatMessage, ToolCall } from "./llm.js";
import type { LoopCategory, Provenance } from "./pipeline.js";

/** One model call, exactly as sent and as answered. */
export interface RecordedCall {
  /** 1-based order of the call within its step. */
  seq: number;
  /** The provider's name ("ollama", "openai"...). */
  provider: string;
  /** The messages sent, system prompt included, as they left the lab. */
  messages: ChatMessage[];
  /** Names of the tools offered to the model on this call. */
  tools: string[];
  options: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /** The context window the provider asked for, when it sets one (Ollama's num_ctx). */
    contextWindow?: number;
  };
  /** What the model answered; absent when the call failed. */
  reply?: {
    content: string;
    toolCalls?: ToolCall[];
    finishReason: string;
    model: string;
    /** What a tool the provider ran itself returned; sealed advice stays sealed. */
    serverToolResults?: import("./llm.js").ServerToolResult[];
  };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Which model of the role's chain answered, the chain, and every fallback so far. */
  route?: import("../providers/brains.js").Route;
  error?: string;
  startedAt: string;
  durationMs: number;
}

/** A field of a signal a role received or emitted, with where its value came from. */
export interface RecordedField {
  provenance: Provenance;
  value: unknown;
}

/** One thing a role was given for its turn. */
export interface StepInput {
  /**
   * signal: from a wire (or the operator's note); run: the task or another
   * run input; memory: memories recalled during the turn; check: a measured
   * check the lab ran for the role.
   */
  source: "signal" | "run" | "memory" | "check";
  /** The signal type, the run input's name, "recall", or the check's label. */
  name: string;
  /** The role or origin it came from ("operator", "lab", "you"). */
  from: string;
  /** The weakest kind among its fields: anything a model touched is written. */
  provenance: Provenance;
  /** A signal's fields, each with its kind. */
  fields?: Record<string, RecordedField>;
  /** The value of a run input, a recall or a check. */
  value?: unknown;
}

/** One emitted signal, with the kind of each field. */
export interface StepOutput {
  type: string;
  fields: Record<string, RecordedField>;
}

export interface StepRecord {
  /** The run this step belongs to (the session's run id). */
  runId: string;
  /** The role did not call its model, and why: the lab's decision, measured. */
  skipped?: { reason: string; provenance: "measured" };
  /** 1-based order of the step within the run. */
  seq: number;
  /** The round it ran in (null outside the round schedule). */
  round: number | null;
  /** The role's node id, its name and its category. */
  role: string;
  roleName: string;
  category: LoopCategory;
  inputs: StepInput[];
  calls: RecordedCall[];
  outputs: StepOutput[];
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; result?: string; durationMs?: number }>;
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  success: boolean;
  errors: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
}
