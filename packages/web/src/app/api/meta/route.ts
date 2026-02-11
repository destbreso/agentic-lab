import { NextResponse } from "next/server";
import { getSystemMetaKnowledge } from "@agentic-lab/core";

/**
 * GET /api/meta — System introspection endpoint
 *
 * Returns the full meta-knowledge of the Agentic Lab system:
 * identity, architecture, capabilities, recipes, loops, providers, tools.
 *
 * This allows the web UI (or any client) to display system information
 * and enables agents to reason about their own architecture.
 */
export async function GET() {
  try {
    const meta = getSystemMetaKnowledge();
    return NextResponse.json(meta);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
