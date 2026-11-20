// ============================================
// jig-core: the public API
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
  PlanItem,
  PlanStatus,
  NudgePriority,
} from "./types/loop.js";

export type { AgentTool, ToolContext, ToolRegistry } from "./types/tools.js";

// --- Provider Factory ---
export { createProvider, getAvailableProviders, registerProvider } from "./providers/factory.js";
export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_CALL_TIMEOUT_MS,
  ModelCallTimeoutError,
} from "./providers/call-limits.js";
export { OllamaProvider, DEFAULT_OLLAMA_NUM_CTX, resolveNumCtx } from "./providers/ollama.js";
export { OpenAIProvider } from "./providers/openai.js";
export { AnthropicProvider } from "./providers/anthropic.js";

// --- The plan file and the run history on disk ---
export { PlanManager } from "./engine/plan-manager.js";
export { IterationLogger } from "./engine/iteration-logger.js";

// --- Built-in Tools ---
export { FileReadTool } from "./tools/file-read.js";
export { FileWriteTool } from "./tools/file-write.js";
export { ShellTool, type ShellAnswer, type ShellApproval, type ShellApprover } from "./tools/shell.js";
export { registerSecret, redact } from "./providers/secrets.js";
export { environmentBlock, withEnvironment } from "./engine/environment.js";
export { coreVersion } from "./version.js";
export { decide, parseRule, shellMatches, pathMatches, prefixOf, mergeRules, PERMISSION_MODES, type PermissionMode, type PermissionRules, type PermissionSettings, type SessionGrants, type Action as PermissionAction, type Decision as PermissionDecision } from "./permissions/permissions.js";
export { guardTools, type PermissionContext, type PermissionQuestion, type PermissionAnswer, type PermissionRecord } from "./permissions/guard.js";
export { unescapeLiteralNewlines } from "./tools/file-write.js";
export { outcomeLabel } from "./types/pipeline.js";
export { snapshot as workspaceSnapshot, changes as workspaceChanges, type WorkspaceChange } from "./engine/workspace-diff.js";
export {
  ENTRY_KINDS,
  PRESETS,
  KIND_DEFAULTS,
  KEYCHAIN_SERVICE,
  entriesOf,
  resolveKey,
  needsKey,
  entryProvider,
  listEntryModels,
  testEntry,
  keychain,
  splitCommand,
  type EntryKind,
  type ProviderEntry,
  type ResolvedKey,
} from "./providers/entries.js";
export { discoverLocal, discoverySummary, ollamaPort, serverKey, LOCAL_SERVERS, DISCOVERY_HOST, type Discovered, type DiscoverOptions, type LocalServer } from "./providers/discovery.js";
export { answersRoles, buildCatalog, brainsFromCatalog, fromTable, ollamaShow, openRouterModels, parseParams, KNOWN_FAMILIES, RANKING_RULE, type ModelInfo, type CatalogSource } from "./providers/catalog.js";
export {
  chainOf,
  chainProvider,
  defaultBrains,
  isModelRef,
  unavailability,
  UnavailableModel,
  type Brains,
  type ChainProvider,
  type Fallback,
  type Route,
  type Unavailability,
} from "./providers/brains.js";
export { unlistedPrograms, DEFAULT_SHELL_COMMANDS } from "./tools/shell-policy.js";
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
  type StepStore,
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

