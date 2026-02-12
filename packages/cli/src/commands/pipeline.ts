// ============================================
// CLI: pipeline command — Run composable pipelines
// ============================================

import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import {
  loadConfig,
  createProvider,
  createDefaultToolkit,
  createStorage,
  listRecipes,
  getRecipe,
  instantiateRecipe,
  listNodeTypes,
  type PipelineConfig,
  type Signal,
} from "@agentic-lab/core";

interface PipelineOptions {
  recipe?: string;
  provider?: string;
  model?: string;
  dir?: string;
  verbose?: boolean;
  param?: string[];
  list?: boolean;
  nodes?: boolean;
  info?: string;
}

export async function pipelineCommand(options: PipelineOptions): Promise<void> {
  // Sub-command: list node types
  if (options.nodes) {
    listAvailableNodes();
    return;
  }

  // Sub-command: list recipes
  if (options.list) {
    listAvailableRecipes();
    return;
  }

  // Sub-command: show recipe info
  if (options.info) {
    showRecipeInfo(options.info);
    return;
  }

  // Run a recipe-based pipeline
  if (!options.recipe) {
    console.log(chalk.red("\n  ❌ No recipe specified.\n"));
    console.log(chalk.gray("  Usage:"));
    console.log(
      chalk.gray("    alab pipeline --recipe <id>    Run a pipeline recipe"),
    );
    console.log(
      chalk.gray("    alab pipeline --list           List available recipes"),
    );
    console.log(
      chalk.gray("    alab pipeline --nodes          List node types"),
    );
    console.log(
      chalk.gray("    alab pipeline --info <id>      Show recipe details\n"),
    );
    return;
  }

  await runPipeline(options);
}

