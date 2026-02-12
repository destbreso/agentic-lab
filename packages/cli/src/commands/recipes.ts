// ============================================
// CLI: recipes command — Browse and run recipes
// ============================================

import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import {
  listRecipes,
  getRecipe,
  instantiateRecipe,
  loadConfig,
  createProvider,
  createDefaultToolkit,
  createStorage,
  type PipelineConfig,
  type Signal,
} from "@agentic-lab/core";

interface RecipesOptions {
  run?: string;
  info?: string;
  provider?: string;
  model?: string;
  dir?: string;
  param?: string[];
  verbose?: boolean;
  category?: string;
}

export async function recipesCommand(options: RecipesOptions): Promise<void> {
  // Sub-command: show recipe info
  if (options.info) {
    showRecipeDetail(options.info);
    return;
  }

  // Sub-command: run a recipe
  if (options.run) {
    await runRecipe(options);
    return;
  }

  // Default: list recipes
  listAllRecipes(options.category);
}

function listAllRecipes(category?: string): void {
  console.log(chalk.cyan("\n📋 Agentic Lab — Recipes\n"));

  let recipes = listRecipes();

  if (category) {
    recipes = recipes.filter(
      (r) => r.category?.toLowerCase() === category.toLowerCase(),
    );
  }

  if (recipes.length === 0) {
    console.log(
      chalk.gray(
        category
          ? `  No recipes found in category "${category}".\n`
          : "  No recipes registered.\n",
      ),
    );
    return;
  }

  const table = new Table({
    head: [
      chalk.white("ID"),
      chalk.white("Name"),
      chalk.white("Category"),
      chalk.white("Nodes"),
      chalk.white("Tags"),
    ],
    style: { head: [], border: [] },
    colWidths: [24, 24, 14, 8, 30],
  });

  for (const recipe of recipes) {
    table.push([
      chalk.bold(recipe.id),
      recipe.name,
      recipe.category || chalk.gray("-"),
      String(recipe.nodes.length),
      recipe.tags
        ?.slice(0, 3)
        .map((t) => chalk.gray(`#${t}`))
        .join(" ") || "",
    ]);
  }

  console.log(table.toString());

  // Group by category
  const categories = new Map<string, number>();
  for (const r of listRecipes()) {
    const cat = r.category || "uncategorized";
    categories.set(cat, (categories.get(cat) || 0) + 1);
  }

  console.log(chalk.gray(`\n  ${recipes.length} recipes available`));
  console.log(
    chalk.gray(
      `  Categories: ${Array.from(categories.entries())
        .map(([c, n]) => `${c} (${n})`)
        .join(", ")}`,
    ),
  );
  console.log(chalk.gray("  Use --info <id> for details, --run <id> to run\n"));
}

function showRecipeDetail(recipeId: string): void {
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
  const nodeTable = new Table({
    head: [
      chalk.white("ID"),
      chalk.white("Type"),
      chalk.white("Name"),
      chalk.white("Description"),
    ],
    style: { head: [], border: [] },
    colWidths: [14, 14, 20, 40],
  });

  for (const node of recipe.nodes) {
    nodeTable.push([
      node.id,
      node.type,
      node.name || "-",
      (node.description || "-").slice(0, 38),
    ]);
  }
  console.log(nodeTable.toString());

  // Wires
  if (recipe.wires && recipe.wires.length > 0) {
    console.log(
      chalk.white(
        `\n  Wires: ${recipe.wires.length} connections between nodes`,
      ),
    );
    for (const wire of recipe.wires) {
      const enabled = wire.enabled !== false ? "●" : "○";
      console.log(
        chalk.gray(
          `    ${enabled} ${wire.sourcePortId} → ${wire.targetPortId}`,
        ),
      );
    }
  }

  // Parameters
  if (recipe.parameters && recipe.parameters.length > 0) {
    console.log(chalk.white("\n  Parameters:"));
    for (const param of recipe.parameters) {
      const req = param.required ? chalk.red("*") : " ";
      const def =
        param.default !== undefined
          ? chalk.gray(` (default: ${JSON.stringify(param.default)})`)
          : "";
      console.log(
        chalk.gray(
          `   ${req} ${chalk.bold(param.name)} [${param.type}] — ${param.description}${def}`,
        ),
      );
    }
  }

  console.log(
    chalk.gray(
      `\n  Run: alab recipes --run ${recipe.id} [--param key=value]\n`,
    ),
  );
}

