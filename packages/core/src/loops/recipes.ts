// ============================================
// Recipe System
// ============================================
// Built-in recipes: reusable pipeline templates
// that can be instantiated with parameters.
//
// A Recipe describes a pipeline graph (nodes + wires)
// as a serializable template. Users can instantiate
// a recipe to create a concrete PipelineOrchestrator
// with all nodes connected and ready to run.

import { nanoid } from "nanoid";
import type {
  Recipe,
  RecipeParameter,
  PipelineConfig,
  SerializedNode,
  Wire,
  Signal,
} from "../types/pipeline.js";
import { PipelineOrchestrator } from "../engine/pipeline.js";
import { createNode } from "./registry.js";

// -----------------------------------------------------------
// Recipe registry
// -----------------------------------------------------------

const recipeRegistry = new Map<string, Recipe>();

/**
 * Register a recipe.
 */
export function registerRecipe(recipe: Recipe): void {
  recipeRegistry.set(recipe.id, recipe);
}

/**
 * Get a recipe by ID.
 */
export function getRecipe(id: string): Recipe | undefined {
  return recipeRegistry.get(id);
}

/**
 * List all registered recipes.
 */
export function listRecipes(): Recipe[] {
  return Array.from(recipeRegistry.values());
}

/**
 * Instantiate a recipe into a PipelineOrchestrator.
 *
 * @param recipeId The recipe ID
 * @param params Parameters required by the recipe
 * @param overrides Optional overrides for pipeline config
 * @returns A ready-to-run PipelineOrchestrator
 */
export function instantiateRecipe(
  recipeId: string,
  params: Record<string, unknown>,
  overrides?: Partial<PipelineConfig>,
): PipelineOrchestrator {
  const recipe = recipeRegistry.get(recipeId);
  if (!recipe) {
    throw new Error(
      `Recipe not found: "${recipeId}". Available: ${Array.from(recipeRegistry.keys()).join(", ")}`,
    );
  }

  return instantiateRecipeFromDefinition(recipe, params, overrides);
}

/**
 * Instantiate a pipeline from a recipe definition.
 */
export function instantiateRecipeFromDefinition(
  recipe: Recipe,
  params: Record<string, unknown>,
  overrides?: Partial<PipelineConfig>,
): PipelineOrchestrator {
  // Validate required parameters
  if (recipe.parameters) {
    for (const param of recipe.parameters) {
      if (param.required && !(param.name in params)) {
        throw new Error(
          `Recipe "${recipe.name}" requires parameter "${param.name}": ${param.description}`,
        );
      }
    }
  }

  // Resolve parameters with defaults
  const resolvedParams: Record<string, unknown> = {};
  if (recipe.parameters) {
    for (const param of recipe.parameters) {
      resolvedParams[param.name] = params[param.name] ?? param.default;
    }
  }
  // Include extra params not in the recipe definition
  for (const [key, value] of Object.entries(params)) {
    if (!(key in resolvedParams)) {
      resolvedParams[key] = value;
    }
  }

  // Build pipeline config
  const pipelineConfig: PipelineConfig = {
    id: nanoid(12),
    name: recipe.name,
    description: recipe.description,
    workingDir: (resolvedParams.workingDir as string) || process.cwd(),
    maxCycles: 50,
    delayMs: 100,
    tags: recipe.tags,
    ...recipe.defaults,
    ...overrides,
  };

  const pipeline = new PipelineOrchestrator(pipelineConfig);

  // Create and add nodes
  for (const serialized of recipe.nodes) {
    const nodeConfig = {
      ...serialized.config,
    };

    // Merge resolved params into node metadata
    const metadata = {
      ...serialized.metadata,
      ...resolvedParams,
    };

    const node = createNode(
      serialized.type,
      serialized.id,
      nodeConfig,
      metadata,
    );
    pipeline.addNode(node);
  }

  // Create wires
  for (const wireDef of recipe.wires) {
    pipeline.connect(wireDef.sourcePortId, wireDef.targetPortId, {
      id: wireDef.id,
    });
  }

  return pipeline;
}

// -----------------------------------------------------------
// Built-in Recipes
// -----------------------------------------------------------

/**
 * Ralph Loop — Classic single-loop agent.
 * One execution loop that reads specs, picks a task, works, commits.
 * This is the simplest recipe — equivalent to the original AgenticLoop.
 */
const RALPH_LOOP_RECIPE: Recipe = {
  id: "ralph-loop",
  name: "Ralph Loop",
  description:
    "Classic single-loop agent. Read specs → pick task → work → commit. The original, simple, effective.",
  version: "1.0.0",
  author: "Agentic Lab",
  tags: ["classic", "simple", "beginner"],
  category: "basic",
  nodes: [
    {
      id: "exec",
      type: "execution",
      name: "Ralph Executor",
      category: "execution",
      description: "Single execution loop — the Ralph Loop",
      version: "1.0.0",
      config: {
        maxIterations: 20,
        delayMs: 500,
        concurrent: false,
      },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input",
            signalTypes: ["task", "plan"],
            description: "Task to execute",
            required: false, // No required inputs — self-driven
          },
        ],
        outputs: [
          {
            name: "result",
            direction: "output",
            signalTypes: ["execution_result"],
            description: "Execution result",
          },
        ],
      },
    },
  ],
  wires: [],
  defaults: {
    maxCycles: 20,
    delayMs: 1000,
  },
  parameters: [
    {
      name: "provider",
      description: "LLM provider instance",
      type: "string",
      required: true,
    },
    {
      name: "tools",
      description: "Tool registry",
      type: "string",
      required: true,
    },
    {
      name: "workingDir",
      description: "Working directory for the agent",
      type: "string",
      required: true,
    },
    {
      name: "promptFile",
      description: "Path to the prompt/spec file",
      type: "string",
      required: false,
      default: "PROMPT.md",
    },
    {
      name: "planFile",
      description: "Path to the plan file",
      type: "string",
      required: false,
      default: "PLAN.md",
    },
  ],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

