// ============================================
// @agentic-lab/core — Meta-Knowledge Module
//
// Self-awareness layer: provides a complete runtime
// description of the Agentic Lab system so any agent
// can reason about its own architecture, capabilities,
// and current state.
// ============================================

import { listRecipes } from "../loops/recipes.js";
import { listNodeTypes } from "../loops/registry.js";
import { getAvailableProviders } from "../providers/factory.js";

// ── Types ───────────────────────────────────────────────

export interface SystemCapability {
  name: string;
  description: string;
  category: "loop" | "provider" | "tool" | "storage" | "recipe" | "engine";
}

export interface SystemMetaKnowledge {
  identity: SystemIdentity;
  architecture: ArchitectureDescription;
  capabilities: SystemCapability[];
  recipes: RecipeMeta[];
  loops: LoopMeta[];
  providers: ProviderMeta[];
  tools: ToolMeta[];
  currentContext?: RuntimeContext;
}

export interface SystemIdentity {
  name: string;
  version: string;
  description: string;
  philosophy: string;
  createdBy: string;
}

export interface ArchitectureDescription {
  overview: string;
  levels: ArchitectureLevel[];
  dataFlow: string;
  keyPrinciples: string[];
}

export interface ArchitectureLevel {
  name: string;
  description: string;
  components: string[];
}

export interface RecipeMeta {
  id: string;
  name: string;
  loops: string[];
  description: string;
  topology: string;
  useCase: string;
}

export interface LoopMeta {
  type: string;
  name: string;
  category: string;
  role: string;
  systemPromptSummary: string;
  frequency: string;
  inputPorts: string[];
  outputPorts: string[];
}

export interface ProviderMeta {
  name: string;
  description: string;
  models: string[];
  features: string[];
}

export interface ToolMeta {
  name: string;
  description: string;
  category: string;
}

export interface RuntimeContext {
  activeProvider?: string;
  activeModel?: string;
  activeRecipe?: string;
  sessionId?: string;
}

// ── Static Knowledge (compiled into the system) ─────────

const SYSTEM_IDENTITY: SystemIdentity = {
  name: "Agentic Lab",
  version: "0.1.0",
  description:
    "A composable multi-loop agentic AI engine. An experimental lab for building, " +
    "testing, and orchestrating autonomous AI agents that use iterative loops of " +
    "planning, execution, evaluation, criticism, memory consolidation, and refinement " +
    "to solve complex tasks with self-correcting behavior.",
  philosophy:
    "Agentic Lab is built on the principle that a single LLM call is insufficient for " +
    "complex tasks. Instead, specialized loops — each with a distinct cognitive role — " +
    "collaborate through a signal-based pipeline. The system is self-correcting: the " +
    "Evaluation loop verifies real-world changes, the Critic loop detects stagnation " +
    "and circular reasoning, and the Refinement loop makes epistemic decisions about " +
    "convergence, refinement, or backtracking. This architecture is inspired by the " +
    "'Ralph Loop' pattern — named after the principle that an agent should never trust " +
    "its own claims without external verification.",
  createdBy: "Developed as an experimental open-source project",
};

