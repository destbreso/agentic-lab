// ============================================
// CLI: config command — View and validate config
// ============================================

import * as path from "path";
import chalk from "chalk";
import Table from "cli-table3";
import {
  loadConfig,
  getAvailableProviders,
  getSystemMetaKnowledge,
} from "@agentic-lab/core";

interface ConfigOptions {
  dir?: string;
  check?: boolean;
  meta?: boolean;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  // Sub-command: show system meta-knowledge
  if (options.meta) {
    showMetaKnowledge();
    return;
  }

  const workingDir = path.resolve(options.dir || ".");

  console.log(chalk.cyan("\n⚙️  Agentic Lab — Configuration\n"));

  const appConfig = await loadConfig(workingDir);

  // Show provider configuration
  console.log(chalk.white("  Providers:"));
  const allProviders = getAvailableProviders();
  const providerTable = new Table({
    head: [
      chalk.white("Provider"),
      chalk.white("Status"),
      chalk.white("Model"),
      chalk.white("Base URL"),
    ],
    style: { head: [], border: [] },
  });

  for (const name of allProviders) {
    const config = appConfig.providers[name];
    const configured = !!config;
    const hasKey = !!config?.apiKey;

    providerTable.push([
      chalk.bold(name),
      configured
        ? hasKey || name === "ollama"
          ? chalk.green("✅ configured")
          : chalk.yellow("⚠️  no API key")
        : chalk.gray("○ not configured"),
      config?.defaultModel || chalk.gray("-"),
      config?.baseUrl || chalk.gray("default"),
    ]);
  }

  // Also show providers configured in .env but not registered in factory
  for (const name of Object.keys(appConfig.providers)) {
    if (!allProviders.includes(name)) {
      const config = appConfig.providers[name];
      providerTable.push([
        chalk.bold(name),
        chalk.yellow("⚠️  not registered"),
        config?.defaultModel || chalk.gray("-"),
        config?.baseUrl || chalk.gray("default"),
      ]);
    }
  }

  console.log(providerTable.toString());

  // Show loop defaults
  console.log(chalk.white("\n  Loop Defaults:"));
  const loop = appConfig.loop;
  const loopEntries = [
    ["Provider", (loop.provider as string) || chalk.gray("ollama")],
    ["Max Iterations", String(loop.maxIterations || 10)],
    ["Delay", `${loop.delayMs || 1000}ms`],
    ["Prompt File", loop.promptFile || "PROMPT.md"],
    ["Plan File", loop.planFile || "PLAN.md"],
    ["Auto Commit", loop.autoCommit ? "yes" : "no"],
    ["Auto Push", loop.autoPush ? "yes" : "no"],
    ["Verbose", loop.verbose ? "yes" : "no"],
  ];

  for (const [key, value] of loopEntries) {
    console.log(chalk.gray(`    ${key.padEnd(16)} ${value}`));
  }

  // Show storage configuration
  console.log(chalk.white("\n  Storage:"));
  const storage = appConfig.storage;
  const storageBackend = storage.backend || "auto";
  console.log(chalk.gray(`    Backend          ${storageBackend}`));

  if (storage.postgres) {
    const pg = storage.postgres;
    const host = pg.connectionString
      ? chalk.gray("(connection string)")
      : `${pg.host || "localhost"}:${pg.port || 5432}`;
    console.log(
      chalk.gray(
        `    PostgreSQL       ${host}/${pg.database || "agentic_lab"}`,
      ),
    );
  }
  if (storage.redis) {
    const redis = storage.redis;
    const host =
      redis.url || `${redis.host || "localhost"}:${redis.port || 6379}`;
    console.log(chalk.gray(`    Redis            ${host}`));
  }
  if (storage.qdrant) {
    const q = storage.qdrant;
    const host = q.url || `${q.host || "localhost"}:${q.port || 6333}`;
    console.log(chalk.gray(`    Qdrant           ${host}`));
  }

  // Show logging
  console.log(chalk.white("\n  Logging:"));
  console.log(chalk.gray(`    Level            ${appConfig.logging.level}`));
  if (appConfig.logging.logFile) {
    console.log(
      chalk.gray(`    Log File         ${appConfig.logging.logFile}`),
    );
  }

  // Validation check
  if (options.check) {
    console.log(chalk.white("\n  Validation:\n"));
    await runValidation(appConfig, workingDir);
  }

  console.log("");
}