/**
 * Full Agent Pipeline — All 5 loops connected.
 *
 * Topology:
 *   Planning → Execution → Evaluation → Planning (feedback loop)
 *                ↓               ↓
 *             Critic ←←←←←←←←←←←←
 *                ↓
 *             Memory → (feeds back to Execution + Planning)
 *
 * Signal flow:
 *   - Planning emits plan/task → Execution
 *   - Execution emits result → Evaluation + Critic + Memory
 *   - Evaluation emits verdict → Planning + Critic
 *   - Critic emits feedback → Planning
 *   - Memory emits compressed context → Execution + Planning
 */
const FULL_PIPELINE_RECIPE: Recipe = {
  id: "full-agent-pipeline",
  name: "Full Agent Pipeline",
  description:
    "Complete agentic pipeline with all 5 specialized loops: Planning → Execution → Evaluation, with Critic watching and Memory compressing.",
  version: "1.0.0",
  author: "Agentic Lab",
  tags: ["advanced", "full", "specialized"],
  category: "advanced",
  nodes: [
    {
      id: "planner",
      type: "planning",
      name: "Strategic Planner",
      category: "planning",
      description: "Reviews aggregate state, adjusts strategy and plan",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
        frequency: { everyNIterations: 5 },
      },
      ports: {
        inputs: [
          {
            name: "evaluation",
            direction: "input",
            signalTypes: ["evaluation", "eval_metrics"],
            description: "Verdicts",
          },
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result", "token_usage"],
            description: "Execution history",
            required: false,
          },
          {
            name: "critic_feedback",
            direction: "input",
            signalTypes: ["critic_feedback", "stagnation_alert"],
            description: "Critic feedback",
            required: false,
          },
          {
            name: "memory",
            direction: "input",
            signalTypes: ["memory", "compressed_context"],
            description: "Compressed context",
            required: false,
          },
        ],
        outputs: [
          {
            name: "plan",
            direction: "output",
            signalTypes: ["plan"],
            description: "Updated plan",
          },
          {
            name: "strategy",
            direction: "output",
            signalTypes: ["strategy"],
            description: "Strategic decisions",
          },
          {
            name: "task",
            direction: "output",
            signalTypes: ["task"],
            description: "Next task",
          },
        ],
      },
    },
    {
      id: "executor",
      type: "execution",
      name: "Task Executor",
      category: "execution",
      description: "Fast, stateless executor — does the actual work",
      version: "1.0.0",
      config: {
        maxIterations: 20,
        delayMs: 500,
        concurrent: false,
      },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input",
            signalTypes: ["task", "plan"],
            description: "Task to execute",
            required: false,
          },
          {
            name: "context",
            direction: "input",
            signalTypes: ["context", "memory", "compressed_context"],
            description: "Context and memory",
            required: false,
          },
        ],
        outputs: [
          {
            name: "result",
            direction: "output",
            signalTypes: ["execution_result"],
            description: "Execution result",
          },
          {
            name: "tool_calls",
            direction: "output",
            signalTypes: ["tool_calls"],
            description: "Tool calls",
          },
          {
            name: "tokens",
            direction: "output",
            signalTypes: ["token_usage"],
            description: "Token usage",
          },
        ],
      },
    },
    {
      id: "evaluator",
      type: "evaluation",
      name: "Output Evaluator",
      category: "evaluation",
      description: "Verifies real-world changes against external signals",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
      },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "What was claimed",
          },
          {
            name: "ground_truth",
            direction: "input",
            signalTypes: ["ground_truth", "test_results", "build_output"],
            description: "External verification",
            required: false,
          },
        ],
        outputs: [
          {
            name: "evaluation",
            direction: "output",
            signalTypes: ["evaluation"],
            description: "Verdict",
          },
          {
            name: "corrections",
            direction: "output",
            signalTypes: ["corrections"],
            description: "Corrections",
          },
          {
            name: "metrics",
            direction: "output",
            signalTypes: ["eval_metrics"],
            description: "Metrics",
          },
        ],
      },
    },
    {
      id: "critic",
      type: "critic",
      name: "Anti-Ralph Critic",
      category: "critic",
      description: "Adversarial watchdog — detects stagnation and circularity",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: true,
        frequency: { everyNIterations: 3 },
      },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result", "tool_calls"],
            description: "Execution activity",
          },
          {
            name: "eval_metrics",
            direction: "input",
            signalTypes: ["eval_metrics", "evaluation"],
            description: "Evaluation scores",
          },
          {
            name: "token_usage",
            direction: "input",
            signalTypes: ["token_usage"],
            description: "Cost tracking",
          },
        ],
        outputs: [
          {
            name: "critic_feedback",
            direction: "output",
            signalTypes: ["critic_feedback"],
            description: "Feedback",
          },
          {
            name: "stagnation_alert",
            direction: "output",
            signalTypes: ["stagnation_alert"],
            description: "Alert",
          },
          {
            name: "intervention",
            direction: "output",
            signalTypes: ["intervention"],
            description: "Forced action",
          },
        ],
      },
    },
    {
      id: "memory",
      type: "memory",
      name: "Context Compressor",
      category: "memory",
      description:
        "Summarizes, compresses, denoises — prevents infinite meta-reasoning",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: true,
        frequency: { everyNIterations: 3 },
      },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result", "tool_calls"],
            description: "Raw outputs",
          },
          {
            name: "evaluation",
            direction: "input",
            signalTypes: ["evaluation", "eval_metrics"],
            description: "Verdicts",
          },
          {
            name: "strategy",
            direction: "input",
            signalTypes: ["strategy"],
            description: "Planning decisions",
            required: false,
          },
        ],
        outputs: [
          {
            name: "compressed_context",
            direction: "output",
            signalTypes: ["compressed_context"],
            description: "Clean summary",
          },
          {
            name: "milestone",
            direction: "output",
            signalTypes: ["milestone"],
            description: "Milestone",
          },
          {
            name: "memory",
            direction: "output",
            signalTypes: ["memory"],
            description: "Long-term memory",
          },
        ],
      },
    },
  ],
  wires: [
    // Planning → Execution
    {
      id: "w1",
      sourcePortId: "planner:out:task",
      targetPortId: "executor:in:task",
      enabled: true,
    },

    // Execution → Evaluation
    {
      id: "w2",
      sourcePortId: "executor:out:result",
      targetPortId: "evaluator:in:execution_result",
      enabled: true,
    },

    // Evaluation → Planning (feedback)
    {
      id: "w3",
      sourcePortId: "evaluator:out:evaluation",
      targetPortId: "planner:in:evaluation",
      enabled: true,
    },
    {
      id: "w4",
      sourcePortId: "evaluator:out:metrics",
      targetPortId: "planner:in:evaluation",
      enabled: true,
    },

    // Execution → Critic
    {
      id: "w5",
      sourcePortId: "executor:out:result",
      targetPortId: "critic:in:execution_result",
      enabled: true,
    },
    {
      id: "w6",
      sourcePortId: "executor:out:tokens",
      targetPortId: "critic:in:token_usage",
      enabled: true,
    },

    // Evaluation → Critic
    {
      id: "w7",
      sourcePortId: "evaluator:out:metrics",
      targetPortId: "critic:in:eval_metrics",
      enabled: true,
    },

    // Critic → Planning
    {
      id: "w8",
      sourcePortId: "critic:out:critic_feedback",
      targetPortId: "planner:in:critic_feedback",
      enabled: true,
    },
    {
      id: "w9",
      sourcePortId: "critic:out:stagnation_alert",
      targetPortId: "planner:in:critic_feedback",
      enabled: true,
    },

    // Execution → Memory
    {
      id: "w10",
      sourcePortId: "executor:out:result",
      targetPortId: "memory:in:execution_result",
      enabled: true,
    },

    // Evaluation → Memory
    {
      id: "w11",
      sourcePortId: "evaluator:out:evaluation",
      targetPortId: "memory:in:evaluation",
      enabled: true,
    },

    // Planning → Memory (strategy decisions)
    {
      id: "w12",
      sourcePortId: "planner:out:strategy",
      targetPortId: "memory:in:strategy",
      enabled: true,
    },

    // Memory → Execution (compressed context)
    {
      id: "w13",
      sourcePortId: "memory:out:compressed_context",
      targetPortId: "executor:in:context",
      enabled: true,
    },
    {
      id: "w14",
      sourcePortId: "memory:out:memory",
      targetPortId: "executor:in:context",
      enabled: true,
    },

    // Memory → Planning
    {
      id: "w15",
      sourcePortId: "memory:out:compressed_context",
      targetPortId: "planner:in:memory",
      enabled: true,
    },
  ],
  defaults: {
    maxCycles: 50,
    delayMs: 200,
  },
  parameters: [
    {
      name: "provider",
      description: "LLM provider instance for all loops",
      type: "string",
      required: true,
    },
    {
      name: "tools",
      description: "Tool registry shared by execution and evaluation",
      type: "string",
      required: true,
    },
    {
      name: "workingDir",
      description: "Working directory",
      type: "string",
      required: true,
    },
    {
      name: "planFile",
      description: "Path to the plan file",
      type: "string",
      required: false,
      default: "PLAN.md",
    },
    {
      name: "promptFile",
      description: "Path to the prompt/spec file",
      type: "string",
      required: false,
      default: "PROMPT.md",
    },
  ],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

