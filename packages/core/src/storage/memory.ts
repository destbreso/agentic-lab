// ============================================
// In-Memory Storage — Fallback / Testing
// ============================================
// Full Storage implementation that works without
// any external services. Useful for testing and
// quick experiments where persistence isn't needed.

import { nanoid } from "nanoid";
import type {
  Storage,
  RunStore,
  CheckpointStore,
  MemoryStore,
  EventStore,
  UsageStore,
  ChatStore,
  StoredRun,
  StoredIteration,
  StoredToolCall,
  RunFilter,
  Checkpoint,
  MemoryItem,
  StoredEvent,
  UsageRecord,
  DailyStats,
  ChatSession,
  ChatMessageRecord,
} from "../types/storage.js";

// -----------------------------------------------------------
// In-Memory Run Store
// -----------------------------------------------------------
class InMemoryRunStore implements RunStore {
  private runs: Map<string, StoredRun> = new Map();
  private iterations: Map<string, StoredIteration[]> = new Map();
  private toolCalls: Map<string, StoredToolCall[]> = new Map();

  async createRun(
    run: Omit<StoredRun, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoredRun> {
    const now = new Date().toISOString();
    const stored: StoredRun = {
      ...run,
      id: nanoid(),
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.externalId, stored);
    return stored;
  }

  async updateRun(
    externalId: string,
    updates: Partial<StoredRun>,
  ): Promise<StoredRun | null> {
    const existing = this.runs.get(externalId);
    if (!existing) return null;
    const updated: StoredRun = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(externalId, updated);
    return updated;
  }

  async getRun(externalId: string): Promise<StoredRun | null> {
    return this.runs.get(externalId) || null;
  }

  async listRuns(
    filter?: RunFilter,
  ): Promise<{ runs: StoredRun[]; total: number }> {
    let results = Array.from(this.runs.values());

    if (filter?.status)
      results = results.filter((r) => r.status === filter.status);
    if (filter?.provider)
      results = results.filter((r) => r.provider === filter.provider);
    if (filter?.tags?.length) {
      results = results.filter((r) =>
        filter.tags!.some((t) => r.tags.includes(t)),
      );
    }

    // Sort
    const orderBy = filter?.orderBy || "created_at";
    const dir = filter?.orderDir === "asc" ? 1 : -1;
    const fieldMap: Record<string, keyof StoredRun> = {
      created_at: "createdAt",
      started_at: "startedAt",
      duration_ms: "durationMs",
      total_tokens: "totalTokens",
    };
    const sortField = fieldMap[orderBy] || "createdAt";
    results.sort((a, b) => {
      const aVal = a[sortField] as string | number | undefined;
      const bVal = b[sortField] as string | number | undefined;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;
      return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
    });

    const total = results.length;
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 50;
    results = results.slice(offset, offset + limit);

    return { runs: results, total };
  }

  async deleteRun(externalId: string): Promise<boolean> {
    return this.runs.delete(externalId);
  }

  async saveIteration(iteration: StoredIteration): Promise<StoredIteration> {
    const stored: StoredIteration = {
      ...iteration,
      id: iteration.id || nanoid(),
    };
    const list = this.iterations.get(iteration.runId) || [];
    const idx = list.findIndex((i) => i.number === iteration.number);
    if (idx >= 0) list[idx] = stored;
    else list.push(stored);
    this.iterations.set(iteration.runId, list);
    return stored;
  }

  async getIterations(runId: string): Promise<StoredIteration[]> {
    return (this.iterations.get(runId) || []).sort(
      (a, b) => a.number - b.number,
    );
  }

  async saveToolCall(
    toolCall: Omit<StoredToolCall, "id">,
  ): Promise<StoredToolCall> {
    const stored: StoredToolCall = { ...toolCall, id: nanoid() };
    const list = this.toolCalls.get(toolCall.iterationId) || [];
    list.push(stored);
    this.toolCalls.set(toolCall.iterationId, list);
    return stored;
  }

  async getToolCalls(iterationId: string): Promise<StoredToolCall[]> {
    return this.toolCalls.get(iterationId) || [];
  }

  async getToolStats(): Promise<
    Array<{
      name: string;
      count: number;
      avgDurationMs: number;
      errorCount: number;
    }>
  > {
    const stats = new Map<
      string,
      { count: number; totalDuration: number; errors: number }
    >();
    for (const calls of this.toolCalls.values()) {
      for (const tc of calls) {
        const s = stats.get(tc.name) || {
          count: 0,
          totalDuration: 0,
          errors: 0,
        };
        s.count++;
        s.totalDuration += tc.durationMs || 0;
        if (tc.isError) s.errors++;
        stats.set(tc.name, s);
      }
    }
    return Array.from(stats.entries())
      .map(([name, s]) => ({
        name,
        count: s.count,
        avgDurationMs: s.count > 0 ? Math.round(s.totalDuration / s.count) : 0,
        errorCount: s.errors,
      }))
      .sort((a, b) => b.count - a.count);
  }
}

// -----------------------------------------------------------
// In-Memory Checkpoint Store
// -----------------------------------------------------------
class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints: Map<string, Checkpoint[]> = new Map();

