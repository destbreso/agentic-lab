import { NextResponse } from "next/server";
import { listRecipes } from "@agentic-lab/core";

/**
 * Layout positions for nodes by category.
 * Provides sensible defaults for the visual pipeline editor canvas.
 */
const CATEGORY_POSITIONS: Record<string, { x: number; y: number }> = {
  planning: { x: 80, y: 200 },
  execution: { x: 380, y: 80 },
  evaluation: { x: 380, y: 320 },
  critic: { x: 680, y: 80 },
  refinement: { x: 680, y: 320 },
  memory: { x: 680, y: 200 },
  custom: { x: 900, y: 200 },
};

/**
 * GET /api/pipelines/recipes
 * List all available recipes — sourced from the core recipe registry.
 * Adds x/y positions for the visual editor.
 */
export async function GET() {
  const coreRecipes = listRecipes();

  const recipes = coreRecipes.map((r) => {
    // Map core serialized nodes → editor-friendly format with positions
    const nodes = r.nodes.map((n, idx) => {
      const pos = CATEGORY_POSITIONS[n.category] ?? { x: 100 + idx * 300, y: 200 };
      // Offset duplicates so nodes in the same category don't stack
      const sameCategory = r.nodes.filter((other, oi) => oi < idx && other.category === n.category).length;
      return {
        type: n.type ?? n.category,
        name: n.name,
        x: pos.x + sameCategory * 40,
        y: pos.y + sameCategory * 40,
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

      return { fromNode, fromPort, toNode, toPort };
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

  return NextResponse.json({ recipes });
}
