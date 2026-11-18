// ============================================
// CLI: recipes command — Browse and run recipes
// ============================================

import chalk from "chalk";
import Table from "cli-table3";
import { runTopologyCommand } from "../session-runner.js";
import {
  listRecipes,
  getRecipe,
} from "@agentic-lab/core";

interface RecipesOptions {
  task?: string;
  iterations?: string;
  json?: boolean;
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
  // The same engine and output as `agentic-lab run --topology <id>`.
  await runTopologyCommand({ ...options, topology: options.run });
}
