// ============================================
// Storage Factory
// ============================================
// Creates the appropriate storage backend based
// on configuration. Falls back to in-memory when
// no services are available.

import type { Storage } from "../types/storage.js";
import { InMemoryStorage } from "./memory.js";
import { PostgresStorage, type PostgresStorageConfig } from "./postgres.js";
import {
  VectorMemoryStore,
  createOllamaEmbedding,
  createOpenAIEmbedding,
  type EmbeddingFunction,
} from "./qdrant.js";
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

  let storage: Storage | null = null;

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
      storage = pgStorage;
    } catch (error) {
      if (effectiveConfig.backend === "postgres") {
        // User explicitly requested Postgres — fail
        throw new Error(`PostgreSQL storage unavailable: ${(error as Error).message}`);
      }
      logger.warn(`⚠️  PostgreSQL unavailable (${(error as Error).message}), falling back to in-memory`);
    }
  }

  if (!storage) {
    // Fall back to in-memory
    const memStorage = new InMemoryStorage();
    await memStorage.init();
    logger.info("📦 Using in-memory storage (data will not persist across restarts)");
    storage = memStorage;
  }

  // Enhance memory store with Qdrant vector search if configured
  if (effectiveConfig.qdrant) {
    try {
      const embedding = resolveEmbedding();
      const vectorStore = new VectorMemoryStore(
        {
          ...effectiveConfig.qdrant,
          embeddingDimension: effectiveConfig.qdrant.embeddingDimension ?? embedding.dimension,
        },
        embedding.fn,
        storage.memory,
      );
      await vectorStore.init();
      // Replace the memory store with the vector-enhanced version
      (storage as unknown as { memory: typeof vectorStore }).memory = vectorStore;
      logger.info(
        `✅ Qdrant vector memory enabled (${embedding.provider} ${embedding.model}, ${vectorStore.vectorSize} dims)`,
      );
    } catch (error) {
      logger.warn(`⚠️  Qdrant unavailable (${(error as Error).message}), semantic search disabled`);
    }
  }

  return storage;
}

/** Vector sizes of common embedding models, so no probe call is needed for them. */
const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "nomic-embed-text": 768,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

export interface ResolvedEmbedding {
  provider: "openai" | "ollama";
  model: string;
  /** Undefined when neither EMBEDDING_DIMENSION nor the known models say; the store then measures it. */
  dimension?: number;
  fn: EmbeddingFunction;
}

/**
 * Resolve the embedding model from environment variables.
 *
 * EMBEDDING_PROVIDER (ollama | openai) picks the provider; without it, an
 * OpenAI key selects OpenAI and everything else uses local Ollama.
 * EMBEDDING_MODEL names the model for either provider (OLLAMA_EMBEDDING_MODEL
 * still works for Ollama). The vector size comes from EMBEDDING_DIMENSION, then
 * from the known models; when neither knows it, the vector store measures it.
 */
export function resolveEmbedding(env: NodeJS.ProcessEnv = process.env): ResolvedEmbedding {
  const requested = env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (requested && requested !== "openai" && requested !== "ollama") {
    throw new Error(`unknown EMBEDDING_PROVIDER "${env.EMBEDDING_PROVIDER}" (use ollama or openai)`);
  }
  const provider: "openai" | "ollama" =
    (requested as "openai" | "ollama" | undefined) ?? (env.OPENAI_API_KEY ? "openai" : "ollama");

  let model: string;
  let fn: EmbeddingFunction;
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("EMBEDDING_PROVIDER=openai needs OPENAI_API_KEY");
    model = env.EMBEDDING_MODEL || "text-embedding-3-small";
    fn = createOpenAIEmbedding(env.OPENAI_API_KEY, model);
  } else {
    model = env.OLLAMA_EMBEDDING_MODEL || env.EMBEDDING_MODEL || "nomic-embed-text";
    fn = createOllamaEmbedding(model, env.OLLAMA_BASE_URL || "http://localhost:11434");
  }

  const configured = Number.parseInt(env.EMBEDDING_DIMENSION ?? "", 10);
  const dimension =
    Number.isFinite(configured) && configured > 0
      ? configured
      : KNOWN_EMBEDDING_DIMENSIONS[model.split(":")[0]];

  return { provider, model, dimension, fn };
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
      collectionName: process.env.QDRANT_COLLECTION,
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
