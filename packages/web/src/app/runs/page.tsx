"use client";

import { useEffect, useState, useCallback } from "react";
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  Filter,
  ChevronDown,
  Sparkles,
  Cpu,
  Timer,
  Search,
  ArrowUpDown,
  ExternalLink,
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

interface Run {
  id: string;
  status: string;
  provider: string;
  model: string;
  totalTokens: number;
  totalIterations: number;
  durationMs: number;
  success: boolean;
  created_at: string;
  completed_at?: string;
  error?: string;
}

/* ─── Helpers ────────────────────────────────────── */

function formatDuration(ms: number) {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const STATUS_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; bg: string; label: string }
> = {
  completed: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    label: "Failed",
  },
  running: {
    icon: Loader2,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    label: "Running",
  },
  pending: {
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Pending",
  },
};

/* ─── Run Row ────────────────────────────────────── */

function RunRow({ run, onSelect }: { run: Run; onSelect: () => void }) {
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <button
      onClick={onSelect}
      className="group flex w-full items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left transition-all hover:border-zinc-700 hover:bg-zinc-800/40"
    >
      {/* Status */}
      <div className={cn("rounded-lg p-2", config.bg)}>
        <StatusIcon
          className={cn(
            "h-4 w-4",
            config.color,
            run.status === "running" && "animate-spin",
          )}
        />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-200 truncate">
            {run.id.slice(0, 12)}…
          </span>
          <Badge
            variant={
              run.success
                ? "success"
                : run.status === "running"
                  ? "default"
                  : "error"
            }
            className="text-[10px]"
          >
            {config.label}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {run.provider}/{run.model}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(run.created_at)}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="hidden items-center gap-6 sm:flex">
        <div className="text-right">
          <p className="text-[10px] text-zinc-600">Tokens</p>
          <p className="text-xs font-semibold tabular-nums text-zinc-300">
            {formatTokens(run.totalTokens)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-600">Iterations</p>
          <p className="text-xs font-semibold tabular-nums text-zinc-300">
            {run.totalIterations}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-600">Duration</p>
          <p className="text-xs font-semibold tabular-nums text-zinc-300">
            {formatDuration(run.durationMs)}
          </p>
        </div>
      </div>

      {/* Arrow */}
      <ExternalLink className="h-4 w-4 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-400" />
    </button>
  );
}

/* ─── Run Detail Modal ───────────────────────────── */

function RunDetail({ run, onClose }: { run: Run; onClose: () => void }) {
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-lg mx-4 animate-in fade-in zoom-in-95">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <StatusIcon className={cn("h-4 w-4", config.color)} />
              Run {run.id.slice(0, 16)}…
            </CardTitle>
            <CardDescription className="mt-1">
              {run.provider} / {run.model}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-800 p-3 text-center">
              <Sparkles className="mx-auto mb-1 h-4 w-4 text-violet-400" />
              <p className="text-lg font-bold tabular-nums text-zinc-100">
                {formatTokens(run.totalTokens)}
              </p>
              <p className="text-[10px] text-zinc-500">Tokens</p>
            </div>
            <div className="rounded-xl border border-zinc-800 p-3 text-center">
              <RefreshCw className="mx-auto mb-1 h-4 w-4 text-blue-400" />
              <p className="text-lg font-bold tabular-nums text-zinc-100">
                {run.totalIterations}
              </p>
              <p className="text-[10px] text-zinc-500">Iterations</p>
            </div>
            <div className="rounded-xl border border-zinc-800 p-3 text-center">
              <Timer className="mx-auto mb-1 h-4 w-4 text-emerald-400" />
              <p className="text-lg font-bold tabular-nums text-zinc-100">
                {formatDuration(run.durationMs)}
              </p>
              <p className="text-[10px] text-zinc-500">Duration</p>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Status</span>
              <Badge variant={run.success ? "success" : "error"}>
                {config.label}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Created</span>
              <span className="text-zinc-300">
                {new Date(run.created_at).toLocaleString()}
              </span>
            </div>
            {run.completed_at && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Completed</span>
                <span className="text-zinc-300">
                  {new Date(run.completed_at).toLocaleString()}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-500">Full ID</span>
              <span className="font-mono text-xs text-zinc-400">{run.id}</span>
            </div>
          </div>

          {/* Error */}
          {run.error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-xs font-medium text-red-400">Error</p>
              <p className="mt-1 text-xs text-red-300/80">{run.error}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────── */

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs?limit=100");
      const data = await res.json();
      setRuns(data.runs || []);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const filtered = runs.filter((r) => {
    const matchSearch =
      search === "" ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.provider.toLowerCase().includes(search.toLowerCase()) ||
      r.model.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statuses = ["all", "completed", "running", "failed", "pending"];

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm text-zinc-500">Loading runs…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 animate-in fade-in">
      {/* Header actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by ID, provider, or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 py-2 pl-10 pr-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter */}
          <div className="flex gap-1 rounded-xl bg-zinc-800/50 p-1">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  statusFilter === s
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <Button variant="ghost" size="sm" onClick={loadRuns}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Run List */}
      {filtered.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <History className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-400">
              {runs.length === 0 ? "No runs yet" : "No runs match your filters"}
            </p>
            <p className="text-xs text-zinc-600">
              {runs.length === 0
                ? "Run a pipeline from the CLI or Pipelines page to see results here."
                : "Try a different search or status filter."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onSelect={() => setSelectedRun(run)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedRun && (
        <RunDetail run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </div>
  );
}
