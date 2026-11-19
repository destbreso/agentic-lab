// ============================================
// Config Loader
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import type { LoopConfig } from "../types/loop.js";
import type { StorageConfig } from "../storage/factory.js";
import { LEGACY_PROJECT_CONFIG, PROJECT_CONFIG, userConfigFile } from "./places.js";

/** Jig's whole configuration. */
export interface JigConfig {
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

  /** Named chains of "<entry>/<model>", tried in order when one is unavailable. */
  brains?: Record<string, string[]>;

  /** The brains whose chain may fall from a local model to a cloud one (a brain written as { "chain": [...], "crossToCloud": true }). */
  crossToCloud?: string[];

  /** "local-only": a project ("providers": "local-only" in its jig.config.json) whose roles run on local models only. */
  privacy?: "local-only";

  /** The tools' settings. */
  tools?: {
    /** file_write turns literal "\n" escapes into line breaks when the content has no real one (default true). */
    unescapeNewlines?: boolean;
  };

  /** The console's own settings. */
  ui?: {
    /** Play Jig's startup animation when a session opens (default true). */
    startup?: boolean;
  };
}

const DEFAULT_CONFIG: JigConfig = {
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

/** A config file's contents, or nothing when it is missing or unreadable. */
async function readConfigFile(file: string): Promise<Partial<JigConfig> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as Partial<JigConfig>;
  } catch {
    return null;
  }
}

/** Two partial configs merged a section at a time, the second winning. */
function mergeFiles(a: Partial<JigConfig>, b: Partial<JigConfig>): Partial<JigConfig> {
  return {
    loop: { ...(a.loop ?? {}), ...(b.loop ?? {}) },
    providers: { ...(a.providers ?? {}), ...(b.providers ?? {}) },
    storage: { ...(a.storage ?? {}), ...(b.storage ?? {}) },
    logging: { ...(a.logging ?? {}), ...(b.logging ?? {}) } as JigConfig["logging"],
    brains: { ...(a.brains ?? {}), ...(b.brains ?? {}) },
    ui: { ...(a.ui ?? {}), ...(b.ui ?? {}) },
    tools: { ...(a.tools ?? {}), ...(b.tools ?? {}) },
  };
}

/**
 * Load the configuration, each source over the one before:
 * 1. the defaults;
 * 2. the user's config file (userConfigFile(): ~/.config/jig/config.json);
 * 3. the environment, with the working directory's .env;
 * 4. the project's jig.config.json (agentic-lab.config.json, its name before the rename, when it has none);
 * 5. explicit overrides.
 */
/** Brains as written: a chain, or { "chain": [...], "crossToCloud": true } for a brain that may fall from local to cloud. */
function brainsOf(written: Record<string, unknown>): { brains: Record<string, string[]>; crossToCloud: string[] } {
  const brains: Record<string, string[]> = {};
  const cross: string[] = [];
  for (const [name, b] of Object.entries(written)) {
    if (Array.isArray(b)) brains[name] = b.map(String);
    else if (b && typeof b === "object" && Array.isArray((b as { chain?: unknown }).chain)) {
      brains[name] = ((b as { chain: unknown[] }).chain).map(String);
      if ((b as { crossToCloud?: unknown }).crossToCloud === true) cross.push(name);
    }
  }
  return { brains, crossToCloud: cross };
}

export async function loadConfig(
  workingDir?: string,
  overrides?: Partial<JigConfig>,
): Promise<JigConfig> {
  const cwd = workingDir || process.cwd();

  // Load .env file
  loadDotenv({ path: path.join(cwd, ".env") });

  const userConfig = (await readConfigFile(userConfigFile())) ?? {};
  const projectConfig =
    (await readConfigFile(path.join(cwd, PROJECT_CONFIG))) ?? (await readConfigFile(path.join(cwd, LEGACY_PROJECT_CONFIG))) ?? {};
  // The user's file is under the environment; the project's is over it.
  const fileConfig = projectConfig;

  // Build provider configs from env vars
  const envProviders: JigConfig["providers"] = {};

  // A model is named only when the person named one: otherwise it is chosen from what the provider lists.
  const named = (model: string | undefined) => (model ? { defaultModel: model } : {});
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_DEFAULT_MODEL) {
    envProviders.ollama = { baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434", ...named(process.env.OLLAMA_DEFAULT_MODEL) };
  }

  if (process.env.OPENAI_API_KEY) {
    envProviders.openai = { apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL, ...named(process.env.OPENAI_DEFAULT_MODEL) };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    envProviders.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY, ...named(process.env.ANTHROPIC_DEFAULT_MODEL) };
  }

  if (process.env.GOOGLE_API_KEY) {
    envProviders.google = { apiKey: process.env.GOOGLE_API_KEY, baseUrl: process.env.GOOGLE_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai", ...named(process.env.GOOGLE_DEFAULT_MODEL) };
  }

  if (process.env.OPENROUTER_API_KEY) {
    envProviders.openrouter = { apiKey: process.env.OPENROUTER_API_KEY, baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1", ...named(process.env.OPENROUTER_DEFAULT_MODEL) };
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

  // Merge: defaults < the user's file < env < the project's file < overrides
  const user = mergeFiles({}, userConfig);
  const providers: JigConfig["providers"] = { ...(user.providers || {}) };
  for (const [name, p] of Object.entries(envProviders)) providers[name] = { ...(providers[name] ?? {}), ...p };
  // A project may say "providers": "local-only" instead of naming entries: its roles run on local models only.
  const localOnly = (fileConfig.providers as unknown) === "local-only";
  if (!localOnly) for (const [name, p] of Object.entries(fileConfig.providers || {})) providers[name] = { ...(providers[name] ?? {}), ...p };
  for (const [name, p] of Object.entries(overrides?.providers || {})) providers[name] = { ...(providers[name] ?? {}), ...p };
  const config: JigConfig = {
    loop: {
      ...DEFAULT_CONFIG.loop,
      ...(user.loop || {}),
      ...(fileConfig.loop || {}),
      ...(overrides?.loop || {}),
      provider:
        process.env.DEFAULT_PROVIDER || fileConfig.loop?.provider || user.loop?.provider || "ollama",
      workingDir: cwd,
    },
    providers,
    storage: {
      ...(user.storage || {}),
      ...envStorage,
      ...(fileConfig.storage || {}),
      ...(overrides?.storage || {}),
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(user.logging || {}),
      ...(process.env.DEFAULT_LOG_LEVEL ? { level: process.env.DEFAULT_LOG_LEVEL } : {}),
      ...(fileConfig.logging || {}),
      ...(overrides?.logging || {}),
    },
    ...brainsOf({ ...(user.brains || {}), ...(fileConfig.brains || {}), ...(overrides?.brains || {}) }),
    ...(localOnly || overrides?.privacy === "local-only" ? { privacy: "local-only" as const } : {}),
    ui: { ...(user.ui || {}), ...(fileConfig.ui || {}), ...(overrides?.ui || {}) },
    tools: { ...(user.tools || {}), ...(fileConfig.tools || {}), ...(overrides?.tools || {}) },
  };

  return config;
}
