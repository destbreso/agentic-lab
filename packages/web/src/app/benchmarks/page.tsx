"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Trophy,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Cpu,
  Timer,
  Trash2,
  BarChart3,
  Target,
  Brain,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Zap,
  RefreshCw,
  Search,
  FlaskConical,
  Plus,
  Eye,
  X,
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
import { toast } from "sonner";

/* ═══════════════════════════════════════════════════
   Types (mirror the server types)
   ═══════════════════════════════════════════════════ */

interface BenchmarkProblem {
  id: string;
  title: string;
  prompt: string;
  trap: string;
  expectedInsight: string;
  category: string;
  difficulty: string;
  tags: string[];
}

interface BenchmarkContender {
  id: string;
  type: "baseline" | "recipe";
  label: string;
  recipeId?: string;
}

interface ContenderResult {
  contenderId: string;
  contenderLabel: string;
  contenderType: "baseline" | "recipe";
  answer: string;
  qualityScore: number;
  qualityNotes: string;
  durationMs: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  status: "pending" | "running" | "completed" | "error";
  error?: string;
}

interface BenchmarkRun {
  id: string;
  problemId: string;
  problemTitle: string;
  prompt: string;
  model: string;
  provider: string;
  contenders: BenchmarkContender[];
  results: ContenderResult[];
  status: "pending" | "running" | "completed" | "error";
  createdAt: string;
  completedAt?: string;
}

interface BenchmarkSuite {
  id: string;
  name: string;
  description: string;
  runs: BenchmarkRun[];
  model: string;
  provider: string;
  status: "pending" | "running" | "completed";
  createdAt: string;
  completedAt?: string;
}

interface ContenderSummary {
  contenderId: string;
  label: string;
  type: "baseline" | "recipe";
  avgScore: number;
  avgDurationMs: number;
  totalTokens: number;
  completedRuns: number;
}

interface Recipe {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
}

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */

function formatDuration(ms: number | undefined | null) {
  if (ms == null || ms === 0) return "—";
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
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

function scoreColor(score: number): string {
  if (score < 0) return "text-zinc-500";
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score < 0) return "bg-zinc-500/10";
  if (score >= 80) return "bg-emerald-500/10";
  if (score >= 50) return "bg-amber-500/10";
  return "bg-red-500/10";
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  reasoning: Brain,
  logic: Target,
  "common-sense": Zap,
  math: BarChart3,
  coding: Cpu,
  ambiguity: AlertTriangle,
};

const CATEGORY_COLORS: Record<string, string> = {
  reasoning: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  logic: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "common-sense": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  math: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  coding: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  ambiguity: "text-orange-400 bg-orange-500/10 border-orange-500/20",
};

const DIFF_BADGE: Record<string, string> = {
  easy: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  hard: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  pending: { icon: Clock, color: "text-zinc-500", label: "Pendiente" },
  running: { icon: Loader2, color: "text-violet-400", label: "Ejecutando" },
  completed: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    label: "Completado",
  },
  error: { icon: XCircle, color: "text-red-400", label: "Error" },
};

/* ═══════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════ */

