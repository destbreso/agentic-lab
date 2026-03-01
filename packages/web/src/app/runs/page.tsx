"use client";

import { useEffect, useState, useCallback } from "react";
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Cpu,
  Timer,
  Trash2,
  Archive,
  ArchiveRestore,
  RotateCcw,
  Ban,
  MoreHorizontal,
  AlertTriangle,
  Copy,
  Check,
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
import { useInfraStatus } from "@/lib/use-infra-status";
import { InfraBanner } from "@/components/infra-banner";
import { toast } from "sonner";

/* ─── Types ──────────────────────────────────────── */

interface Run {
  id: string;
  externalId: string;
  name?: string;
  status: string;
  provider: string;
  model: string;
  totalTokens: number;
  totalIterations?: number;
  durationMs?: number;
  success?: boolean;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  error?: string;
}

/* ─── Helpers ────────────────────────────────────── */

function formatDuration(ms: number | undefined | null) {
  if (ms == null) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string | undefined | null) {
  if (!dateStr) return "—";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "—";
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
  cancelled: {
    icon: Ban,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    label: "Cancelled",
  },
  archived: {
    icon: Archive,
    color: "text-zinc-500",
    bg: "bg-zinc-500/10",
    label: "Archived",
  },
};

/* ─── Confirm Dialog ─────────────────────────────── */

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  variant = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const btnClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "warning"
        ? "bg-orange-600 hover:bg-orange-700 text-white"
        : "bg-blue-600 hover:bg-blue-700 text-white";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <Card className="w-full max-w-sm mx-4 animate-in zoom-in-95">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "rounded-full p-2",
                variant === "danger"
                  ? "bg-red-500/10"
                  : variant === "warning"
                    ? "bg-orange-500/10"
                    : "bg-blue-500/10",
              )}
            >
              <AlertTriangle
                className={cn(
                  "h-5 w-5",
                  variant === "danger"
                    ? "text-red-400"
                    : variant === "warning"
                      ? "text-orange-400"
                      : "text-blue-400",
                )}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">{title}</p>
              <p className="mt-1 text-xs text-zinc-400">{description}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <button
              onClick={onConfirm}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                btnClass,
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Action Menu ────────────────────────────────── */

