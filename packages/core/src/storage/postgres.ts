// ============================================
// PostgreSQL Storage Implementation
// ============================================
// Full implementation of the Storage interface
// using PostgreSQL for persistence.

import pg from "pg";
import { nanoid } from "nanoid";
import type {
  Storage,
  RunStore,
  CheckpointStore,
  MemoryStore,
  EventStore,
  UsageStore,
  StoredRun,
  StoredIteration,
  StoredToolCall,
  RunFilter,
  Checkpoint,
  MemoryItem,
  StoredEvent,
  UsageRecord,
  DailyStats,
} from "../types/storage.js";

const { Pool } = pg;

export interface PostgresStorageConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  maxConnections?: number;
}

// -----------------------------------------------------------
// PostgreSQL Run Store
// -----------------------------------------------------------
class PgRunStore implements RunStore {
  constructor(private pool: pg.Pool) {}

  async createRun(run: Omit<StoredRun, "id" | "createdAt" | "updatedAt">): Promise<StoredRun> {
    const result = await this.pool.query(
      `INSERT INTO runs (external_id, name, status, provider, model, max_iterations, working_dir,
        total_input_tokens, total_output_tokens, total_tokens, started_at, ended_at, duration_ms,
        config, success, summary, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        run.externalId, run.name, run.status, run.provider, run.model,
        run.maxIterations, run.workingDir, run.totalInputTokens, run.totalOutputTokens,
        run.totalTokens, run.startedAt, run.endedAt, run.durationMs,
        JSON.stringify(run.config), run.success, run.summary, run.tags,
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  async updateRun(externalId: string, updates: Partial<StoredRun>): Promise<StoredRun | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: "name", status: "status", totalInputTokens: "total_input_tokens",
      totalOutputTokens: "total_output_tokens", totalTokens: "total_tokens",
      startedAt: "started_at", endedAt: "ended_at", durationMs: "duration_ms",
      success: "success", summary: "summary", tags: "tags",
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in updates) {
        setClauses.push(`${col} = $${paramIndex}`);
        values.push((updates as Record<string, unknown>)[key]);
        paramIndex++;
      }
    }

    if (updates.config) {
      setClauses.push(`config = $${paramIndex}`);
      values.push(JSON.stringify(updates.config));
      paramIndex++;
    }

    if (setClauses.length === 0) return this.getRun(externalId);

    values.push(externalId);
    const result = await this.pool.query(
      `UPDATE runs SET ${setClauses.join(", ")} WHERE external_id = $${paramIndex} RETURNING *`,
      values,
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async getRun(externalId: string): Promise<StoredRun | null> {
    const result = await this.pool.query(
      "SELECT * FROM runs WHERE external_id = $1",
      [externalId],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async listRuns(filter?: RunFilter): Promise<{ runs: StoredRun[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filter?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filter.status);
    }
    if (filter?.provider) {
      conditions.push(`provider = $${paramIndex++}`);
      values.push(filter.provider);
    }
    if (filter?.model) {
      conditions.push(`model = $${paramIndex++}`);
      values.push(filter.model);
    }
    if (filter?.tags?.length) {
      conditions.push(`tags && $${paramIndex++}`);
      values.push(filter.tags);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = filter?.orderBy || "created_at";
    const orderDir = filter?.orderDir || "desc";
    const limit = filter?.limit || 50;
    const offset = filter?.offset || 0;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM runs ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ${limit} OFFSET ${offset}`,
        values,
      ),
      this.pool.query(`SELECT COUNT(*) FROM runs ${where}`, values),
    ]);

    return {
      runs: dataResult.rows.map((r) => this.mapRow(r)),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async deleteRun(externalId: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM runs WHERE external_id = $1",
      [externalId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async saveIteration(iteration: StoredIteration): Promise<StoredIteration> {
    const result = await this.pool.query(
      `INSERT INTO iterations (id, run_id, number, success, input_tokens, output_tokens, total_tokens,
        response_text, plan_item_id, plan_item_title, started_at, ended_at, duration_ms, errors, commit_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (run_id, number) DO UPDATE SET
        success = EXCLUDED.success, input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens, total_tokens = EXCLUDED.total_tokens,
        response_text = EXCLUDED.response_text, ended_at = EXCLUDED.ended_at,
        duration_ms = EXCLUDED.duration_ms, errors = EXCLUDED.errors, commit_sha = EXCLUDED.commit_sha
       RETURNING *`,
      [
        iteration.id || nanoid(), iteration.runId, iteration.number, iteration.success,
        iteration.inputTokens, iteration.outputTokens, iteration.totalTokens,
        iteration.responseText, iteration.planItemId, iteration.planItemTitle,
        iteration.startedAt, iteration.endedAt, iteration.durationMs,
        JSON.stringify(iteration.errors), iteration.commitSha,
      ],
    );
    return this.mapIterationRow(result.rows[0]);
  }

  async getIterations(runId: string): Promise<StoredIteration[]> {
    const result = await this.pool.query(
      "SELECT * FROM iterations WHERE run_id = $1 ORDER BY number ASC",
      [runId],
    );
    return result.rows.map((r) => this.mapIterationRow(r));
  }

  async saveToolCall(toolCall: Omit<StoredToolCall, "id">): Promise<StoredToolCall> {
    const result = await this.pool.query(
      `INSERT INTO tool_calls (iteration_id, run_id, name, arguments, result, is_error, duration_ms, called_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        toolCall.iterationId, toolCall.runId, toolCall.name,
        JSON.stringify(toolCall.arguments), toolCall.result,
        toolCall.isError, toolCall.durationMs, toolCall.calledAt,
      ],
    );
    return this.mapToolCallRow(result.rows[0]);
  }

  async getToolCalls(iterationId: string): Promise<StoredToolCall[]> {
    const result = await this.pool.query(
      "SELECT * FROM tool_calls WHERE iteration_id = $1 ORDER BY called_at ASC",
      [iterationId],
    );
    return result.rows.map((r) => this.mapToolCallRow(r));
  }

  async getToolStats(): Promise<Array<{ name: string; count: number; avgDurationMs: number; errorCount: number }>> {
    const result = await this.pool.query(
      `SELECT name, COUNT(*)::int AS count, COALESCE(AVG(duration_ms), 0)::int AS avg_duration_ms,
        SUM(CASE WHEN is_error THEN 1 ELSE 0 END)::int AS error_count
       FROM tool_calls GROUP BY name ORDER BY count DESC`,
    );
    return result.rows.map((r) => ({
      name: r.name,
      count: r.count,
      avgDurationMs: r.avg_duration_ms,
      errorCount: r.error_count,
    }));
  }

  // --- Row mappers ---

  private mapRow(row: Record<string, unknown>): StoredRun {
    return {
      id: row.id as string,
      externalId: row.external_id as string,
      name: row.name as string | undefined,
      status: row.status as string,
      provider: row.provider as string,
      model: row.model as string,
      maxIterations: row.max_iterations as number,
      workingDir: row.working_dir as string,
      totalInputTokens: Number(row.total_input_tokens),
      totalOutputTokens: Number(row.total_output_tokens),
      totalTokens: Number(row.total_tokens),
      startedAt: row.started_at ? (row.started_at as Date).toISOString() : undefined,
      endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : undefined,
      durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
      config: (row.config as Record<string, unknown>) || {},
      success: row.success as boolean | undefined,
      summary: row.summary as string | undefined,
      tags: (row.tags as string[]) || [],
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }

  private mapIterationRow(row: Record<string, unknown>): StoredIteration {
    return {
      id: row.id as string,
      runId: row.run_id as string,
      number: row.number as number,
      success: row.success as boolean,
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      responseText: row.response_text as string | undefined,
      planItemId: row.plan_item_id as string | undefined,
      planItemTitle: row.plan_item_title as string | undefined,
      startedAt: (row.started_at as Date).toISOString(),
      endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : undefined,
      durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
      errors: (row.errors as string[]) || [],
      commitSha: row.commit_sha as string | undefined,
    };
  }

  private mapToolCallRow(row: Record<string, unknown>): StoredToolCall {
    return {
      id: row.id as string,
      iterationId: row.iteration_id as string,
      runId: row.run_id as string,
      name: row.name as string,
      arguments: (row.arguments as Record<string, unknown>) || {},
      result: row.result as string | undefined,
      isError: row.is_error as boolean,
      durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
      calledAt: (row.called_at as Date).toISOString(),
    };
  }
}

// -----------------------------------------------------------
// PostgreSQL Checkpoint Store
// -----------------------------------------------------------
class PgCheckpointStore implements CheckpointStore {
  constructor(private pool: pg.Pool) {}

  async save(checkpoint: Omit<Checkpoint, "id" | "createdAt">): Promise<Checkpoint> {
    const result = await this.pool.query(
      `INSERT INTO checkpoints (run_id, iteration, state, messages, plan, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_id, iteration) DO UPDATE SET
        state = EXCLUDED.state, messages = EXCLUDED.messages,
        plan = EXCLUDED.plan, metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        checkpoint.runId, checkpoint.iteration,
        JSON.stringify(checkpoint.state), JSON.stringify(checkpoint.messages),
        JSON.stringify(checkpoint.plan), JSON.stringify(checkpoint.metadata),
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const result = await this.pool.query(
      "SELECT * FROM checkpoints WHERE run_id = $1 ORDER BY iteration DESC LIMIT 1",
      [runId],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async get(runId: string, iteration: number): Promise<Checkpoint | null> {
    const result = await this.pool.query(
      "SELECT * FROM checkpoints WHERE run_id = $1 AND iteration = $2",
      [runId, iteration],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async list(runId: string): Promise<Checkpoint[]> {
    const result = await this.pool.query(
      "SELECT * FROM checkpoints WHERE run_id = $1 ORDER BY iteration ASC",
      [runId],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async delete(runId: string): Promise<void> {
    await this.pool.query("DELETE FROM checkpoints WHERE run_id = $1", [runId]);
  }

  private mapRow(row: Record<string, unknown>): Checkpoint {
    return {
      id: row.id as string,
      runId: row.run_id as string,
      iteration: row.iteration as number,
      state: row.state as Checkpoint["state"],
      messages: row.messages as Checkpoint["messages"],
      plan: row.plan as Checkpoint["plan"],
      metadata: (row.metadata as Record<string, unknown>) || {},
      createdAt: (row.created_at as Date).toISOString(),
    };
  }
}

// -----------------------------------------------------------
// PostgreSQL Memory Store
// -----------------------------------------------------------
class PgMemoryStore implements MemoryStore {
  constructor(private pool: pg.Pool) {}

  async put(namespace: string[], key: string, value: Record<string, unknown>): Promise<MemoryItem> {
    const result = await this.pool.query(
      `INSERT INTO memories (namespace, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value
       RETURNING *`,
      [namespace, key, JSON.stringify(value)],
    );
    return this.mapRow(result.rows[0]);
  }

  async get(namespace: string[], key: string): Promise<MemoryItem | null> {
    const result = await this.pool.query(
      "SELECT * FROM memories WHERE namespace = $1 AND key = $2",
      [namespace, key],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async search(namespace: string[], options?: { limit?: number }): Promise<MemoryItem[]> {
    const limit = options?.limit || 100;
    const result = await this.pool.query(
      "SELECT * FROM memories WHERE namespace = $1 ORDER BY updated_at DESC LIMIT $2",
      [namespace, limit],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async semanticSearch(_namespace: string[], _query: string, _options?: { limit?: number }): Promise<MemoryItem[]> {
    // Semantic search is handled by Qdrant integration
    // This is a placeholder — the VectorMemoryStore wraps this
    throw new Error("Semantic search requires Qdrant integration. Use VectorMemoryStore instead.");
  }

  async delete(namespace: string[], key: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM memories WHERE namespace = $1 AND key = $2",
      [namespace, key],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteNamespace(namespace: string[]): Promise<void> {
    await this.pool.query(
      "DELETE FROM memories WHERE namespace = $1",
      [namespace],
    );
  }

  private mapRow(row: Record<string, unknown>): MemoryItem {
    return {
      id: row.id as string,
      namespace: row.namespace as string[],
      key: row.key as string,
      value: row.value as Record<string, unknown>,
      qdrantPointId: row.qdrant_point_id as string | undefined,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}

// -----------------------------------------------------------
// PostgreSQL Event Store
// -----------------------------------------------------------
class PgEventStore implements EventStore {
  private subscribers: Map<string, Set<(event: StoredEvent) => void>> = new Map();

  constructor(private pool: pg.Pool) {}

  async emit(runId: string, eventType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const result = await this.pool.query(
      `INSERT INTO events (run_id, event_type, payload) VALUES ($1, $2, $3) RETURNING *`,
      [runId, eventType, JSON.stringify(payload)],
    );
    const event = this.mapRow(result.rows[0]);

    // Notify local subscribers
    const subs = this.subscribers.get(runId);
    if (subs) {
      for (const cb of subs) {
        try { cb(event); } catch { /* ignore subscriber errors */ }
      }
    }

    return event;
  }

  async getEvents(
    runId: string,
    options?: { eventType?: string; limit?: number; after?: number },
  ): Promise<StoredEvent[]> {
    const conditions = ["run_id = $1"];
    const values: unknown[] = [runId];
    let paramIndex = 2;

    if (options?.eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      values.push(options.eventType);
    }
    if (options?.after) {
      conditions.push(`id > $${paramIndex++}`);
      values.push(options.after);
    }

    const limit = options?.limit || 1000;
    const result = await this.pool.query(
      `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ${limit}`,
      values,
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  subscribe(
    runId: string,
    callback: (event: StoredEvent) => void,
    _options?: { eventTypes?: string[] },
  ): () => void {
    if (!this.subscribers.has(runId)) {
      this.subscribers.set(runId, new Set());
    }
    this.subscribers.get(runId)!.add(callback);

    return () => {
      this.subscribers.get(runId)?.delete(callback);
      if (this.subscribers.get(runId)?.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  private mapRow(row: Record<string, unknown>): StoredEvent {
    return {
      id: Number(row.id),
      runId: row.run_id as string,
      eventType: row.event_type as string,
      payload: row.payload as Record<string, unknown>,
      createdAt: (row.created_at as Date).toISOString(),
    };
  }
}

// -----------------------------------------------------------
// PostgreSQL Usage Store
// -----------------------------------------------------------
class PgUsageStore implements UsageStore {
  constructor(private pool: pg.Pool) {}

  async record(usage: Omit<UsageRecord, "id" | "recordedAt">): Promise<UsageRecord> {
    const result = await this.pool.query(
      `INSERT INTO provider_usage (run_id, provider, model, input_tokens, output_tokens,
        total_tokens, estimated_cost, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        usage.runId, usage.provider, usage.model, usage.inputTokens,
        usage.outputTokens, usage.totalTokens, usage.estimatedCost, usage.latencyMs,
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  async getByProvider(provider: string, options?: { days?: number }): Promise<UsageRecord[]> {
    const days = options?.days || 30;
    const result = await this.pool.query(
      `SELECT * FROM provider_usage WHERE provider = $1 AND recorded_at > NOW() - INTERVAL '${days} days' ORDER BY recorded_at DESC`,
      [provider],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async getDailyStats(days?: number): Promise<DailyStats[]> {
    const d = days || 30;
    const result = await this.pool.query(
      `SELECT * FROM v_daily_stats WHERE day > CURRENT_DATE - INTERVAL '${d} days' ORDER BY day DESC`,
    );
    return result.rows.map((r) => ({
      day: r.day.toISOString().split("T")[0],
      runs: Number(r.runs),
      tokens: Number(r.tokens),
      avgDurationMs: Number(r.avg_duration_ms),
      successfulRuns: Number(r.successful_runs),
    }));
  }

  async getTotalCost(options?: { days?: number; provider?: string }): Promise<number> {
    const conditions = ["1=1"];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options?.days) {
      conditions.push(`recorded_at > NOW() - INTERVAL '${options.days} days'`);
    }
    if (options?.provider) {
      conditions.push(`provider = $${paramIndex++}`);
      values.push(options.provider);
    }

    const result = await this.pool.query(
      `SELECT COALESCE(SUM(estimated_cost), 0) AS total FROM provider_usage WHERE ${conditions.join(" AND ")}`,
      values,
    );
    return parseFloat(result.rows[0].total);
  }

  private mapRow(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as string,
      runId: row.run_id as string | undefined,
      provider: row.provider as string,
      model: row.model as string,
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      estimatedCost: parseFloat(row.estimated_cost as string),
      latencyMs: row.latency_ms ? Number(row.latency_ms) : undefined,
      recordedAt: (row.recorded_at as Date).toISOString(),
    };
  }
}

// -----------------------------------------------------------
// PostgreSQL Storage — Unified implementation
// -----------------------------------------------------------
export class PostgresStorage implements Storage {
  private pool: pg.Pool;
  public runs: RunStore;
  public checkpoints: CheckpointStore;
  public memory: MemoryStore;
  public events: EventStore;
  public usage: UsageStore;

  constructor(config: PostgresStorageConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      host: config.host || "localhost",
      port: config.port || 5432,
      database: config.database || "agentic_lab",
      user: config.user || "agentic",
      password: config.password || "agentic_lab_secret",
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: config.maxConnections || 10,
    });

    this.runs = new PgRunStore(this.pool);
    this.checkpoints = new PgCheckpointStore(this.pool);
    this.memory = new PgMemoryStore(this.pool);
    this.events = new PgEventStore(this.pool);
    this.usage = new PgUsageStore(this.pool);
  }

  async init(): Promise<void> {
    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthy(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query("SELECT 1");
        return true;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }
}