// --- The composable engine: roles wired into a topology ---
export type {
  // Primitives
  NodeId,
  PortId,
  WireId,
  Signal,
  Provenance,
  RunInput,
  RunView,
  Port,
  PortDirection,
  Wire,
  WireFeedback,
  WirePredicate,
  WirePredicateOp,
  // Node
  RoleEngine,
  RoleCategory,
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
  RunOutcome,
  PortOverrides,
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

export {
  PipelineOrchestrator,
  DEFAULT_NODE_TIMEOUT_MS,
  DEFAULT_RUN_INPUTS,
  runViewFor,
  type PipelineOptions,
  type RunOrder,
} from "./engine/pipeline.js";
export { createMemoryGateway } from "./engine/memory-gateway.js";
export { taskKey, scopePrefix, type MemoryScope } from "./engine/memory-scope.js";

// --- Tasks and the lab's measured checks ---
export type {
  TaskCheck,
  CheckFile,
  CheckRunner,
  MeasuredCheckResult,
  MeasuredCheckRun,
} from "./tasks/types.js";
export { MeasuredChecker, type MeasuredCheckerOptions } from "./tasks/checker.js";
export {
  loadTaskFile,
  parseTask,
  parseChecks,
  taskCheckSchema,
  taskFileSchema,
  type TaskFile,
} from "./tasks/load.js";

// --- Step records: what each role saw and did, and replay ---
export type {
  StepRecord,
  StepInput,
  StepOutput,
  RecordedCall,
  RecordedField,
} from "./types/step.js";
export { recordingProvider, replayProviders, type RoleRef, type CallSink } from "./engine/recorder.js";
export { eventsFromSteps, type TimedEvent, type RecordedRun } from "./engine/replay-events.js";
export { playProvider, playRoleOf, type PlayOptions, type PlayRole } from "./engine/play.js";

// --- What each role sees, measured with marks ---
export {
  measureSight,
  renderSight,
  SIGHT_ROWS,
  type SightMatrix,
  type SightRow,
  type SightRole,
  type SightCell,
} from "./engine/sight.js";

// --- Definition files: the formats module (JSON and YAML; Agent Spec with the lab's extension, legacy recipes) ---
export {
  readTopologyText,
  readTopologyFile,
  validateTopologyText,
  writeTopologyText,
  writeTopologyFile,
  convertTopologyText,
  registerDialect,
  listDialects,
  getDialect,
  describeIssue,
  FormatError,
  asTopology,
  deriveDrawing,
  checkTopology,
  ignoredElsewhere,
  AGENTSPEC_VERSION,
  EXTENSION_PROFILE,
  IMPORT_ROUND_LIMIT,
  DEFAULT_FACES,
  FULL_SIGHT,
  CONSULT_SIGHTS,
  deciderOf,
  type Topology,
  type RoleFace,
  type WayBack,
  type AlsoEdge,
  type ConsultEdge,
  type ConsultedRole,
  type ConsultSight,
  type Exit,
  type FormatIssue,
  type Loss,
  type DialectPlugin,
  type SyntaxId,
  type ReadResult,
  type ValidateResult,
  type ConvertResult,
} from "./formats/index.js";
export { BUILT_IN_TOPOLOGIES, builtinFile, loadBuiltinTopologies } from "./formats/builtin.js";

// --- The viewer's layout engine: one grid for the web and the terminal ---
export * as grid from "./grid/index.js";
export {
  drawingOf,
  horizontal,
  vertical,
  strip,
  draw,
  layoutFor,
  horizontalWidth,
  toText,
  toANSI,
  initialRunState,
  reduceRun,
  foldRun,
  SPINNER,
  screen,
  rail,
  logPanel,
  logText,
  footer,
  drawingBlock,
  logLines,
  firstLine,
  shortTokens,
  elapsed,
  Grid,
  len,
  charWidth,
  padCells,
  fit,
  type Cell,
  type Drawing,
  type RunState,
  type LayoutName,
  type Meaning,
  type Screen,
  type ScreenOptions,
} from "./grid/index.js";

// --- Provenance: given, measured or written, for every signal field ---
export {
  registerSignalFields,
  signalFields,
  declaredSignalTypes,
  provenanceOf,
  provenanceOfSignal,
  describeFields,
  undeclaredFields,
  weakest,
  type FieldSpec,
  type VaryingField,
  type ShapedField,
} from "./engine/provenance.js";

// --- Declarative role engines + feedback rules (Phase 4) ---
export {
  ConfigurableEngine,
  type EngineBlueprint,
  type ConfigurableEngineConfig,
} from "./roles/configurable-engine.js";
export { registerBlueprint } from "./roles/blueprint.js";
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

// --- A topology run: one task through a topology, with its event stream ---
export {
  TopologyRun,
  type TopologyRunConfig,
  type RunResult,
  type RunRequest,
  type RunEvent,
  type RoleInfo,
  type RoleToolCall,
  type SteeringNote,
} from "./engine/topology-run.js";
// The names before jig-core 0.1.6, kept until 0.2.0.
export {
  /** @deprecated Renamed TopologyRun in jig-core 0.1.6; this name goes in 0.2.0. */
  TopologyRun as AgentSession,
  /** @deprecated Renamed TopologyRunConfig in jig-core 0.1.6; this name goes in 0.2.0. */
  type TopologyRunConfig as AgentSessionConfig,
  /** @deprecated Renamed RunResult in jig-core 0.1.6; this name goes in 0.2.0. */
  type RunResult as AgentRunResult,
  /** @deprecated Renamed RunEvent in jig-core 0.1.6; this name goes in 0.2.0. */
  type RunEvent as SessionEvent,
} from "./engine/topology-run.js";
export {
  registerRun,
  unregisterRun,
  getRun,
  listRunIds,
  steerRun,
  stopRun,
} from "./engine/run-registry.js";

// --- The tools each kind of role gets by default ---
export { READ_ONLY_TOOLS, NO_TOOLS, WRITE_TOOLS } from "./roles/tool-policies.js";

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
  BaseRoleEngine,
  // A role's engine, one per category
  ExecutionEngine,
  EvaluationEngine,
  PlanningEngine,
  CriticEngine,
  MemoryEngine,
  RefinementEngine,
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
} from "./roles/index.js";

