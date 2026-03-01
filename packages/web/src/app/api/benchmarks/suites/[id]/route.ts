import { NextRequest, NextResponse } from "next/server";
import { getSuite } from "@/lib/benchmarks";

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
          const results = suite.runs
            .flatMap((r) => r.results)
            .filter((r) => r.contenderId === c.id && r.status === "completed");
          const avgScore =
            results.length > 0
              ? results.reduce((sum, r) => sum + r.qualityScore, 0) / results.length
              : 0;
          const avgDuration =
            results.length > 0
              ? results.reduce((sum, r) => sum + r.durationMs, 0) / results.length
              : 0;
          const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);
          return {
            contenderId: c.id,
            label: c.label,
            type: c.type,
            avgScore: Math.round(avgScore * 10) / 10,
            avgDurationMs: Math.round(avgDuration),
            totalTokens,
            completedRuns: results.length,
          };
        })
      : [],
  };

  return NextResponse.json({ suite, stats });
}