  async save(
    checkpoint: Omit<Checkpoint, "id" | "createdAt">,
  ): Promise<Checkpoint> {
    const stored: Checkpoint = {
      ...checkpoint,
      id: nanoid(),
      createdAt: new Date().toISOString(),
    };
    const list = this.checkpoints.get(checkpoint.runId) || [];
    const idx = list.findIndex((c) => c.iteration === checkpoint.iteration);
    if (idx >= 0) list[idx] = stored;
    else list.push(stored);
    this.checkpoints.set(checkpoint.runId, list);
    return stored;
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const list = this.checkpoints.get(runId);
    if (!list?.length) return null;
    return list.sort((a, b) => b.iteration - a.iteration)[0];
  }

  async get(runId: string, iteration: number): Promise<Checkpoint | null> {
    const list = this.checkpoints.get(runId);
    return list?.find((c) => c.iteration === iteration) || null;
  }

  async list(runId: string): Promise<Checkpoint[]> {
    return (this.checkpoints.get(runId) || []).sort(
      (a, b) => a.iteration - b.iteration,
    );
  }

  async delete(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }
}

// -----------------------------------------------------------
// In-Memory Memory Store
// -----------------------------------------------------------
class InMemoryMemoryStore implements MemoryStore {
  private memories: Map<string, MemoryItem> = new Map();

  private makeKey(namespace: string[], key: string): string {
    return `${namespace.join("/")}::${key}`;
  }

  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
  ): Promise<MemoryItem> {
    const compositeKey = this.makeKey(namespace, key);
    const now = new Date().toISOString();
    const existing = this.memories.get(compositeKey);
    const item: MemoryItem = {
      id: existing?.id || nanoid(),
      namespace,
      key,
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.memories.set(compositeKey, item);
    return item;
  }

  async get(namespace: string[], key: string): Promise<MemoryItem | null> {
    return this.memories.get(this.makeKey(namespace, key)) || null;
  }

  async search(
    namespace: string[],
    options?: { limit?: number },
  ): Promise<MemoryItem[]> {
    const results: MemoryItem[] = [];

    if (namespace.length === 0) {
      // Empty namespace → return ALL memories
      for (const v of this.memories.values()) results.push(v);
    } else {
      // Prefix match: any memory whose namespace starts with the given segments
      const prefix = namespace.join("/");
      for (const v of this.memories.values()) {
        const ns = v.namespace.join("/");
        if (ns === prefix || ns.startsWith(prefix + "/")) results.push(v);
      }
    }

    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results.slice(0, options?.limit || 100);
  }

  async semanticSearch(
    _namespace: string[],
    _query: string,
    _options?: { limit?: number },
  ): Promise<MemoryItem[]> {
    throw new Error(
      "Semantic search not available in InMemoryStore. Use VectorMemoryStore with Qdrant.",
    );
  }

  async delete(namespace: string[], key: string): Promise<boolean> {
    return this.memories.delete(this.makeKey(namespace, key));
  }

  async deleteNamespace(namespace: string[]): Promise<void> {
    const prefix = namespace.join("/") + "::";
    for (const key of this.memories.keys()) {
      if (key.startsWith(prefix)) this.memories.delete(key);
    }
  }
}

// -----------------------------------------------------------
// In-Memory Event Store
// -----------------------------------------------------------
class InMemoryEventStore implements EventStore {
  private events: Map<string, StoredEvent[]> = new Map();
  private counter = 0;
  private subscribers: Map<string, Set<(event: StoredEvent) => void>> =
    new Map();

  async emit(
    runId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: ++this.counter,
      runId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    const list = this.events.get(runId) || [];
    list.push(event);
    this.events.set(runId, list);

    // Notify subscribers
    const subs = this.subscribers.get(runId);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(event);
        } catch {
          /* ignore */
        }
      }
    }

    return event;
  }

  async getEvents(
    runId: string,
    options?: { eventType?: string; limit?: number; after?: number },
  ): Promise<StoredEvent[]> {
    let events = this.events.get(runId) || [];
    if (options?.after) events = events.filter((e) => e.id > options.after!);
    if (options?.eventType)
      events = events.filter((e) => e.eventType === options.eventType);
    if (options?.limit) events = events.slice(0, options.limit);
    return events;
  }

  subscribe(
    runId: string,
    callback: (event: StoredEvent) => void,
    options?: { eventTypes?: string[] },
  ): () => void {
    if (!this.subscribers.has(runId)) {
      this.subscribers.set(runId, new Set());
    }
    // Wrap callback to filter by event types if specified
    const filteredCallback = options?.eventTypes?.length
      ? (event: StoredEvent) => {
          if (options.eventTypes!.includes(event.eventType)) {
            callback(event);
          }
        }
      : callback;
    this.subscribers.get(runId)!.add(filteredCallback);
    return () => {
      this.subscribers.get(runId)?.delete(filteredCallback);
    };
  }
}

// -----------------------------------------------------------
// In-Memory Usage Store
// -----------------------------------------------------------
class InMemoryUsageStore implements UsageStore {
  private records: UsageRecord[] = [];

