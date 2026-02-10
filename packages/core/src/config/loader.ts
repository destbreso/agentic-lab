// ============================================
// Config Loader
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import type { LoopConfig } from "../types/loop.js";

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
    logging: {
      ...DEFAULT_CONFIG.logging,
      level: process.env.DEFAULT_LOG_LEVEL || DEFAULT_CONFIG.logging.level,
      ...(fileConfig.logging || {}),
      ...(overrides?.logging || {}),
    },
  };

  return config;
}
