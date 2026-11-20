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
  RoleEngine,
  PortOverrides,
} from "../types/pipeline.js";
import { ExecutionEngine, type ExecutionEngineConfig } from "./execution.js";
import { EvaluationEngine, type EvaluationEngineConfig } from "./evaluation.js";
import { PlanningEngine, type PlanningEngineConfig } from "./planning.js";
import { CriticEngine, type CriticEngineConfig } from "./critic.js";
import { MemoryEngine, type MemoryEngineConfig } from "./memory.js";
import {
  RefinementEngine,
  type RefinementEngineConfig,
} from "./refinement.js";
import { NO_TOOLS, READ_ONLY_TOOLS } from "./tool-policies.js";

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
  ports?: PortOverrides,
): RoleEngine {
  const entry = registry.get(type);
  if (!entry) {
    throw new Error(
      `Unknown node type: "${type}". Available: ${Array.from(registry.keys()).join(", ")}`,
    );
  }
  return entry.factory(id, config, metadata, ports);
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
      { name: "task", direction: "input", signalTypes: ["task", "plan", "corrections"], description: "Task, plan, or corrections sent back" },
      { name: "context", direction: "input", signalTypes: ["context", "memory", "compressed_context"], description: "Additional context", required: false },
    ],
    outputs: [
      { name: "result", direction: "output", signalTypes: ["execution_result"], description: "Execution result" },
      { name: "tool_calls", direction: "output", signalTypes: ["tool_calls"], description: "Tool calls made" },
      { name: "tokens", direction: "output", signalTypes: ["token_usage"], description: "Token usage" },
    ],
  },
  defaultConfig: { maxIterations: 20, delayMs: 500, concurrent: false },
  factory: (id, config, metadata, ports) => {
    const loopConfig: ExecutionEngineConfig = {
      provider: metadata?.provider as ExecutionEngineConfig["provider"],
      tools: metadata?.tools as ExecutionEngineConfig["tools"],
      promptFile: metadata?.promptFile as string,
      planFile: metadata?.planFile as string,
      systemMessage: metadata?.systemMessage as string,
      skillPrompt: metadata?.skillPrompt as string,
    };
    return new ExecutionEngine(loopConfig, { id, name: metadata?.nodeName as string | undefined, config, ports });
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
  defaultConfig: { maxIterations: 1, delayMs: 0, concurrent: false, toolPolicy: READ_ONLY_TOOLS },
  factory: (id, config, metadata, ports) => {
    const loopConfig: EvaluationEngineConfig = {
      provider: metadata?.provider as EvaluationEngineConfig["provider"],
      tools: metadata?.tools as EvaluationEngineConfig["tools"],
      checks: metadata?.checks as EvaluationEngineConfig["checks"],
      systemMessage: metadata?.systemMessage as string,
      skillPrompt: metadata?.skillPrompt as string,
      skipUnverifiable: metadata?.skipUnverifiable === true,
    };
    return new EvaluationEngine(loopConfig, { id, name: metadata?.nodeName as string | undefined, config, ports });
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
      { name: "task", direction: "input", signalTypes: ["task", "replan_signal"], description: "The task, or the reason to start over", required: false },
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
    toolPolicy: READ_ONLY_TOOLS,
  },
  factory: (id, config, metadata, ports) => {
    const loopConfig: PlanningEngineConfig = {
      provider: metadata?.provider as PlanningEngineConfig["provider"],
      tools: metadata?.tools as PlanningEngineConfig["tools"],
      planFile: metadata?.planFile as string,
      specsDir: metadata?.specsDir as string,
      systemMessage: metadata?.systemMessage as string,
      skillPrompt: metadata?.skillPrompt as string,
    };
    return new PlanningEngine(loopConfig, { id, name: metadata?.nodeName as string | undefined, config, ports });
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
    toolPolicy: NO_TOOLS,
  },
  factory: (id, config, metadata, ports) => {
    const loopConfig: CriticEngineConfig = {
      provider: metadata?.provider as CriticEngineConfig["provider"],
      windowSize: metadata?.windowSize as number,
      stagnationThreshold: metadata?.stagnationThreshold as number,
      tokenBudget: metadata?.tokenBudget as number,
      systemMessage: metadata?.systemMessage as string,
      skillPrompt: metadata?.skillPrompt as string,
    };
    return new CriticEngine(loopConfig, { id, name: metadata?.nodeName as string | undefined, config, ports });
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
    toolPolicy: NO_TOOLS,
  },
  factory: (id, config, metadata, ports) => {
    const loopConfig: MemoryEngineConfig = {
      provider: metadata?.provider as MemoryEngineConfig["provider"],
      bufferSize: metadata?.bufferSize as number,
      maxSummaryLength: metadata?.maxSummaryLength as number,
      systemMessage: metadata?.systemMessage as string,
      skillPrompt: metadata?.skillPrompt as string,
    };
    return new MemoryEngine(loopConfig, { id, name: metadata?.nodeName as string | undefined, config, ports });
  },
});

registerNodeType({
  type: "refinement",
  name: "Refinement Loop",
  category: "refinement",
  description:
    "Convergence gate for iterative refinement. Analyzes evaluation verdicts " +
    "and critic feedback to decide: converge, refine, or backtrack. " +
    "Enables Opus-class deep reasoning through self-correction.",
  version: "1.0.0",
  defaultPorts: {
    inputs: [
      {
        name: "evaluation",
        direction: "input",
        signalTypes: ["evaluation", "eval_metrics"],
        description: "Verdicts from evaluation loop",
      },
      {
        name: "critic_feedback",
        direction: "input",
        signalTypes: ["critic_feedback", "stagnation_alert"],
        description: "Structural analysis from critic",
        required: false,
      },
      {
        name: "execution_result",
        direction: "input",
        signalTypes: ["execution_result"],
        description: "The output being refined",
        required: false,
      },
    ],
    outputs: [
      {
        name: "refinement_decision",
        direction: "output",
        signalTypes: ["refinement_decision"],
        description: "The decision: converge, refine, or backtrack",
      },
      {
        name: "corrections",
        direction: "output",
        signalTypes: ["corrections"],
        description: "Specific fixes to apply",
      },
      {
        name: "replan_signal",
        direction: "output",
        signalTypes: ["replan_signal"],
        description: "Request for full re-planning",
      },
      {
        name: "convergence",
        direction: "output",
        signalTypes: ["convergence"],
        description: "Pipeline has converged",
      },
    ],
  },
  defaultConfig: {
    maxIterations: 1,
    delayMs: 0,
    concurrent: false,
    frequency: {
      everyNIterations: 1,
      onSignals: ["evaluation", "eval_metrics"],
    },
    toolPolicy: NO_TOOLS,
  },
  factory: (id, config, metadata, ports) => {
    const loopConfig: RefinementEngineConfig = {
      provider: metadata?.provider as RefinementEngineConfig["provider"],
      convergenceThreshold: metadata?.convergenceThreshold as number,
      maxRounds: metadata?.maxRounds as number,
      systemMessage: metadata?.systemMessage as string,
      skillPrompt: metadata?.skillPrompt as string,
    };
    return new RefinementEngine(loopConfig, { id, name: metadata?.nodeName as string | undefined, config, ports });
  },
});
