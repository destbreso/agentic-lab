"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  MessageSquare,
  Send,
  Plus,
  Clock,
  Sparkles,
  Bot,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Hash,
  Copy,
  RotateCcw,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Zap,
  Eye,
  EyeOff,
  Brain,
  Shield,
  Database,
  Circle,
  Timer,
  ArrowDown,
  StopCircle,
  Cpu,
  FileText,
  Code2,
  Terminal,
  Search,
  Wrench,
  AlertTriangle,
  Workflow,
  Layers,
  Play,
  ChevronDown,
  List,
  ListTree,
  GripVertical,
  Users,
  Swords,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

type ChatMode = "chat" | "agent";

interface ChatSession {
  id: string;
  title: string;
  model: string;
  provider: string;
  mode: ChatMode;
  recipe?: string;
  messageCount: number;
  tokenCount: number;
  status: "active" | "completed" | "error";
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "agent";
  content: string;
  timestamp: string;
  tokens?: number;
  durationMs?: number;
  model?: string;
  loop?: string;
  messageType?: "text" | "plan" | "eval" | "critic" | "memory" | "result";
  thinking?: string;
}

interface TaskStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "error" | "skipped";
  type: "think" | "tool" | "code" | "search" | "write" | "eval" | "plan";
  detail?: string;
  durationMs?: number;
  startedAt?: string;
  loop?: string;
  iteration?: number;
  subtasks?: SubTask[];
  contentPreview?: string;
}

interface SubTask {
  id: string;
  parentStepId: string;
  label: string;
  status: "pending" | "running" | "completed" | "error" | "skipped";
  index: number;
  total: number;
}

/* ═══════════════════════════════════════════════════
   Constants – Recipe icon mapping (UI-only decoration)
   Recipe data comes from core via /api/pipelines/recipes
   ═══════════════════════════════════════════════════ */

type RecipeIcon = React.ElementType;

/** Static icon mapping — icons are UI-specific and can't come from the API */
const RECIPE_ICONS: Record<string, RecipeIcon> = {
  "ralph-loop": Zap,
  "exec-eval": Eye,
  "plan-exec-eval": Layers,
  "full-agent-pipeline": Workflow,
  "full-pipeline": Workflow,
  "deep-reasoning": Brain,
  "supervised-coder": Users,
  "adversarial-duel": Swords,
};

interface UIRecipe {
  id: string;
  name: string;
  loops: number;
  description: string;
  icon: RecipeIcon;
}

/** Default recipes (used before API fetch completes) */
const DEFAULT_RECIPES: UIRecipe[] = [
  {
    id: "ralph-loop",
    name: "Ralph Loop",
    loops: 1,
    description: "Single execution loop",
    icon: Zap,
  },
  {
    id: "exec-eval",
    name: "Execute & Evaluate",
    loops: 2,
    description: "Execute then verify",
    icon: Eye,
  },
  {
    id: "full-agent-pipeline",
    name: "Full Pipeline",
    loops: 5,
    description: "All 5 specialized loops",
    icon: Workflow,
  },
  {
    id: "deep-reasoning",
    name: "Deep Reasoning",
    loops: 5,
    description: "Iterative self-correcting, Opus-class",
    icon: Brain,
  },
  {
    id: "supervised-coder",
    name: "Supervised Coder",
    loops: 3,
    description: "Tech Lead → Developer → Reviewer",
    icon: Users,
  },
  {
    id: "adversarial-duel",
    name: "Adversarial Duel",
    loops: 4,
    description: "Two agents compete, Arbiter judges",
    icon: Swords,
  },
];

/** Hook: fetch recipes from core API and merge with icons */
function useRecipes(): UIRecipe[] {
  const [recipes, setRecipes] = useState<UIRecipe[]>(DEFAULT_RECIPES);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pipelines/recipes")
      .then((r) => r.json())
      .then(
        (
          data: Array<{
            id: string;
            name: string;
            nodes: unknown[];
            description: string;
          }>,
        ) => {
          if (cancelled || !Array.isArray(data)) return;
          const mapped: UIRecipe[] = data.map((r) => ({
            id: r.id,
            name: r.name,
            loops: r.nodes?.length ?? 1,
            description: r.description,
            icon: RECIPE_ICONS[r.id] || Cpu,
          }));
          if (mapped.length > 0) setRecipes(mapped);
        },
      )
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return recipes;
}

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatTokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const STEP_ICONS: Record<TaskStep["type"], React.ElementType> = {
  think: Brain,
  tool: Wrench,
  code: Code2,
  search: Search,
  write: FileText,
  eval: Eye,
  plan: Layers,
};

const STEP_COLORS: Record<TaskStep["type"], string> = {
  think: "text-purple-400",
  tool: "text-amber-400",
  code: "text-blue-400",
  search: "text-cyan-400",
  write: "text-emerald-400",
  eval: "text-orange-400",
  plan: "text-indigo-400",
};

