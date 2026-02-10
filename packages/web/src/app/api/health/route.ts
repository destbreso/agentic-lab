// ============================================
// API: /api/health — Health check endpoint
// ============================================

import { NextResponse } from "next/server";

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

  return NextResponse.json({
    status: allHealthy ? "healthy" : "degraded",
    services,
    timestamp: new Date().toISOString(),
  });
}