function listAvailableNodes(): void {
  console.log(chalk.cyan("\n🧩 Agentic Lab — Available Node Types\n"));

  const nodeTypes = listNodeTypes();

  if (nodeTypes.length === 0) {
    console.log(chalk.gray("  No node types registered.\n"));
    return;
  }

  const table = new Table({
    head: [
      chalk.white("Type"),
      chalk.white("Category"),
      chalk.white("Description"),
    ],
    style: { head: [], border: [] },
    colWidths: [20, 15, 50],
  });

  for (const nt of nodeTypes) {
    table.push([
      chalk.bold(nt.type),
      nt.category || chalk.gray("-"),
      nt.description || chalk.gray("-"),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\n  ${nodeTypes.length} node types available\n`));
}

function listAvailableRecipes(): void {
  console.log(chalk.cyan("\n📋 Agentic Lab — Available Recipes\n"));

  const recipes = listRecipes();

  if (recipes.length === 0) {
    console.log(chalk.gray("  No recipes registered.\n"));
    return;
  }

  const table = new Table({
    head: [
      chalk.white("ID"),
      chalk.white("Name"),
      chalk.white("Category"),
      chalk.white("Description"),
    ],
    style: { head: [], border: [] },
    colWidths: [22, 22, 14, 50],
  });

  for (const recipe of recipes) {
    table.push([
      chalk.bold(recipe.id),
      recipe.name,
      recipe.category || chalk.gray("-"),
      recipe.description.slice(0, 48) +
        (recipe.description.length > 48 ? "…" : ""),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\n  ${recipes.length} recipes available`));
  console.log(chalk.gray("  Use --info <id> to see details\n"));
}

function showRecipeInfo(recipeId: string): void {
  const recipe = getRecipe(recipeId);

  if (!recipe) {
    console.log(chalk.red(`\n  ❌ Recipe "${recipeId}" not found.`));
    const available = listRecipes()
      .map((r) => r.id)
      .join(", ");
    console.log(chalk.gray(`  Available: ${available}\n`));
    return;
  }

  console.log(chalk.cyan(`\n📋 Recipe: ${recipe.name}\n`));
  console.log(chalk.white(`  ID:          ${recipe.id}`));
  console.log(chalk.white(`  Version:     ${recipe.version}`));
  console.log(chalk.white(`  Category:    ${recipe.category || "-"}`));
  console.log(chalk.white(`  Author:      ${recipe.author || "-"}`));
  console.log(chalk.white(`  Description: ${recipe.description}`));

  if (recipe.tags && recipe.tags.length > 0) {
    console.log(
      chalk.white(
        `  Tags:        ${recipe.tags.map((t) => chalk.gray(`#${t}`)).join(", ")}`,
      ),
    );
  }

  // Nodes
  console.log(chalk.white("\n  Nodes:"));
  for (const node of recipe.nodes) {
    console.log(
      chalk.gray(
        `    • ${chalk.bold(node.name || node.id)} (${node.type}) — ${node.description || ""}`,
      ),
    );
  }

  // Wires
  if (recipe.wires && recipe.wires.length > 0) {
    console.log(chalk.white(`\n  Wires: ${recipe.wires.length} connections`));
  }

  // Parameters
  if (recipe.parameters && recipe.parameters.length > 0) {
    console.log(chalk.white("\n  Parameters:"));
    for (const param of recipe.parameters) {
      const req = param.required ? chalk.red("*") : "";
      const def =
        param.default !== undefined
          ? chalk.gray(` (default: ${param.default})`)
          : "";
      console.log(
        chalk.gray(
          `    ${req}${chalk.bold(param.name)} [${param.type}] — ${param.description}${def}`,
        ),
      );
    }
  }

  console.log("");
}

async function runPipeline(options: PipelineOptions): Promise<void> {
  const workingDir = options.dir || ".";

  console.log(chalk.cyan("\n🔀 Agentic Lab — Pipeline Runner\n"));

  const spinner = ora("Loading configuration...").start();
  const appConfig = await loadConfig(workingDir);
  spinner.succeed("Configuration loaded");

  // Resolve provider
  const providerName =
    options.provider || (appConfig.loop.provider as string) || "ollama";
  const providerConfig = appConfig.providers[providerName] || {};
  const model =
    options.model || providerConfig.defaultModel || appConfig.loop.model;

  console.log(chalk.gray(`  Provider: ${providerName}`));
  if (model) console.log(chalk.gray(`  Model: ${model}`));

  // Parse recipe params (--param key=value)
  const params: Record<string, unknown> = {};
  if (options.param) {
    for (const p of options.param) {
      const eqIdx = p.indexOf("=");
      if (eqIdx > 0) {
        const key = p.slice(0, eqIdx);
        const raw = p.slice(eqIdx + 1);
        // Try to parse as number/boolean
        if (raw === "true") params[key] = true;
        else if (raw === "false") params[key] = false;
        else if (!isNaN(Number(raw))) params[key] = Number(raw);
        else params[key] = raw;
      }
    }
  }

  // Inject provider/model into params if recipe expects them
  if (!params.provider) params.provider = providerName;
  if (model && !params.model) params.model = model;

  // Get recipe info
  const recipe = getRecipe(options.recipe!);
  if (!recipe) {
    console.log(chalk.red(`\n  ❌ Recipe "${options.recipe}" not found.`));
    const available = listRecipes()
      .map((r) => r.id)
      .join(", ");
    console.log(chalk.gray(`  Available: ${available}\n`));
    process.exit(1);
  }

  console.log(chalk.gray(`  Recipe: ${recipe.name} (${recipe.id})`));
  console.log(chalk.gray(`  Nodes: ${recipe.nodes.length}`));
  console.log(chalk.gray(`  Wires: ${recipe.wires?.length || 0}`));

  // Create provider
  spinner.start(`Connecting to ${providerName}...`);
  const provider = createProvider(providerName, {
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model: model || "default",
  });

  const healthy = await provider.healthCheck();
  if (!healthy) {
    spinner.fail(`Cannot connect to ${providerName}`);
    process.exit(1);
  }
  spinner.succeed(`Connected to ${providerName}`);

  // Create tools
  const tools = createDefaultToolkit();

  // Storage
  let storage;
  try {
    spinner.start("Connecting to storage...");
    storage = await createStorage(appConfig.storage);
    spinner.succeed(
      `Storage: ${storage.constructor.name.replace("Storage", "")}`,
    );
  } catch {
    spinner.info("Storage: in-memory (no persistence)");
  }

  // Instantiate the pipeline from the recipe
  spinner.start("Instantiating pipeline from recipe...");
  const pipelineConfig: Partial<PipelineConfig> = {
    name: `pipeline-${recipe.id}-${Date.now()}`,
    metadata: { verbose: options.verbose },
  };

  const pipeline = instantiateRecipe(recipe.id, params, pipelineConfig);
  spinner.succeed(`Pipeline instantiated: ${recipe.name}`);

  // Wire events
  pipeline.on("pipeline:start", () => {
    console.log(chalk.green("\n▶ Pipeline started\n"));
  });

  pipeline.on("node:start", ({ nodeId }) => {
    console.log(chalk.cyan(`  ▸ Node started: ${nodeId}`));
  });

  pipeline.on("node:end", ({ nodeId }) => {
    console.log(chalk.gray(`  ✓ Node complete: ${nodeId}`));
  });

  pipeline.on("node:error", ({ nodeId, error }) => {
    console.log(chalk.red(`  ✗ Node error: ${nodeId} — ${error.message}`));
  });

  pipeline.on("signal:sent", ({ signal }) => {
    if (options.verbose) {
      console.log(
        chalk.gray(`    → Signal [${signal.type}] from ${signal.sourceNodeId}`),
      );
    }
  });

  pipeline.on("pipeline:complete", ({ result }) => {
    console.log(chalk.cyan("\n═══════════════════════════════════"));
    console.log(chalk.green("✅ Pipeline completed"));
    console.log(chalk.cyan("═══════════════════════════════════\n"));
  });

  pipeline.on("pipeline:error", ({ error }) => {
    console.log(chalk.cyan("\n═══════════════════════════════════"));
    console.log(chalk.red(`❌ Pipeline error: ${error.message}`));
    console.log(chalk.cyan("═══════════════════════════════════\n"));
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n⚠️  Stopping pipeline (Ctrl+C)..."));
    pipeline.stop("User interrupted");
  });

  // Build initial signals with provider/tools context
  const initialSignals: Signal[] = [
    {
      sourceNodeId: "cli",
      type: "context",
      data: {
        provider: providerName,
        model: model || "default",
        workingDir: workingDir,
      },
      timestamp: new Date().toISOString(),
    },
  ];

  // Run the pipeline
  const result = await pipeline.run(initialSignals);

  // Summary
  console.log(chalk.gray(`  Duration: ${formatMs(result.totalDurationMs)}`));
  console.log(chalk.gray(`  Cycles: ${result.totalCycles}`));
  console.log(
    chalk.gray(
      `  ${result.success ? "Completed successfully" : "Finished with errors"}: ${result.summary}`,
    ),
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