const LOOP_COLORS: Record<string, string> = {
  planning: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  execution: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  evaluation: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  critic: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  memory: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  refinement: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

/* ═══════════════════════════════════════════════════
   SessionSidebar
   ═══════════════════════════════════════════════════ */

function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  collapsed,
  onToggle,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const chatSessions = sessions.filter((s) => s.mode === "chat");
  const agentSessions = sessions.filter((s) => s.mode === "agent");

  return (
    <div
      className={cn(
        "flex flex-col border-r border-zinc-800 bg-zinc-950/80 backdrop-blur transition-all",
        collapsed ? "w-12" : "w-64",
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 p-2">
        {!collapsed && (
          <span className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Sessions
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={onToggle}
          className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {!collapsed && (
        <>
          <button
            onClick={onNew}
            className="mx-2 mt-2 flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5 hover:text-blue-300"
          >
            <Plus className="h-3 w-3" />
            New session
          </button>

          <div className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
            {/* Agent Sessions */}
            {agentSessions.length > 0 && (
              <>
                <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-violet-400/70">
                  <Workflow className="h-3 w-3" />
                  Agent Tasks
                </div>
                {agentSessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    active={s.id === activeId}
                    onSelect={onSelect}
                  />
                ))}
                <div className="my-2 border-t border-zinc-800/50" />
              </>
            )}

            {/* Chat Sessions */}
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <MessageSquare className="h-3 w-3" />
              Chat
            </div>
            {chatSessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === activeId}
                onSelect={onSelect}
              />
            ))}

            {sessions.length === 0 && (
              <p className="px-2 pt-4 text-center text-[11px] text-zinc-600">
                No sessions yet
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SessionItem({
  session: s,
  active,
  onSelect,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(s.id)}
      className={cn(
        "mb-1 flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors",
        active
          ? "bg-zinc-800 text-zinc-200"
          : "text-zinc-400 hover:bg-zinc-800/50",
      )}
    >
      <div className="flex items-center gap-2">
        {s.mode === "agent" ? (
          <Workflow className="h-3 w-3 shrink-0 text-violet-400" />
        ) : (
          <MessageSquare className="h-3 w-3 shrink-0 text-zinc-500" />
        )}
        <span className="truncate text-xs font-medium">{s.title}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
        <span>{s.model}</span>
        <span>·</span>
        <span>
          {s.messageCount} msg{s.messageCount !== 1 ? "s" : ""}
        </span>
        {s.tokenCount > 0 && (
          <>
            <span>·</span>
            <span>{formatTokens(s.tokenCount)} tok</span>
          </>
        )}
        {s.recipe && (
          <>
            <span>·</span>
            <span className="text-violet-400/70">{s.recipe}</span>
          </>
        )}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════
   ExecutionPanel — Resizable + Compact/Detailed
   ═══════════════════════════════════════════════════ */

type PanelView = "compact" | "detailed";

const PANEL_MIN_W = 260;
const PANEL_MAX_W = 640;
const PANEL_DEFAULT_W = 320;

function ExecutionPanel({
  steps,
  collapsed,
  onToggle,
  totalTokens,
  elapsed,
  isRunning,
  mode,
  activeRecipe,
  recipes,
}: {
  steps: TaskStep[];
  collapsed: boolean;
  onToggle: () => void;
  totalTokens: number;
  elapsed: number;
  isRunning: boolean;
  mode: ChatMode;
  activeRecipe?: string;
  recipes: UIRecipe[];
}) {
  const [view, setView] = useState<PanelView>("compact");
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_W);
  const stepsEndRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(PANEL_DEFAULT_W);

  // Auto-scroll when new steps arrive
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  // Auto-expand steps that have subtasks arriving in detailed view
  useEffect(() => {
    if (view === "detailed") {
      const withSubs = steps.filter((s) => s.subtasks && s.subtasks.length > 0);
      if (withSubs.length > 0) {
        setExpandedSteps((prev) => {
          const next = new Set(prev);
          withSubs.forEach((s) => next.add(s.id));
          return next;
        });
      }
    }
  }, [steps, view]);

  // Auto-expand steps with contentPreview in detailed view
  useEffect(() => {
    if (view === "detailed") {
      const withContent = steps.filter((s) => s.contentPreview && s.loop);
      if (withContent.length > 0) {
        setExpandedSteps((prev) => {
          const next = new Set(prev);
          withContent.forEach((s) => next.add(s.id));
          return next;
        });
      }
    }
  }, [steps, view]);

  const toggleExpand = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // ─── Resize drag ─────────────────────────────────
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = panelWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        // Drag left = wider panel (since panel is on the right)
        const delta = startXRef.current - ev.clientX;
        const newWidth = Math.min(
          PANEL_MAX_W,
          Math.max(PANEL_MIN_W, startWidthRef.current + delta),
        );
        setPanelWidth(newWidth);
      };

      const handleUp = () => {
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [panelWidth],
  );

  // Determine if a step is expandable (has content or subtasks)
  const isExpandable = (step: TaskStep) =>
    (step.subtasks && step.subtasks.length > 0) ||
    (step.contentPreview && step.contentPreview.length > 0);

  return (
    <div
      className={cn(
        "relative flex flex-col border-l border-zinc-800 bg-zinc-950/80 backdrop-blur transition-[width]",
        collapsed ? "w-12" : "",
      )}
      style={collapsed ? undefined : { width: panelWidth }}
    >
      {/* ── Resize handle (left edge) ── */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 z-30 h-full w-1.5 cursor-col-resize group hover:bg-violet-500/20 active:bg-violet-500/30 transition-colors"
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 flex h-8 w-1.5 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="h-3 w-3 text-zinc-600" />
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-zinc-800 p-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={onToggle}
          className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
        >
          {collapsed ? (
            <PanelRightOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelRightClose className="h-3.5 w-3.5" />
          )}
        </Button>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {mode === "agent" ? "Pipeline" : "Execution"}
            </span>
            {isRunning && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── Recipe + view toggle row ── */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            {mode === "agent" && activeRecipe ? (
              <div className="flex items-center gap-2 min-w-0">
                <Workflow className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                <span className="truncate text-[11px] font-medium text-violet-300">
                  {recipes.find((r) => r.id === activeRecipe)?.name ||
                    activeRecipe}
                </span>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-1">
              {/* Compact / Detailed toggle */}
              <div className="flex rounded-md border border-zinc-700 bg-zinc-800/50 p-0.5">
                <button
                  onClick={() => setView("compact")}
                  className={cn(
                    "flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium transition-all",
                    view === "compact"
                      ? "bg-zinc-700 text-zinc-200 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                  title="Vista compacta"
                >
                  <List className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={() => setView("detailed")}
                  className={cn(
                    "flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium transition-all",
                    view === "detailed"
                      ? "bg-violet-500/20 text-violet-300 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                  title="Vista detallada"
                >
                  <ListTree className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          </div>

          {/* ── Steps timeline ── */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {steps.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Terminal className="mb-2 h-6 w-6 text-zinc-700" />
                <p className="text-xs text-zinc-600">
                  {mode === "agent"
                    ? "Run an agent task to see pipeline execution"
                    : "Send a message to see execution steps"}
                </p>
              </div>
            )}

            {steps.map((step, i) => {
              const Icon = STEP_ICONS[step.type] || Circle;
              const color = STEP_COLORS[step.type] || "text-zinc-400";
              const isLast = i === steps.length - 1;
              const showLoopBadge =
                step.loop && (i === 0 || steps[i - 1]?.loop !== step.loop);
              const hasSubtasks = step.subtasks && step.subtasks.length > 0;
              const isExpanded = expandedSteps.has(step.id);
              const completedSubs =
                step.subtasks?.filter((s) => s.status === "completed").length ||
                0;
              const totalSubs = step.subtasks?.length || 0;
              const expandable = isExpandable(step);

              return (
                <div key={step.id}>
                  {/* Loop separator */}
                  {showLoopBadge && (
                    <div className="mb-2 mt-1 flex items-center gap-2">
                      <div
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                          LOOP_COLORS[step.loop!] ||
                            "bg-zinc-800 text-zinc-400 border-zinc-700",
                        )}
                      >
                        {step.loop}
                      </div>
                      <div className="h-px flex-1 bg-zinc-800" />
                    </div>
                  )}

                  <div className="relative flex gap-3 pb-3">
                    {/* Connector line */}
                    {!isLast && (
                      <div className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-zinc-800" />
                    )}

                    {/* Icon */}
                    <div className="relative z-10 mt-0.5">
                      {step.status === "running" ? (
                        <Loader2
                          className={cn(
                            "h-[22px] w-[22px] animate-spin",
                            color,
                          )}
                        />
                      ) : step.status === "completed" ? (
                        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-zinc-800/80">
                          <Icon className={cn("h-3 w-3", color)} />
                        </div>
                      ) : step.status === "error" ? (
                        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-red-500/10">
                          <XCircle className="h-3 w-3 text-red-400" />
                        </div>
                      ) : step.status === "skipped" ? (
                        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-zinc-800/80">
                          <Circle className="h-3 w-3 text-zinc-600" />
                        </div>
                      ) : (
                        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-zinc-800/40">
                          <Circle className="h-3 w-3 text-zinc-700" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {/* Step header row — clickable when expandable */}
                      <div
                        className={cn(
                          "flex items-center gap-2",
                          expandable && view === "detailed" && "cursor-pointer",
                        )}
                        onClick={() => {
                          if (expandable && view === "detailed")
                            toggleExpand(step.id);
                        }}
                      >
                        {view === "detailed" && expandable && (
                          <ChevronRight
                            className={cn(
                              "h-3 w-3 shrink-0 text-zinc-600 transition-transform",
                              isExpanded && "rotate-90",
                            )}
                          />
                        )}
                        <span
                          className={cn(
                            "text-xs font-medium",
                            step.status === "running"
                              ? "text-zinc-200"
                              : step.status === "completed"
                                ? "text-zinc-400"
                                : step.status === "error"
                                  ? "text-red-400"
                                  : "text-zinc-600",
                          )}
                        >
                          {step.label}
                        </span>
                        {step.durationMs != null && step.durationMs > 0 && (
                          <span className="text-[10px] text-zinc-600">
                            {step.durationMs < 1000
                              ? `${step.durationMs}ms`
                              : `${(step.durationMs / 1000).toFixed(1)}s`}
                          </span>
                        )}
                      </div>

                      {/* Detail line — always show in compact, show when collapsed in detailed */}
                      {step.detail && (view === "compact" || !isExpanded) && (
                        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">
                          {step.detail}
                        </p>
                      )}

                      {/* ── COMPACT VIEW: progress bar only for subtasks ── */}
                      {view === "compact" && hasSubtasks && (
                        <div className="mt-1.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-violet-500/60 transition-all duration-500"
                                style={{
                                  width: `${totalSubs > 0 ? (completedSubs / totalSubs) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span className="text-[9px] text-zinc-600">
                              {completedSubs}/{totalSubs}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* ── DETAILED VIEW: expanded content ── */}
                      {view === "detailed" && isExpanded && (
                        <div className="mt-1.5 space-y-2">
                          {/* Detail text */}
                          {step.detail && (
                            <p className="text-[10px] leading-relaxed text-zinc-600">
                              {step.detail}
                            </p>
                          )}

                          {/* Subtask list */}
                          {hasSubtasks && (
                            <div className="space-y-0.5 border-l-2 border-violet-500/20 pl-2">
                              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                                {step.loop === "evaluation"
                                  ? "Criteria"
                                  : step.loop === "critic"
                                    ? "Findings"
                                    : "Tasks"}
                                {" · "}
                                {completedSubs}/{totalSubs}
                              </p>
                              {step.subtasks!.map((sub) => (
                                <div
                                  key={sub.id}
                                  className={cn(
                                    "flex items-center gap-2 rounded-md py-0.5 px-1.5 text-[10px] transition-all duration-300",
                                    sub.status === "running" &&
                                      "bg-violet-500/5",
                                  )}
                                >
                                  {sub.status === "completed" ? (
                                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                                  ) : sub.status === "running" ? (
                                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-400" />
                                  ) : sub.status === "error" ? (
                                    <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                                  ) : (
                                    <Circle className="h-3 w-3 shrink-0 text-zinc-700" />
                                  )}
                                  <span
                                    className={cn(
                                      "flex-1 min-w-0",
                                      sub.status === "completed"
                                        ? "text-zinc-500"
                                        : sub.status === "running"
                                          ? "text-zinc-200"
                                          : sub.status === "error"
                                            ? "text-red-400"
                                            : "text-zinc-600",
                                    )}
                                  >
                                    {sub.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Content preview — the actual LLM output */}
                          {step.contentPreview && (
                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
                              <div className="flex items-center gap-2 border-b border-zinc-800/50 px-2.5 py-1.5">
                                <Code2 className="h-3 w-3 text-zinc-600" />
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                                  {step.loop || step.type} output
                                </span>
                              </div>
                              <pre className="max-h-48 overflow-auto p-2.5 text-[10px] leading-relaxed text-zinc-500 font-mono whitespace-pre-wrap break-words">
                                {step.contentPreview}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <div ref={stepsEndRef} />
          </div>

          {/* ── Stats bar ── */}
          <div className="border-t border-zinc-800 px-3 py-2">
            <div className="flex items-center justify-between text-[10px] text-zinc-600">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  {formatTokens(totalTokens)} tok
                </span>
                <span className="flex items-center gap-1">
                  <Timer className="h-2.5 w-2.5" />
                  {elapsed < 1000
                    ? `${elapsed}ms`
                    : `${(elapsed / 1000).toFixed(1)}s`}
                </span>
              </div>
              <span className="flex items-center gap-1">
                <Hash className="h-2.5 w-2.5" />
                {steps.filter((s) => s.status === "completed").length}/
                {steps.length} steps
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MessageBubble
   ═══════════════════════════════════════════════════ */

function MessageBubble({
  message,
  onCopy,
  showThinking,
}: {
  message: ChatMessage;
  onCopy: (text: string) => void;
  showThinking?: boolean;
}) {
  const isUser = message.role === "user";
  const isAgent = message.role === "agent";
  const isSystem = message.role === "system";
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  return (
    <div
      className={cn(
        "group mb-4 flex gap-3 chat-slide-in",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div
          className={cn(
            "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            isAgent
              ? "bg-violet-500/10 text-violet-400"
              : isSystem
                ? "bg-amber-500/10 text-amber-400"
                : "bg-blue-500/10 text-blue-400",
          )}
        >
          {isAgent ? (
            <Workflow className="h-3.5 w-3.5" />
          ) : isSystem ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Bot className="h-3.5 w-3.5" />
          )}
        </div>
      )}

      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-blue-600 text-white"
            : isAgent
              ? "border border-violet-500/20 bg-violet-500/5 text-zinc-300"
              : isSystem
                ? "bg-amber-500/10 text-amber-200"
                : "bg-zinc-800 text-zinc-300 chat-content",
        )}
      >
        {/* Loop badge for agent messages */}
        {isAgent && message.loop && (
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                LOOP_COLORS[message.loop] ||
                  "bg-zinc-800 text-zinc-400 border-zinc-700",
              )}
            >
              {message.loop}
            </span>
            {message.messageType && message.messageType !== "text" && (
              <span className="text-[10px] text-zinc-500">
                {message.messageType}
              </span>
            )}
          </div>
        )}

        {/* Collapsible thinking section */}
        {showThinking && message.thinking && (
          <div className="mb-2">
            <button
              onClick={() => setThinkingExpanded((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[10px] text-violet-400 transition-colors hover:bg-violet-500/10"
            >
              <Brain className="h-3 w-3" />
              <span>Razonamiento</span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  thinkingExpanded && "rotate-180",
                )}
              />
            </button>
            {thinkingExpanded && (
              <div className="mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-violet-500/10 bg-black/20 p-2.5 text-[11px] leading-relaxed text-zinc-500">
                <div className="whitespace-pre-wrap">{message.thinking}</div>
              </div>
            )}
          </div>
        )}

        <div className="whitespace-pre-wrap">{message.content}</div>

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="text-[10px] opacity-50">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {message.tokens && ` · ${message.tokens} tokens`}
            {message.durationMs &&
              ` · ${(message.durationMs / 1000).toFixed(1)}s`}
          </span>
          {!isUser && (
            <button
              onClick={() => onCopy(message.content)}
              className="invisible text-zinc-600 transition-colors hover:text-zinc-400 group-hover:visible"
            >
              <Copy className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-700 text-zinc-300">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   StreamingBubble
   ═══════════════════════════════════════════════════ */

function StreamingBubble({
  content,
  isAgent,
}: {
  content: string;
  isAgent?: boolean;
}) {
  return (
    <div className="mb-4 flex gap-3 chat-slide-in">
      <div
        className={cn(
          "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          isAgent
            ? "bg-violet-500/10 text-violet-400"
            : "bg-blue-500/10 text-blue-400",
        )}
      >
        {isAgent ? (
          <Workflow className="h-3.5 w-3.5 animate-pulse" />
        ) : (
          <Bot className="h-3.5 w-3.5 animate-pulse" />
        )}
      </div>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isAgent
            ? "border border-violet-500/20 bg-violet-500/5 text-zinc-300"
            : "bg-zinc-800 text-zinc-300 chat-content",
        )}
      >
        <div className="whitespace-pre-wrap">
          {content}
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400" />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   RecipeSelector
   ═══════════════════════════════════════════════════ */

function RecipeSelector({
  selected,
  onSelect,
  open,
  onToggle,
  recipes,
}: {
  selected: string;
  onSelect: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  recipes: UIRecipe[];
}) {
  const current = recipes.find((r) => r.id === selected) || recipes[0];
  const Icon = current.icon;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-2.5 py-1.5 text-[11px] text-violet-300 transition-colors hover:bg-violet-500/10"
      >
        <Icon className="h-3 w-3" />
        <span className="font-medium">{current.name}</span>
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
          {recipes.map((recipe) => {
            const RIcon = recipe.icon;
            return (
              <button
                key={recipe.id}
                onClick={() => {
                  onSelect(recipe.id);
                  onToggle();
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  recipe.id === selected
                    ? "bg-violet-500/10 text-violet-300"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                )}
              >
                <RIcon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{recipe.name}</div>
                  <div className="text-[10px] text-zinc-500">
                    {recipe.description} · {recipe.loops} loop
                    {recipe.loops > 1 ? "s" : ""}
                  </div>
                </div>
                {recipe.id === selected && (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ModeSwitcher
   ═══════════════════════════════════════════════════ */

function ModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-zinc-700 bg-zinc-800/50 p-0.5">
      <button
        onClick={() => onModeChange("chat")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
          mode === "chat"
            ? "bg-zinc-700 text-zinc-200 shadow-sm"
            : "text-zinc-500 hover:text-zinc-300",
        )}
      >
        <MessageSquare className="h-3 w-3" />
        Chat
      </button>
      <button
        onClick={() => onModeChange("agent")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
          mode === "agent"
            ? "bg-violet-500/20 text-violet-300 shadow-sm"
            : "text-zinc-500 hover:text-zinc-300",
        )}
      >
        <Workflow className="h-3 w-3" />
        Agent
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Main ChatPage
   ═══════════════════════════════════════════════════ */

export default function ChatPage() {
  // Recipes from core API (single source of truth)
  const recipes = useRecipes();

  // Panel state
  const [sessionPanelOpen, setSessionPanelOpen] = useState(true);
  const [execPanelOpen, setExecPanelOpen] = useState(true);

  // Mode state
  const [mode, setMode] = useState<ChatMode>("chat");
  const [selectedRecipe, setSelectedRecipe] = useState("ralph-loop");
  const [recipeSelectorOpen, setRecipeSelectorOpen] = useState(false);

  // Session & message state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("llama3.1:8b");

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Active run tracking — survives navigation
  const activeRunIdRef = useRef<string | null>(null);

  // Execution state
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions
  useEffect(() => {
    fetch("/api/chat/sessions")
      .then((r) => r.json())
      .then((d) => {
        // Add mode field to legacy sessions
        const withMode = (d.sessions || []).map((s: ChatSession) => ({
          ...s,
          mode: s.mode || "chat",
        }));
        setSessions(withMode);
        if (withMode.length > 0) {
          setActiveSessionId(withMode[withMode.length - 1].id);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSessionId]);

  // Sync mode from active session
  useEffect(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session) {
      setMode(session.mode || "chat");
      if (session.recipe) {
        setSelectedRecipe(session.recipe);
      }
    }
  }, [activeSessionId, sessions]);

  // ── Cleanup on unmount: persist active run, clear timer ──
  useEffect(() => {
    return () => {
      // Save active runId so we can reconnect on return
      if (activeRunIdRef.current) {
        try {
          sessionStorage.setItem(
            "alab-active-run",
            JSON.stringify({
              runId: activeRunIdRef.current,
              timestamp: Date.now(),
            }),
          );
        } catch {
          /* quota / SSR */
        }
      }
      // Clear elapsed timer to prevent leaks
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, []);

  // ── Reconnect to active run on mount ──
  useEffect(() => {
    let aborted = false;
    let eventSource: EventSource | null = null;

    try {
      const raw = sessionStorage.getItem("alab-active-run");
      if (!raw) return;
      const { runId, timestamp } = JSON.parse(raw) as {
        runId: string;
        timestamp: number;
      };
      // Only reconnect if it was saved within the last 30 minutes
      if (Date.now() - timestamp > 30 * 60 * 1000) {
        sessionStorage.removeItem("alab-active-run");
        return;
      }

      // Check if the run is still active
      fetch(`/api/runs/${runId}`)
        .then((r) => r.json())
        .then((data) => {
          if (aborted) return;
          const run = data.run || data;
          if (run.status === "running") {
            // Reconnect via SSE events endpoint
            activeRunIdRef.current = runId;
            setIsStreaming(true);
            startTimeRef.current = Date.now();
            elapsedTimerRef.current = setInterval(() => {
              setElapsed(Date.now() - startTimeRef.current);
            }, 100);

            toast.info("Reconectando al run activo…", { duration: 3000 });

            eventSource = new EventSource(`/api/events/${runId}`);

            eventSource.addEventListener("step", (e) => {
              try {
                const outer = JSON.parse(e.data);
                const data = outer.event ? outer : outer.payload || outer;
                setSteps((prev) => {
                  const existing = prev.find((s) => s.id === data.id);
                  if (existing) {
                    return prev.map((s) =>
                      s.id === data.id
                        ? {
                            ...s,
                            status: data.status,
                            durationMs: data.durationMs,
                            detail: data.detail,
                            contentPreview:
                              data.contentPreview || s.contentPreview,
                          }
                        : s,
                    );
                  }
                  return [
                    ...prev,
                    {
                      id: data.id,
                      label: data.label,
                      type: data.type || "think",
                      status: data.status,
                      detail: data.detail,
                      durationMs: data.durationMs,
                      loop: data.loop,
                      iteration: data.iteration,
                      contentPreview: data.contentPreview,
                      startedAt: new Date().toISOString(),
                    },
                  ];
                });
              } catch {
                /* malformed */
              }
            });

            eventSource.addEventListener("stream", (e) => {
              try {
                const outer = JSON.parse(e.data);
                const data = outer.payload || outer;
                if (data.content) {
                  setStreamContent((prev) => prev + data.content);
                }
              } catch {
                /* skip */
              }
            });

            eventSource.addEventListener("result", (e) => {
              try {
                const outer = JSON.parse(e.data);
                const data = outer.payload || outer;
                const finalAnswer = data.finalAnswer || "Agent task completed.";
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg-${Date.now()}`,
                    role: "agent",
                    content: finalAnswer,
                    timestamp: new Date().toISOString(),
                    tokens: data.tokens,
                    messageType: "result",
                  },
                ]);
                toast.success("Run completado", { duration: 4000 });
                cleanup();
              } catch {
                /* skip */
              }
            });

            eventSource.addEventListener("error", (e) => {
              // SSE spec fires generic error on connection close
              if (eventSource?.readyState === EventSource.CLOSED) {
                cleanup();
                return;
              }
              try {
                const outer = JSON.parse((e as MessageEvent).data || "{}");
                const data = outer.payload || outer;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg-${Date.now()}`,
                    role: "system",
                    content: `Agent error: ${data.message || "unknown error"}`,
                    timestamp: new Date().toISOString(),
                  },
                ]);
                toast.error("Error en el run", { duration: 5000 });
              } catch {
                /* connection error — SSE reconnect will handle it */
              }
              cleanup();
            });

            const cleanup = () => {
              activeRunIdRef.current = null;
              sessionStorage.removeItem("alab-active-run");
              setIsStreaming(false);
              setStreamContent("");
              if (elapsedTimerRef.current) {
                clearInterval(elapsedTimerRef.current);
                elapsedTimerRef.current = null;
              }
              eventSource?.close();
              eventSource = null;
            };
          } else {
            // Run already finished
            sessionStorage.removeItem("alab-active-run");
            if (run.status === "completed") {
              toast.success("Run anterior completado", { duration: 3000 });
            } else if (run.status === "failed") {
              toast.error("Run anterior falló", { duration: 3000 });
            }
          }
        })
        .catch(() => {
          sessionStorage.removeItem("alab-active-run");
        });
    } catch {
      sessionStorage.removeItem("alab-active-run");
    }

    return () => {
      aborted = true;
      eventSource?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addStep = useCallback(
    (
      label: string,
      type: TaskStep["type"],
      status: TaskStep["status"] = "running",
      detail?: string,
      extra?: Partial<TaskStep>,
    ) => {
      const step: TaskStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        type,
        status,
        detail,
        startedAt: new Date().toISOString(),
        ...extra,
      };
      setSteps((prev) => [...prev, step]);
      return step.id;
    },
    [],
  );

  const updateStep = useCallback((id: string, updates: Partial<TaskStep>) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    );
  }, []);

  const createNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: mode === "agent" ? "New agent task" : "New session",
      model,
      provider: "ollama",
      mode,
      recipe: mode === "agent" ? selectedRecipe : undefined,
      messageCount: 0,
      tokenCount: 0,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newSession.id);
    setMessages([]);
    setSteps([]);
    setTotalTokens(0);
    setElapsed(0);
  }, [model, mode, selectedRecipe]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
    }
  }, []);

  /* ─── Handle Mode Change ─── */
  const handleModeChange = useCallback(
    (newMode: ChatMode) => {
      setMode(newMode);
      // Update active session mode
      if (activeSessionId) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  mode: newMode,
                  recipe: newMode === "agent" ? selectedRecipe : undefined,
                }
              : s,
          ),
        );
      }
    },
    [activeSessionId, selectedRecipe],
  );

  /* ─── Send Message (Chat mode) ─── */
  const sendChatMessage = useCallback(
    async (text: string) => {
      // Reset execution panel
      setSteps([]);
      setElapsed(0);
      setIsStreaming(true);
      setStreamContent("");
      startTimeRef.current = Date.now();

      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);

      // Simulated execution steps
      const thinkId = addStep("Analyzing request", "think");
      await new Promise((r) => setTimeout(r, 300));
      updateStep(thinkId, { status: "completed", durationMs: 300 });

      const planId = addStep("Planning response", "plan");
      await new Promise((r) => setTimeout(r, 200));
      updateStep(planId, {
        status: "completed",
        durationMs: 200,
        detail: "Determined response strategy",
      });

      const genId = addStep(
        "Generating response",
        "code",
        "running",
        `Model: ${model}`,
      );

      const context = [...messages]
        .filter((m) => m.role !== "system")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        abortRef.current = new AbortController();

        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            model,
            provider: "ollama",
            sessionId: activeSessionId,
            context,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No stream reader");

        const decoder = new TextDecoder();
        let fullContent = "";
        let tokensUsed = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
                setStreamContent(fullContent);
              }
              if (data.done && data.eval_count) {
                tokensUsed = data.eval_count + (data.prompt_eval_count || 0);
              }
            } catch {
              // skip
            }
          }
        }

        const duration = Date.now() - startTimeRef.current;
        updateStep(genId, {
          status: "completed",
          durationMs: duration,
          detail: `${tokensUsed || "?"} tokens generated`,
        });

        const evalId = addStep("Finalizing", "eval");
        await new Promise((r) => setTimeout(r, 150));
        updateStep(evalId, {
          status: "completed",
          durationMs: 150,
          detail: "Response complete",
        });

        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: fullContent,
          timestamp: new Date().toISOString(),
          tokens: tokensUsed || undefined,
          durationMs: duration,
          model,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setTotalTokens((prev) => prev + (tokensUsed || 0));
        setStreamContent("");

        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  messageCount: s.messageCount + 2,
                  tokenCount: s.tokenCount + (tokensUsed || 0),
                  updated_at: new Date().toISOString(),
                }
              : s,
          ),
        );
      } catch (err: unknown) {
        const error = err as Error;
        if (error.name === "AbortError") {
          updateStep(genId, { status: "error", detail: "Cancelled by user" });
          addStep("Generation cancelled", "eval", "skipped");
          if (streamContent) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: "assistant",
                content: streamContent + "\n\n_(generation stopped)_",
                timestamp: new Date().toISOString(),
              },
            ]);
          }
        } else {
          updateStep(genId, { status: "error", detail: error.message });
          addStep("Error occurred", "eval", "error", error.message);
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: "system",
              content: `Error: ${error.message}`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        setStreamContent("");
      } finally {
        setIsStreaming(false);
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      }
    },
    [messages, model, activeSessionId, addStep, updateStep, streamContent],
  );

  /* ─── Send Agent Task ─── */
  const sendAgentTask = useCallback(
    async (text: string) => {
      setSteps([]);
      setElapsed(0);
      setIsStreaming(true);
      setStreamContent("");
      startTimeRef.current = Date.now();

      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);

      // Update session recipe
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId ? { ...s, recipe: selectedRecipe } : s,
        ),
      );

      const context = [...messages]
        .filter((m) => m.role !== "system")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        abortRef.current = new AbortController();

        const res = await fetch("/api/chat/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: text,
            mode: "recipe",
            recipe: selectedRecipe,
            model,
            provider: "ollama",
            sessionId: activeSessionId,
            context,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No stream reader");

        const decoder = new TextDecoder();
        let fullContent = "";
        let thinkingBuffer = "";
        let totalTok = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (data.event) {
                case "run_id": {
                  // Track active run for reconnection on navigation
                  activeRunIdRef.current = data.runId;
                  try {
                    sessionStorage.setItem(
                      "alab-active-run",
                      JSON.stringify({
                        runId: data.runId,
                        timestamp: Date.now(),
                      }),
                    );
                  } catch {
                    /* SSR / quota */
                  }
                  break;
                }
                case "step": {
                  // Upsert step in execution panel
                  setSteps((prev) => {
                    const existing = prev.find((s) => s.id === data.id);
                    if (existing) {
                      return prev.map((s) =>
                        s.id === data.id
                          ? {
                              ...s,
                              status: data.status,
                              durationMs: data.durationMs,
                              detail: data.detail,
                              contentPreview:
                                data.contentPreview || s.contentPreview,
                            }
                          : s,
                      );
                    }
                    return [
                      ...prev,
                      {
                        id: data.id,
                        label: data.label,
                        type: data.type,
                        status: data.status,
                        detail: data.detail,
                        durationMs: data.durationMs,
                        loop: data.loop,
                        iteration: data.iteration,
                        contentPreview: data.contentPreview,
                        startedAt: new Date().toISOString(),
                      },
                    ];
                  });
                  break;
                }
                case "subtask": {
                  // Add or update subtask in its parent step
                  setSteps((prev) =>
                    prev.map((s) => {
                      if (s.id !== data.parentStepId) return s;
                      const existing = s.subtasks || [];
                      const idx = existing.findIndex((st) => st.id === data.id);
                      const sub: SubTask = {
                        id: data.id,
                        parentStepId: data.parentStepId,
                        label: data.label,
                        status: data.status,
                        index: data.index,
                        total: data.total,
                      };
                      if (idx >= 0) {
                        const updated = [...existing];
                        updated[idx] = sub;
                        return { ...s, subtasks: updated };
                      }
                      return { ...s, subtasks: [...existing, sub] };
                    }),
                  );
                  break;
                }
                case "thinking": {
                  // Reasoning content → execution panel context, not chat area
                  if (data.content) {
                    thinkingBuffer += data.content;
                  }
                  break;
                }
                case "stream": {
                  if (data.content) {
                    fullContent += data.content;
                    setStreamContent(fullContent);
                  }
                  break;
                }
                case "result": {
                  totalTok = data.tokens || 0;
                  const duration = Date.now() - startTimeRef.current;

                  // Use finalAnswer (clean result) over streamed fullContent
                  const finalAnswer =
                    data.finalAnswer || fullContent || "Agent task completed.";

                  // Add the main agent result message
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `msg-${Date.now()}`,
                      role: "agent",
                      content: finalAnswer,
                      timestamp: new Date().toISOString(),
                      tokens: totalTok,
                      durationMs: duration,
                      model,
                      messageType: "result",
                      thinking: thinkingBuffer || undefined,
                    },
                  ]);

                  // Add summary message
                  if (data.loops && data.loops.length > 0) {
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `msg-${Date.now()}-summary`,
                        role: "agent",
                        content: `✅ Pipeline completed: **${data.loops.join(" → ")}**\n\n${formatTokens(totalTok)} tokens · ${data.iterations} loops · ${(duration / 1000).toFixed(1)}s`,
                        timestamp: new Date().toISOString(),
                        messageType: "result",
                      },
                    ]);
                  }
                  toast.success("Run completado", { duration: 4000 });
                  activeRunIdRef.current = null;
                  try {
                    sessionStorage.removeItem("alab-active-run");
                  } catch {
                    /* SSR */
                  }
                  break;
                }
                case "error": {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `msg-${Date.now()}`,
                      role: "system",
                      content: `Agent error: ${data.message}`,
                      timestamp: new Date().toISOString(),
                    },
                  ]);
                  toast.error(`Error: ${data.message}`, { duration: 5000 });
                  activeRunIdRef.current = null;
                  try {
                    sessionStorage.removeItem("alab-active-run");
                  } catch {
                    /* SSR */
                  }
                  break;
                }
              }
            } catch {
              // skip malformed
            }
          }
        }

        setTotalTokens((prev) => prev + totalTok);
        setStreamContent("");

        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  messageCount: s.messageCount + 2,
                  tokenCount: s.tokenCount + totalTok,
                  updated_at: new Date().toISOString(),
                }
              : s,
          ),
        );
      } catch (err: unknown) {
        const error = err as Error;
        if (error.name === "AbortError") {
          addStep("Task cancelled", "eval", "skipped");
          if (streamContent) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: "agent",
                content: streamContent + "\n\n_(task stopped)_",
                timestamp: new Date().toISOString(),
              },
            ]);
          }
        } else {
          addStep("Error occurred", "eval", "error", error.message);
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: "system",
              content: `Error: ${error.message}`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        setStreamContent("");
      } finally {
        setIsStreaming(false);
        activeRunIdRef.current = null;
        try {
          sessionStorage.removeItem("alab-active-run");
        } catch {
          /* SSR */
        }
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      }
    },
    [messages, model, activeSessionId, selectedRecipe, addStep, streamContent],
  );

  /* ─── Unified Send ─── */
  const sendMessage = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || isStreaming) return;

      if (!activeSessionId) createNewSession();

      setInput("");
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Update session title from first message
      if (messages.length === 0) {
        const title = text.length > 40 ? text.slice(0, 40) + "…" : text;
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, title } : s)),
        );
      }

      if (mode === "agent") {
        await sendAgentTask(text);
      } else {
        await sendChatMessage(text);
      }
    },
    [
      input,
      isStreaming,
      activeSessionId,
      messages.length,
      mode,
      createNewSession,
      sendAgentTask,
      sendChatMessage,
    ],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div className="flex h-full animate-in fade-in">
      {/* Session Sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => {
          setActiveSessionId(id);
          setMessages([]);
          setSteps([]);
          setTotalTokens(0);
          setElapsed(0);
        }}
        onNew={createNewSession}
        collapsed={!sessionPanelOpen}
        onToggle={() => setSessionPanelOpen((v) => !v)}
      />

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-3">
            {mode === "agent" ? (
              <Workflow className="h-4 w-4 text-violet-400" />
            ) : (
              <MessageSquare className="h-4 w-4 text-zinc-500" />
            )}
            <span className="text-sm font-medium text-zinc-300">
              {sessions.find((s) => s.id === activeSessionId)?.title ||
                (mode === "agent" ? "New Agent Task" : "New Chat")}
            </span>
            {mode === "agent" && (
              <Badge
                variant="muted"
                className="bg-violet-500/10 text-violet-300 text-[10px] border-violet-500/20"
              >
                <Workflow className="mr-1 h-2.5 w-2.5" />
                {recipes.find((r) => r.id === selectedRecipe)?.name || "Agent"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ModeSwitcher mode={mode} onModeChange={handleModeChange} />
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-blue-500/50"
            >
              <option value="llama3.1:8b">llama3.1:8b</option>
              <option value="qwen2.5-coder:7b">qwen2.5-coder:7b</option>
            </select>
            <Badge variant="muted" className="text-[10px]">
              <Sparkles className="mr-1 h-2.5 w-2.5" />
              {formatTokens(totalTokens)} tokens
            </Badge>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex h-full items-center justify-center">
              <div className="flex max-w-lg flex-col items-center gap-4 text-center">
                <div
                  className={cn(
                    "rounded-2xl p-6",
                    mode === "agent"
                      ? "bg-gradient-to-br from-violet-500/10 to-purple-500/10"
                      : "bg-gradient-to-br from-violet-500/10 to-blue-500/10",
                  )}
                >
                  {mode === "agent" ? (
                    <Workflow className="h-10 w-10 text-violet-400" />
                  ) : (
                    <Bot className="h-10 w-10 text-violet-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-200">
                    {mode === "agent"
                      ? "Agentic Task Runner"
                      : "Agentic Lab Chat"}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500 leading-relaxed">
                    {mode === "agent"
                      ? "Describe a task and the multi-loop engine will plan, execute, evaluate, critique, and consolidate. Select a recipe to control the pipeline."
                      : "Chat directly with the LLM. Ask questions, debug code, or explore ideas."}
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {mode === "agent"
                    ? [
                        "Refactor the auth module for better security",
                        "Write tests for the pipeline orchestrator",
                        "Plan a migration from REST to GraphQL",
                        "Full code review of the storage layer",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => {
                            setInput(prompt);
                            inputRef.current?.focus();
                          }}
                          className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-300/70 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-200"
                        >
                          {prompt}
                        </button>
                      ))
                    : [
                        "Explain the 5-loop architecture",
                        "Help me debug my pipeline",
                        "Create a planning loop config",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => {
                            setInput(prompt);
                            inputRef.current?.focus();
                          }}
                          className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-blue-500/30 hover:bg-blue-500/5 hover:text-blue-300"
                        >
                          {prompt}
                        </button>
                      ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onCopy={copyToClipboard}
              showThinking={showThinking}
            />
          ))}

          {isStreaming && streamContent && (
            <StreamingBubble
              content={streamContent}
              isAgent={mode === "agent"}
            />
          )}

          {/* Agent working indicator (when no stream content yet) */}
          {isStreaming && !streamContent && mode === "agent" && (
            <div className="mb-4 flex gap-3 chat-slide-in">
              <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                <Brain className="h-3.5 w-3.5 animate-pulse" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 text-sm text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                <span className="text-xs">Agent working…</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
          <form onSubmit={sendMessage} className="mx-auto max-w-3xl">
            {/* Agent controls bar */}
            {mode === "agent" && (
              <div className="mb-2 flex items-center gap-2">
                <RecipeSelector
                  selected={selectedRecipe}
                  onSelect={setSelectedRecipe}
                  open={recipeSelectorOpen}
                  onToggle={() => setRecipeSelectorOpen((v) => !v)}
                  recipes={recipes}
                />

                {/* Thinking mode toggle */}
                <button
                  type="button"
                  onClick={() => setShowThinking((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-medium transition-all",
                    showThinking
                      ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                      : "border-zinc-700/50 bg-zinc-800/30 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400",
                  )}
                  title={
                    showThinking
                      ? "Ocultar razonamiento"
                      : "Mostrar razonamiento"
                  }
                >
                  <Brain className="h-3 w-3" />
                  <span className="hidden sm:inline">Thinking</span>
                  {showThinking ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                </button>

                <div className="flex-1" />
                <span className="text-[10px] text-zinc-600">
                  The task will run through{" "}
                  {recipes.find((r) => r.id === selectedRecipe)?.loops || 1}{" "}
                  loop
                  {(recipes.find((r) => r.id === selectedRecipe)?.loops || 1) >
                  1
                    ? "s"
                    : ""}
                </span>
              </div>
            )}

            <div
              className={cn(
                "relative flex items-end rounded-2xl border transition-colors",
                mode === "agent"
                  ? "border-violet-500/30 bg-violet-500/5 focus-within:border-violet-500/50 focus-within:ring-1 focus-within:ring-violet-500/20"
                  : "border-zinc-700 bg-zinc-800/50 focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/20",
              )}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === "agent"
                    ? "Describe a task for the agent…"
                    : "Send a message…"
                }
                rows={1}
                className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                style={{ maxHeight: 200 }}
              />
              <div className="flex items-center gap-1 p-2">
                {isStreaming ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={stopGeneration}
                    className="h-8 w-8 text-red-400 hover:bg-red-500/10"
                  >
                    <StopCircle className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!input.trim()}
                    className={cn(
                      "h-8 w-8 rounded-xl transition-all",
                      input.trim()
                        ? mode === "agent"
                          ? "bg-violet-600 text-white hover:bg-violet-700"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-zinc-700 text-zinc-500",
                    )}
                  >
                    {mode === "agent" ? (
                      <Play className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-zinc-600">
              {mode === "agent" ? (
                <>
                  Enter to run · Shift+Enter for new line · Recipe:{" "}
                  <span className="text-violet-400/70">
                    {recipes.find((r) => r.id === selectedRecipe)?.name}
                  </span>{" "}
                  · <span className="text-zinc-500">{model}</span>
                </>
              ) : (
                <>
                  Enter to send · Shift+Enter for new line · Using{" "}
                  <span className="text-zinc-500">{model}</span> via Ollama
                </>
              )}
            </p>
          </form>
        </div>
      </div>

      {/* Execution Panel */}
      <ExecutionPanel
        steps={steps}
        collapsed={!execPanelOpen}
        onToggle={() => setExecPanelOpen((v) => !v)}
        totalTokens={totalTokens}
        elapsed={elapsed}
        isRunning={isStreaming}
        mode={mode}
        activeRecipe={mode === "agent" ? selectedRecipe : undefined}
        recipes={recipes}
      />
    </div>
  );
}