/**
 * Execution + Evaluation — Simple two-loop pattern.
 * Good for tasks that need real-world verification.
 */
const EXEC_EVAL_RECIPE: Recipe = {
  id: "exec-eval",
  name: "Execute & Evaluate",
  description:
    "Two-loop pattern: Execution does work, Evaluation verifies real-world changes. Simple but effective.",
  version: "1.0.0",
  author: "Agentic Lab",
  tags: ["intermediate", "verification"],
  category: "intermediate",
  nodes: [
    {
      id: "exec",
      type: "execution",
      name: "Executor",
      category: "execution",
      description: "Executes tasks",
      version: "1.0.0",
      config: { maxIterations: 20, delayMs: 500, concurrent: false },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input",
            signalTypes: ["task", "plan", "corrections"],
            description: "Task or corrections",
            required: false,
          },
          {
            name: "context",
            direction: "input",
            signalTypes: ["context", "memory"],
            description: "Context",
            required: false,
          },
        ],
        outputs: [
          {
            name: "result",
            direction: "output",
            signalTypes: ["execution_result"],
            description: "Result",
          },
          {
            name: "tool_calls",
            direction: "output",
            signalTypes: ["tool_calls"],
            description: "Tools",
          },
          {
            name: "tokens",
            direction: "output",
            signalTypes: ["token_usage"],
            description: "Tokens",
          },
        ],
      },
    },
    {
      id: "eval",
      type: "evaluation",
      name: "Evaluator",
      category: "evaluation",
      description: "Verifies execution output",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "Claimed output",
          },
          {
            name: "ground_truth",
            direction: "input",
            signalTypes: ["ground_truth"],
            description: "Truth",
            required: false,
          },
        ],
        outputs: [
          {
            name: "evaluation",
            direction: "output",
            signalTypes: ["evaluation"],
            description: "Verdict",
          },
          {
            name: "corrections",
            direction: "output",
            signalTypes: ["corrections"],
            description: "Corrections",
          },
          {
            name: "metrics",
            direction: "output",
            signalTypes: ["eval_metrics"],
            description: "Metrics",
          },
        ],
      },
    },
  ],
  wires: [
    // Execution → Evaluation
    {
      id: "w1",
      sourcePortId: "exec:out:result",
      targetPortId: "eval:in:execution_result",
      enabled: true,
    },
    // Evaluation corrections → Execution (feedback loop)
    {
      id: "w2",
      sourcePortId: "eval:out:corrections",
      targetPortId: "exec:in:task",
      enabled: true,
    },
  ],
  defaults: {
    maxCycles: 30,
    delayMs: 500,
  },
  parameters: [
    {
      name: "provider",
      description: "LLM provider",
      type: "string",
      required: true,
    },
    {
      name: "tools",
      description: "Tool registry",
      type: "string",
      required: true,
    },
    {
      name: "workingDir",
      description: "Working directory",
      type: "string",
      required: true,
    },
  ],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

