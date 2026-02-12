// ============================================
// API: /api/health — Health check endpoint
// ============================================
// Returns service status AND capability flags so
// the UI can show which features are available.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function checkService(
  name: string,
  checkFn: () => Promise<boolean>,
): Promise<{ name: string; status: string }> {
  try {
    const ok = await checkFn();
    return { name, status: ok ? "healthy" : "unhealthy" };
  } catch {
    return { name, status: "unavailable" };
  }
}

export async function GET() {
  const services: Array<{ name: string; status: string }> = [];

  // Check PostgreSQL
  try {
    const { createStorage } = await import("@agentic-lab/core");
    const storage = await createStorage({ backend: "postgres" });
    const healthy = await storage.healthy();
    services.push({
      name: "postgres",
      status: healthy ? "healthy" : "unhealthy",
    });
    await storage.close();
  } catch {
    services.push({ name: "postgres", status: "unavailable" });
  }

  // Check Redis
  try {
    const { RedisEventBus } = await import("@agentic-lab/core");
    const redis = new RedisEventBus({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    });
    await redis.connect();
    const healthy = await redis.healthy();
    services.push({ name: "redis", status: healthy ? "healthy" : "unhealthy" });
    await redis.disconnect();
  } catch {
    services.push({ name: "redis", status: "unavailable" });
  }

  // Check Qdrant
  try {
    const qdrantUrl = `http://${process.env.QDRANT_HOST || "localhost"}:${process.env.QDRANT_PORT || "6333"}`;
    const res = await fetch(`${qdrantUrl}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    services.push({ name: "qdrant", status: res.ok ? "healthy" : "unhealthy" });
  } catch {
    services.push({ name: "qdrant", status: "unavailable" });
  }

  const allHealthy = services.every((s) => s.status === "healthy");

  // Derive capability flags from service status
  const pgOk =
    services.find((s) => s.name === "postgres")?.status === "healthy";
  const redisOk =
    services.find((s) => s.name === "redis")?.status === "healthy";
  const qdrantOk =
    services.find((s) => s.name === "qdrant")?.status === "healthy";

  const capabilities = {
    persistence: pgOk, // Run history, stats, cost tracking survive restarts
    realtime: redisOk, // Live SSE events cross-process, rate limiting, cache
    semanticSearch: qdrantOk, // Vector memory, semantic recall across runs
  };

  // Human-readable notes about degradation
  const degraded: string[] = [];
  if (!pgOk)
    degraded.push(
      "Run history and stats are in-memory only — data will not persist across restarts",
    );
  if (!redisOk)
    degraded.push(
      "Real-time event streaming between CLI and dashboard is unavailable",
    );
  if (!qdrantOk)
    degraded.push(
      "Semantic memory search is disabled — memories stored but not vector-indexed",
    );

  return NextResponse.json({
    status: allHealthy ? "healthy" : "degraded",
    services,
    capabilities,
    degraded,
    timestamp: new Date().toISOString(),
  });
}
