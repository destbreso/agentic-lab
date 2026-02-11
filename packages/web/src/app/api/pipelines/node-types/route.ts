import { NextResponse } from "next/server";
import { listNodeTypes } from "@agentic-lab/core";

/**
 * GET /api/pipelines/node-types
 * List all registered node types — sourced directly from the core registry.
 */
export async function GET() {
  const registered = listNodeTypes();

  // Map core RegisteredNodeType → API response shape
  const nodeTypes = registered.map((entry) => ({
    type: entry.type,
    name: entry.name,
    category: entry.category,
    description: entry.description ?? "",
    version: entry.version ?? "1.0.0",
    defaultConfig: entry.defaultConfig ?? {
      maxIterations: 1,
      delayMs: 0,
      concurrent: false,
    },
    ports: {
      inputs: entry.defaultPorts.inputs.map((p) => ({
        name: p.name,
        signalTypes: p.signalTypes,
        required: p.required ?? false,
      })),
      outputs: entry.defaultPorts.outputs.map((p) => ({
        name: p.name,
        signalTypes: p.signalTypes,
      })),
    },
  }));

  return NextResponse.json({ nodeTypes });
}
