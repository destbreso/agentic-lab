// ============================================
// CLI: pipeline command — Run composable pipelines
// ============================================

import chalk from "chalk";
import Table from "cli-table3";
import { runTopologyCommand } from "../session-runner.js";
import {
  listRecipes,
  getRecipe,
  listNodeTypes,
} from "@agentic-lab/core";

interface PipelineOptions {
  task?: string;
  iterations?: string;
  json?: boolean;
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
  // The same engine and output as `agentic-lab run --topology <id>`.
  await runTopologyCommand({ ...options, topology: options.recipe });
}
