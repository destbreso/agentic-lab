// ============================================
// API: /api/stats — Analytics and statistics
// ============================================

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function GET() {
  let storage: Awaited<ReturnType<typeof getStorageClient>> = null;
  try {
    storage = await getStorageClient();
    if (!storage) {
      return NextResponse.json({
        totalRuns: 0,
        totalTokens: 0,
        dailyStats: [],
        toolStats: [],
        totalCost: 0,
        message: "Storage not configured",
      });
    }

    const [runsResult, dailyStats, toolStats, totalCost] = await Promise.all([
      storage.runs.listRuns({ limit: 1000 }),
      storage.usage.getDailyStats(30),
      storage.runs.getToolStats(),
      storage.usage.getTotalCost({ days: 30 }),
    ]);

    // Aggregate stats
    const runs = runsResult.runs;
    const totalTokens = runs.reduce((sum, r) => sum + r.totalTokens, 0);
    const successfulRuns = runs.filter((r) => r.success).length;
    const avgDurationMs =
      runs.length > 0
        ? runs.reduce((sum, r) => sum + (r.durationMs || 0), 0) / runs.length
        : 0;

    // Provider breakdown
    const providerCounts: Record<string, number> = {};
    for (const r of runs) {
      providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1;
    }

    return NextResponse.json({
      totalRuns: runs.length,
      totalTokens,
      successfulRuns,
      avgDurationMs: Math.round(avgDurationMs),
      providerBreakdown: providerCounts,
      dailyStats,
      toolStats,
      totalCost,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}
