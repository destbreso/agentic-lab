// ============================================
// Storage Factory
// ============================================
// Creates the appropriate storage backend based
// on configuration. Falls back to in-memory when
// no services are available.

import type { Storage } from "../types/storage.js";
import { InMemoryStorage } from "./memory.js";
import { PostgresStorage, type PostgresStorageConfig } from "./postgres.js";
import { createLogger } from "../utils/logger.js";

export interface StorageConfig {
  /** Storage backend: 'postgres', 'memory' (auto-detected if not specified) */
  backend?: "postgres" | "memory";

  /** PostgreSQL connection config */
  postgres?: PostgresStorageConfig;

  /** Redis config (for event bus enhancement) */
  redis?: {
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };

  /** Qdrant config (for semantic memory) */
  qdrant?: {
    url?: string;
    host?: string;
    port?: number;
    apiKey?: string;
    collectionName?: string;
    embeddingDimension?: number;
  };
}

/**
 * Create a Storage instance based on the given configuration.
 *
 * Priority:
 * 1. Explicit backend config
 * 2. Environment variables (POSTGRES_*, REDIS_*, QDRANT_*)
 * 3. Auto-detect available services
 * 4. Fall back to in-memory
 */
export async function createStorage(config?: StorageConfig): Promise<Storage> {
  const logger = createLogger({ level: "info", prefix: "storage" });
  const effectiveConfig = resolveStorageConfig(config);

  // Try PostgreSQL
  if (effectiveConfig.backend === "postgres" || effectiveConfig.postgres) {
    try {
      const pgStorage = new PostgresStorage(
        effectiveConfig.postgres || {
          host: "localhost",
          port: 5432,
          database: "agentic_lab",
          user: "agentic",
          password: "agentic_lab_secret",
        },
      );
      await pgStorage.init();
      logger.info("✅ Connected to PostgreSQL storage");
      return pgStorage;
    } catch (error) {
      if (effectiveConfig.backend === "postgres") {
        // User explicitly requested Postgres — fail
        throw new Error(`PostgreSQL storage unavailable: ${(error as Error).message}`);
      }
      logger.warn(`⚠️  PostgreSQL unavailable (${(error as Error).message}), falling back to in-memory`);
    }
  }

  // Fall back to in-memory
  const memStorage = new InMemoryStorage();
  await memStorage.init();
  logger.info("📦 Using in-memory storage (data will not persist across restarts)");
  return memStorage;
}

/**
 * Resolve storage config from environment variables.
 */
function resolveStorageConfig(config?: StorageConfig): StorageConfig {
  const resolved: StorageConfig = { ...config };

  // Check environment variables for PostgreSQL
  if (
    !resolved.postgres &&
    (process.env.POSTGRES_HOST || process.env.POSTGRES_URL || process.env.DATABASE_URL)
  ) {
    resolved.postgres = {
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
      host: process.env.POSTGRES_HOST || "localhost",
      port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
      database: process.env.POSTGRES_DB || "agentic_lab",
      user: process.env.POSTGRES_USER || "agentic",
      password: process.env.POSTGRES_PASSWORD || "agentic_lab_secret",
    };
    resolved.backend = resolved.backend || "postgres";
  }

  // Check environment variables for Redis
  if (!resolved.redis && (process.env.REDIS_URL || process.env.REDIS_HOST)) {
    resolved.redis = {
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
    };
  }

  // Check environment variables for Qdrant
  if (!resolved.qdrant && (process.env.QDRANT_URL || process.env.QDRANT_HOST)) {
    resolved.qdrant = {
      url: process.env.QDRANT_URL,
      host: process.env.QDRANT_HOST || "localhost",
      port: parseInt(process.env.QDRANT_PORT || "6333", 10),
      apiKey: process.env.QDRANT_API_KEY,
    };
  }

  return resolved;
}

/**
 * Create storage with Redis event bus enhancement.
 * When Redis is available, events are published via pub/sub
 * in addition to being stored in the primary backend.
 */
export async function createStorageWithRedis(config?: StorageConfig): Promise<{
  storage: Storage;
  redis?: import("./redis.js").RedisEventBus;
}> {
  const storage = await createStorage(config);
  const resolvedConfig = resolveStorageConfig(config);

  if (resolvedConfig.redis) {
    try {
      const { RedisEventBus } = await import("./redis.js");
      const bus = new RedisEventBus(resolvedConfig.redis);
      await bus.connect();
      return { storage, redis: bus };
    } catch (error) {
      const logger = createLogger({ level: "warn", prefix: "storage" });
      logger.warn(`⚠️  Redis unavailable (${(error as Error).message}), events will not be broadcast`);
    }
  }

  return { storage };
}
