import { NextRequest, NextResponse } from "next/server";
import {
  getAllSuites,
  getSuite,
  saveSuite,
  deleteSuite,
  flushSuite,
  getProblems,
  buildRun,
  runBenchmarkSuite,
} from "@/lib/benchmarks";
import type { BenchmarkSuite, BenchmarkContender } from "@/lib/benchmarks";

/**
 * GET /api/benchmarks/suites
 * List all benchmark suites.
 */
export async function GET() {
  const suites = await getAllSuites();
  return NextResponse.json({ suites });
}

/**
 * POST /api/benchmarks/suites
 * Create and start a new benchmark suite.
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   problemIds: string[],          // which problems to test
 *   contenders: BenchmarkContender[],  // baseline + recipes to compare
 *   model: string,
 *   provider: string,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      description = "",
      problemIds = [],
      contenders = [],
      model = "llama3.1:8b",
      provider = "ollama",
      memoryNamespace,
    } = body as {
      name: string;
      description?: string;
      problemIds: string[];
      contenders: BenchmarkContender[];
      model: string;
      provider: string;
      memoryNamespace?: string;
    };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (problemIds.length === 0) {
      return NextResponse.json(
        { error: "At least one problem is required" },
        { status: 400 },
      );
    }
    if (contenders.length < 2) {
      return NextResponse.json(
        {
          error:
            "At least 2 contenders are required (e.g., baseline + one recipe)",
        },
        { status: 400 },
      );
    }

    const allProblems = getProblems();
    const selectedProblems = allProblems.filter((p) =>
      problemIds.includes(p.id),
    );

    if (selectedProblems.length === 0) {
      return NextResponse.json(
        { error: "No valid problems found" },
        { status: 400 },
      );
    }

    // Build suite
    const suite: BenchmarkSuite = {
      id: `suite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      description,
      runs: selectedProblems.map((p) =>
        buildRun(p, contenders, model, provider),
      ),
      model,
      provider,
      memoryNamespace,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    saveSuite(suite);
    flushSuite(suite); // persist initial state to DB

    // Start execution in background (don't await — respond immediately)
    runBenchmarkSuite(suite, selectedProblems, (updated) => {
      flushSuite(updated); // persist progress to DB after each step
    }).catch((err) => {
      console.error("[benchmark] Suite execution error:", err);
      suite.status = "error" as BenchmarkSuite["status"];
      saveSuite(suite);
      flushSuite(suite);
    });

    return NextResponse.json({ suite }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/benchmarks/suites?id=...
 * Delete a benchmark suite.
 */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const found = await getSuite(id);
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  deleteSuite(id);
  return NextResponse.json({ ok: true });
}
