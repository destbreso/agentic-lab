// ============================================
// CLI: run command — Execute an agentic loop
// ============================================

import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import {
  loadConfig,
  createProvider,
  createDefaultToolkit,
  AgenticLoop,
  createStorage,
  type LoopConfig,
} from "@agentic-lab/core";

interface RunOptions {
  provider?: string;
  model?: string;
  iterations?: string;
  delay?: string;
  prompt?: string;
  plan?: string;
  specs?: string;
  dir?: string;
  autoCommit?: boolean;
  autoPush?: boolean;
  verbose?: boolean;
  log?: string;
  temperature?: string;
  maxTokens?: string;
  tools?: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const workingDir = path.resolve(options.dir || ".");

  console.log(chalk.cyan("\n🤖 Agentic Lab — Starting Loop\n"));

  // Load configuration
  const spinner = ora("Loading configuration...").start();
  const appConfig = await loadConfig(workingDir);
  spinner.succeed("Configuration loaded");

  // Resolve provider
  const providerName =
    options.provider || (appConfig.loop.provider as string) || "ollama";
  const providerConfig = appConfig.providers[providerName] || {};
  const model =
    options.model ||
    providerConfig.defaultModel ||
    appConfig.loop.model ||
    "llama3.1";

  console.log(chalk.gray(`  Provider: ${providerName}`));
  console.log(chalk.gray(`  Model: ${model}`));

  // Create provider
  spinner.start(`Connecting to ${providerName}...`);
  const provider = createProvider(providerName, {
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model,
  });

  // Health check
  const healthy = await provider.healthCheck();
  if (!healthy) {
    spinner.fail(`Cannot connect to ${providerName}`);
    console.log(
      chalk.red(
        `\n  ❌ Provider "${providerName}" is not reachable. Check your configuration.\n`,
      ),
    );
    process.exit(1);
  }
  spinner.succeed(`Connected to ${providerName} (${model})`);

  // Create tools
  const enabledTools = options.tools?.split(",").map((t) => t.trim());
  const tools = createDefaultToolkit(enabledTools);

  console.log(
    chalk.gray(
      `  Tools: ${tools
        .getAll()
        .map((t) => t.definition.name)
        .join(", ")}`,
    ),
  );

  // Build loop config
  const loopConfig: LoopConfig = {
    name: `loop-${Date.now()}`,
    provider: providerName,
    model,
    maxIterations: parseInt(options.iterations || "10"),
    delayMs: parseInt(options.delay || "1000"),
    promptFile: options.prompt || "PROMPT.md",
    planFile: options.plan || "PLAN.md",
    specsDir: options.specs,
    workingDir,
    temperature: options.temperature
      ? parseFloat(options.temperature)
      : undefined,
    maxTokens: options.maxTokens ? parseInt(options.maxTokens) : undefined,
    verbose: options.verbose,
    logFile: options.log,
    autoCommit: options.autoCommit,
    autoPush: options.autoPush,
    enabledTools: enabledTools,
  };

  // Initialize storage backend
  let storage;
  try {
    spinner.start("Connecting to storage...");
    storage = await createStorage(appConfig.storage);
    spinner.succeed(`Storage: ${storage.constructor.name.replace("Storage", "")}`);
  } catch {
    spinner.info("Storage: in-memory (no persistence)");
  }

  // Create and run the loop
  const loop = new AgenticLoop({
    config: loopConfig,
    provider,
    tools,
    storage,
  });

  // Wire up events for CLI output
  loop.on("iteration:start", ({ iteration }) => {
    console.log(
      chalk.cyan(
        `\n─── Iteration ${iteration}/${loopConfig.maxIterations} ───`,
      ),
    );
  });

  loop.on("tool:call", ({ name, iteration }) => {
    console.log(chalk.gray(`  🔧 ${name}`));
  });

  loop.on("llm:response", ({ usage, iteration }) => {
    console.log(
      chalk.gray(
        `  📊 Tokens: ${usage.totalTokens.toLocaleString()} (in: ${usage.inputTokens.toLocaleString()}, out: ${usage.outputTokens.toLocaleString()})`,
      ),
    );
  });

  loop.on("iteration:error", ({ error, iteration }) => {
    console.log(
      chalk.red(`  ❌ Error in iteration ${iteration}: ${error.message}`),
    );
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n⚠️  Stopping loop (Ctrl+C)..."));
    loop.stop("User interrupted");
  });

  console.log(chalk.green("\n▶ Loop started\n"));

  const result = await loop.run();

  // Final summary
  console.log(chalk.cyan("\n═══════════════════════════════════"));
  console.log(
    result.success
      ? chalk.green("✅ Loop completed successfully")
      : chalk.red("❌ Loop finished with errors"),
  );
  console.log(chalk.gray(result.summary));
  console.log(chalk.cyan("═══════════════════════════════════\n"));
}
