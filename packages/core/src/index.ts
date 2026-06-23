// ============================================
// @agentic-lab/core — Public API
// ============================================

// --- Types ---
export type {
  LLMProvider,
  LLMProviderConfig,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ToolDefinition,
  ToolParameter,
  ToolResult,
  ToolCall,
} from "./types/llm.js";

export type {
  LoopConfig,
  LoopState,
  LoopIteration,
  LoopResult,
  LoopStatus,
  LoopEvent,
  LoopEventMap,
  PlanItem,
  PlanStatus,
  SteeringNudge,
  NudgePriority,
} from "./types/loop.js";

export type { AgentTool, ToolContext, ToolRegistry } from "./types/tools.js";

// --- Provider Factory ---
export { createProvider, getAvailableProviders } from "./providers/factory.js";
export { OllamaProvider } from "./providers/ollama.js";
export { OpenAIProvider } from "./providers/openai.js";
export { AnthropicProvider } from "./providers/anthropic.js";

// --- Loop Engine ---
export { AgenticLoop } from "./engine/loop.js";
export { PlanManager } from "./engine/plan-manager.js";
export { PromptBuilder } from "./engine/prompt-builder.js";
export { IterationLogger } from "./engine/iteration-logger.js";

// --- Built-in Tools ---
export { FileReadTool } from "./tools/file-read.js";
export { FileWriteTool } from "./tools/file-write.js";
export { ShellTool } from "./tools/shell.js";
export { GlobTool } from "./tools/glob.js";
export { GrepTool } from "./tools/grep.js";
export { GitTool } from "./tools/git.js";
export { createDefaultToolkit } from "./tools/defaults.js";

// --- Storage ---
export {
  // Types
  type Storage,
  type RunStore,
  type CheckpointStore,
  type MemoryStore,
  type EventStore,
  type UsageStore,
  type StoredRun,
  type StoredIteration,
  type StoredToolCall,
  type RunFilter,
  type Checkpoint,
  type MemoryItem,
  type StoredEvent,
  type UsageRecord,
  type DailyStats,
  // Implementations
  PostgresStorage,
  type PostgresStorageConfig,
  InMemoryStorage,
  RedisEventBus,
  RedisEventStore,
  type RedisConfig,
  VectorMemoryStore,
  createOpenAIEmbedding,
  createOllamaEmbedding,
  type QdrantConfig,
  type EmbeddingFunction,
  // Factory
  createStorage,
  createStorageWithRedis,
  type StorageConfig,
} from "./storage/index.js";

// --- Composable Loop Engine ---
export type {
  // Primitives
  NodeId,
  PortId,
  WireId,
  Signal,
  Port,
  PortDirection,
  Wire,
  WireFeedback,
  WirePredicate,
  WirePredicateOp,
  // Node
  LoopNode,
  LoopCategory,
  NodeStatus,
  NodeRunConfig,
  NodeContext,
  NodeResult,
  TriggerFrequency,
  SerializedNode,
  // Pipeline
  PipelineConfig,
  PipelineState,
  PipelineStatus,
  PipelineResult,
  PipelineEvent,
  PipelineEventMap,
  // Recipe
  Recipe,
  RecipeParameter,
  // Registry
  NodeFactory,
  RegisteredNodeType,
  // Capabilities (Phase 1)
  NodeBrainConfig,
  ToolPolicy,
  SharedStore,
  NodeRuntime,
  // Memory (Phase 3)
  MemoryPolicy,
  MemoryGateway,
  RecalledMemory,
} from "./types/pipeline.js";

export { PipelineOrchestrator, type PipelineOptions } from "./engine/pipeline.js";
export { createMemoryGateway } from "./engine/memory-gateway.js";

// --- Declarative loop authoring + feedback rules (Phase 4) ---
export {
  ConfigurableLoop,
  type LoopBlueprint,
  type ConfigurableLoopConfig,
} from "./loops/configurable-loop.js";
export { registerBlueprint } from "./loops/blueprint.js";
export {
  applyFeedbackRules,
  type FeedbackRuleDef,
} from "./engine/feedback-rules.js";
export {
  compileWireFeedback,
  evaluatePredicate,
  getByPath,
  type CompiledWireFeedback,
} from "./engine/wire-feedback.js";

// --- Agent Session (Phase 5): task-driven runner + auto skill activation ---
export {
  AgentSession,
  type AgentSessionConfig,
  type AgentRunResult,
} from "./engine/agent-session.js";

// --- Capability Resolution (per-node brain + tools + shared blackboard) ---
export {
  scopeToolRegistry,
  toolPolicyFromConfig,
  resolveBrain,
  isToolRegistry,
  InMemorySharedStore,
  type ProviderFactory,
} from "./engine/capability-resolver.js";

// --- Skills (packaged reusable capabilities) ---
export {
  SkillRegistry,
  skillFromMarkdown,
  parseFrontmatter,
  loadSkillsFromDir,
  loadSkillResource,
  resolveActiveSkills,
  selectStaticSkills,
  cosineSimilarity,
  heuristicSharedTerms,
  composeSkills,
  appendSkillPrompt,
  type Skill,
  type ActiveSkill,
  type SkillActivation,
  type SkillResource,
  type SkillParameter,
  type ActivationContext,
  type ActivateOptions,
  type ComposedSkills,
  type ParsedFrontmatter,
  type LoadSkillsResult,
} from "./skills/index.js";

export {
  // Base
  BaseLoopNode,
  // Loops
  ExecutionLoop,
  EvaluationLoop,
  PlanningLoop,
  CriticLoop,
  MemoryLoop,
  RefinementLoop,
  // Registry
  registerNodeType,
  getNodeType,
  listNodeTypes,
  createNode,
  // Recipes
  registerRecipe,
  getRecipe,
  listRecipes,
  instantiateRecipe,
  instantiateRecipeFromDefinition,
  pipelineToRecipe,
} from "./loops/index.js";

export type {
  ExecutionLoopConfig,
  EvaluationLoopConfig,
  EvaluationCheck,
  EvaluationVerdict,
  PlanningLoopConfig,
  StrategyDecision,
  CriticLoopConfig,
  InterventionType,
  MemoryLoopConfig,
  RefinementLoopConfig,
  RefinementAction,
  RefinementDecision,
} from "./loops/index.js";

// --- Config ---
export { loadConfig } from "./config/loader.js";
export type { AgenticLabConfig } from "./config/loader.js";

// --- Logger ---
export { createLogger, type Logger } from "./utils/logger.js";

// --- Utils: structured output + context window ---
export {
  parseStructured,
  extractJSON,
  safeJSONParse,
  jsonFormatInstruction,
  type StructuredParseResult,
  type ParseStructuredOptions,
} from "./utils/structured.js";
export {
  pruneMessages,
  estimateChars,
  type PruneOptions,
} from "./utils/context-window.js";
export {
  withRetry,
  isRetryableError,
  isAbortError,
  type RetryOptions,
} from "./utils/retry.js";

// --- Meta-Knowledge (System Self-Awareness) ---
export {
  getSystemMetaKnowledge,
  buildMetaKnowledgePrompt,
  buildCompactMetaPrompt,
  detectMetaQuestion,
  type SystemMetaKnowledge,
  type SystemCapability,
  type SystemIdentity,
  type ArchitectureDescription,
  type RecipeMeta,
  type LoopMeta,
  type ProviderMeta,
  type ToolMeta,
  type RuntimeContext,
} from "./meta/index.js";
