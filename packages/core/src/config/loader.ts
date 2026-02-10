// ============================================
// Config Loader
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import type { LoopConfig } from "../types/loop.js";
import type { StorageConfig } from "../storage/factory.js";

/** Full configuration for Agentic Lab */
export interface AgenticLabConfig {
  /** Default loop configuration */
  loop: Partial<LoopConfig>;

  /** Provider-specific settings */
  providers: Record<
    string,
    {
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string;
      options?: Record<string, unknown>;
    }
  >;

  /** Storage backend configuration */
  storage: StorageConfig;

  /** Logging configuration */
  logging: {
    level: string;
    logFile?: string;
  };
}

const DEFAULT_CONFIG: AgenticLabConfig = {
  loop: {
    maxIterations: 10,
    delayMs: 1000,
    promptFile: "PROMPT.md",
    planFile: "PLAN.md",
    autoCommit: false,
    autoPush: false,
    verbose: false,
  },
  providers: {},
  storage: {},
  logging: {
    level: "info",
  },
};

/**
 * Load configuration from multiple sources:
 * 1. .env file (environment variables)
 * 2. agentic-lab.config.json file
 * 3. Explicit overrides
 */
export async function loadConfig(
  workingDir?: string,
  overrides?: Partial<AgenticLabConfig>,
): Promise<AgenticLabConfig> {
  const cwd = workingDir || process.cwd();

  // Load .env file
  loadDotenv({ path: path.join(cwd, ".env") });

  // Try to load config file
  let fileConfig: Partial<AgenticLabConfig> = {};
  const configPath = path.join(cwd, "agentic-lab.config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    fileConfig = JSON.parse(raw);
  } catch {
    // No config file, use defaults
  }

  // Build provider configs from env vars
  const envProviders: AgenticLabConfig["providers"] = {};

  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_DEFAULT_MODEL) {
    envProviders.ollama = {
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      defaultModel: process.env.OLLAMA_DEFAULT_MODEL || "llama3.1",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    envProviders.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      defaultModel: process.env.OPENAI_DEFAULT_MODEL || "gpt-4o",
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    envProviders.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel:
        process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-4-20250514",
    };
  }

  if (process.env.GOOGLE_API_KEY) {
    envProviders.google = {
      apiKey: process.env.GOOGLE_API_KEY,
      defaultModel: process.env.GOOGLE_DEFAULT_MODEL || "gemini-2.0-flash",
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    envProviders.openrouter = {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl:
        process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL,
    };
  }

  // Build storage config from env vars
  const envStorage: StorageConfig = {};
  if (process.env.STORAGE_BACKEND) {
    envStorage.backend = process.env.STORAGE_BACKEND as "postgres" | "memory";
  }
  if (process.env.POSTGRES_HOST || process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    envStorage.postgres = {
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      host: process.env.POSTGRES_HOST || "localhost",
      port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
      database: process.env.POSTGRES_DB || "agentic_lab",
      user: process.env.POSTGRES_USER || "agentic",
      password: process.env.POSTGRES_PASSWORD || "agentic_lab_secret",
    };
  }
  if (process.env.REDIS_HOST || process.env.REDIS_URL) {
    envStorage.redis = {
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
    };
  }
  if (process.env.QDRANT_HOST || process.env.QDRANT_URL) {
    envStorage.qdrant = {
      url: process.env.QDRANT_URL,
      host: process.env.QDRANT_HOST || "localhost",
      port: parseInt(process.env.QDRANT_PORT || "6333", 10),
      apiKey: process.env.QDRANT_API_KEY,
    };
  }

  // Merge: defaults < env < file config < overrides
  const config: AgenticLabConfig = {
    loop: {
      ...DEFAULT_CONFIG.loop,
      ...(fileConfig.loop || {}),
      ...(overrides?.loop || {}),
      provider:
        process.env.DEFAULT_PROVIDER || fileConfig.loop?.provider || "ollama",
      workingDir: cwd,
    },
    providers: {
      ...envProviders,
      ...(fileConfig.providers || {}),
      ...(overrides?.providers || {}),
    },
    storage: {
      ...envStorage,
      ...(fileConfig.storage || {}),
      ...(overrides?.storage || {}),
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      level: process.env.DEFAULT_LOG_LEVEL || DEFAULT_CONFIG.logging.level,
      ...(fileConfig.logging || {}),
      ...(overrides?.logging || {}),
    },
  };

  return config;
}