const ARCHITECTURE: ArchitectureDescription = {
  overview:
    "Agentic Lab is a TypeScript monorepo with three packages: core (engine), web " +
    "(Next.js dashboard), and cli (command-line interface). The core engine provides " +
    "two levels of abstraction: (1) the AgenticLoop — a single-loop iteration engine " +
    "with plan management and tool execution, and (2) the Composable Pipeline Engine — " +
    "a DAG-based orchestrator where specialized LoopNodes are connected by typed Wires " +
    "that carry Signals. Recipes are serializable templates that define pipeline topologies.",

  levels: [
    {
      name: "Level 1: Ralph Loop (AgenticLoop)",
      description:
        "A monolithic single-loop engine. Each iteration: reads PROMPT.md + PLAN.md, " +
        "constructs messages, calls the LLM, executes tool calls, updates the plan, " +
        "and persists state. Simple but powerful for straightforward tasks.",
      components: [
        "AgenticLoop",
        "PlanManager",
        "PromptBuilder",
        "IterationLogger",
      ],
    },
    {
      name: "Level 2: Composable Pipeline (PipelineOrchestrator)",
      description:
        "A DAG-based graph engine where specialized LoopNodes run in cycles. Each node " +
        "has typed input/output Ports connected by Wires. Signals carry data between nodes. " +
        "Nodes can have different trigger frequencies (every cycle, every N cycles). " +
        "The orchestrator manages concurrent execution, signal buffering, and cycle coordination.",
      components: [
        "PipelineOrchestrator",
        "BaseLoopNode",
        "6 specialized loops",
        "Wire/Signal system",
        "Recipe registry",
      ],
    },
  ],

  dataFlow:
    "User Task → Recipe Selection → Pipeline Instantiation → " +
    "Cycle Loop [Planning → Execution → Evaluation → Critic → Memory → Refinement] → " +
    "Signal routing between nodes → Convergence check → Final output",

  keyPrinciples: [
    "Never trust the executor's claims — always verify with real-world checks (Anti-Ralph principle)",
    "Specialized cognitive roles — each loop has a distinct epistemic function",
    "Self-correction through iterative refinement — converge, refine, or backtrack",
    "Signal-based communication — typed data flows between pipeline nodes",
    "Recipes as templates — serializable topologies that can be instantiated, composed, and shared",
    "Provider agnostic — same engine works with Ollama, OpenAI, Anthropic, OpenRouter",
    "Storage abstraction — PostgreSQL, Redis, Qdrant, or in-memory",
    "Tool-augmented execution — agents can read/write files, run shell commands, search code",
  ],
};

const LOOP_KNOWLEDGE: LoopMeta[] = [
  {
    type: "execution",
    name: "Execution Loop",
    category: "executor",
    role:
      "The workhorse of the system. Picks tasks from the plan, calls the LLM with " +
      "tool access, produces code, content, or actions. Follows plans step by step.",
    systemPromptSummary:
      "Carry out the task. Follow the plan. Show work clearly. Use tools when needed.",
    frequency: "Every cycle",
    inputPorts: ["task", "feedback", "context"],
    outputPorts: ["result"],
  },
  {
    type: "evaluation",
    name: "Evaluation Loop",
    category: "validator",
    role:
      "Verifies execution output against real-world state. Checks correctness, " +
      "completeness, edge cases, code quality. Produces structured PASS/FAIL verdicts. " +
      "NEVER trusts the executor's claims.",
    systemPromptSummary:
      "Verify output. Check correctness, completeness, edge cases. Output PASS/FAIL per criterion.",
    frequency: "Every cycle",
    inputPorts: ["result"],
    outputPorts: ["verdict"],
  },
  {
    type: "planning",
    name: "Planning Loop",
    category: "strategist",
    role:
      "Analyzes the task, creates numbered step-by-step plans, re-prioritizes based " +
      "on feedback. Thinks about dependencies, risks, and optimal ordering.",
    systemPromptSummary:
      "Analyze task. Create structured plan. Think about dependencies and risks. Do NOT execute.",
    frequency: "Every 5 cycles (or on re-plan trigger)",
    inputPorts: ["task", "feedback"],
    outputPorts: ["plan"],
  },
  {
    type: "critic",
    name: "Critic Loop (Anti-Ralph)",
    category: "monitor",
    role:
      "The adversarial watchdog. Detects circular reasoning, repeated mistakes, " +
      "stagnation, scope creep, self-confirmation bias, and cost runaway. " +
      "Named 'Anti-Ralph' because it exists to prevent the agent from fooling itself.",
    systemPromptSummary:
      "Detect stagnation, circularity, self-confirmation. Flag with CRITICAL/HIGH/MEDIUM/LOW severity.",
    frequency: "Every 3 cycles",
    inputPorts: ["result", "verdict"],
    outputPorts: ["findings"],
  },
  {
    type: "memory",
    name: "Memory Loop",
    category: "memory",
    role:
      "Compresses and summarizes accumulated context to prevent token overflow. " +
      "Extracts key decisions, facts, code artifacts, and milestones. Provides " +
      "compressed context to other loops for efficient operation.",
    systemPromptSummary:
      "Compress context. Extract key decisions, facts, artifacts. Output concise summary.",
    frequency: "Every 3 cycles",
    inputPorts: ["result", "context"],
    outputPorts: ["compressed"],
  },
  {
    type: "refinement",
    name: "Refinement Loop (Convergence Gate)",
    category: "gate",
    role:
      "The epistemic decision-maker with a privileged position — it sees BOTH evaluation " +
      "verdicts AND critic analysis. Makes the critical decision: CONVERGE (done), " +
      "REFINE (fix issues), or BACKTRACK (fundamental rethink). This is the loop that " +
      "ensures the system actually improves rather than going in circles.",
    systemPromptSummary:
      "Analyze evaluation + critic feedback. Decide: CONVERGE, REFINE, or BACKTRACK.",
    frequency: "Every cycle (acts as gate)",
    inputPorts: ["verdict", "findings"],
    outputPorts: ["decision", "corrections"],
  },
];

