// ============================================
// Composable Loop Engine — Type System
// ============================================
// Defines the primitives for building composable,
// specialized loops that can be connected into
// complex agentic workflows.
//
// Architecture:
//
//   LoopNode  — A single composable loop unit
//   Phase     — A stage within a loop (pre/execute/post hooks)
//   Port      — Input/output connection point on a node
//   Wire      — Connection between two ports
//   Pipeline  — A graph of connected LoopNodes
//   Recipe    — A reusable pipeline template
//
// Each specialized loop (Execution, Evaluation, Planning,
// Critic, Memory) implements the LoopNode interface.
// ============================================

import type { ChatMessage } from "./llm.js";
import type { LoopIteration, PlanItem } from "./loop.js";

// -----------------------------------------------------------
// Core Primitives
// -----------------------------------------------------------

/** Unique identifier for a node in a pipeline */
export type NodeId = string;

/** Unique identifier for a port */
export type PortId = string;

/** Unique identifier for a wire connecting two ports */
export type WireId = string;

/** The signal flowing between nodes */
export interface Signal {
  /** Which node sent this signal */
  sourceNodeId: NodeId;

  /** Signal type — helps receivers filter what they care about */
  type: string;

  /** The actual data payload */
  data: Record<string, unknown>;

  /** When this signal was created */
  timestamp: string;

  /** Optional: trace ID for correlating signals across a pipeline */
  traceId?: string;
}

/** Direction of a port */
export type PortDirection = "input" | "output";

/** A port is an input or output connection point on a LoopNode */
export interface Port {
  id: PortId;
  nodeId: NodeId;
  name: string;
  direction: PortDirection;

  /** What signal types this port accepts/emits */
  signalTypes: string[];

  /** Description of what this port does */
  description?: string;

  /** Whether this port is required for the node to operate */
  required?: boolean;
}

/** Comparison operators for a declarative wire predicate. */
export type WirePredicateOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "truthy"
  | "falsy"
  | "contains";

/** A serializable predicate over a signal's data (dot-path field + operator). */
export interface WirePredicate {
  /** Dot-path into the signal's data (e.g. "decision" or "metrics.score"). */
  field: string;
  /** Comparison operator. */
  op: WirePredicateOp;
  /** Value to compare against (ignored for exists/truthy/falsy). */
  value?: string | number | boolean;
}

/**
 * Declarative, serializable feedback configuration attached to a wire. Compiled
 * into the wire's filter + transform when the pipeline is built. Lets the visual
 * editor express "only route signal X when a condition holds, re-typed as Y, at
 * most N times" without code — the building block of safe feedback loops.
 */
export interface WireFeedback {
  /** Only route signals whose type matches this (default: any). */
  whenSignal?: string;
  /** Predicates on signal.data — ALL must pass for the signal to route (AND). */
  where?: WirePredicate[];
  /** Re-type the routed signal (default: keep the original type). */
  asSignal?: string;
  /** Static fields merged into signal.data before delivery. */
  set?: Record<string, unknown>;
  /** Max times this wire may route a signal — anti-loop guard. */
  maxFires?: number;
}

/** A wire connects an output port to an input port */
export interface Wire {
  id: WireId;
  sourcePortId: PortId;
  targetPortId: PortId;

  /** Optional transform applied to signals as they flow through */
  transform?: (signal: Signal) => Signal | null;

  /** Optional filter — if returns false, signal is dropped */
  filter?: (signal: Signal) => boolean;

  /** Whether the wire is enabled */
  enabled: boolean;

  /**
   * Declarative feedback config (serializable). When present, the orchestrator
   * compiles it into `filter` + `transform`, and keeps it on the wire so the
   * topology round-trips through recipes and persistence.
   */
  feedback?: WireFeedback;
}

// -----------------------------------------------------------
// Loop Node — The composable unit
// -----------------------------------------------------------

/** Status of a LoopNode */
export type NodeStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

/** Category of loop — determines behavior and UI */
export type LoopCategory =
  | "execution" // Fast, cheap, stateless — does work
  | "evaluation" // Verifies real-world changes
  | "planning" // Slow, strategic, changes direction
  | "critic" // Detects stagnation, circularity
  | "memory" // Summarizes, compresses, denoises
  | "refinement" // Iterative convergence gate — decides refine or backtrack
  | "custom"; // User-defined

/** Per-node brain (model) override. Falls back to pipeline/global defaults. */
export interface NodeBrainConfig {
  /** LLM provider name (e.g. "anthropic", "openai", "ollama"). */
  provider?: string;
  /** Model id. */
  model?: string;
  /** Temperature for this node's calls. */
  temperature?: number;
  /** Max tokens per call for this node. */
  maxTokens?: number;
}