/**
 * Deep Reasoning — Iterative refinement pipeline.
 *
 * Five loops connected in a closed feedback architecture:
 *   Planning → Execution → Evaluation → Refinement ↔ Critic
 *
 * The Refinement node acts as a convergence gate: it inspects evaluation
 * metrics and critic findings, then decides whether to converge (done),
 * refine (send corrections back to Execution), or backtrack (ask Planning
 * to re-plan from scratch).
 *
 * Defaults: convergenceThreshold 0.7, maxRounds 3.
 */
const DEEP_REASONING_RECIPE: Recipe = {
  id: "deep-reasoning",
  name: "Deep Reasoning",
  description:
    "Iterative plan → execute → evaluate → refine cycle with convergence detection and backtracking. Uses a Refinement gate to decide when quality is sufficient or when to re-plan.",
  version: "1.0.0",
  author: "Agentic Lab",
  tags: ["advanced", "refinement", "convergence", "iterative"],
  category: "advanced",
  nodes: [
    // ── Planning ──────────────────────────────────────────────
    {
      id: "plan",
      type: "planning",
      name: "Planner",
      category: "planning",
      description: "Generates a step-by-step plan from the user prompt",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          {
            name: "prompt",
            direction: "input",
            signalTypes: ["task", "context"],
            description: "User prompt or replan signal",
            required: false,
          },
          {
            name: "replan",
            direction: "input",
            signalTypes: ["replan_signal"],
            description: "Backtrack signal from refinement",
            required: false,
          },
          {
            name: "eval_feedback",
            direction: "input",
            signalTypes: ["evaluation"],
            description: "Evaluation feedback for plan adjustment",
            required: false,
          },
        ],
        outputs: [
          {
            name: "plan",
            direction: "output",
            signalTypes: ["plan"],
            description: "Generated plan",
          },
          {
            name: "subtasks",
            direction: "output",
            signalTypes: ["subtasks"],
            description: "Extracted subtasks",
          },
        ],
      },
    },
    // ── Execution ─────────────────────────────────────────────
    {
      id: "exec",
      type: "execution",
      name: "Executor",
      category: "execution",
      description: "Executes tasks following the plan",
      version: "1.0.0",
      config: { maxIterations: 20, delayMs: 500, concurrent: false },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input",
            signalTypes: ["plan", "task", "corrections"],
            description: "Plan or corrections to execute",
            required: false,
          },
          {
            name: "context",
            direction: "input",
            signalTypes: ["context", "memory"],
            description: "Context and memory",
            required: false,
          },
        ],
        outputs: [
          {
            name: "result",
            direction: "output",
            signalTypes: ["execution_result"],
            description: "Execution result",
          },
          {
            name: "tool_calls",
            direction: "output",
            signalTypes: ["tool_calls"],
            description: "Tool invocations",
          },
          {
            name: "tokens",
            direction: "output",
            signalTypes: ["token_usage"],
            description: "Token usage",
          },
        ],
      },
    },
    // ── Evaluation ────────────────────────────────────────────
    {
      id: "eval",
      type: "evaluation",
      name: "Evaluator",
      category: "evaluation",
      description: "Verifies execution output against expected outcomes",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "Execution output to evaluate",
          },
          {
            name: "ground_truth",
            direction: "input",
            signalTypes: ["ground_truth"],
            description: "Expected output (optional)",
            required: false,
          },
        ],
        outputs: [
          {
            name: "evaluation",
            direction: "output",
            signalTypes: ["evaluation"],
            description: "Pass/fail verdict",
          },
          {
            name: "corrections",
            direction: "output",
            signalTypes: ["corrections"],
            description: "Specific corrections needed",
          },
          {
            name: "metrics",
            direction: "output",
            signalTypes: ["eval_metrics"],
            description: "Evaluation metrics",
          },
        ],
      },
    },
    // ── Critic ────────────────────────────────────────────────
    {
      id: "critic",
      type: "critic",
      name: "Critic",
      category: "critic",
      description: "Deep quality analysis and intervention detection",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "Execution output to critique",
          },
          {
            name: "evaluation",
            direction: "input",
            signalTypes: ["evaluation", "eval_metrics"],
            description: "Evaluation results",
            required: false,
          },
        ],
        outputs: [
          {
            name: "critique",
            direction: "output",
            signalTypes: ["critique"],
            description: "Quality analysis",
          },
          {
            name: "intervention",
            direction: "output",
            signalTypes: ["intervention"],
            description: "Intervention recommendations",
          },
          {
            name: "critic_feedback",
            direction: "output",
            signalTypes: ["critic_feedback"],
            description: "Structured feedback for refinement",
          },
        ],
      },
    },
    // ── Refinement (convergence gate) ─────────────────────────
    {
      id: "refine",
      type: "refinement",
      name: "Refinement Gate",
      category: "refinement",
      description:
        "Convergence gate: decides whether to converge, refine, or backtrack based on evaluation and critic signals",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
        frequency: {
          everyNIterations: 1,
          onSignals: ["evaluation", "eval_metrics"],
        },
      },
      metadata: {
        convergenceThreshold: 0.7,
        maxRounds: 3,
      },
      ports: {
        inputs: [
          {
            name: "evaluation",
            direction: "input",
            signalTypes: ["evaluation", "eval_metrics"],
            description: "Evaluation signals",
            required: true,
          },
          {
            name: "critic_feedback",
            direction: "input",
            signalTypes: ["critic_feedback", "critique"],
            description: "Critic analysis",
            required: false,
          },
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "Raw execution output",
            required: false,
          },
        ],
        outputs: [
          {
            name: "refinement_decision",
            direction: "output",
            signalTypes: ["refinement_decision"],
            description: "Converge / refine / backtrack decision",
          },
          {
            name: "corrections",
            direction: "output",
            signalTypes: ["corrections"],
            description: "Corrections for execution (refine action)",
          },
          {
            name: "replan_signal",
            direction: "output",
            signalTypes: ["replan_signal"],
            description: "Replan signal (backtrack action)",
          },
          {
            name: "convergence",
            direction: "output",
            signalTypes: ["convergence"],
            description: "Convergence signal (converge action)",
          },
        ],
      },
    },
  ],
  wires: [
    // ── Forward path ──────────────────────────────────────────
    // Planning → Execution
    {
      id: "w-plan-exec",
      sourcePortId: "plan:out:plan",
      targetPortId: "exec:in:task",
      enabled: true,
    },
    // Execution → Evaluation
    {
      id: "w-exec-eval",
      sourcePortId: "exec:out:result",
      targetPortId: "eval:in:execution_result",
      enabled: true,
    },
    // Execution → Critic
    {
      id: "w-exec-critic",
      sourcePortId: "exec:out:result",
      targetPortId: "critic:in:execution_result",
      enabled: true,
    },
    // Evaluation → Critic (context)
    {
      id: "w-eval-critic",
      sourcePortId: "eval:out:evaluation",
      targetPortId: "critic:in:evaluation",
      enabled: true,
    },

    // ── To Refinement gate ────────────────────────────────────
    // Evaluation → Refinement
    {
      id: "w-eval-refine",
      sourcePortId: "eval:out:evaluation",
      targetPortId: "refine:in:evaluation",
      enabled: true,
    },
    // Evaluation metrics → Refinement
    {
      id: "w-metrics-refine",
      sourcePortId: "eval:out:metrics",
      targetPortId: "refine:in:evaluation",
      enabled: true,
    },
    // Critic → Refinement
    {
      id: "w-critic-refine",
      sourcePortId: "critic:out:critic_feedback",
      targetPortId: "refine:in:critic_feedback",
      enabled: true,
    },
    // Execution result → Refinement (for context)
    {
      id: "w-exec-refine",
      sourcePortId: "exec:out:result",
      targetPortId: "refine:in:execution_result",
      enabled: true,
    },

    // ── Feedback loops ────────────────────────────────────────
    // Refinement corrections → Execution (refine action)
    {
      id: "w-refine-exec",
      sourcePortId: "refine:out:corrections",
      targetPortId: "exec:in:task",
      enabled: true,
    },
    // Refinement replan → Planning (backtrack action)
    {
      id: "w-refine-plan",
      sourcePortId: "refine:out:replan_signal",
      targetPortId: "plan:in:replan",
      enabled: true,
    },
    // Evaluation feedback → Planning (plan adjustment)
    {
      id: "w-eval-plan",
      sourcePortId: "eval:out:evaluation",
      targetPortId: "plan:in:eval_feedback",
      enabled: true,
    },
    // Evaluation corrections → Execution (direct feedback)
    {
      id: "w-evalcorr-exec",
      sourcePortId: "eval:out:corrections",
      targetPortId: "exec:in:task",
      enabled: true,
    },
  ],
  defaults: {
    maxCycles: 50,
    delayMs: 500,
  },
  parameters: [
    {
      name: "provider",
      description: "LLM provider for all loops",
      type: "string",
      required: true,
    },
    {
      name: "tools",
      description: "Tool registry for execution",
      type: "string",
      required: true,
    },
    {
      name: "workingDir",
      description: "Working directory for file operations",
      type: "string",
      required: true,
    },
    {
      name: "convergenceThreshold",
      description: "Minimum pass-rate to consider converged (0-1)",
      type: "number",
      required: false,
      default: 0.7,
    },
    {
      name: "maxRounds",
      description: "Maximum refinement rounds before forced convergence",
      type: "number",
      required: false,
      default: 3,
    },
  ],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

