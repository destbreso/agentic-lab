// ============================================
// API: /api/metrics — Prometheus metrics endpoint
// ============================================
// Exposes metrics in Prometheus format for
// scraping by the Prometheus container.

import { NextResponse } from "next/server";

async function getStorageClient() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

export async function GET() {
  const storage = await getStorageClient();
  const lines: string[] = [];

  lines.push("# HELP agentic_lab_runs_total Total number of runs");
  lines.push("# TYPE agentic_lab_runs_total counter");

  lines.push("# HELP agentic_lab_tokens_total Total tokens consumed");
  lines.push("# TYPE agentic_lab_tokens_total counter");

  lines.push("# HELP agentic_lab_tool_calls_total Total tool calls");
  lines.push("# TYPE agentic_lab_tool_calls_total counter");

  lines.push("# HELP agentic_lab_run_duration_seconds Run duration in seconds");
  lines.push("# TYPE agentic_lab_run_duration_seconds histogram");

  if (storage) {
    try {
      const { runs, total } = await storage.runs.listRuns({ limit: 10000 });

      // Runs total by status
      const statusCounts: Record<string, number> = {};
      for (const r of runs) {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        lines.push(`agentic_lab_runs_total{status="${status}"} ${count}`);
      }

      // Tokens total
      const totalTokens = runs.reduce((sum, r) => sum + r.totalTokens, 0);
      lines.push(`agentic_lab_tokens_total ${totalTokens}`);

      // Tool stats
      const toolStats = await storage.runs.getToolStats();
      for (const t of toolStats) {
        lines.push(`agentic_lab_tool_calls_total{tool="${t.name}"} ${t.count}`);
      }

      // Provider breakdown
      const providerTokens: Record<string, number> = {};
      for (const r of runs) {
        providerTokens[r.provider] =
          (providerTokens[r.provider] || 0) + r.totalTokens;
      }
      for (const [provider, tokens] of Object.entries(providerTokens)) {
        lines.push(
          `agentic_lab_tokens_total{provider="${provider}"} ${tokens}`,
        );
      }
    } catch {
      lines.push("# Storage query failed");
    }
  } else {
    lines.push("agentic_lab_runs_total 0");
    lines.push("agentic_lab_tokens_total 0");
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
