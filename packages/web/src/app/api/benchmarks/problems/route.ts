import { NextResponse } from "next/server";
import { getProblems } from "@/lib/benchmarks";

/**
 * GET /api/benchmarks/problems
 * Returns the full problem bank for benchmarking.
 */
export async function GET() {
  const problems = getProblems();

  const categories = [...new Set(problems.map((p) => p.category))];
  const difficulties = [...new Set(problems.map((p) => p.difficulty))];

  return NextResponse.json({
    problems,
    total: problems.length,
    categories,
    difficulties,
  });
}