const TOOL_KNOWLEDGE: ToolMeta[] = [
  {
    name: "file-read",
    description: "Read file contents with line range support",
    category: "filesystem",
  },
  {
    name: "file-write",
    description: "Create or overwrite files with content",
    category: "filesystem",
  },
  {
    name: "shell",
    description: "Execute shell commands with timeout and safety restrictions",
    category: "system",
  },
  {
    name: "glob",
    description: "Find files matching glob patterns",
    category: "filesystem",
  },
  {
    name: "grep",
    description: "Search for text patterns in files with regex support",
    category: "search",
  },
  {
    name: "git",
    description: "Git operations: status, diff, log, commit, branch management",
    category: "version-control",
  },
];

const PROVIDER_KNOWLEDGE: ProviderMeta[] = [
  {
    name: "ollama",
    description:
      "Local LLM runner. Runs models on the user's machine. No API key needed. " +
      "Supports streaming. Best for development and privacy-conscious use cases.",
    models: [
      "llama3.1:8b",
      "llama3.1:70b",
      "codellama",
      "mistral",
      "mixtral",
      "deepseek-coder",
      "qwen2.5-coder",
    ],
    features: ["local", "streaming", "no-api-key", "tool-calling"],
  },
  {
    name: "openai",
    description:
      "OpenAI API provider. Supports GPT-4, GPT-4o, etc. Requires OPENAI_API_KEY.",
    models: ["gpt-4", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo", "o1", "o3"],
    features: ["cloud", "streaming", "tool-calling", "high-quality"],
  },
  {
    name: "anthropic",
    description:
      "Anthropic API provider. Supports Claude models. Requires ANTHROPIC_API_KEY.",
    models: [
      "claude-sonnet-4-20250514",
      "claude-3.5-sonnet",
      "claude-3-haiku",
      "claude-3-opus",
    ],
    features: [
      "cloud",
      "streaming",
      "tool-calling",
      "long-context",
      "high-quality",
    ],
  },
  {
    name: "openrouter",
    description:
      "OpenRouter proxy. Routes to 100+ models from various providers through a " +
      "unified API. Requires OPENROUTER_API_KEY.",
    models: ["any model available on openrouter.ai"],
    features: ["cloud", "streaming", "multi-provider", "unified-api"],
  },
];

// ── Dynamic Knowledge (introspected at runtime) ─────────

/**
 * Introspect the current system state to build runtime capability list.
 * This queries the registries to get live data about what's available.
 */
function introspectCapabilities(): SystemCapability[] {
  const capabilities: SystemCapability[] = [];

  // Loops from registry
  const nodeTypes = listNodeTypes();
  for (const nt of nodeTypes) {
    capabilities.push({
      name: nt.type,
      description: `${nt.category} loop — ${nt.type}`,
      category: "loop",
    });
  }

  // Recipes from registry
  const recipes = listRecipes();
  for (const r of recipes) {
    capabilities.push({
      name: r.id,
      description: r.description,
      category: "recipe",
    });
  }

  // Providers
  const providers = getAvailableProviders();
  for (const p of providers) {
    capabilities.push({
      name: p,
      description: `LLM provider: ${p}`,
      category: "provider",
    });
  }

  // Tools (static — they don't have a runtime registry yet)
  for (const t of TOOL_KNOWLEDGE) {
    capabilities.push({
      name: t.name,
      description: t.description,
      category: "tool",
    });
  }

  return capabilities;
}

/**
 * Build complete recipe metadata by introspecting the core registry.
 */
function introspectRecipes(): RecipeMeta[] {
  const recipes = listRecipes();

  const topologyMap: Record<string, string> = {
    "ralph-loop":
      "Single node: Execution runs alone in a loop. Simple and direct.",
    "exec-eval":
      "Linear: Execution → Evaluation. The executor works, then the evaluator verifies.",
    "full-agent-pipeline":
      "Full DAG: Planning → Execution → Evaluation → Critic → Memory. All 5 specialized loops " +
      "with feedback wires: verdict → planning, findings → execution, compressed → all.",
    "deep-reasoning":
      "Iterative refinement: Planning → Execution → Evaluation → Critic → Refinement, " +
      "with backtracking. Runs up to 3 rounds, converging when evaluation pass rate ≥ 70%.",
  };

  const useCaseMap: Record<string, string> = {
    "ralph-loop":
      "Quick single-shot tasks, simple code generation, answers to direct questions.",
    "exec-eval":
      "Tasks that need verification: code with tests, factual accuracy checks.",
    "full-agent-pipeline":
      "Complex multi-step tasks: architecture design, large refactors, research with analysis.",
    "deep-reasoning":
      "Hard problems requiring iterative refinement: mathematical proofs, complex algorithms, " +
      "multi-constraint optimization, thorough analysis with self-correction.",
  };

  return recipes.map((r) => ({
    id: r.id,
    name: r.name,
    loops: r.nodes.map((n) => n.category),
    description: r.description,
    topology: topologyMap[r.id] || "Custom topology",
    useCase: useCaseMap[r.id] || "General-purpose pipeline",
  }));
}

// ── Public API ──────────────────────────────────────────

/**
 * Get the complete meta-knowledge of the Agentic Lab system.
 * This is the main entry point for system self-awareness.
 */
export function getSystemMetaKnowledge(
  runtimeContext?: RuntimeContext,
): SystemMetaKnowledge {
  return {
    identity: SYSTEM_IDENTITY,
    architecture: ARCHITECTURE,
    capabilities: introspectCapabilities(),
    recipes: introspectRecipes(),
    loops: LOOP_KNOWLEDGE,
    providers: PROVIDER_KNOWLEDGE,
    tools: TOOL_KNOWLEDGE,
    currentContext: runtimeContext,
  };
}

/**
 * Generate a natural-language system prompt block that gives an agent
 * full awareness of its own system. This is the key function that injects
 * self-knowledge into any agent's context.
 */
export function buildMetaKnowledgePrompt(
  runtimeContext?: RuntimeContext,
): string {
  const meta = getSystemMetaKnowledge(runtimeContext);

  const recipeSummary = meta.recipes
    .map(
      (r) =>
        `  • ${r.name} (${r.id}): ${r.loops.join(" → ")} — ${r.description}\n` +
        `    Topology: ${r.topology}\n` +
        `    Best for: ${r.useCase}`,
    )
    .join("\n\n");

  const loopSummary = meta.loops
    .map(
      (l) =>
        `  • ${l.name} [${l.type}] (${l.category}): ${l.role}\n` +
        `    Ports: in(${l.inputPorts.join(", ")}) → out(${l.outputPorts.join(", ")})\n` +
        `    Frequency: ${l.frequency}`,
    )
    .join("\n\n");

  const providerSummary = meta.providers
    .map(
      (p) =>
        `  • ${p.name}: ${p.description}\n` +
        `    Models: ${p.models.join(", ")}\n` +
        `    Features: ${p.features.join(", ")}`,
    )
    .join("\n\n");

  const toolSummary = meta.tools
    .map((t) => `  • ${t.name} (${t.category}): ${t.description}`)
    .join("\n");

  const principlesList = meta.architecture.keyPrinciples
    .map((p, i) => `  ${i + 1}. ${p}`)
    .join("\n");

  const levelsSummary = meta.architecture.levels
    .map(
      (l) =>
        `  ${l.name}:\n    ${l.description}\n    Components: ${l.components.join(", ")}`,
    )
    .join("\n\n");

  let contextBlock = "";
  if (runtimeContext) {
    const parts: string[] = [];
    if (runtimeContext.activeProvider)
      parts.push(`Provider: ${runtimeContext.activeProvider}`);
    if (runtimeContext.activeModel)
      parts.push(`Model: ${runtimeContext.activeModel}`);
    if (runtimeContext.activeRecipe)
      parts.push(`Recipe: ${runtimeContext.activeRecipe}`);
    if (runtimeContext.sessionId)
      parts.push(`Session: ${runtimeContext.sessionId}`);
    if (parts.length > 0) {
      contextBlock = `\n\nCURRENT RUNTIME CONTEXT:\n  ${parts.join(" · ")}`;
    }
  }

  return `═══════════════════════════════════════════════
SYSTEM SELF-KNOWLEDGE — AGENTIC LAB
═══════════════════════════════════════════════

You are an AI agent running inside **${meta.identity.name}** (v${meta.identity.version}).

${meta.identity.description}

PHILOSOPHY:
${meta.identity.philosophy}

ARCHITECTURE:
${meta.architecture.overview}

ABSTRACTION LEVELS:
${levelsSummary}

DATA FLOW:
${meta.architecture.dataFlow}

KEY DESIGN PRINCIPLES:
${principlesList}

AVAILABLE RECIPES (Pipeline Templates):
${recipeSummary}

SPECIALIZED LOOPS:
${loopSummary}

LLM PROVIDERS:
${providerSummary}

BUILT-IN TOOLS:
${toolSummary}

PACKAGES:
  • @agentic-lab/core — Engine, loops, providers, tools, storage, types (TypeScript)
  • @agentic-lab/web — Next.js 15 dashboard with chat UI, pipeline visualizer, run history
  • @agentic-lab/cli — Command-line interface for running loops, managing workspaces

STORAGE BACKENDS:
  • PostgreSQL — Run history, iterations, tool calls
  • Redis — Real-time events, pub/sub, caching
  • Qdrant — Vector memory for semantic search
  • In-Memory — Development/testing fallback${contextBlock}

═══════════════════════════════════════════════

You have full knowledge of your own architecture. When asked about yourself, your
capabilities, how you work, or what you can do, answer accurately based on the
information above. You can explain your loop system, recipes, providers, tools,
and design principles. You understand that you are part of a composable multi-loop
engine and can describe how the different loops collaborate.

═══════════════════════════════════════════════`;
}

/**
 * Check if a user message is asking about the system itself.
 * Returns a confidence score (0-1) for meta-questions.
 */
export function detectMetaQuestion(message: string): number {
  const lower = message.toLowerCase();

  // High confidence patterns — direct questions about the system
  const highPatterns = [
    /\b(?:qu[ée]\s+eres|who\s+are\s+you|what\s+are\s+you)\b/,
    /\b(?:c[oó]mo\s+funciona|how\s+(?:do\s+you|does\s+(?:it|this))\s+work)\b/,
    /\b(?:explica|explain)\s+(?:tu|your|the)\s+(?:arquitectura|architecture|sistema|system)\b/,
    /\b(?:qu[ée]\s+puedes\s+hacer|what\s+can\s+you\s+do)\b/,
    /\b(?:cu[aá]les\s+son\s+tus|what\s+are\s+your)\s+(?:capacidades|capabilities)\b/,
    /\b(?:describe|descr[ií]be)\s+(?:yourself|you|tu\s*mismo|el\s+sistema)\b/,
    /\bagentic\s*lab\b/i,
    /\bralph\s*loop\b/i,
    /\b(?:qu[ée]\s+(?:recipes?|recetas?)\s+(?:tienes|hay|existen|available))\b/,
    /\b(?:qu[ée]\s+(?:loops?|bucles?)\s+(?:tienes|hay|existen|available))\b/,
    /\b(?:qu[ée]\s+(?:providers?|proveedores?)\s+(?:tienes|hay|soporta|support))\b/,
    /\b(?:qu[ée]\s+(?:herramientas|tools?)\s+(?:tienes|hay|disponibles|available))\b/,
    /\b(?:cu[aá]l\s+es\s+tu|what\s+is\s+your)\s+(?:dise[ñn]o|design|propósito|purpose)\b/,
    /\b(?:anti[\s-]?ralph)\b/,
    /\b(?:pipeline\s+(?:composable|orchestrat))\b/,
    /\b(?:sobre\s+ti\s+mismo|about\s+yourself)\b/,
    /\b(?:tu\s+(?:motor|engine)|your\s+engine)\b/,
  ];

  // Medium confidence — mentions of system components
  const mediumPatterns = [
    /\b(?:execution|evaluation|planning|critic|memory|refinement)\s+loop\b/,
    /\b(?:recipe|receta|pipeline|signal|wire)\b/,
    /\b(?:node\s+type|loop\s+node|base\s+loop)\b/,
    /\b(?:ollama|openai|anthropic|openrouter)\s+(?:provider|soporte)\b/,
    /\b(?:convergence|backtrack|refine)\b/,
    /\bself[\s-]?(?:correct|aware|knowledge)\b/,
    /\b(?:introspecci[oó]n|introspect)\b/,
  ];

  for (const pattern of highPatterns) {
    if (pattern.test(lower)) return 1.0;
  }

  let mediumHits = 0;
  for (const pattern of mediumPatterns) {
    if (pattern.test(lower)) mediumHits++;
  }

  if (mediumHits >= 2) return 0.8;
  if (mediumHits >= 1) return 0.5;

  return 0;
}

/**
 * Get a concise version of meta-knowledge for token-constrained contexts.
 * Useful when full meta-knowledge prompt would be too large.
 */
export function buildCompactMetaPrompt(
  runtimeContext?: RuntimeContext,
): string {
  const recipes = introspectRecipes();
  const providers = getAvailableProviders();

  let ctx = "";
  if (runtimeContext) {
    const parts: string[] = [];
    if (runtimeContext.activeProvider)
      parts.push(`provider=${runtimeContext.activeProvider}`);
    if (runtimeContext.activeModel)
      parts.push(`model=${runtimeContext.activeModel}`);
    if (runtimeContext.activeRecipe)
      parts.push(`recipe=${runtimeContext.activeRecipe}`);
    if (parts.length > 0) ctx = ` [${parts.join(", ")}]`;
  }

  return (
    `[SYSTEM: You are Agentic Lab v0.1.0 — a composable multi-loop AI engine.${ctx}\n` +
    `Architecture: Specialized loops (execution, evaluation, planning, critic, memory, refinement) ` +
    `connected in pipelines via typed signals. Self-correcting via Anti-Ralph principle.\n` +
    `Recipes: ${recipes.map((r) => `${r.name}(${r.loops.join("→")})`).join(", ")}.\n` +
    `Providers: ${providers.join(", ")}. Tools: file-read, file-write, shell, glob, grep, git.\n` +
    `You can answer questions about your own architecture, loops, recipes, and capabilities.]`
  );
}
