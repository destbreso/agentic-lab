import { NextRequest, NextResponse } from "next/server";
import { getSuite } from "@/lib/benchmarks";
import { contenderStats } from "@/lib/benchmarks/summary";

/**
 * GET /api/benchmarks/suites/[id]
 * Get a single benchmark suite with all results.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const suite = await getSuite(id);

  if (!suite) {
    return NextResponse.json({ error: "Suite not found" }, { status: 404 });
  }

  // Compute aggregated stats
  const stats = {
    totalRuns: suite.runs.length,
    completedRuns: suite.runs.filter((r) => r.status === "completed").length,
    contenderSummary: suite.runs.length > 0
      ? suite.runs[0].contenders.map((c) => {
          const results = suite.runs.flatMap((r) => r.results).filter((r) => r.contenderId === c.id);
          // A score of -1 (no score) is counted apart, never averaged in.
          return { contenderId: c.id, label: c.label, type: c.type, ...contenderStats(results) };
        })
      : [],
  };

  return NextResponse.json({ suite, stats });
}