/** Per-node tool availability policy (a subset of the global toolkit). */
export interface ToolPolicy {
  /** Allow-list: if set, only these tools are visible to the node. */
  allow?: string[];
  /** Deny-list: these tools are hidden from the node. */
  deny?: string[];
}

/** Configuration for how a node runs */
export interface NodeRunConfig {
  /** Max iterations for this node's internal loop (-1 = unlimited) */
  maxIterations: number;

  /** Delay between internal iterations (ms) */
  delayMs: number;

  /** LLM provider to use */
  provider?: string;

  /** LLM model to use */
  model?: string;

  /** LLM temperature */
  temperature?: number;

  /** Max tokens per LLM call */
  maxTokens?: number;

  /** Frequency: how often should the orchestrator trigger this node */
  frequency?: TriggerFrequency;

  /** Timeout for the entire node execution (ms) */
  timeoutMs?: number;

  /** Whether this node can run concurrently with others */
  concurrent?: boolean;

  /** Tools available to this node (empty = no tools). Legacy alias for `toolPolicy.allow`. */
  enabledTools?: string[];

  /** Per-node brain (model) override. Falls back to pipeline/global defaults. */
  brain?: NodeBrainConfig;

  /** Per-node tool availability policy (subset of the global toolkit). */
  toolPolicy?: ToolPolicy;

  /** Skill names explicitly attached to this node (manual activation). */
  skills?: string[];

  /** Per-node memory policy (read/write scopes + auto-recall). */
  memory?: MemoryPolicy;

  /** Arbitrary extra config */
  metadata?: Record<string, unknown>;
}

/** How often a node is triggered within a pipeline */
export interface TriggerFrequency {
  /** Trigger every N iterations of the parent pipeline */
  everyNIterations?: number;

  /** Trigger on specific signal types */
  onSignals?: string[];

  /** Trigger after a duration (ms) since last run */
  afterMs?: number;

  /** Trigger at most N times total */
  maxTriggers?: number;

  /** Cron-like expression (for long-running pipelines) */
  cron?: string;
}

/**
 * Shared blackboard — a read+write key/value store scoped to a single
 * pipeline run, visible to every node. Lets nodes coordinate beyond typed
 * signals (e.g. a running scratchpad, accumulated facts, shared counters).
 */
export interface SharedStore {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  keys(): string[];
  /** Append a value to an array stored at `key` (creating it if absent). */
  append(key: string, value: unknown): void;
  /** Snapshot of all entries. */
  all(): Record<string, unknown>;
}

/** Per-node memory policy: what to read, where to write, and whether to auto-recall. */
export interface MemoryPolicy {
  /** Auto-inject relevant recalled memories before the node reasons. */
  contextual?: boolean;
  /** Namespaces (scopes) the node may read from. Default: its write scope. */
  readScopes?: string[];
  /** Namespace (scope) the node writes durable memories to. Default: "shared". */
  writeScope?: string;
  /** How many memories to recall. Default: 5. */
  topK?: number;
}

/** A memory returned by a recall. */
export interface RecalledMemory {
  content: string;
  score?: number;
  namespace?: string[];
  key?: string;
}

/**
 * Per-node memory access. Recall is semantic (with a text-search fallback);
 * remember persists a durable fact to the node's write scope. Both are scoped
 * to the node's MemoryPolicy by the orchestrator.
 */
export interface MemoryGateway {
  /** Whether the node should auto-inject recalled context before reasoning. */
  readonly contextual: boolean;
  recall(query: string, opts?: { topK?: number }): Promise<RecalledMemory[]>;
  remember(
    content: string,
    opts?: { key?: string; metadata?: Record<string, unknown> },
  ): Promise<void>;
}

/**
 * Per-node runtime capability bundle, resolved by the orchestrator and
 * injected into the node's context. Exposes the shared blackboard and the
 * memory gateway; future phases add brain/tools/skills resolution here too.
 */
export interface NodeRuntime {
  /** Shared blackboard (read+write) for cross-node coordination. */
  shared: SharedStore;
  /** Contextual + durable memory access, scoped to the node's policy. */
  memory?: MemoryGateway;
}

/** Context provided to a LoopNode during execution */
export interface NodeContext {
  /** The node's ID in the pipeline */
  nodeId: NodeId;

  /** The pipeline's trace ID (for correlation) */
  traceId: string;

  /** Iteration number within this node's internal loop */
  iteration: number;

  /** Working directory */
  workingDir: string;

  /** Signals received from connected input ports */
  inputSignals: Signal[];