// -----------------------------------------------------------
// Supervised Coder — Plan → Code → Review pipeline
// -----------------------------------------------------------

/**
 * Supervised Coder — Cognitive Role Separation for coding agents.
 *
 * Philosophy: A single agent evaluating its own work is unreliable.
 * This recipe separates the developer workflow into three specialized
 * cognitive roles that check each other's output:
 *
 *   Planner → Coder → Reviewer
 *       ↑                  ↓
 *       └── corrections ───┘
 *
 * This mirrors how real software teams operate:
 *   - Tech Lead (Planner): reads specs, decides what to build next
 *   - Developer (Coder): writes code, runs tests
 *   - Code Reviewer (Reviewer): independently verifies the changes
 *
 * Key principle: "Trust but verify" — the Coder claims "done",
 * the Reviewer independently runs tests and reads the diff.
 */
const SUPERVISED_CODER_RECIPE: Recipe = {
  id: "supervised-coder",
  name: "Supervised Coder",
  description:
    "Three-loop coding pipeline with cognitive role separation: Planner decides what to build, Coder implements, Reviewer independently verifies. Mirrors a real dev team (tech lead → developer → code reviewer).",
  version: "1.0.0",
  author: "Agentic Lab",
  tags: ["coding", "supervised", "verification", "team-simulation"],
  category: "intermediate",
  nodes: [
    // ── Planner ──────────────────────────────────────────
    {
      id: "planner",
      type: "planning",
      name: "Tech Lead",
      category: "planning",
      description:
        "Reads specs and PLAN.md, selects the single highest-priority task, decomposes it into actionable steps for the Coder",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
        frequency: { everyNIterations: 3 },
      },
      ports: {
        inputs: [
          {
            name: "review_feedback",
            direction: "input",
            signalTypes: ["evaluation", "corrections"],
            description: "Review verdict and corrections from the Reviewer",
            required: false,
          },
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "What the Coder actually did",
            required: false,
          },
        ],
        outputs: [
          {
            name: "task",
            direction: "output",
            signalTypes: ["task"],
            description: "Selected task with decomposed steps for the Coder",
          },
          {
            name: "plan_update",
            direction: "output",
            signalTypes: ["plan"],
            description: "Updated plan state",
          },
        ],
      },
    },
    // ── Coder ────────────────────────────────────────────
    {
      id: "coder",
      type: "execution",
      name: "Developer",
      category: "execution",
      description:
        "Implements the selected task: writes code, runs tests, commits. Reports what was done, NOT whether it was done well (that is the Reviewer's job)",
      version: "1.0.0",
      config: {
        maxIterations: 15,
        delayMs: 500,
        concurrent: false,
      },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input",
            signalTypes: ["task", "plan", "corrections"],
            description: "Task from Planner or corrections from Reviewer",
            required: false,
          },
        ],
        outputs: [
          {
            name: "result",
            direction: "output",
            signalTypes: ["execution_result"],
            description: "What was implemented and claimed outcome",
          },
          {
            name: "tool_calls",
            direction: "output",
            signalTypes: ["tool_calls"],
            description: "All tool calls made during coding",
          },
          {
            name: "tokens",
            direction: "output",
            signalTypes: ["token_usage"],
            description: "Token usage report",
          },
        ],
      },
    },
    // ── Reviewer ─────────────────────────────────────────
    {
      id: "reviewer",
      type: "evaluation",
      name: "Code Reviewer",
      category: "evaluation",
      description:
        "Independently verifies the Coder's changes. Runs tests, reads diffs, checks against specs. Never trusts the Coder's claims — always inspects the actual state of the codebase",
      version: "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
      },
      ports: {
        inputs: [
          {
            name: "execution_result",
            direction: "input",
            signalTypes: ["execution_result"],
            description: "What the Coder claims to have done",
          },
          {
            name: "original_task",
            direction: "input",
            signalTypes: ["task"],
            description:
              "Original task from Planner (ground truth for expectations)",
            required: false,
          },
        ],
        outputs: [
          {
            name: "verdict",
            direction: "output",
            signalTypes: ["evaluation"],
            description:
              "Pass/fail verdict with evidence from actual test runs",
          },
          {
            name: "corrections",
            direction: "output",
            signalTypes: ["corrections"],
            description:
              "Specific corrections if review fails (goes to Coder + Planner)",
          },
          {
            name: "metrics",
            direction: "output",
            signalTypes: ["eval_metrics"],
            description: "Review metrics (tests passed, coverage, etc.)",
          },
        ],
      },
    },
  ],
  wires: [
    // Planner → Coder (task assignment)
    {
      id: "w-plan-to-code",
      sourcePortId: "planner:out:task",
      targetPortId: "coder:in:task",
      enabled: true,
    },
    // Coder → Reviewer (implementation output)
    {
      id: "w-code-to-review",
      sourcePortId: "coder:out:result",
      targetPortId: "reviewer:in:execution_result",
      enabled: true,
    },
    // Planner → Reviewer (original task for reference)
    {
      id: "w-plan-to-review",
      sourcePortId: "planner:out:task",
      targetPortId: "reviewer:in:original_task",
      enabled: true,
    },
    // Reviewer → Coder (corrections feedback)
    {
      id: "w-review-to-code",
      sourcePortId: "reviewer:out:corrections",
      targetPortId: "coder:in:task",
      enabled: true,
    },
    // Reviewer → Planner (verdict feedback)
    {
      id: "w-review-to-plan",
      sourcePortId: "reviewer:out:verdict",
      targetPortId: "planner:in:review_feedback",
      enabled: true,
    },
    // Coder → Planner (execution result for plan updating)
    {
      id: "w-code-to-plan",
      sourcePortId: "coder:out:result",
      targetPortId: "planner:in:execution_result",
      enabled: true,
    },
  ],
  defaults: {
    maxCycles: 25,
    delayMs: 800,
  },
  parameters: [
    {
      name: "provider",
      description: "LLM provider for all loops",
      type: "string",
      required: true,
    },
    {
      name: "tools",
      description: "Tool registry for the Coder and Reviewer",
      type: "string",
      required: true,
    },
    {
      name: "workingDir",
      description: "Working directory for the coding project",
      type: "string",
      required: true,
    },
    {
      name: "promptFile",
      description: "Path to the prompt / instructions file",
      type: "string",
      required: false,
      default: "PROMPT.md",
    },
    {
      name: "planFile",
      description: "Path to the implementation plan file",
      type: "string",
      required: false,
      default: "PLAN.md",
    },
    {
      name: "specsDir",
      description: "Directory containing project specifications",
      type: "string",
      required: false,
      default: "specs",
    },
  ],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

