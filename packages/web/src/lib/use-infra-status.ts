// ============================================
// Hook: useInfraStatus
// ============================================
// Shared React hook that polls /api/health and
// exposes service status + capability flags.
// Use this from any page to know what features
// are available with the current infrastructure.

"use client";

import { useEffect, useState, useCallback } from "react";

export interface HealthService {
  name: string;
  status: "healthy" | "unhealthy" | "unavailable";
}

export interface InfraCapabilities {
  /** PostgreSQL is up — run history, stats, cost tracking persist */
  persistence: boolean;
  /** Redis is up — real-time SSE, rate limiting, cache */
  realtime: boolean;
  /** Qdrant is up — semantic vector search across memories */
  semanticSearch: boolean;
}

export interface InfraStatus {
  services: HealthService[];
  capabilities: InfraCapabilities;
  /** Human-readable notes about degraded features */
  degraded: string[];
  /** Overall status */
  status: "healthy" | "degraded" | "unknown";
  /** True while the first fetch is in progress */
  loading: boolean;
  /** True when all 3 services are healthy */
  isFullyHealthy: boolean;
  /** True when no services are available */
  isFullyDown: boolean;
  /** Force re-check */
  refresh: () => void;
}

const POLL_INTERVAL = 60_000; // 60 s

const EMPTY_CAPABILITIES: InfraCapabilities = {
  persistence: false,
  realtime: false,
  semanticSearch: false,
};

export function useInfraStatus(): InfraStatus {
  const [services, setServices] = useState<HealthService[]>([]);
  const [capabilities, setCapabilities] =
    useState<InfraCapabilities>(EMPTY_CAPABILITIES);
  const [degraded, setDegraded] = useState<string[]>([]);
  const [status, setStatus] = useState<"healthy" | "degraded" | "unknown">(
    "unknown",
  );
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      setServices(data.services || []);
      setCapabilities(data.capabilities || EMPTY_CAPABILITIES);
      setDegraded(data.degraded || []);
      setStatus(data.status || "unknown");
    } catch {
      // Network error — assume everything is down
      setServices([
        { name: "postgres", status: "unavailable" },
        { name: "redis", status: "unavailable" },
        { name: "qdrant", status: "unavailable" },
      ]);
      setCapabilities(EMPTY_CAPABILITIES);
      setDegraded(["Could not reach health endpoint"]);
      setStatus("degraded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const isFullyHealthy = services.every((s) => s.status === "healthy");
  const isFullyDown =
    services.length > 0 && services.every((s) => s.status === "unavailable");

  return {
    services,
    capabilities,
    degraded,
    status,
    loading,
    isFullyHealthy,
    isFullyDown,
    refresh: fetchHealth,
  };
}