async function runRecipe(options: RecipesOptions): Promise<void> {
  const recipeId = options.run!;
  const workingDir = options.dir || ".";

  console.log(chalk.cyan("\n🚀 Agentic Lab — Running Recipe\n"));

  const recipe = getRecipe(recipeId);
  if (!recipe) {
    console.log(chalk.red(`  ❌ Recipe "${recipeId}" not found.`));
    const available = listRecipes()
      .map((r) => r.id)
      .join(", ");
    console.log(chalk.gray(`  Available: ${available}\n`));
    process.exit(1);
  }

  const spinner = ora("Loading configuration...").start();
  const appConfig = await loadConfig(workingDir);
  spinner.succeed("Configuration loaded");

  // Provider
  const providerName =
    options.provider || (appConfig.loop.provider as string) || "ollama";
  const providerConfig = appConfig.providers[providerName] || {};
  const model =
    options.model || providerConfig.defaultModel || appConfig.loop.model;

  console.log(chalk.gray(`  Provider: ${providerName}`));
  if (model) console.log(chalk.gray(`  Model: ${model}`));
  console.log(chalk.gray(`  Recipe: ${recipe.name}`));

  // Parse params
  const params: Record<string, unknown> = {};
  if (options.param) {
    for (const p of options.param) {
      const eqIdx = p.indexOf("=");
      if (eqIdx > 0) {
        const key = p.slice(0, eqIdx);
        const raw = p.slice(eqIdx + 1);
        if (raw === "true") params[key] = true;
        else if (raw === "false") params[key] = false;
        else if (!isNaN(Number(raw))) params[key] = Number(raw);
        else params[key] = raw;
      }
    }
  }

  if (!params.provider) params.provider = providerName;
  if (model && !params.model) params.model = model;

  // Connect provider
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

  // Tools & Storage
  const tools = createDefaultToolkit();
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

  // Instantiate
  spinner.start("Instantiating pipeline from recipe...");
  const pipelineConfig: Partial<PipelineConfig> = {
    name: `recipe-${recipeId}-${Date.now()}`,
    metadata: { verbose: options.verbose },
  };

  const pipeline = instantiateRecipe(recipeId, params, pipelineConfig);
  spinner.succeed(`Pipeline ready: ${recipe.name}`);

  // Events
  pipeline.on("pipeline:start", () =>
    console.log(chalk.green("\n▶ Pipeline started\n")),
  );
  pipeline.on("node:start", ({ nodeId }) =>
    console.log(chalk.cyan(`  ▸ Node: ${nodeId}`)),
  );
  pipeline.on("node:end", ({ nodeId }) =>
    console.log(chalk.gray(`  ✓ Done: ${nodeId}`)),
  );
  pipeline.on("node:error", ({ nodeId, error }) =>
    console.log(chalk.red(`  ✗ Error: ${nodeId} — ${error.message}`)),
  );
  pipeline.on("pipeline:complete", () => {
    console.log(chalk.cyan("\n═══════════════════════════════════"));
    console.log(chalk.green("✅ Recipe pipeline completed"));
    console.log(chalk.cyan("═══════════════════════════════════\n"));
  });

  if (options.verbose) {
    pipeline.on("signal:sent", ({ signal }) =>
      console.log(
        chalk.gray(`    → [${signal.type}] from ${signal.sourceNodeId}`),
      ),
    );
  }

  // SIGINT
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n⚠️  Stopping pipeline (Ctrl+C)..."));
    pipeline.stop("User interrupted");
  });

  // Build initial signals
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

  // Run
  const result = await pipeline.run(initialSignals);

  console.log(chalk.gray(`  Duration: ${formatMs(result.totalDurationMs)}`));
  console.log(chalk.gray(`  Cycles: ${result.totalCycles}`));
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