/**
 * Adversarial Duel — Order-2 competitive pipeline.
 *
 * Two execution agents (α and β) compete to solve the SAME task.
 * An Arbiter evaluates both solutions side-by-side and picks a winner.
 * The loser receives targeted feedback; the winner's approach persists.
 *
 * Architecture:
 *
 *              ┌───────────┐
 *     ┌───────▶│  Agent α  │───────┐
 *     │        │(Challenger)│       │
 *  ┌──┴─────┐  └───────────┘  ┌────▼─────┐
 *  │  Arena  │                 │  Arbiter  │
 *  │(Planning)│◀───────────────│  (Judge)  │
 *  └──┬─────┘  ┌───────────┐  └────▲─────┘
 *     │        │  Agent β  │       │
 *     └───────▶│(Challenger)│───────┘
 *              └───────────┘
 *
 * Key insight: Relative comparison creates stronger evolutionary pressure
 * than absolute verification. An agent doesn't just need to be "good enough" —
 * it needs to be BETTER than its rival.
 *
 * Signal flow:
 *   Arena → α: task        Arena → β: same task
 *   α → Arbiter: solution  β → Arbiter: solution
 *   Arbiter → Arena: verdict (winner, rationale, round scores)
 *   Arbiter → α: feedback  Arbiter → β: feedback
 *
 * The Arena tracks cumulative scores across rounds and can adjust the
 * challenge based on how the competition is evolving.
 */
