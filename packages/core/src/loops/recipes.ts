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

// -----------------------------------------------------------
// Register built-in recipes
// -----------------------------------------------------------
registerRecipe(RALPH_LOOP_RECIPE);
registerRecipe(FULL_PIPELINE_RECIPE);
registerRecipe(EXEC_EVAL_RECIPE);

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
