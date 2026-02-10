// ============================================
// Redis Storage — Real-time pub/sub & caching
// ============================================
// Uses Redis for:
// - Real-time event streaming (pub/sub)
// - Ephemeral state caching
// - Rate limiting
// - Run status broadcasting (CLI ↔ Dashboard)

import { createClient, type RedisClientType } from "redis";
import type { StoredEvent, EventStore } from "../types/storage.js";

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

/** Key prefixes */
const PREFIX = {
  event: "alab:event",
  runState: "alab:run:state",
  runStream: "alab:run:stream",
  cache: "alab:cache",
  metrics: "alab:metrics",
  rateLimit: "alab:ratelimit",
} as const;

// -----------------------------------------------------------
// Redis Event Bus — Pub/sub for real-time event streaming
// -----------------------------------------------------------
export class RedisEventBus {
  private publisher: RedisClientType;
  private subscriber: RedisClientType;
  private connected = false;

  constructor(private config: RedisConfig) {
    const url = config.url || `redis://${config.host || "localhost"}:${config.port || 6379}/${config.db || 0}`;
    this.publisher = createClient({ url }) as RedisClientType;
    this.subscriber = this.publisher.duplicate() as RedisClientType;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await Promise.all([
      this.publisher.connect(),
      this.subscriber.connect(),
    ]);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await Promise.all([
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
    this.connected = false;
  }

  /** Publish an event to a run's channel */
  async publishEvent(runId: string, event: StoredEvent): Promise<void> {
    const channel = `${PREFIX.runStream}:${runId}`;
    await this.publisher.publish(channel, JSON.stringify(event));

    // Also store in a sorted set for replay (keep last 1000 events per run)
    const key = `${PREFIX.event}:${runId}`;
    await this.publisher.zAdd(key, {
      score: event.id,
      value: JSON.stringify(event),
    });
    await this.publisher.zRemRangeByRank(key, 0, -1001); // Trim to 1000
    await this.publisher.expire(key, 86400); // TTL: 24 hours
  }

  /** Subscribe to a run's event stream */
  async subscribeToRun(
    runId: string,
    callback: (event: StoredEvent) => void,
  ): Promise<() => Promise<void>> {
    const channel = `${PREFIX.runStream}:${runId}`;

    await this.subscriber.subscribe(channel, (message) => {
      try {
        const event = JSON.parse(message) as StoredEvent;
        callback(event);
      } catch { /* ignore parse errors */ }
    });

    return async () => {
      await this.subscriber.unsubscribe(channel);
    };
  }

  /** Get cached events for a run (for late joiners) */
  async getRecentEvents(runId: string, afterId?: number): Promise<StoredEvent[]> {
    const key = `${PREFIX.event}:${runId}`;
    const min = afterId ? `(${afterId}` : "-inf";
    const results = await this.publisher.zRangeByScore(key, min, "+inf");
    return results.map((r) => JSON.parse(r) as StoredEvent);
  }

  // -----------------------------------------------------------
  // Run State — Ephemeral cache
  // -----------------------------------------------------------

  /** Cache a run's current state */
  async setRunState(runId: string, state: Record<string, unknown>): Promise<void> {
    const key = `${PREFIX.runState}:${runId}`;
    await this.publisher.set(key, JSON.stringify(state), { EX: 3600 }); // 1 hour TTL
  }

  /** Get a run's cached state */
  async getRunState(runId: string): Promise<Record<string, unknown> | null> {
    const key = `${PREFIX.runState}:${runId}`;
    const raw = await this.publisher.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  /** Delete a run's cached state */
  async deleteRunState(runId: string): Promise<void> {
    await this.publisher.del(`${PREFIX.runState}:${runId}`);
  }

  // -----------------------------------------------------------
  // Generic Cache
  // -----------------------------------------------------------

  /** Set a cache value */
  async cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const cacheKey = `${PREFIX.cache}:${key}`;
    const opts = ttlSeconds ? { EX: ttlSeconds } : undefined;
    await this.publisher.set(cacheKey, JSON.stringify(value), opts);
  }

  /** Get a cache value */
  async cacheGet<T = unknown>(key: string): Promise<T | null> {
    const cacheKey = `${PREFIX.cache}:${key}`;
    const raw = await this.publisher.get(cacheKey);
    return raw ? JSON.parse(raw) as T : null;
  }

  /** Delete a cache value */
  async cacheDel(key: string): Promise<void> {
    await this.publisher.del(`${PREFIX.cache}:${key}`);
  }

  // -----------------------------------------------------------
  // Rate Limiting (sliding window)
  // -----------------------------------------------------------

  /** Check and increment a rate limit counter */
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const rlKey = `${PREFIX.rateLimit}:${key}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Remove entries outside the window
    await this.publisher.zRemRangeByScore(rlKey, 0, now - windowMs);

    // Count current entries
    const count = await this.publisher.zCard(rlKey);

    if (count >= maxRequests) {
      // Get the oldest entry to calculate reset time
      const oldest = await this.publisher.zRange(rlKey, 0, 0, { BY: "SCORE" });
      const resetAt = oldest.length > 0 ? parseInt(oldest[0], 10) + windowMs : now + windowMs;
      return { allowed: false, remaining: 0, resetAt };
    }

    // Add current request
    await this.publisher.zAdd(rlKey, { score: now, value: `${now}:${Math.random()}` });
    await this.publisher.expire(rlKey, windowSeconds);

    return {
      allowed: true,
      remaining: maxRequests - count - 1,
      resetAt: now + windowMs,
    };
  }

  // -----------------------------------------------------------
  // Metrics Counters
  // -----------------------------------------------------------

  /** Increment a metric counter */
  async incrementMetric(metric: string, value: number = 1): Promise<void> {
    const key = `${PREFIX.metrics}:${metric}`;
    await this.publisher.incrByFloat(key, value);
  }

  /** Get a metric counter */
  async getMetric(metric: string): Promise<number> {
    const key = `${PREFIX.metrics}:${metric}`;
    const raw = await this.publisher.get(key);
    return raw ? parseFloat(raw) : 0;
  }

  /** Health check */
  async healthy(): Promise<boolean> {
    try {
      const pong = await this.publisher.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }
}

// -----------------------------------------------------------
// Redis-backed Event Store adapter
// -----------------------------------------------------------
export class RedisEventStore implements EventStore {
  private localIdCounter = 0;

  constructor(private bus: RedisEventBus) {}

  async emit(runId: string, eventType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: ++this.localIdCounter,
      runId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.bus.publishEvent(runId, event);
    return event;
  }

  async getEvents(
    runId: string,
    options?: { eventType?: string; limit?: number; after?: number },
  ): Promise<StoredEvent[]> {
    let events = await this.bus.getRecentEvents(runId, options?.after);
    if (options?.eventType) {
      events = events.filter((e) => e.eventType === options.eventType);
    }
    if (options?.limit) {
      events = events.slice(0, options.limit);
    }
    return events;
  }

  subscribe(
    runId: string,
    callback: (event: StoredEvent) => void,
    options?: { eventTypes?: string[] },
  ): () => void {
    let unsubscribePromise: Promise<() => Promise<void>> | null = null;

    const wrappedCallback = (event: StoredEvent) => {
      if (options?.eventTypes && !options.eventTypes.includes(event.eventType)) {
        return;
      }
      callback(event);
    };

    // Start subscription (async, but subscribe is sync interface)
    unsubscribePromise = this.bus.subscribeToRun(runId, wrappedCallback);

    return () => {
      unsubscribePromise?.then((unsub) => unsub());
    };
  }
}