const ADVERSARIAL_DUEL_RECIPE: Recipe = {
  id: "adversarial-duel",
  name: "Adversarial Duel",
  description:
    "Order-2 competitive pipeline: two agents solve the same task independently, an Arbiter compares both solutions and picks the winner. The loser gets feedback. Evolutionary pressure through rivalry.",
  version: "1.0.0",
  author: "Agentic Lab",
  tags: ["adversarial", "competitive", "dual-agent", "tournament"],
  category: "advanced",
  nodes: [
    // ── Arena (Planning) ──────────────────────────────────────
    {
      id: "arena",
      type: "planning",
      name: "Arena",
      category: "planning",
      description:
        "Sets the challenge, distributes tasks to both challengers, tracks scores across rounds, and adjusts difficulty based on competition dynamics.",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          {
            name: "prompt",
            direction: "input" as const,
            signalTypes: ["task", "context"],
            description: "Initial task or user prompt",
            required: false,
          },
          {
            name: "verdict",
            direction: "input" as const,
            signalTypes: ["evaluation", "verdict"],
            description:
              "Arbiter verdict from previous round (winner, scores, rationale)",
            required: false,
          },
        ],
        outputs: [
          {
            name: "challenge_alpha",
            direction: "output" as const,
            signalTypes: ["task", "plan"],
            description: "Task assignment for Agent α",
          },
          {
            name: "challenge_beta",
            direction: "output" as const,
            signalTypes: ["task", "plan"],
            description: "Task assignment for Agent β",
          },
          {
            name: "scoreboard",
            direction: "output" as const,
            signalTypes: ["context"],
            description:
              "Cumulative scoreboard and competition context for the Arbiter",
          },
        ],
      },
    },
    // ── Agent α (Execution — Challenger 1) ────────────────────
    {
      id: "alpha",
      type: "execution",
      name: "Agent α",
      category: "execution",
      description:
        "First challenger. Receives a task and produces a solution. Competes against Agent β for the best result.",
      version: "1.0.0",
      config: { maxIterations: 15, delayMs: 500, concurrent: false },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input" as const,
            signalTypes: ["task", "plan", "corrections"],
            description: "Task from Arena or feedback from Arbiter",
            required: false,
          },
        ],
        outputs: [
          {
            name: "solution",
            direction: "output" as const,
            signalTypes: ["execution_result"],
            description: "Agent α's solution",
          },
          {
            name: "tokens",
            direction: "output" as const,
            signalTypes: ["token_usage"],
            description: "Token usage",
          },
        ],
      },
    },
    // ── Agent β (Execution — Challenger 2) ────────────────────
    {
      id: "beta",
      type: "execution",
      name: "Agent β",
      category: "execution",
      description:
        "Second challenger. Receives the same task and produces a competing solution. Competes against Agent α.",
      version: "1.0.0",
      config: { maxIterations: 15, delayMs: 500, concurrent: false },
      ports: {
        inputs: [
          {
            name: "task",
            direction: "input" as const,
            signalTypes: ["task", "plan", "corrections"],
            description: "Task from Arena or feedback from Arbiter",
            required: false,
          },
        ],
        outputs: [
          {
            name: "solution",
            direction: "output" as const,
            signalTypes: ["execution_result"],
            description: "Agent β's solution",
          },
          {
            name: "tokens",
            direction: "output" as const,
            signalTypes: ["token_usage"],
            description: "Token usage",
          },
        ],
      },
    },
    // ── Arbiter (Evaluation — Judge) ──────────────────────────
    {
      id: "arbiter",
      type: "evaluation",
      name: "Arbiter",
      category: "evaluation",
      description:
        "Impartial judge. Receives both solutions, compares them side-by-side against criteria, picks a winner, and provides specific feedback to both challengers.",
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          {
            name: "solution_alpha",
            direction: "input" as const,
            signalTypes: ["execution_result"],
            description: "Solution from Agent α",
          },
          {
            name: "solution_beta",
            direction: "input" as const,
            signalTypes: ["execution_result"],
            description: "Solution from Agent β",
          },
          {
            name: "scoreboard",
            direction: "input" as const,
            signalTypes: ["context"],
            description: "Cumulative scoreboard context from Arena",
            required: false,
          },
        ],
        outputs: [
          {
            name: "verdict",
            direction: "output" as const,
            signalTypes: ["evaluation", "verdict"],
            description:
              "Comparative verdict: winner, scores (1-10), rationale",
          },
          {
            name: "feedback_alpha",
            direction: "output" as const,
            signalTypes: ["corrections"],
            description:
              "Specific feedback for Agent α (what to improve next round)",
          },
          {
            name: "feedback_beta",
            direction: "output" as const,
            signalTypes: ["corrections"],
            description:
              "Specific feedback for Agent β (what to improve next round)",
          },
          {
            name: "metrics",
            direction: "output" as const,
            signalTypes: ["eval_metrics"],
            description:
              "Round metrics (alpha_score, beta_score, margin, criteria breakdown)",
          },
        ],
      },
    },
  ],
  wires: [
    // Arena → Challengers (task distribution)
    {
      id: "w-arena-to-alpha",
      sourcePortId: "arena:out:challenge_alpha",
      targetPortId: "alpha:in:task",
      enabled: true,
    },
    {
      id: "w-arena-to-beta",
      sourcePortId: "arena:out:challenge_beta",
      targetPortId: "beta:in:task",
      enabled: true,
    },
    // Arena → Arbiter (scoreboard context)
    {
      id: "w-arena-to-arbiter",
      sourcePortId: "arena:out:scoreboard",
      targetPortId: "arbiter:in:scoreboard",
      enabled: true,
    },
    // Challengers → Arbiter (solution submission)
    {
      id: "w-alpha-to-arbiter",
      sourcePortId: "alpha:out:solution",
      targetPortId: "arbiter:in:solution_alpha",
      enabled: true,
    },
    {
      id: "w-beta-to-arbiter",
      sourcePortId: "beta:out:solution",
      targetPortId: "arbiter:in:solution_beta",
      enabled: true,
    },
    // Arbiter → Arena (verdict for next round)
    {
      id: "w-arbiter-to-arena",
      sourcePortId: "arbiter:out:verdict",
      targetPortId: "arena:in:verdict",
      enabled: true,
    },
    // Arbiter → Challengers (individual feedback)
    {
      id: "w-arbiter-to-alpha",
      sourcePortId: "arbiter:out:feedback_alpha",
      targetPortId: "alpha:in:task",
      enabled: true,
    },
    {
      id: "w-arbiter-to-beta",
      sourcePortId: "arbiter:out:feedback_beta",
      targetPortId: "beta:in:task",
      enabled: true,
    },
  ],
  defaults: {
    maxCycles: 10,
    delayMs: 1000,
  },
  parameters: [
    {
      name: "provider",
      description:
        "LLM provider. Both challengers use the same provider (fair competition).",
      type: "string",
      required: true,
    },
    {
      name: "modelAlpha",
      description:
        "Model for Agent α. Can differ from β for cross-model tournaments.",
      type: "string",
      required: false,
    },
    {
      name: "modelBeta",
      description:
        "Model for Agent β. Can differ from α for cross-model tournaments.",
      type: "string",
      required: false,
    },
    {
      name: "tools",
      description: "Tool registry available to both challengers",
      type: "string",
      required: true,
    },
    {
      name: "workingDir",
      description: "Working directory for the competition",
      type: "string",
      required: true,
    },
    {
      name: "rounds",
      description: "Number of competition rounds (default: 3)",
      type: "number",
      required: false,
      default: 3,
    },
    {
      name: "promptFile",
      description: "Path to the prompt / instructions file",
      type: "string",
      required: false,
      default: "PROMPT.md",
    },
    {
      name: "planFile",
      description: "Path to the task specification file",
      type: "string",
      required: false,
      default: "PLAN.md",
    },
  ],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