export default function BenchmarksPage() {
  // Data
  const [problems, setProblems] = useState<BenchmarkProblem[]>([]);
  const [suites, setSuites] = useState<BenchmarkSuite[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  // UI state
  const [tab, setTab] = useState<"suites" | "problems" | "new">("suites");
  const [loading, setLoading] = useState(true);
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [viewingAnswer, setViewingAnswer] = useState<ContenderResult | null>(
    null,
  );

  // New suite form
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selectedProblems, setSelectedProblems] = useState<Set<string>>(
    new Set(),
  );
  const [selectedRecipes, setSelectedRecipes] = useState<Set<string>>(
    new Set(),
  );
  const [includeBaseline, setIncludeBaseline] = useState(true);
  const [newModel, setNewModel] = useState("llama3.1:8b");
  const [newProvider, setNewProvider] = useState("ollama");
  const [newMemoryBank, setNewMemoryBank] = useState<string>("");
  const [memoryBanks, setMemoryBanks] = useState<
    Array<{ id: string; name: string; description: string; itemCount: number }>
  >([]);
  const [submitting, setSubmitting] = useState(false);

  // Filter
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  /* ─── Load data ──────────────────────────────────── */

  const fetchProblems = useCallback(async () => {
    try {
      const res = await fetch("/api/benchmarks/problems");
      const data = await res.json();
      setProblems(data.problems || []);
    } catch {
      /* no-op */
    }
  }, []);

  const fetchSuites = useCallback(async () => {
    try {
      const res = await fetch("/api/benchmarks/suites");
      const data = await res.json();
      setSuites(data.suites || []);
    } catch {
      /* no-op */
    }
  }, []);

  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch("/api/pipelines/recipes");
      const data = await res.json();
      setRecipes(
        (data.recipes || []).map((r: Recipe & Record<string, unknown>) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          nodeCount: r.nodeCount,
        })),
      );
    } catch {
      /* no-op */
    }
  }, []);

  const fetchMemoryBanks = useCallback(async () => {
    try {
      const res = await fetch("/api/memories/banks");
      const data = await res.json();
      setMemoryBanks(data.banks || []);
    } catch {
      /* no-op */
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchProblems(),
      fetchSuites(),
      fetchRecipes(),
      fetchMemoryBanks(),
    ]).finally(() => setLoading(false));
  }, [fetchProblems, fetchSuites, fetchRecipes, fetchMemoryBanks]);

  // Auto-refresh suites while any are running
  useEffect(() => {
    const hasRunning = suites.some((s) => s.status === "running");
    if (!hasRunning) return;
    const timer = setInterval(fetchSuites, 3000);
    return () => clearInterval(timer);
  }, [suites, fetchSuites]);

  // Refresh expanded suite details
  useEffect(() => {
    if (!expandedSuite) return;
    const suite = suites.find((s) => s.id === expandedSuite);
    if (!suite || suite.status !== "running") return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/benchmarks/suites/${expandedSuite}`);
        const data = await res.json();
        if (data.suite) {
          setSuites((prev) =>
            prev.map((s) => (s.id === expandedSuite ? data.suite : s)),
          );
        }
      } catch {
        /* skip */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [expandedSuite, suites]);

  /* ─── Actions ──────────────────────────────────── */

  const createSuite = async () => {
    if (!newName.trim()) {
      toast.error("Nombre requerido");
      return;
    }
    if (selectedProblems.size === 0) {
      toast.error("Selecciona al menos un problema");
      return;
    }
    if (!includeBaseline && selectedRecipes.size === 0) {
      toast.error("Selecciona al menos un contendiente");
      return;
    }
    if ((includeBaseline ? 1 : 0) + selectedRecipes.size < 2) {
      toast.error(
        "Se necesitan al menos 2 contendientes (baseline + receta o varias recetas)",
      );
      return;
    }

    setSubmitting(true);

    const contenders: BenchmarkContender[] = [];
    if (includeBaseline) {
      contenders.push({
        id: "baseline",
        type: "baseline",
        label: `Baseline (${newModel})`,
      });
    }
    for (const recipeId of selectedRecipes) {
      const recipe = recipes.find((r) => r.id === recipeId);
      contenders.push({
        id: `recipe-${recipeId}`,
        type: "recipe",
        label: recipe?.name || recipeId,
        recipeId,
      });
    }

    try {
      const res = await fetch("/api/benchmarks/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          problemIds: Array.from(selectedProblems),
          contenders,
          model: newModel,
          provider: newProvider,
          memoryNamespace: newMemoryBank || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Error al crear suite");
        return;
      }
      toast.success("Benchmark iniciado");
      setSuites((prev) => [data.suite, ...prev]);
      setTab("suites");
      setExpandedSuite(data.suite.id);
      // Reset form
      setNewName("");
      setNewDescription("");
      setSelectedProblems(new Set());
      setSelectedRecipes(new Set());
      setNewMemoryBank("");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSuiteAction = async (id: string) => {
    try {
      await fetch(`/api/benchmarks/suites?id=${id}`, { method: "DELETE" });
      setSuites((prev) => prev.filter((s) => s.id !== id));
      if (expandedSuite === id) setExpandedSuite(null);
      toast.success("Suite eliminada");
    } catch {
      toast.error("Error al eliminar");
    }
  };

  /* ─── Filtered problems ─────────────────────────── */

  const filteredProblems = problems.filter((p) => {
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.prompt.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const categories = [...new Set(problems.map((p) => p.category))];

  /* ─── Render ────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                <Trophy className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-zinc-100">
                  Benchmarks
                </h1>
                <p className="text-xs text-zinc-500">
                  Compara arquitecturas agentic vs baseline con problemas
                  conocidos
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="muted" className="text-[10px]">
              <FlaskConical className="mr-1 h-2.5 w-2.5" />
              {problems.length} problemas
            </Badge>
            <Badge variant="muted" className="text-[10px]">
              <Trophy className="mr-1 h-2.5 w-2.5" />
              {suites.length} suites
            </Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1">
          {(
            [
              { id: "suites", label: "Suites", icon: Trophy },
              { id: "problems", label: "Banco de Problemas", icon: Target },
              { id: "new", label: "Nuevo Benchmark", icon: Plus },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                tab === id
                  ? "bg-violet-500/10 text-violet-300 border border-violet-500/30"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* ═══ Tab: Suites ═══ */}
        {tab === "suites" && (
          <div className="space-y-4">
            {suites.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-6">
                  <Trophy className="h-10 w-10 text-amber-400/50" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">No hay benchmarks aún</p>
                  <p className="text-xs text-zinc-600">
                    Crea uno para comparar tus arquitecturas agentic
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTab("new")}
                  className="border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Crear Benchmark
                </Button>
              </div>
            ) : (
              suites.map((suite) => (
                <SuiteCard
                  key={suite.id}
                  suite={suite}
                  expanded={expandedSuite === suite.id}
                  onToggle={() =>
                    setExpandedSuite(
                      expandedSuite === suite.id ? null : suite.id,
                    )
                  }
                  onDelete={() => deleteSuiteAction(suite.id)}
                  expandedRun={expandedRun}
                  onToggleRun={(runId) =>
                    setExpandedRun(expandedRun === runId ? null : runId)
                  }
                  onViewAnswer={(r) => setViewingAnswer(r)}
                />
              ))
            )}
          </div>
        )}

        {/* ═══ Tab: Problems ═══ */}
        {tab === "problems" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Buscar problemas…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-3 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setCategoryFilter("all")}
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                    categoryFilter === "all"
                      ? "bg-violet-500/10 text-violet-300"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  Todos
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                      categoryFilter === cat
                        ? CATEGORY_COLORS[cat] ||
                            "bg-violet-500/10 text-violet-300"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Problem cards */}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredProblems.map((problem) => (
                <ProblemCard key={problem.id} problem={problem} />
              ))}
            </div>
          </div>
        )}

        {/* ═══ Tab: New Benchmark ═══ */}
        {tab === "new" && (
          <div className="mx-auto max-w-4xl space-y-6">
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FlaskConical className="h-4 w-4 text-violet-400" />
                  Configuración del Benchmark
                </CardTitle>
                <CardDescription className="text-xs">
                  Elige nombre, modelo, y los contendientes a comparar
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Name + Description */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Nombre
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Benchmark Common Sense v1"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Descripción (opcional)
                    </label>
                    <input
                      type="text"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Comparación de razonamiento…"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Model + Provider */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Modelo
                    </label>
                    <select
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500/50 focus:outline-none"
                    >
                      <option value="llama3.1:8b">llama3.1:8b</option>
                      <option value="qwen2.5-coder:7b">qwen2.5-coder:7b</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="claude-3-5-sonnet-20241022">
                        claude-3.5-sonnet
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Provider
                    </label>
                    <select
                      value={newProvider}
                      onChange={(e) => setNewProvider(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500/50 focus:outline-none"
                    >
                      <option value="ollama">Ollama (Local)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                </div>

                {/* Memory Bank selector */}
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Banco de Memoria Semántica (opcional)
                  </label>
                  <select
                    value={newMemoryBank}
                    onChange={(e) => setNewMemoryBank(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500/50 focus:outline-none"
                  >
                    <option value="">Sin memoria (defecto)</option>
                    {memoryBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name} ({bank.itemCount} memorias)
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    Si seleccionas un banco, los contendientes usarán su memoria semántica durante la ejecución.
                  </p>
                </div>

                {/* Baseline toggle */}
                <div className="flex items-center gap-3 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
                  <button
                    type="button"
                    onClick={() => setIncludeBaseline((v) => !v)}
                    className={cn(
                      "flex h-5 w-9 items-center rounded-full transition-colors",
                      includeBaseline ? "bg-violet-500" : "bg-zinc-600",
                    )}
                  >
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow transition-transform",
                        includeBaseline ? "translate-x-4" : "translate-x-0.5",
                      )}
                    />
                  </button>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">
                      Incluir Baseline (LLM directo)
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      Compara contra el modelo sin arquitectura agentic
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recipe selection */}
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  Recetas (Arquitecturas Agentic)
                </CardTitle>
                <CardDescription className="text-xs">
                  Selecciona las recetas que quieres comparar
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {recipes.map((recipe) => {
                    const selected = selectedRecipes.has(recipe.id);
                    return (
                      <button
                        key={recipe.id}
                        onClick={() => {
                          setSelectedRecipes((prev) => {
                            const next = new Set(prev);
                            if (next.has(recipe.id)) next.delete(recipe.id);
                            else next.add(recipe.id);
                            return next;
                          });
                        }}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-all",
                          selected
                            ? "border-violet-500/40 bg-violet-500/10"
                            : "border-zinc-700/50 bg-zinc-800/30 hover:border-zinc-600",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "h-2 w-2 rounded-full",
                              selected ? "bg-violet-400" : "bg-zinc-600",
                            )}
                          />
                          <span
                            className={cn(
                              "text-xs font-medium",
                              selected ? "text-violet-300" : "text-zinc-400",
                            )}
                          >
                            {recipe.name}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-zinc-600 line-clamp-2">
                          {recipe.description}
                        </p>
                        <div className="mt-1">
                          <Badge variant="muted" className="text-[9px]">
                            {recipe.nodeCount} nodos
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Problem selection */}
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Target className="h-4 w-4 text-amber-400" />
                      Problemas
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Selecciona los problemas del banco a evaluar (
                      {selectedProblems.size} seleccionados)
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSelectedProblems(new Set(problems.map((p) => p.id)))
                      }
                      className="text-[10px] text-violet-400 hover:text-violet-300"
                    >
                      Todos
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedProblems(new Set())}
                      className="text-[10px] text-zinc-500 hover:text-zinc-400"
                    >
                      Ninguno
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  {problems.map((problem) => {
                    const selected = selectedProblems.has(problem.id);
                    const CatIcon = CATEGORY_ICONS[problem.category] || Target;
                    return (
                      <button
                        key={problem.id}
                        onClick={() => {
                          setSelectedProblems((prev) => {
                            const next = new Set(prev);
                            if (next.has(problem.id)) next.delete(problem.id);
                            else next.add(problem.id);
                            return next;
                          });
                        }}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-all",
                          selected
                            ? "border-amber-500/40 bg-amber-500/5"
                            : "border-zinc-700/50 bg-zinc-800/30 hover:border-zinc-600",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CatIcon
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                selected ? "text-amber-400" : "text-zinc-500",
                              )}
                            />
                            <span
                              className={cn(
                                "text-xs font-medium",
                                selected ? "text-amber-300" : "text-zinc-400",
                              )}
                            >
                              {problem.title}
                            </span>
                          </div>
                          <Badge
                            variant="muted"
                            className={cn(
                              "shrink-0 text-[9px]",
                              DIFF_BADGE[problem.difficulty],
                            )}
                          >
                            {problem.difficulty}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[10px] text-zinc-600 line-clamp-2">
                          {problem.prompt}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex justify-end gap-3 pb-8">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTab("suites")}
                className="text-zinc-500"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={createSuite}
                disabled={submitting}
                className="bg-violet-600 text-white hover:bg-violet-500"
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                Iniciar Benchmark
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Answer viewer modal */}
      {viewingAnswer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">
                  {viewingAnswer.contenderLabel}
                </h3>
                <div className="mt-1 flex items-center gap-2">
                  <Badge
                    variant="muted"
                    className={cn(
                      "text-[10px]",
                      scoreBg(viewingAnswer.qualityScore),
                    )}
                  >
                    <span className={scoreColor(viewingAnswer.qualityScore)}>
                      Score: {viewingAnswer.qualityScore}
                    </span>
                  </Badge>
                  <span className="text-[10px] text-zinc-500">
                    {formatDuration(viewingAnswer.durationMs)} ·{" "}
                    {formatTokens(viewingAnswer.tokens)} tokens
                  </span>
                </div>
              </div>
              <button
                onClick={() => setViewingAnswer(null)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-3 rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Respuesta
              </p>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                {viewingAnswer.answer || "(sin respuesta)"}
              </div>
            </div>
            {viewingAnswer.qualityNotes && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400 mb-1">
                  Evaluación
                </p>
                <p className="text-xs text-zinc-400">
                  {viewingAnswer.qualityNotes}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════ */

function SuiteCard({
  suite,
  expanded,
  onToggle,
  onDelete,
  expandedRun,
  onToggleRun,
  onViewAnswer,
}: {
  suite: BenchmarkSuite;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  expandedRun: string | null;
  onToggleRun: (id: string) => void;
  onViewAnswer: (r: ContenderResult) => void;
}) {
  const StatusIcon = STATUS_CONFIG[suite.status]?.icon || Clock;
  const statusColor = STATUS_CONFIG[suite.status]?.color || "text-zinc-500";
  const statusLabel = STATUS_CONFIG[suite.status]?.label || suite.status;

  const completedRuns = suite.runs.filter(
    (r) => r.status === "completed",
  ).length;
  const totalResults = suite.runs.flatMap((r) => r.results);
  const completedResults = totalResults.filter((r) => r.status === "completed");

  // Per-contender aggregation
  const contenderIds = [...new Set(totalResults.map((r) => r.contenderId))];
  const contenderAgg = contenderIds.map((cId) => {
    const results = completedResults.filter((r) => r.contenderId === cId);
    const first = totalResults.find((r) => r.contenderId === cId);
    const avgScore =
      results.length > 0
        ? results.reduce((s, r) => s + r.qualityScore, 0) / results.length
        : -1;
    const avgDuration =
      results.length > 0
        ? results.reduce((s, r) => s + r.durationMs, 0) / results.length
        : 0;
    const totalTokens = results.reduce((s, r) => s + r.tokens, 0);
    return {
      id: cId,
      label: first?.contenderLabel || cId,
      type: first?.contenderType || "recipe",
      avgScore: Math.round(avgScore * 10) / 10,
      avgDuration: Math.round(avgDuration),
      totalTokens,
      count: results.length,
    };
  });

  // Find winner
  const winner =
    contenderAgg.length > 0
      ? contenderAgg.reduce((a, b) => (a.avgScore >= b.avgScore ? a : b))
      : null;

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            )}
            <div>
              <CardTitle className="text-sm">{suite.name}</CardTitle>
              {suite.description && (
                <CardDescription className="text-[10px]">
                  {suite.description}
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="muted" className="text-[10px]">
              <Cpu className="mr-1 h-2.5 w-2.5" />
              {suite.model}
            </Badge>
            <Badge variant="muted" className={cn("text-[10px]", statusColor)}>
              <StatusIcon
                className={cn(
                  "mr-1 h-2.5 w-2.5",
                  suite.status === "running" && "animate-spin",
                )}
              />
              {statusLabel}
            </Badge>
            <span className="text-[10px] text-zinc-600">
              {completedRuns}/{suite.runs.length} runs
            </span>
            <span className="text-[10px] text-zinc-600">
              {timeAgo(suite.createdAt)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded p-1 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Summary bar */}
        {contenderAgg.length > 0 && (
          <div className="mt-3 flex gap-3 overflow-x-auto">
            {contenderAgg.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "flex min-w-[140px] flex-col rounded-lg border px-3 py-2",
                  winner?.id === c.id && c.avgScore >= 0
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-zinc-700/50 bg-zinc-800/30",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {winner?.id === c.id && c.avgScore >= 0 && (
                    <Trophy className="h-3 w-3 text-amber-400" />
                  )}
                  <span className="text-[10px] font-medium text-zinc-300 truncate">
                    {c.label}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      scoreColor(c.avgScore),
                    )}
                  >
                    {c.avgScore >= 0 ? c.avgScore : "—"}
                  </span>
                  <span className="text-[9px] text-zinc-600">pts avg</span>
                </div>
                <div className="mt-0.5 flex gap-2 text-[9px] text-zinc-600">
                  <span>
                    <Timer className="mr-0.5 inline h-2.5 w-2.5" />
                    {formatDuration(c.avgDuration)}
                  </span>
                  <span>
                    <Sparkles className="mr-0.5 inline h-2.5 w-2.5" />
                    {formatTokens(c.totalTokens)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardHeader>

      {/* Expanded: individual runs */}
      {expanded && (
        <CardContent className="space-y-3 border-t border-zinc-800 pt-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Resultados por problema
          </div>
          {suite.runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedRun === run.id}
              onToggle={() => onToggleRun(run.id)}
              onViewAnswer={onViewAnswer}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
  onViewAnswer,
}: {
  run: BenchmarkRun;
  expanded: boolean;
  onToggle: () => void;
  onViewAnswer: (r: ContenderResult) => void;
}) {
  const StatusIcon = STATUS_CONFIG[run.status]?.icon || Clock;
  const statusColor = STATUS_CONFIG[run.status]?.color || "text-zinc-500";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs font-medium text-zinc-300">
            {run.problemTitle}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-600">
            {run.prompt}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run.results
            .filter((r) => r.status === "completed")
            .map((r) => (
              <span
                key={r.contenderId}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  scoreBg(r.qualityScore),
                  scoreColor(r.qualityScore),
                )}
              >
                {r.qualityScore}
              </span>
            ))}
          <StatusIcon
            className={cn(
              "h-3.5 w-3.5",
              statusColor,
              run.status === "running" && "animate-spin",
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {run.results.map((result) => (
              <ResultCard
                key={result.contenderId}
                result={result}
                best={
                  run.results
                    .filter((r) => r.status === "completed")
                    .reduce(
                      (a, b) => (a.qualityScore >= b.qualityScore ? a : b),
                      run.results[0],
                    ).contenderId === result.contenderId
                }
                onViewAnswer={() => onViewAnswer(result)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  result,
  best,
  onViewAnswer,
}: {
  result: ContenderResult;
  best: boolean;
  onViewAnswer: () => void;
}) {
  const StatusIcon = STATUS_CONFIG[result.status]?.icon || Clock;
  const statusColor = STATUS_CONFIG[result.status]?.color || "text-zinc-500";

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        best && result.status === "completed"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-zinc-700/50 bg-zinc-800/30",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {best && result.status === "completed" && (
            <Trophy className="h-3 w-3 text-amber-400" />
          )}
          <span className="text-[11px] font-medium text-zinc-300">
            {result.contenderLabel}
          </span>
        </div>
        <Badge variant="muted" className={cn("text-[9px]", statusColor)}>
          <StatusIcon
            className={cn(
              "mr-0.5 h-2.5 w-2.5",
              result.status === "running" && "animate-spin",
            )}
          />
          {STATUS_CONFIG[result.status]?.label}
        </Badge>
      </div>

      {result.status === "completed" && (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                scoreColor(result.qualityScore),
              )}
            >
              {result.qualityScore}
            </span>
            <span className="text-[10px] text-zinc-600">/100</span>
          </div>

          <div className="mt-2 flex gap-3 text-[10px] text-zinc-500">
            <span>
              <Timer className="mr-0.5 inline h-2.5 w-2.5" />
              {formatDuration(result.durationMs)}
            </span>
            <span>
              <Sparkles className="mr-0.5 inline h-2.5 w-2.5" />
              {formatTokens(result.tokens)} tok
            </span>
          </div>

          {result.qualityNotes && (
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500 line-clamp-2">
              {result.qualityNotes}
            </p>
          )}

          <button
            onClick={onViewAnswer}
            className="mt-2 flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300"
          >
            <Eye className="h-3 w-3" />
            Ver respuesta completa
          </button>
        </>
      )}

      {result.status === "error" && result.error && (
        <p className="mt-2 text-[10px] text-red-400 line-clamp-2">
          {result.error}
        </p>
      )}
    </div>
  );
}

function ProblemCard({ problem }: { problem: BenchmarkProblem }) {
  const [expanded, setExpanded] = useState(false);
  const CatIcon = CATEGORY_ICONS[problem.category] || Target;
  const catColor =
    CATEGORY_COLORS[problem.category] ||
    "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md border",
                catColor,
              )}
            >
              <CatIcon className="h-3 w-3" />
            </div>
            <CardTitle className="text-xs">{problem.title}</CardTitle>
          </div>
          <Badge
            variant="muted"
            className={cn("text-[9px]", DIFF_BADGE[problem.difficulty])}
          >
            {problem.difficulty}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          {problem.prompt}
        </p>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {expanded ? "Ocultar detalles" : "Ver trampa y solución"}
        </button>

        {expanded && (
          <div className="space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wider text-red-400">
                Trampa
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-500">{problem.trap}</p>
            </div>
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wider text-emerald-400">
                Respuesta esperada
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-500">
                {problem.expectedInsight}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {problem.tags.map((tag) => (
            <Badge
              key={tag}
              variant="muted"
              className="text-[9px] text-zinc-600"
            >
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