export type {
  ExecutionEngineConfig,
  EvaluationEngineConfig,
  EvaluationCheck,
  EvaluationVerdict,
  PlanningEngineConfig,
  StrategyDecision,
  CriticEngineConfig,
  InterventionType,
  MemoryEngineConfig,
  RefinementEngineConfig,
  RefinementAction,
  RefinementDecision,
} from "./roles/index.js";

// The names before jig-core 0.1.7, kept until 0.2.0: a role's engine was called a loop.
export {
  /** @deprecated Renamed ExecutionEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  ExecutionEngine as ExecutionLoop,
  /** @deprecated Renamed EvaluationEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  EvaluationEngine as EvaluationLoop,
  /** @deprecated Renamed PlanningEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  PlanningEngine as PlanningLoop,
  /** @deprecated Renamed CriticEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  CriticEngine as CriticLoop,
  /** @deprecated Renamed MemoryEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  MemoryEngine as MemoryLoop,
  /** @deprecated Renamed RefinementEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  RefinementEngine as RefinementLoop,
  /** @deprecated Renamed BaseRoleEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  BaseRoleEngine as BaseLoopNode,
  /** @deprecated Renamed ExecutionEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type ExecutionEngineConfig as ExecutionLoopConfig,
  /** @deprecated Renamed EvaluationEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type EvaluationEngineConfig as EvaluationLoopConfig,
  /** @deprecated Renamed PlanningEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type PlanningEngineConfig as PlanningLoopConfig,
  /** @deprecated Renamed CriticEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type CriticEngineConfig as CriticLoopConfig,
  /** @deprecated Renamed MemoryEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type MemoryEngineConfig as MemoryLoopConfig,
  /** @deprecated Renamed RefinementEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type RefinementEngineConfig as RefinementLoopConfig,
} from "./roles/index.js";
export {
  /** @deprecated Renamed ConfigurableEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  ConfigurableEngine as ConfigurableLoop,
  /** @deprecated Renamed EngineBlueprint in jig-core 0.1.7; this name goes in 0.2.0. */
  type EngineBlueprint as LoopBlueprint,
  /** @deprecated Renamed ConfigurableEngineConfig in jig-core 0.1.7; this name goes in 0.2.0. */
  type ConfigurableEngineConfig as ConfigurableLoopConfig,
} from "./roles/configurable-engine.js";
export {
  /** @deprecated Renamed RoleEngine in jig-core 0.1.7; this name goes in 0.2.0. */
  type RoleEngine as LoopNode,
  /** @deprecated Renamed RoleCategory in jig-core 0.1.7; this name goes in 0.2.0. */
  type RoleCategory as LoopCategory,
} from "./types/pipeline.js";
export {
  /** @deprecated Renamed EngineMeta in jig-core 0.1.7; this name goes in 0.2.0. */
  type EngineMeta as LoopMeta,
} from "./meta/index.js";

// --- Config ---
export { loadConfig } from "./config/loader.js";
export type { JigConfig } from "./config/loader.js";
export {
  PROJECT_DIR,
  LEGACY_PROJECT_DIR,
  PROJECT_CONFIG,
  LEGACY_PROJECT_CONFIG,
  projectPath,
  readablePaths,
  existingProjectPath,
  ensureProjectDir,
  ensureProjectDirSync,
  listProjectEntries,
  userConfigDir,
  userConfigFile,
} from "./config/places.js";

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
  type EngineMeta,
  type ProviderMeta,
  type ToolMeta,
  type RuntimeContext,
} from "./meta/index.js";
