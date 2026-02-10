// ============================================
// Loop Node Registry
// ============================================
// Central registry for discovering and instantiating
// loop node types. Built-in types are registered at
// import time. Custom types can be registered at runtime.

import type {
  NodeId,
  NodeFactory,
  NodeRunConfig,
  RegisteredNodeType,
  LoopNode,
} from "../types/pipeline.js";
import { ExecutionLoop, type ExecutionLoopConfig } from "./execution.js";
import { EvaluationLoop, type EvaluationLoopConfig } from "./evaluation.js";
import { PlanningLoop, type PlanningLoopConfig } from "./planning.js";
import { CriticLoop, type CriticLoopConfig } from "./critic.js";
import { MemoryLoop, type MemoryLoopConfig } from "./memory.js";

/** Global node type registry */
const registry = new Map<string, RegisteredNodeType>();

/**
 * Register a new node type.
 * Built-in types are registered automatically.
 * Custom types can be registered at runtime.
 */
export function registerNodeType(entry: RegisteredNodeType): void {
  registry.set(entry.type, entry);
}

/**
 * Get a registered node type by its key.
 */
export function getNodeType(type: string): RegisteredNodeType | undefined {
  return registry.get(type);
}

/**
 * List all registered node types.
 */
export function listNodeTypes(): RegisteredNodeType[] {
  return Array.from(registry.values());
}

/**
 * Create a node instance from a type key + config.
 */
export function createNode(
  type: string,
  id: NodeId,
  config: NodeRunConfig,
  metadata?: Record<string, unknown>,
): LoopNode {
  const entry = registry.get(type);
  if (!entry) {
    throw new Error(
      `Unknown node type: "${type}". Available: ${Array.from(registry.keys()).join(", ")}`,
    );
  }
  return entry.factory(id, config, metadata);
}

// -----------------------------------------------------------
// Built-in type registrations
// -----------------------------------------------------------
// These are registered as descriptors. The factory functions
// require runtime dependencies (LLM provider, tools) that
// are passed via metadata at instantiation time.
// -----------------------------------------------------------

registerNodeType({
  type: "execution",
  name: "Execution Loop",
  category: "execution",
  description:
    "Fast, stateless executor. Picks a task, calls LLM with tools, does work.",
  version: "1.0.0",
  defaultPorts: {
    inputs: [
      { name: "task", direction: "input", signalTypes: ["task", "plan"], description: "Task or plan to execute" },
      { name: "context", direction: "input", signalTypes: ["context", "memory"], description: "Additional context", required: false },
    ],
    outputs: [
      { name: "result", direction: "output", signalTypes: ["execution_result"], description: "Execution result" },
      { name: "tool_calls", direction: "output", signalTypes: ["tool_calls"], description: "Tool calls made" },
      { name: "tokens", direction: "output", signalTypes: ["token_usage"], description: "Token usage" },
    ],
  },
  defaultConfig: { maxIterations: 20, delayMs: 500, concurrent: false },
  factory: (id, config, metadata) => {
    const loopConfig: ExecutionLoopConfig = {
      provider: metadata?.provider as ExecutionLoopConfig["provider"],
      tools: metadata?.tools as ExecutionLoopConfig["tools"],
      promptFile: metadata?.promptFile as string,
      planFile: metadata?.planFile as string,
      systemMessage: metadata?.systemMessage as string,
    };
    return new ExecutionLoop(loopConfig, { id, config });
  },
});

registerNodeType({
  type: "evaluation",
  name: "Evaluation Loop",
  category: "evaluation",
  description:
    "Verifies real-world changes. Never trusts execution output alone.",
  version: "1.0.0",
  defaultPorts: {
    inputs: [
      { name: "execution_result", direction: "input", signalTypes: ["execution_result"], description: "What was claimed" },
      { name: "ground_truth", direction: "input", signalTypes: ["ground_truth", "test_results", "build_output"], description: "External verification", required: false },
    ],
    outputs: [
      { name: "evaluation", direction: "output", signalTypes: ["evaluation"], description: "Verdict" },
      { name: "corrections", direction: "output", signalTypes: ["corrections"], description: "Corrections" },
      { name: "metrics", direction: "output", signalTypes: ["eval_metrics"], description: "Metrics" },
    ],
  },
  defaultConfig: { maxIterations: 1, delayMs: 0, concurrent: false },
  factory: (id, config, metadata) => {
    const loopConfig: EvaluationLoopConfig = {
      provider: metadata?.provider as EvaluationLoopConfig["provider"],
      tools: metadata?.tools as EvaluationLoopConfig["tools"],
      checks: metadata?.checks as EvaluationLoopConfig["checks"],
      systemMessage: metadata?.systemMessage as string,
    };
    return new EvaluationLoop(loopConfig, { id, config });
  },
});

