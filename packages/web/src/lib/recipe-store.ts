// ============================================
// Recipe store (web): file-based persistence
// ============================================
// Saved pipelines are stored as editor-format JSON under the recipes directory
// so they survive restarts and reload into the visual editor with positions +
// per-node config intact.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureProjectDir, readablePaths, type WireFeedback } from "jig-core";

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
  /** The fields the wire delivers; absent means every field. */
  fields?: string[];
}

export interface SavedRecipe {
  id: string;
  name: string;
  description?: string;
  nodes: SavedRecipeNode[];
  wires: SavedRecipeWire[];
  savedAt?: string;
}

/** Where recipes are written: AGENTIC_RECIPES_DIR, else .jig/recipes. */
async function writableDir(): Promise<string> {
  if (process.env.AGENTIC_RECIPES_DIR) {
    await fs.mkdir(process.env.AGENTIC_RECIPES_DIR, { recursive: true });
    return process.env.AGENTIC_RECIPES_DIR;
  }
  return ensureProjectDir(process.cwd(), "recipes");
}

/** Where recipes are read: the same, and .agentic-lab/recipes from before the rename. */
function readableDirs(): string[] {
  return process.env.AGENTIC_RECIPES_DIR ? [process.env.AGENTIC_RECIPES_DIR] : readablePaths(process.cwd(), "recipes");
}

export async function saveRecipeFile(recipe: SavedRecipe): Promise<void> {
  const dir = await writableDir();
  const payload: SavedRecipe = { ...recipe, savedAt: new Date().toISOString() };
  await fs.writeFile(
    path.join(dir, `${recipe.id}.json`),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

export async function listSavedRecipes(): Promise<SavedRecipe[]> {
  const out: SavedRecipe[] = [];
  const seen = new Set<string>();
  for (const dir of readableDirs()) {
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json") || seen.has(f)) continue;
      seen.add(f);
      try {
        out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
      } catch {
        /* skip malformed */
      }
    }
  }
  return out;
}

export async function deleteRecipeFile(id: string): Promise<boolean> {
  let deleted = false;
  for (const dir of readableDirs()) {
    try {
      await fs.unlink(path.join(dir, `${id}.json`));
      deleted = true;
    } catch {
      /* not in this folder */
    }
  }
  return deleted;
}