async function runValidation(
  appConfig: Awaited<ReturnType<typeof loadConfig>>,
  _workingDir: string,
): Promise<void> {
  let issues = 0;
  let warnings = 0;

  // Check if at least one provider is configured
  const configuredProviders = Object.keys(appConfig.providers);
  if (configuredProviders.length === 0) {
    console.log(chalk.red("    ❌ No providers configured"));
    console.log(
      chalk.gray(
        "       Set OLLAMA_BASE_URL, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env",
      ),
    );
    issues++;
  } else {
    console.log(
      chalk.green(
        `    ✅ ${configuredProviders.length} provider(s) configured: ${configuredProviders.join(", ")}`,
      ),
    );
  }

  // Check for providers in config but not in factory
  const registeredProviders = getAvailableProviders();
  for (const name of configuredProviders) {
    if (!registeredProviders.includes(name)) {
      console.log(
        chalk.yellow(
          `    ⚠️  Provider "${name}" is configured but not registered in the factory`,
        ),
      );
      warnings++;
    }
  }

  // Check default provider
  const defaultProvider = (appConfig.loop.provider as string) || "ollama";
  if (!configuredProviders.includes(defaultProvider)) {
    console.log(
      chalk.yellow(
        `    ⚠️  Default provider "${defaultProvider}" is not configured`,
      ),
    );
    warnings++;
  } else {
    console.log(
      chalk.green(`    ✅ Default provider "${defaultProvider}" is configured`),
    );
  }

  // Check storage
  if (appConfig.storage.postgres) {
    console.log(chalk.green("    ✅ PostgreSQL configured"));
  } else {
    console.log(
      chalk.gray("    ○  No PostgreSQL configured (will use in-memory)"),
    );
  }

  if (appConfig.storage.redis) {
    console.log(chalk.green("    ✅ Redis configured"));
  } else {
    console.log(chalk.gray("    ○  No Redis configured (events local)"));
  }

  if (appConfig.storage.qdrant) {
    console.log(chalk.green("    ✅ Qdrant configured (vector memory)"));
  } else {
    console.log(chalk.gray("    ○  No Qdrant configured (no vector memory)"));
  }

  // Summary
  console.log("");
  if (issues > 0) {
    console.log(chalk.red(`    ${issues} issue(s), ${warnings} warning(s)`));
  } else if (warnings > 0) {
    console.log(chalk.yellow(`    ✅ No issues, ${warnings} warning(s)`));
  } else {
    console.log(chalk.green("    ✅ Configuration looks good!"));
  }
}

function showMetaKnowledge(): void {
  console.log(chalk.cyan("\n🧠 Agentic Lab — System Meta-Knowledge\n"));

  const meta = getSystemMetaKnowledge();

  // Identity
  console.log(chalk.white("  Identity:"));
  console.log(chalk.gray(`    Name:        ${meta.identity.name}`));
  console.log(chalk.gray(`    Version:     ${meta.identity.version}`));
  console.log(chalk.gray(`    Description: ${meta.identity.description}`));
  console.log(chalk.gray(`    Philosophy:  ${meta.identity.philosophy}`));

  // Architecture
  console.log(chalk.white("\n  Architecture:"));
  console.log(chalk.gray(`    ${meta.architecture.overview}`));
  for (const level of meta.architecture.levels) {
    console.log(chalk.white(`\n    ${level.name}:`));
    console.log(chalk.gray(`      ${level.description}`));
    console.log(chalk.gray(`      Components: ${level.components.join(", ")}`));
  }

  // Capabilities
  console.log(chalk.white("\n  Capabilities:"));
  const grouped = new Map<string, typeof meta.capabilities>();
  for (const cap of meta.capabilities) {
    const list = grouped.get(cap.category) || [];
    list.push(cap);
    grouped.set(cap.category, list);
  }
  for (const [category, caps] of grouped) {
    console.log(chalk.white(`    [${category}]`));
    for (const cap of caps) {
      console.log(chalk.gray(`      • ${cap.name}: ${cap.description}`));
    }
  }

  // Recipes
  if (meta.recipes.length > 0) {
    console.log(chalk.white("\n  Recipes:"));
    for (const recipe of meta.recipes) {
      console.log(chalk.gray(`    • ${recipe.name} (${recipe.id})`));
      console.log(chalk.gray(`      ${recipe.description}`));
    }
  }

  // Providers
  if (meta.providers.length > 0) {
    console.log(chalk.white("\n  Providers:"));
    for (const p of meta.providers) {
      console.log(chalk.gray(`    • ${p.name}: ${p.description}`));
    }
  }

  // Tools
  if (meta.tools.length > 0) {
    console.log(chalk.white("\n  Tools:"));
    for (const tool of meta.tools) {
      console.log(chalk.gray(`    • ${tool.name}: ${tool.description}`));
    }
  }

  console.log("");
}
