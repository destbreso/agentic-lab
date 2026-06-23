import { NextRequest, NextResponse } from "next/server";
import { listRecipes } from "@agentic-lab/core";
import {
  listSavedRecipes,
  saveRecipeFile,
  deleteRecipeFile,
  type SavedRecipe,
} from "@/lib/recipe-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Layout positions for nodes by category.
 * Provides sensible defaults for the visual pipeline editor canvas.
 * When multiple nodes share a category, they are offset diagonally.
 */
const CATEGORY_POSITIONS: Record<string, { x: number; y: number }> = {
  planning: { x: 80, y: 200 },
  execution: { x: 380, y: 80 },
  evaluation: { x: 680, y: 200 },
  critic: { x: 680, y: 80 },
  refinement: { x: 680, y: 320 },
  memory: { x: 900, y: 200 },
  custom: { x: 900, y: 200 },
};

/**
 * GET /api/pipelines/recipes
 * List all available recipes — sourced from the core recipe registry.
 * Adds x/y positions and per-node ports for the visual editor.
 */
export async function GET() {
  const coreRecipes = listRecipes();

  const recipes = coreRecipes.map((r) => {
    // Track how many nodes per category for offset stacking
    const categoryCount: Record<string, number> = {};

    // Map core serialized nodes → editor-friendly format with positions + ports
    const nodes = r.nodes.map((n, idx) => {
      const cat = n.category;
      const pos = CATEGORY_POSITIONS[cat] ?? { x: 100 + idx * 300, y: 200 };
      const sameIdx = categoryCount[cat] || 0;
      categoryCount[cat] = sameIdx + 1;

      // Offset duplicate-category nodes vertically (not diagonally — avoids overlaps)
      const offsetX = sameIdx * 20;
      const offsetY = sameIdx * 180;

      return {
        id: n.id,
        type: n.type ?? n.category,
        name: n.name,
        x: pos.x + offsetX,
        y: pos.y + offsetY,
        ports: n.ports
          ? {
              inputs: n.ports.inputs.map((p) => ({
                name: p.name,
                signalTypes: p.signalTypes,
                required: p.required ?? false,
              })),
              outputs: n.ports.outputs.map((p) => ({
                name: p.name,
                signalTypes: p.signalTypes,
              })),
            }
          : undefined,
      };
    });

    // Map core wires (portId-based) → editor-friendly format (index-based)
    const wires = r.wires.map((w) => {
      // Core wire format: "nodeId:out:portName" → "nodeId:in:portName"
      const srcParts = w.sourcePortId.split(":");
      const tgtParts = w.targetPortId.split(":");
      const fromNodeId = srcParts[0];
      const toNodeId = tgtParts[0];
      const fromPort = srcParts[2] ?? srcParts[1];
      const toPort = tgtParts[2] ?? tgtParts[1];

      const fromNode = r.nodes.findIndex((n) => n.id === fromNodeId);
      const toNode = r.nodes.findIndex((n) => n.id === toNodeId);

      return { fromNode, fromPort, toNode, toPort, feedback: w.feedback };
    });

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      author: r.author ?? "Agentic Lab",
      tags: r.tags ?? [],
      category: r.category ?? "basic",
      nodeCount: nodes.length,
      wireCount: wires.length,
      nodes,
      wires,
    };
  });

  // Merge user-saved pipelines (already in editor format) after the built-ins.
  const saved = await listSavedRecipes();
  const savedMapped = saved.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    version: "1.0.0",
    author: "You",
    tags: ["saved"],
    category: "saved",
    saved: true,
    nodeCount: r.nodes?.length ?? 0,
    wireCount: r.wires?.length ?? 0,
    nodes: r.nodes ?? [],
    wires: r.wires ?? [],
  }));

  return NextResponse.json({ recipes: [...recipes, ...savedMapped] });
}

/**
 * POST /api/pipelines/recipes
 * Persist a pipeline composed in the editor (editor-format graph).
 */
export async function POST(req: NextRequest) {
  let body: SavedRecipe;
  try {
    body = (await req.json()) as SavedRecipe;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.name || !Array.isArray(body.nodes)) {
    return NextResponse.json({ error: "name and nodes are required" }, { status: 400 });
  }

  const id =
    body.id ||
    `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()
      .toString(36)
      .slice(-4)}`;

  await saveRecipeFile({ ...body, id });
  return NextResponse.json({ ok: true, id });
}

/**
 * DELETE /api/pipelines/recipes?id=...
 * Remove a saved pipeline.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteRecipeFile(id);
  return NextResponse.json({ ok });
}