  /** Function to emit a signal from an output port */
  emit: (portName: string, type: string, data: Record<string, unknown>) => void;

  /** Function to request a stop of this node */
  requestStop: (reason: string) => void;

  /** Access to shared pipeline state (read-only for most nodes) */
  pipelineState: PipelineState;

  /**
   * Shared blackboard (read+write) for cross-node coordination.
   * Optional for backward compatibility — the orchestrator always provides it.
   */
  shared?: SharedStore;

  /**
   * Resolved per-node runtime capabilities (shared blackboard, and in future
   * phases brain/tools/skills/memory). Optional for backward compatibility.
   */
  runtime?: NodeRuntime;

  /** Logger scoped to this node */
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

/** Result of a single node execution cycle */
export interface NodeResult {
  /** Whether this cycle was successful */
  success: boolean;

  /** Signals produced by this node */
  outputSignals: Signal[];

  /** Token usage for this cycle */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Tool calls made */
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
    durationMs?: number;
  }>;

  /** Duration in ms */
  durationMs: number;

  /** Errors */
  errors: string[];

  /** Arbitrary metadata from the node */
  metadata?: Record<string, unknown>;
}

/**
 * LoopNode — The fundamental composable unit.
 *
 * Every specialized loop (Execution, Evaluation, Planning, etc.)
 * implements this interface. Nodes can be connected via ports
 * to build complex workflows.
 */
export interface LoopNode {
  /** Unique ID for this node instance */
  readonly id: NodeId;

  /** Human-readable name */
  readonly name: string;

  /** Category of this loop */
  readonly category: LoopCategory;

  /** Description of what this node does */
  readonly description: string;

  /** Version (for recipe compatibility) */
  readonly version: string;

  /** Input ports — what signals this node accepts */
  readonly inputPorts: Port[];

  /** Output ports — what signals this node emits */
  readonly outputPorts: Port[];

  /** Current status */
  status: NodeStatus;

  /** Configuration for this node */
  config: NodeRunConfig;

  /**
   * Initialize the node. Called once before first execution.
   * Use for loading resources, connecting to services, etc.
   */
  init(context: NodeContext): Promise<void>;

  /**
   * Execute one cycle of this node.
   * This is the core logic — each node type implements this differently.
   *
   * - ExecutionLoop: picks a task, calls LLM, uses tools
   * - EvaluationLoop: checks real-world signals, validates outputs
   * - PlanningLoop: reviews aggregate state, adjusts strategy
   * - CriticLoop: looks for stagnation, circularity
   * - MemoryLoop: summarizes, compresses, freezes canonical states
   */
  execute(context: NodeContext): Promise<NodeResult>;

  /**
   * Teardown. Called when the node is being removed or the pipeline stops.
   */
  dispose(): Promise<void>;

  /**
   * Serialize this node's configuration for persistence/recipes.
   */
  serialize(): SerializedNode;
}

/** Serialized representation of a node (for storage/recipes) */
export interface SerializedNode {
  id: NodeId;
  type: string; // Registry key — e.g. "execution", "evaluation", "my-custom-loop"
  name: string;
  category: LoopCategory;
  description: string;
  version: string;
  config: NodeRunConfig;
  ports: {
    inputs: Array<Omit<Port, "nodeId" | "id">>;
    outputs: Array<Omit<Port, "nodeId" | "id">>;
  };
  metadata?: Record<string, unknown>;
}

// -----------------------------------------------------------
// Pipeline — A graph of connected nodes
// -----------------------------------------------------------

/** Status of the entire pipeline */
export type PipelineStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

/** Shared state visible to all nodes in a pipeline */
export interface PipelineState {
  /** Pipeline ID */
  pipelineId: string;

  /** Current pipeline status */
  status: PipelineStatus;

  /** Number of full pipeline cycles completed */
  cycle: number;

  /** Aggregated token usage across all nodes */
  totalTokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** When the pipeline started */
  startedAt?: string;

  /** Signals log — last N signals for debugging */
  recentSignals: Signal[];

  /** Per-node status snapshot */
  nodeStatuses: Record<
    NodeId,
    {
      status: NodeStatus;
      lastRunAt?: string;
      totalCycles: number;
      totalErrors: number;
    }
  >;

  /** Arbitrary shared data (nodes can read; only orchestrator writes) */
  shared: Record<string, unknown>;
}

/** Configuration for a pipeline */
export interface PipelineConfig {
  /** Unique identifier */
  id?: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** Working directory for all nodes */
  workingDir: string;

  /** Maximum number of pipeline cycles (0 = unlimited) */
  maxCycles: number;

  /** Delay between pipeline cycles (ms) */
  delayMs: number;