  async record(
    usage: Omit<UsageRecord, "id" | "recordedAt">,
  ): Promise<UsageRecord> {
    const record: UsageRecord = {
      ...usage,
      id: nanoid(),
      recordedAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async getByProvider(
    provider: string,
    options?: { days?: number },
  ): Promise<UsageRecord[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (options?.days || 30));
    return this.records.filter(
      (r) => r.provider === provider && new Date(r.recordedAt) > cutoff,
    );
  }

  async getDailyStats(days?: number): Promise<DailyStats[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days || 30));

    const grouped = new Map<
      string,
      { runs: number; tokens: number; durations: number[]; successful: number }
    >();
    for (const r of this.records) {
      if (new Date(r.recordedAt) <= cutoff) continue;
      const day = r.recordedAt.split("T")[0];
      const g = grouped.get(day) || {
        runs: 0,
        tokens: 0,
        durations: [],
        successful: 0,
      };
      g.runs++;
      g.tokens += r.totalTokens;
      if (r.latencyMs) g.durations.push(r.latencyMs);
      if ((r as unknown as Record<string, unknown>).success !== false)
        g.successful++;
      grouped.set(day, g);
    }

    return Array.from(grouped.entries())
      .map(([day, g]) => ({
        day,
        runs: g.runs,
        tokens: g.tokens,
        avgDurationMs:
          g.durations.length > 0
            ? g.durations.reduce((a, b) => a + b, 0) / g.durations.length
            : 0,
        successfulRuns: g.successful,
      }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  async getTotalCost(options?: {
    days?: number;
    provider?: string;
  }): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (options?.days || 365));
    return this.records
      .filter((r) => {
        if (new Date(r.recordedAt) <= cutoff) return false;
        if (options?.provider && r.provider !== options.provider) return false;
        return true;
      })
      .reduce((sum, r) => sum + r.estimatedCost, 0);
  }
}

// -----------------------------------------------------------
// In-Memory Chat Store
// -----------------------------------------------------------
class InMemoryChatStore implements ChatStore {
  private sessions: Map<string, ChatSession> = new Map();
  private messages: Map<string, ChatMessageRecord[]> = new Map();

  async createSession(
    session: Omit<ChatSession, "id" | "createdAt" | "updatedAt">,
  ): Promise<ChatSession> {
    const now = new Date().toISOString();
    const stored: ChatSession = {
      ...session,
      id: nanoid(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(stored.id, stored);
    this.messages.set(stored.id, []);
    return stored;
  }

  async getSession(id: string): Promise<ChatSession | null> {
    return this.sessions.get(id) || null;
  }

  async listSessions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<ChatSession[]> {
    const all = Array.from(this.sessions.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    return all.slice(offset, offset + limit);
  }

  async updateSession(
    id: string,
    updates: Partial<ChatSession>,
  ): Promise<ChatSession | null> {
    const existing = this.sessions.get(id);
    if (!existing) return null;
    const updated: ChatSession = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async deleteSession(id: string): Promise<boolean> {
    this.messages.delete(id);
    return this.sessions.delete(id);
  }

  async saveMessage(
    message: Omit<ChatMessageRecord, "id" | "createdAt">,
  ): Promise<ChatMessageRecord> {
    const stored: ChatMessageRecord = {
      ...message,
      id: nanoid(),
      createdAt: new Date().toISOString(),
    };
    const msgs = this.messages.get(message.sessionId) || [];
    msgs.push(stored);
    this.messages.set(message.sessionId, msgs);

    // Auto-increment counters
    const session = this.sessions.get(message.sessionId);
    if (session) {
      session.messageCount += 1;
      session.tokenCount += message.tokens || 0;
      session.updatedAt = new Date().toISOString();
    }
    return stored;
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; after?: string },
  ): Promise<ChatMessageRecord[]> {
    let msgs = this.messages.get(sessionId) || [];
    if (options?.after) {
      const afterDate = new Date(options.after).getTime();
      msgs = msgs.filter((m) => new Date(m.createdAt).getTime() > afterDate);
    }
    const limit = options?.limit || 200;
    return msgs.slice(0, limit);
  }

  async deleteMessage(id: string): Promise<boolean> {
    for (const [, msgs] of this.messages) {
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx >= 0) {
        msgs.splice(idx, 1);
        return true;
      }
    }
    return false;
  }
}

// -----------------------------------------------------------
// In-Memory Storage — Full implementation
// -----------------------------------------------------------
export class InMemoryStorage implements Storage {
  public runs: RunStore;
  public checkpoints: CheckpointStore;
  public memory: MemoryStore;
  public events: EventStore;
  public usage: UsageStore;
  public chat: ChatStore;

  constructor() {
    this.runs = new InMemoryRunStore();
    this.checkpoints = new InMemoryCheckpointStore();
    this.memory = new InMemoryMemoryStore();
    this.events = new InMemoryEventStore();
    this.usage = new InMemoryUsageStore();
    this.chat = new InMemoryChatStore();
  }

  async init(): Promise<void> {
    // Nothing to initialize for in-memory
  }

  async close(): Promise<void> {
    // Nothing to close
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}