function ActionMenu({
  run,
  onAction,
  onClose,
}: {
  run: Run;
  onAction: (action: string) => void;
  onClose: () => void;
}) {
  const actions: Array<{
    id: string;
    label: string;
    icon: React.ElementType;
    color: string;
    show: boolean;
  }> = [
    {
      id: "relaunch",
      label: "Relaunch",
      icon: RotateCcw,
      color: "text-blue-400 hover:bg-blue-500/10",
      show: ["completed", "failed", "cancelled"].includes(run.status),
    },
    {
      id: "archive",
      label: "Archive",
      icon: Archive,
      color: "text-zinc-400 hover:bg-zinc-500/10",
      show: run.status !== "archived" && run.status !== "running",
    },
    {
      id: "unarchive",
      label: "Unarchive",
      icon: ArchiveRestore,
      color: "text-zinc-400 hover:bg-zinc-500/10",
      show: run.status === "archived",
    },
    {
      id: "copy-id",
      label: "Copy Run ID",
      icon: Copy,
      color: "text-zinc-400 hover:bg-zinc-500/10",
      show: true,
    },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      color: "text-red-400 hover:bg-red-500/10",
      show: run.status !== "running",
    },
  ];

  const visible = actions.filter((a) => a.show);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Menu */}
      <div className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl animate-in fade-in slide-in-from-top-2">
        {visible.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={(e) => {
                e.stopPropagation();
                onAction(action.id);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                action.color,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {action.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ─── Run Row ────────────────────────────────────── */

function RunRow({
  run,
  onSelect,
  onAction,
}: {
  run: Run;
  onSelect: () => void;
  onAction: (action: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <div className="group relative flex w-full items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 transition-all hover:border-zinc-700 hover:bg-zinc-800/40">
      {/* Clickable area */}
      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-4 text-left min-w-0"
      >
        {/* Status */}
        <div className={cn("rounded-lg p-2 shrink-0", config.bg)}>
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
              {run.name || `${run.id.slice(0, 12)}…`}
            </span>
            <Badge
              variant={
                run.success
                  ? "success"
                  : run.status === "running"
                    ? "default"
                    : run.status === "cancelled"
                      ? "warning"
                      : "error"
              }
              className="text-[10px] shrink-0"
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
              {timeAgo(run.createdAt)}
            </span>
            {run.config?.recipe ? (
              <span className="text-violet-400/60">
                {String(run.config.recipe)}
              </span>
            ) : null}
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
              {run.totalIterations ?? 0}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-zinc-600">Duration</p>
            <p className="text-xs font-semibold tabular-nums text-zinc-300">
              {formatDuration(run.durationMs)}
            </p>
          </div>
        </div>
      </button>

      {/* Action menu trigger */}
      <div className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <ActionMenu
            run={run}
            onAction={onAction}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Run Detail Modal ───────────────────────────── */

function RunDetail({
  run,
  onClose,
  onAction,
}: {
  run: Run;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  const copyId = () => {
    navigator.clipboard.writeText(run.externalId || run.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showRelaunch = ["completed", "failed", "cancelled"].includes(
    run.status,
  );
  const showArchive = run.status !== "archived" && run.status !== "running";
  const showUnarchive = run.status === "archived";
  const showDelete = run.status !== "running";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-lg mx-4 animate-in fade-in zoom-in-95">
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <StatusIcon
                className={cn(
                  "h-4 w-4 shrink-0",
                  config.color,
                  run.status === "running" && "animate-spin",
                )}
              />
              <span className="truncate">
                {run.name || `Run ${run.id.slice(0, 16)}…`}
              </span>
            </CardTitle>
            <CardDescription className="mt-1">
              {run.provider} / {run.model}
              {run.config?.recipe ? (
                <span className="ml-2 text-violet-400/60">
                  • {String(run.config.recipe)}
                </span>
              ) : null}
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
                {run.totalIterations ?? 0}
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
              <Badge
                variant={
                  run.success
                    ? "success"
                    : run.status === "cancelled"
                      ? "warning"
                      : run.status === "archived"
                        ? "muted"
                        : run.status === "running"
                          ? "default"
                          : "error"
                }
              >
                {config.label}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Created</span>
              <span className="text-zinc-300">
                {new Date(run.createdAt).toLocaleString()}
              </span>
            </div>
            {run.endedAt && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Ended</span>
                <span className="text-zinc-300">
                  {new Date(run.endedAt).toLocaleString()}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Run ID</span>
              <button
                onClick={copyId}
                className="flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {(run.externalId || run.id).slice(0, 24)}…
              </button>
            </div>
            {run.tags && run.tags.length > 0 && (
              <div className="flex justify-between items-start">
                <span className="text-zinc-500">Tags</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {run.tags.map((tag) => (
                    <Badge key={tag} variant="muted" className="text-[9px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          {run.summary && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
                Summary
              </p>
              <p className="text-xs text-zinc-300 leading-relaxed line-clamp-4">
                {run.summary}
              </p>
            </div>
          )}

          {/* Error */}
          {run.error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-xs font-medium text-red-400">Error</p>
              <p className="mt-1 text-xs text-red-300/80">{run.error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
            {showRelaunch && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction("relaunch")}
                className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              >
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Relaunch
              </Button>
            )}
            {showArchive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction("archive")}
                className="text-zinc-400 hover:text-zinc-300 hover:bg-zinc-500/10"
              >
                <Archive className="mr-1.5 h-3 w-3" />
                Archive
              </Button>
            )}
            {showUnarchive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction("unarchive")}
                className="text-zinc-400 hover:text-zinc-300 hover:bg-zinc-500/10"
              >
                <ArchiveRestore className="mr-1.5 h-3 w-3" />
                Unarchive
              </Button>
            )}
            <div className="flex-1" />
            {showDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction("delete")}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="mr-1.5 h-3 w-3" />
                Delete
              </Button>
            )}
          </div>
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
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: "danger" | "warning" | "default";
    action: () => Promise<void>;
  } | null>(null);
  const infra = useInfraStatus();

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

  /* ─── Run Actions ─── */

  const deleteRun = useCallback(async (run: Run) => {
    try {
      const res = await fetch(`/api/runs/${run.externalId || run.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
      setSelectedRun(null);
      toast.success("Run deleted");
    } catch {
      toast.error("Failed to delete run");
    }
  }, []);

  const archiveRun = useCallback(
    async (run: Run) => {
      try {
        const res = await fetch(`/api/runs/${run.externalId || run.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
        if (!res.ok) throw new Error("Archive failed");
        setRuns((prev) =>
          prev.map((r) => (r.id === run.id ? { ...r, status: "archived" } : r)),
        );
        if (selectedRun?.id === run.id) {
          setSelectedRun({ ...run, status: "archived" });
        }
        toast.success("Run archived");
      } catch {
        toast.error("Failed to archive run");
      }
    },
    [selectedRun],
  );

  const unarchiveRun = useCallback(
    async (run: Run) => {
      const restoreStatus = run.success ? "completed" : "failed";
      try {
        const res = await fetch(`/api/runs/${run.externalId || run.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: restoreStatus }),
        });
        if (!res.ok) throw new Error("Unarchive failed");
        setRuns((prev) =>
          prev.map((r) =>
            r.id === run.id ? { ...r, status: restoreStatus } : r,
          ),
        );
        if (selectedRun?.id === run.id) {
          setSelectedRun({ ...run, status: restoreStatus });
        }
        toast.success("Run restored");
      } catch {
        toast.error("Failed to restore run");
      }
    },
    [selectedRun],
  );

  const relaunchRun = useCallback((run: Run) => {
    const task = run.name || run.summary || "";
    const recipe = run.config?.recipe ? String(run.config.recipe) : "";
    const params = new URLSearchParams();
    if (task) params.set("task", task);
    if (recipe) params.set("recipe", recipe);
    if (run.model) params.set("model", run.model);
    if (run.provider) params.set("provider", run.provider);
    window.location.href = `/chat?${params.toString()}`;
  }, []);

  const handleAction = useCallback(
    (run: Run, action: string) => {
      switch (action) {
        case "delete":
          setConfirm({
            title: "Delete this run?",
            description:
              "This will permanently remove the run and all its iterations. This action cannot be undone.",
            confirmLabel: "Delete",
            variant: "danger",
            action: () => deleteRun(run),
          });
          break;
        case "archive":
          archiveRun(run);
          break;
        case "unarchive":
          unarchiveRun(run);
          break;
        case "relaunch":
          relaunchRun(run);
          break;
        case "copy-id":
          navigator.clipboard.writeText(run.externalId || run.id);
          toast.success("Run ID copied");
          break;
      }
    },
    [deleteRun, archiveRun, unarchiveRun, relaunchRun],
  );

  /* ─── Filtering ─── */

  const filtered = runs.filter((r) => {
    const matchSearch =
      search === "" ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
      r.provider.toLowerCase().includes(search.toLowerCase()) ||
      r.model.toLowerCase().includes(search.toLowerCase()) ||
      (r.summary || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusCounts: Record<string, number> = {};
  for (const r of runs) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }

  const statuses = [
    "all",
    "completed",
    "running",
    "failed",
    "cancelled",
    "archived",
  ];

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
      {/* Degradation banner */}
      <InfraBanner
        services={infra.services}
        capabilities={infra.capabilities}
        degraded={infra.degraded}
        status={infra.status}
      />

      {/* Header actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name, ID, provider, model, or summary…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 py-2 pl-10 pr-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter with counts */}
          <div className="flex gap-1 rounded-xl bg-zinc-800/50 p-1">
            {statuses.map((s) => {
              const count = s === "all" ? runs.length : statusCounts[s] || 0;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    statusFilter === s
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {s}
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-0.5 text-[9px] tabular-nums",
                        statusFilter === s ? "text-zinc-300" : "text-zinc-600",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
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
                ? !infra.capabilities.persistence
                  ? "Infrastructure is not running — run history requires PostgreSQL. Start services with docker compose up -d."
                  : "Run a pipeline from the CLI or Pipelines page to see results here."
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
              onAction={(action) => handleAction(run, action)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedRun && (
        <RunDetail
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          onAction={(action) => handleAction(selectedRun, action)}
        />
      )}

      {/* Confirm Dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          variant={confirm.variant}
          onConfirm={async () => {
            await confirm.action();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