registerNodeType({
  type: "planning",
  name: "Planning Loop",
  category: "planning",
  description:
    "Slow, strategic planner. Reviews aggregate state, adjusts direction.",
  version: "1.0.0",
  defaultPorts: {
    inputs: [
      { name: "evaluation", direction: "input", signalTypes: ["evaluation", "eval_metrics"], description: "Verdicts" },
      { name: "execution_result", direction: "input", signalTypes: ["execution_result", "token_usage"], description: "Execution history" },
      { name: "critic_feedback", direction: "input", signalTypes: ["critic_feedback", "stagnation_alert"], description: "Critic feedback", required: false },
      { name: "memory", direction: "input", signalTypes: ["memory", "compressed_context"], description: "Compressed context", required: false },
    ],
    outputs: [
      { name: "plan", direction: "output", signalTypes: ["plan"], description: "Updated plan" },
      { name: "strategy", direction: "output", signalTypes: ["strategy"], description: "Strategic decisions" },
      { name: "task", direction: "output", signalTypes: ["task"], description: "Next task" },
    ],
  },
  defaultConfig: {
    maxIterations: 1,
    delayMs: 0,
    concurrent: false,
    frequency: { everyNIterations: 5 },
  },
  factory: (id, config, metadata) => {
    const loopConfig: PlanningLoopConfig = {
      provider: metadata?.provider as PlanningLoopConfig["provider"],
      tools: metadata?.tools as PlanningLoopConfig["tools"],
      planFile: metadata?.planFile as string,
      specsDir: metadata?.specsDir as string,
      systemMessage: metadata?.systemMessage as string,
    };
    return new PlanningLoop(loopConfig, { id, config });
  },
});

registerNodeType({
  type: "critic",
  name: "Critic Loop",
  category: "critic",
  description:
    "Adversarial watchdog. Detects stagnation, circularity, cost runaway.",
  version: "1.0.0",
  defaultPorts: {
    inputs: [
      { name: "execution_result", direction: "input", signalTypes: ["execution_result", "tool_calls"], description: "Execution activity" },
      { name: "eval_metrics", direction: "input", signalTypes: ["eval_metrics", "evaluation"], description: "Evaluation scores" },
      { name: "token_usage", direction: "input", signalTypes: ["token_usage"], description: "Cost tracking" },
    ],
    outputs: [
      { name: "critic_feedback", direction: "output", signalTypes: ["critic_feedback"], description: "Feedback" },
      { name: "stagnation_alert", direction: "output", signalTypes: ["stagnation_alert"], description: "Stagnation alert" },
      { name: "intervention", direction: "output", signalTypes: ["intervention"], description: "Forced action" },
    ],
  },
  defaultConfig: {
    maxIterations: 1,
    delayMs: 0,
    concurrent: true,
    frequency: { everyNIterations: 3 },
  },
  factory: (id, config, metadata) => {
    const loopConfig: CriticLoopConfig = {
      provider: metadata?.provider as CriticLoopConfig["provider"],
      windowSize: metadata?.windowSize as number,
      stagnationThreshold: metadata?.stagnationThreshold as number,
      tokenBudget: metadata?.tokenBudget as number,
      systemMessage: metadata?.systemMessage as string,
    };
    return new CriticLoop(loopConfig, { id, config });
  },
});

registerNodeType({
  type: "memory",
  name: "Memory Loop",
  category: "memory",
  description:
    "Summarizes, compresses, denoises. Creates canonical state snapshots.",
  version: "1.0.0",
  defaultPorts: {
    inputs: [
      { name: "execution_result", direction: "input", signalTypes: ["execution_result", "tool_calls"], description: "Raw outputs" },
      { name: "evaluation", direction: "input", signalTypes: ["evaluation", "eval_metrics"], description: "Verdicts" },
      { name: "strategy", direction: "input", signalTypes: ["strategy"], description: "Planning decisions", required: false },
    ],
    outputs: [
      { name: "compressed_context", direction: "output", signalTypes: ["compressed_context"], description: "Clean summary" },
      { name: "milestone", direction: "output", signalTypes: ["milestone"], description: "Milestone" },
      { name: "memory", direction: "output", signalTypes: ["memory"], description: "Long-term memory" },
    ],
  },
  defaultConfig: {
    maxIterations: 1,
    delayMs: 0,
    concurrent: true,
    frequency: { everyNIterations: 3 },
  },
  factory: (id, config, metadata) => {
    const loopConfig: MemoryLoopConfig = {
      provider: metadata?.provider as MemoryLoopConfig["provider"],
      bufferSize: metadata?.bufferSize as number,
      maxSummaryLength: metadata?.maxSummaryLength as number,
      systemMessage: metadata?.systemMessage as string,
    };
    return new MemoryLoop(loopConfig, { id, config });
  },
});
