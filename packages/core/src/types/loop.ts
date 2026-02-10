// ============================================
// Agentic Loop Types
// ============================================

import type { ChatMessage, ToolCall } from "./llm.js";

/** Overall status of the loop */
export type LoopStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

/** Status of a plan item */
export type PlanStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

/** A single item in the plan */
export interface PlanItem {
  id: string;
  title: string;
  status: PlanStatus;
  description?: string;
  phase?: string;
  priority?: number;
  notes?: string;
  completedAt?: string;
}

/** Configuration for an agentic loop */
export interface LoopConfig {
  /** Unique identifier for this loop run */
  id?: string;

  /** Human-readable name for the loop */
  name: string;

  /** LLM provider to use (e.g., 'ollama', 'openai', 'anthropic') */
  provider: string;

  /** Model to use with the provider */
  model: string;

  /** Maximum number of iterations (0 = unlimited) */
  maxIterations: number;

  /** Delay between iterations in milliseconds */
  delayMs: number;

  /** Path to the prompt file (PROMPT.md) */
  promptFile: string;

  /** Path to the specs directory */
  specsDir?: string;

  /** Path to the plan file (PLAN.md) */
  planFile?: string;

  /** Working directory for the agent */
  workingDir: string;

  /** Temperature for LLM calls */
  temperature?: number;

  /** Max tokens per LLM call */
  maxTokens?: number;

  /** Enable verbose/debug logging */
  verbose?: boolean;

  /** Path to log file (in addition to console) */
  logFile?: string;

  /** Tools to make available to the agent */
  enabledTools?: string[];

  /** Whether to auto-commit after each iteration */
  autoCommit?: boolean;

  /** Whether to auto-push after commits */
  autoPush?: boolean;

  /** Provider-specific configuration overrides */
  providerConfig?: Record<string, unknown>;
}

/** Data captured for a single iteration */
export interface LoopIteration {
  /** Iteration number (1-based) */
  number: number;

  /** When the iteration started */
  startedAt: string;

  /** When the iteration ended */
  endedAt?: string;

  /** Duration in milliseconds */
  durationMs?: number;

  /** The plan item worked on */
  planItem?: PlanItem;

  /** Tool calls made during this iteration */
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
    durationMs?: number;
  }>;

  /** Token usage for this iteration */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** LLM response text */
  responseText?: string;

  /** Errors encountered */
  errors: string[];

  /** Git commit SHA if auto-committed */
  commitSha?: string;

  /** Whether the iteration was successful */
  success: boolean;
}

/** Full state of the loop at any point */
export interface LoopState {
  /** Current loop configuration */
  config: LoopConfig;

  /** Current status */
  status: LoopStatus;

  /** All iterations so far */
  iterations: LoopIteration[];

  /** Current iteration number */
  currentIteration: number;

  /** When the loop started */
  startedAt?: string;

  /** When the loop ended */
  endedAt?: string;

  /** Aggregate token usage */
  totalTokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Aggregate tool call counts */
  totalToolCalls: Record<string, number>;

  /** Current plan items */
  plan: PlanItem[];

  /** Errors encountered across all iterations */
  errors: string[];
}

/** Final result when the loop completes */
export interface LoopResult {
  /** The final state */
  state: LoopState;

  /** Total elapsed time in ms */
  totalDurationMs: number;

  /** Total iterations run */
  totalIterations: number;

  /** Whether the loop completed successfully */
  success: boolean;

  /** Summary message */
  summary: string;
}

/** Events emitted by the loop */
export type LoopEvent =
  | "loop:start"
  | "loop:stop"
  | "loop:pause"
  | "loop:resume"
  | "loop:complete"
  | "loop:error"
  | "iteration:start"
  | "iteration:end"
  | "iteration:error"
  | "tool:call"
  | "tool:result"
  | "llm:request"
  | "llm:response"
  | "llm:stream"
  | "plan:update";

/** Event payload map */
export interface LoopEventMap {
  "loop:start": { config: LoopConfig; startedAt: string };
  "loop:stop": { reason: string; state: LoopState };
  "loop:pause": { iteration: number };
  "loop:resume": { iteration: number };
  "loop:complete": { result: LoopResult };
  "loop:error": { error: Error; iteration: number };
  "iteration:start": { iteration: number; planItem?: PlanItem };
  "iteration:end": { iteration: LoopIteration };
  "iteration:error": { iteration: number; error: Error };
  "tool:call": {
    name: string;
    args: Record<string, unknown>;
    iteration: number;
  };
  "tool:result": {
    name: string;
    result: string;
    durationMs: number;
    iteration: number;
  };
  "llm:request": { messages: ChatMessage[]; iteration: number };
  "llm:response": {
    content: string;
    usage: LoopIteration["tokenUsage"];
    iteration: number;
  };
  "llm:stream": { chunk: string; iteration: number };
  "plan:update": { plan: PlanItem[]; iteration: number };
}
