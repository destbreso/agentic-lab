"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Zap,
  Brain,
  Shield,
  Database,
  ArrowRight,
  TrendingUp,
  Clock,
  Layers,
  Play,
  Sparkles,
  Eye,
  Target,
  BookOpen,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────── */

interface Stats {
  totalRuns: number;
  totalTokens: number;
  successfulRuns: number;
  avgDurationMs: number;
  providerBreakdown?: Record<string, number>;
  totalCost: number;
  message?: string;
}

interface HealthService {
  name: string;
  status: string;
}

/* ─── Sub-components ─────────────────────────────── */

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  accent = "blue",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  accent?: "blue" | "emerald" | "amber" | "violet";
}) {
  const colors = {
    blue: "text-blue-400 bg-blue-500/10",
    emerald: "text-emerald-400 bg-emerald-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    violet: "text-violet-400 bg-violet-500/10",
  };

  return (
    <Card className="group relative overflow-hidden">
      <div
        className={cn(
          "absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100",
          accent === "blue" &&
            "bg-gradient-to-br from-blue-500/5 to-transparent",
          accent === "emerald" &&
            "bg-gradient-to-br from-emerald-500/5 to-transparent",
          accent === "amber" &&
            "bg-gradient-to-br from-amber-500/5 to-transparent",
          accent === "violet" &&
            "bg-gradient-to-br from-violet-500/5 to-transparent",
        )}
      />
      <CardContent className="relative flex items-center gap-4 p-5">
        <div className={cn("rounded-xl p-2.5", colors[accent])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold text-zinc-50 tabular-nums">
            {value}
          </p>
        </div>
        {trend && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
            <TrendingUp className="h-3 w-3" />
            {trend}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

const LOOPS = [
  {
    name: "Execution",
    icon: Zap,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    role: "Fast, stateless executor. Picks a task, calls LLM with tools, does work.",
    epistemic: "Knows HOW to act, not WHAT matters.",
  },
  {
    name: "Evaluation",
    icon: Eye,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    role: "Verifies real-world changes. Never trusts execution output.",
    epistemic: "Knows WHAT changed, not WHY it matters.",
  },
  {
    name: "Planning",
    icon: Brain,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    role: "Slow, strategic planner. Reviews aggregate state, adjusts direction.",
    epistemic: "Knows WHERE to go, not HOW to get there.",
  },
  {
    name: "Critic",
    icon: Shield,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    role: "Adversarial watchdog. Detects stagnation, circularity, cost runaway.",
    epistemic: "Knows WHEN to stop, not WHAT to do.",
  },
  {
    name: "Memory",
    icon: Database,
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    role: "Summarizes, compresses, denoises. Creates canonical state snapshots.",
    epistemic: "Knows WHAT happened, not WHAT will happen.",
  },
];

function HealthIndicator({ services }: { services: HealthService[] }) {
  if (services.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <div className="h-2 w-2 rounded-full bg-zinc-600" />
        No services detected
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {services.map((s) => (
        <div key={s.name} className="flex items-center justify-between">
          <span className="text-sm text-zinc-400 capitalize">{s.name}</span>
          <Badge
            variant={
              s.status === "healthy"
                ? "success"
                : s.status === "unhealthy"
                  ? "warning"
                  : "error"
            }
          >
            {s.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────── */

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<HealthService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, healthRes] = await Promise.all([
          fetch("/api/stats").then((r) => r.json()),
          fetch("/api/health").then((r) => r.json()),
        ]);
        setStats(statsRes);
        setHealth(healthRes.services || []);
      } catch {
        setStats({
          totalRuns: 0,
          totalTokens: 0,
          successfulRuns: 0,
          avgDurationMs: 0,
          totalCost: 0,
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const formatDuration = (ms: number) => {
    if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
    if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
    return `${ms}ms`;
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm text-zinc-500">Loading dashboard…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6 animate-in fade-in">
      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Runs"
          value={stats?.totalRuns ?? 0}
          icon={Activity}
          accent="blue"
        />
        <StatCard
          label="Tokens Used"
          value={formatTokens(stats?.totalTokens ?? 0)}
          icon={Sparkles}
          accent="violet"
        />
        <StatCard
          label="Success Rate"
          value={
            stats && stats.totalRuns > 0
              ? `${Math.round((stats.successfulRuns / stats.totalRuns) * 100)}%`
              : "—"
          }
          icon={Target}
          accent="emerald"
        />
        <StatCard
          label="Avg Duration"
          value={formatDuration(stats?.avgDurationMs ?? 0)}
          icon={Clock}
          accent="amber"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/pipelines" className="group">
          <Card className="h-full transition-colors hover:border-blue-500/40">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-xl bg-blue-500/10 p-3 text-blue-400 transition-transform group-hover:scale-110">
                <Layers className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-zinc-100">Build Pipeline</p>
                <p className="text-xs text-zinc-500">Drag & drop loop nodes</p>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-blue-400" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/recipes" className="group">
          <Card className="h-full transition-colors hover:border-emerald-500/40">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400 transition-transform group-hover:scale-110">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-zinc-100">Use Recipe</p>
                <p className="text-xs text-zinc-500">Start from a template</p>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-emerald-400" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/runs" className="group">
          <Card className="h-full transition-colors hover:border-violet-500/40">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-xl bg-violet-500/10 p-3 text-violet-400 transition-transform group-hover:scale-110">
                <Play className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-zinc-100">View Runs</p>
                <p className="text-xs text-zinc-500">
                  Execution history & logs
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-violet-400" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Two-column: Loops + System */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Loop Architecture */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-violet-400" />
              Epistemic Loop Architecture
            </CardTitle>
            <CardDescription>
              Five specialized loops with asymmetric knowledge — each knows
              something the others don&apos;t.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {LOOPS.map((loop) => (
              <div
                key={loop.name}
                className={cn(
                  "flex items-start gap-4 rounded-xl border p-4 transition-colors hover:bg-zinc-800/40",
                  loop.border,
                )}
              >
                <div className={cn("rounded-lg p-2", loop.bg)}>
                  <loop.icon className={cn("h-4 w-4", loop.color)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100">
                      {loop.name} Loop
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{loop.role}</p>
                  <p
                    className={cn(
                      "mt-1 text-xs font-medium italic",
                      loop.color,
                    )}
                  >
                    &quot;{loop.epistemic}&quot;
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* System Health */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-emerald-400" />
                System Health
              </CardTitle>
              <CardDescription>Infrastructure service status</CardDescription>
            </CardHeader>
            <CardContent>
              <HealthIndicator services={health} />
            </CardContent>
          </Card>

          {/* Provider Breakdown */}
          {stats?.providerBreakdown &&
            Object.keys(stats.providerBreakdown).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Providers</CardTitle>
                  <CardDescription>Runs by LLM provider</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Object.entries(stats.providerBreakdown).map(
                    ([provider, count]) => (
                      <div
                        key={provider}
                        className="flex items-center justify-between"
                      >
                        <span className="text-sm capitalize text-zinc-400">
                          {provider}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-zinc-200">
                          {count}
                        </span>
                      </div>
                    ),
                  )}
                </CardContent>
              </Card>
            )}

          {/* Cost Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estimated Cost</CardTitle>
              <CardDescription>Last 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums text-zinc-50">
                ${(stats?.totalCost ?? 0).toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