  /** Global timeout (ms) */
  timeoutMs?: number;

  /** How many recent signals to keep in state */
  signalBufferSize?: number;

  /** Tags for categorization */
  tags?: string[];

  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/** Result of a full pipeline run */
export interface PipelineResult {
  /** Pipeline ID */
  pipelineId: string;

  /** Whether the pipeline completed successfully */
  success: boolean;

  /** Total cycles completed */
  totalCycles: number;

  /** Total duration in ms */
  totalDurationMs: number;

  /** Per-node results */
  nodeResults: Record<
    NodeId,
    {
      totalCycles: number;
      totalTokens: number;
      totalToolCalls: number;
      totalErrors: number;
      lastResult?: NodeResult;
    }
  >;

  /** Final pipeline state */
  finalState: PipelineState;

  /** Human-readable summary */
  summary: string;
}

// -----------------------------------------------------------
// Recipe — Reusable pipeline templates
// -----------------------------------------------------------

/** A recipe is a serializable pipeline template */
export interface Recipe {
  /** Unique ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description: string;

  /** Version (semver) */
  version: string;

  /** Author */
  author?: string;

  /** Tags for discovery */
  tags: string[];

  /** Category for organization */
  category?: string;

  /** The nodes in this recipe */
  nodes: SerializedNode[];

  /** The wires connecting nodes */
  wires: Array<
    Omit<Wire, "transform" | "filter"> & {
      /** Named transform (resolved from a registry at runtime) */
      transformName?: string;
      /** Named filter (resolved from a registry at runtime) */
      filterName?: string;
    }
  >;

  /** Default pipeline config */
  defaults: Partial<PipelineConfig>;

  /** Required parameters that must be provided when instantiating */
  parameters?: RecipeParameter[];

  /** When this recipe was created */
  createdAt: string;

  /** When this recipe was last updated */
  updatedAt: string;
}

/** A parameter that must be provided when instantiating a recipe */
export interface RecipeParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string | number }>;
}

// -----------------------------------------------------------
// Registry — Discovery and instantiation
// -----------------------------------------------------------

/** Factory function to create a LoopNode from config */
export type NodeFactory = (
  id: NodeId,
  config: NodeRunConfig,
  metadata?: Record<string, unknown>,
) => LoopNode;

/** Entry in the node type registry */
export interface RegisteredNodeType {
  /** Type key (e.g., "execution", "evaluation") */
  type: string;

  /** Human-readable name */
  name: string;

  /** Category */
  category: LoopCategory;

  /** Description */
  description: string;

  /** Version */
  version: string;

  /** Default port definitions */
  defaultPorts: {
    inputs: Array<Omit<Port, "nodeId" | "id">>;
    outputs: Array<Omit<Port, "nodeId" | "id">>;
  };

  /** Default configuration */
  defaultConfig: Partial<NodeRunConfig>;

  /** Factory function */
  factory: NodeFactory;
}

// -----------------------------------------------------------
// Lifecycle Events
// -----------------------------------------------------------

/** Events emitted by the pipeline orchestrator */
export type PipelineEvent =
  | "pipeline:start"
  | "pipeline:cycle:start"
  | "pipeline:cycle:end"
  | "pipeline:stop"
  | "pipeline:pause"
  | "pipeline:resume"
  | "pipeline:complete"
  | "pipeline:error"
  | "node:start"
  | "node:end"
  | "node:error"
  | "node:skip"
  | "signal:sent"
  | "signal:received"
  | "signal:dropped"
  | "wire:connected"
  | "wire:disconnected";

/** Event payloads */
export interface PipelineEventMap {
  "pipeline:start": { config: PipelineConfig; startedAt: string };
  "pipeline:cycle:start": { cycle: number };
  "pipeline:cycle:end": { cycle: number; durationMs: number };
  "pipeline:stop": { reason: string; state: PipelineState };
  "pipeline:pause": { cycle: number };
  "pipeline:resume": { cycle: number };
  "pipeline:complete": { result: PipelineResult };
  "pipeline:error": { error: Error; cycle: number };
  "node:start": { nodeId: NodeId; cycle: number };
  "node:end": { nodeId: NodeId; cycle: number; result: NodeResult };
  "node:error": { nodeId: NodeId; cycle: number; error: Error };
  "node:skip": { nodeId: NodeId; cycle: number; reason: string };
  "signal:sent": { signal: Signal; portId: PortId };
  "signal:received": { signal: Signal; portId: PortId; nodeId: NodeId };
  "signal:dropped": { signal: Signal; wireId: WireId; reason: string };
  "wire:connected": { wire: Wire };
  "wire:disconnected": { wireId: WireId };
}
