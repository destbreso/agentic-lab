// ============================================
// Storage Types — Interfaces for persistence
// ============================================
// Abstract storage layer inspired by LangGraph's
// checkpointer + memory store pattern.
// Implementations: PostgreSQL, Redis, File (fallback), In-Memory

import type { LoopIteration, LoopResult, LoopState, PlanItem } from "./loop.js";
import type { ChatMessage } from "./llm.js";

// -----------------------------------------------------------
// Run Store — Persistent run history
// -----------------------------------------------------------

/** Stored run record */
export interface StoredRun {
  id: string;
  externalId: string;
  name?: string;
  status: string;
  provider: string;
  model: string;
  maxIterations: number;
  workingDir: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  config: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Stored iteration record */
export interface StoredIteration {
  id: string;
  runId: string;
  number: number;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  responseText?: string;
  planItemId?: string;
  planItemTitle?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  errors: string[];
  commitSha?: string;
}

/** Stored tool call record */
export interface StoredToolCall {
  id: string;
  iterationId: string;
  runId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError: boolean;
  durationMs?: number;
  calledAt: string;
}

/** Filter options for querying runs */
export interface RunFilter {
  status?: string;
  provider?: string;
  model?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "started_at" | "duration_ms" | "total_tokens";
  orderDir?: "asc" | "desc";
}

/** Run store interface */
export interface RunStore {
  /** Save a new run */
  createRun(run: Omit<StoredRun, "id" | "createdAt" | "updatedAt">): Promise<StoredRun>;

  /** Update an existing run */
  updateRun(externalId: string, updates: Partial<StoredRun>): Promise<StoredRun | null>;

  /** Get a run by its external ID (nanoid) */
  getRun(externalId: string): Promise<StoredRun | null>;

  /** List runs with optional filters */
  listRuns(filter?: RunFilter): Promise<{ runs: StoredRun[]; total: number }>;

  /** Delete a run and all associated data */
  deleteRun(externalId: string): Promise<boolean>;

  /** Save an iteration */
  saveIteration(iteration: StoredIteration): Promise<StoredIteration>;

  /** Get iterations for a run */
  getIterations(runId: string): Promise<StoredIteration[]>;

  /** Save a tool call */
  saveToolCall(toolCall: Omit<StoredToolCall, "id">): Promise<StoredToolCall>;

  /** Get tool calls for an iteration */
  getToolCalls(iterationId: string): Promise<StoredToolCall[]>;

  /** Get aggregated tool usage stats */
  getToolStats(): Promise<Array<{ name: string; count: number; avgDurationMs: number; errorCount: number }>>;
}

// -----------------------------------------------------------
// Checkpoint Store — State snapshots for time-travel
// -----------------------------------------------------------

/** A checkpoint captures the full state at a specific iteration */
export interface Checkpoint {
  id: string;
  runId: string;
  iteration: number;
  state: LoopState;
  messages: ChatMessage[];
  plan: PlanItem[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Checkpoint store interface */
export interface CheckpointStore {
  /** Save a checkpoint */
  save(checkpoint: Omit<Checkpoint, "id" | "createdAt">): Promise<Checkpoint>;

  /** Get the latest checkpoint for a run */
  getLatest(runId: string): Promise<Checkpoint | null>;

  /** Get a specific checkpoint */
  get(runId: string, iteration: number): Promise<Checkpoint | null>;

  /** List all checkpoints for a run */
  list(runId: string): Promise<Checkpoint[]>;

  /** Delete checkpoints for a run */
  delete(runId: string): Promise<void>;
}

// -----------------------------------------------------------
// Memory Store — Cross-run semantic memory
// -----------------------------------------------------------

/** A memory item (namespaced key-value with optional embeddings) */
export interface MemoryItem {
  id: string;
  namespace: string[];
  key: string;
  value: Record<string, unknown>;
  qdrantPointId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Memory store interface */
export interface MemoryStore {
  /** Store a memory */
  put(namespace: string[], key: string, value: Record<string, unknown>): Promise<MemoryItem>;

  /** Get a specific memory */
  get(namespace: string[], key: string): Promise<MemoryItem | null>;

  /** Search memories in a namespace */
  search(namespace: string[], options?: { limit?: number }): Promise<MemoryItem[]>;

  /** Semantic search (requires vector store) */
  semanticSearch(namespace: string[], query: string, options?: { limit?: number }): Promise<MemoryItem[]>;

  /** Delete a memory */
  delete(namespace: string[], key: string): Promise<boolean>;

  /** Delete all memories in a namespace */
  deleteNamespace(namespace: string[]): Promise<void>;
}

// -----------------------------------------------------------
// Event Store — Event timeline for replay / streaming
// -----------------------------------------------------------

/** A stored event */
export interface StoredEvent {
  id: number;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Event store interface */
export interface EventStore {
  /** Emit an event */
  emit(runId: string, eventType: string, payload: Record<string, unknown>): Promise<StoredEvent>;

  /** Get events for a run */
  getEvents(runId: string, options?: { eventType?: string; limit?: number; after?: number }): Promise<StoredEvent[]>;

  /** Subscribe to live events (returns unsubscribe function) */
  subscribe(
    runId: string,
    callback: (event: StoredEvent) => void,
    options?: { eventTypes?: string[] },
  ): () => void;
}

// -----------------------------------------------------------
// Provider Usage Store — Metrics & cost tracking
// -----------------------------------------------------------

/** Provider usage record */
export interface UsageRecord {
  id: string;
  runId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  latencyMs?: number;
  recordedAt: string;
}

/** Daily stats */
export interface DailyStats {
  day: string;
  runs: number;
  tokens: number;
  avgDurationMs: number;
  successfulRuns: number;
}

/** Provider usage store */
export interface UsageStore {
  /** Record usage */
  record(usage: Omit<UsageRecord, "id" | "recordedAt">): Promise<UsageRecord>;

  /** Get usage by provider */
  getByProvider(provider: string, options?: { days?: number }): Promise<UsageRecord[]>;

  /** Get daily stats */
  getDailyStats(days?: number): Promise<DailyStats[]>;

  /** Get total cost for a period */
  getTotalCost(options?: { days?: number; provider?: string }): Promise<number>;
}

// -----------------------------------------------------------
// Unified Storage — Combines all stores
// -----------------------------------------------------------

/** Complete storage interface */
export interface Storage {
  runs: RunStore;
  checkpoints: CheckpointStore;
  memory: MemoryStore;
  events: EventStore;
  usage: UsageStore;

  /** Initialize connections / tables */
  init(): Promise<void>;

  /** Close all connections */
  close(): Promise<void>;

  /** Health check */
  healthy(): Promise<boolean>;
}
