// ============================================
// Recipe store (web) — file-based persistence
// ============================================
// Saved pipelines are stored as editor-format JSON under the recipes directory
// so they survive restarts and reload into the visual editor with positions +
// per-node config intact.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { WireFeedback } from "@agentic-lab/core";

export interface SavedRecipeNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
  ports?: { inputs: unknown[]; outputs: unknown[] };
}

export interface SavedRecipeWire {
  fromNode: number;
  fromPort: string;
  toNode: number;
  toPort: string;
  /** Optional declarative feedback spec for this wire. */
  feedback?: WireFeedback;
}

export interface SavedRecipe {
  id: string;
  name: string;
  description?: string;
  nodes: SavedRecipeNode[];
  wires: SavedRecipeWire[];
  savedAt?: string;
}

function recipesDir(): string {
  return (
    process.env.AGENTIC_RECIPES_DIR ||
    path.join(process.cwd(), ".agentic-lab", "recipes")
  );
}

export async function saveRecipeFile(recipe: SavedRecipe): Promise<void> {
  const dir = recipesDir();
  await fs.mkdir(dir, { recursive: true });
  const payload: SavedRecipe = { ...recipe, savedAt: new Date().toISOString() };
  await fs.writeFile(
    path.join(dir, `${recipe.id}.json`),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

export async function listSavedRecipes(): Promise<SavedRecipe[]> {
  try {
    const dir = recipesDir();
    const files = await fs.readdir(dir);
    const out: SavedRecipe[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
      } catch {
        /* skip malformed */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function deleteRecipeFile(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(recipesDir(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