// -----------------------------------------------------------
// Register built-in recipes
// -----------------------------------------------------------
registerRecipe(RALPH_LOOP_RECIPE);
registerRecipe(FULL_PIPELINE_RECIPE);
registerRecipe(EXEC_EVAL_RECIPE);
registerRecipe(DEEP_REASONING_RECIPE);
registerRecipe(SUPERVISED_CODER_RECIPE);
registerRecipe(ADVERSARIAL_DUEL_RECIPE);

// -----------------------------------------------------------
// Utility: Create recipe from a running pipeline
// -----------------------------------------------------------

/**
 * Serialize a running pipeline into a Recipe.
 * Useful for "save as recipe" functionality in the dashboard.
 */
export function pipelineToRecipe(
  pipeline: PipelineOrchestrator,
  meta: {
    name: string;
    description: string;
    author?: string;
    tags?: string[];
    category?: string;
    parameters?: RecipeParameter[];
  },
): Recipe {
  const graph = pipeline.getGraph();

  const nodes: SerializedNode[] = graph.nodes.map((n) => {
    const node = pipeline.getNode(n.id)!;
    return node.serialize();
  });

  const wires = graph.wires.map((w) => ({
    id: w.id,
    sourcePortId: w.sourcePortId,
    targetPortId: w.targetPortId,
    enabled: w.enabled,
  }));

  const now = new Date().toISOString();

  return {
    id: nanoid(12),
    name: meta.name,
    description: meta.description,
    version: "1.0.0",
    author: meta.author,
    tags: meta.tags || [],
    category: meta.category,
    nodes,
    wires,
    defaults: {},
    parameters: meta.parameters,
    createdAt: now,
    updatedAt: now,
  };
}
