// ============================================
// Component: InfraBanner
// ============================================
// Collapsible banner that shows infrastructure
// degradation warnings. Only visible when at
// least one service is down.

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Database,
  Radio,
  Search,
  X,
} from "lucide-react";
import type { InfraCapabilities, HealthService } from "@/lib/use-infra-status";
import { cn } from "@/lib/utils";

interface InfraBannerProps {
  services: HealthService[];
  capabilities: InfraCapabilities;
  degraded: string[];
  status: "healthy" | "degraded" | "unknown";
}

const CAPABILITY_META: Record<
  keyof InfraCapabilities,
  { label: string; icon: React.ElementType; service: string }
> = {
  persistence: {
    label: "Persistence",
    icon: Database,
    service: "postgres",
  },
  realtime: {
    label: "Real-time events",
    icon: Radio,
    service: "redis",
  },
  semanticSearch: {
    label: "Semantic search",
    icon: Search,
    service: "qdrant",
  },
};

export function InfraBanner({
  services,
  capabilities,
  degraded,
  status,
}: InfraBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Don't render when everything is healthy or dismissed
  if (status === "healthy" || dismissed) return null;

  const downCount = services.filter((s) => s.status !== "healthy").length;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="flex-1 text-xs font-medium text-amber-300">
          Degraded mode — {downCount} infrastructure service
          {downCount !== 1 ? "s" : ""} unavailable
        </span>
        <div className="flex items-center gap-2">
          {/* Capability pills */}
          <div className="hidden items-center gap-1 sm:flex">
            {(Object.keys(capabilities) as Array<keyof InfraCapabilities>).map(
              (key) => {
                const meta = CAPABILITY_META[key];
                const ok = capabilities[key];
                const Icon = meta.icon;
                return (
                  <span
                    key={key}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      ok
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-zinc-700/50 text-zinc-500 line-through",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                );
              },
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-amber-400/60" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-amber-400/60" />
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                setDismissed(true);
              }
            }}
            className="rounded p-0.5 text-amber-400/40 hover:bg-amber-500/10 hover:text-amber-400 cursor-pointer"
          >
            <X className="h-3 w-3" />
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-amber-500/10 px-4 py-3 space-y-2">
          {degraded.map((msg, i) => (
            <p key={i} className="text-xs text-amber-300/70">
              • {msg}
            </p>
          ))}
          <p className="mt-2 text-[10px] text-zinc-500">
            Start infrastructure with{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">
              docker compose up -d
            </code>{" "}
            to enable all features.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Small inline badge showing if a specific feature is available.
 * Use next to features that depend on infrastructure.
 */
export function InfraRequiredBadge({
  available,
  feature,
}: {
  available: boolean;
  feature: string;
}) {
  if (available) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
      <AlertTriangle className="h-2.5 w-2.5 text-amber-500/60" />
      {feature} requires infra
    </span>
  );
}
