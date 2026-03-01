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
} from "./types/pipeline.js";

export { PipelineOrchestrator } from "./engine/pipeline.js";

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
