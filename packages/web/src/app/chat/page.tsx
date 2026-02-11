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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

interface ChatSession {
  id: string;
  title: string;
  model: string;
  provider: string;
  messageCount: number;
  tokenCount: number;
  status: "active" | "completed" | "error";
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  tokens?: number;
  durationMs?: number;
  model?: string;
}

interface TaskStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "error" | "skipped";
  type: "think" | "tool" | "code" | "search" | "write" | "eval" | "plan";
  detail?: string;
  durationMs?: number;
  startedAt?: string;
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const STEP_ICONS: Record<string, React.ElementType> = {
  think: Brain,
  tool: Wrench,
  code: Code2,
  search: Search,
  write: FileText,
  eval: Eye,
  plan: Zap,
};

const STEP_COLORS: Record<string, string> = {
  think: "text-violet-400",
  tool: "text-amber-400",
  code: "text-blue-400",
  search: "text-cyan-400",
  write: "text-emerald-400",
  eval: "text-pink-400",
  plan: "text-orange-400",
};

/* ═══════════════════════════════════════════════════
   Session Sidebar (left)
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
  if (collapsed) {
    return (
      <div className="flex w-12 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-3">
        <button
          onClick={onToggle}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <div className="my-3 h-px w-6 bg-zinc-800" />
        <button
          onClick={onNew}
          className="rounded-lg p-2 text-zinc-500 hover:bg-blue-500/10 hover:text-blue-400 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="my-3 h-px w-6 bg-zinc-800" />
        {sessions.slice(0, 8).map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              "my-0.5 rounded-lg p-2 transition-colors",
              activeId === s.id
                ? "bg-blue-500/10 text-blue-400"
                : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400",
            )}
          >
            <Hash className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-72 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-200">Sessions</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-blue-500/10 hover:text-blue-400 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <MessageSquare className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-600">No sessions yet</p>
          </div>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={cn(
              "flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-all",
              activeId === session.id
                ? "bg-blue-500/8 border border-blue-500/20"
                : "hover:bg-zinc-800/50 border border-transparent",
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "text-sm font-medium truncate",
                  activeId === session.id ? "text-blue-300" : "text-zinc-300",
                )}
              >
                {session.title}
              </span>
              <span className="text-[10px] text-zinc-600 shrink-0 ml-2">
                {timeAgo(session.updated_at)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-600">
              <span className="flex items-center gap-1">
                <Cpu className="h-2.5 w-2.5" />
                {session.model}
              </span>
              <span>·</span>
              <span>{session.messageCount} msgs</span>
              {session.tokenCount > 0 && (
                <>
                  <span>·</span>
                  <span>{formatTokens(session.tokenCount)} tok</span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Execution Panel (right)
   ═══════════════════════════════════════════════════ */

function ExecutionPanel({
  steps,
  collapsed,
  onToggle,
  totalTokens,
  elapsed,
  isRunning,
}: {
  steps: TaskStep[];
  collapsed: boolean;
  onToggle: () => void;
  totalTokens: number;
  elapsed: number;
  isRunning: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [steps]);

  if (collapsed) {
    return (
      <div className="flex w-12 flex-col items-center border-l border-zinc-800 bg-zinc-950 py-3">
        <button
          onClick={onToggle}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        {isRunning && (
          <div className="mt-3">
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          </div>
        )}
        {steps.length > 0 && (
          <div className="mt-3 flex flex-col items-center gap-1">
            {steps.slice(-6).map((step) => {
              const color =
                step.status === "completed"
                  ? "bg-emerald-400"
                  : step.status === "running"
                    ? "bg-blue-400 animate-pulse"
                    : step.status === "error"
                      ? "bg-red-400"
                      : "bg-zinc-700";
              return (
                <div
                  key={step.id}
                  className={cn("h-1.5 w-1.5 rounded-full", color)}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-80 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-200">
            Execution
          </span>
          {isRunning && (
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>
        <button
          onClick={onToggle}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 border-b border-zinc-800/60 px-4 py-2 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          {formatTokens(totalTokens)} tokens
        </span>
        <span className="flex items-center gap-1">
          <Timer className="h-3 w-3" />
          {elapsed > 0 ? `${(elapsed / 1000).toFixed(1)}s` : "—"}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {steps.length} steps
        </span>
      </div>

      {/* Steps timeline */}
      <div ref={panelRef} className="flex-1 overflow-y-auto p-3">
        {steps.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Terminal className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-600">
              Steps will appear here during execution
            </p>
          </div>
        )}

        <div className="relative space-y-0">
          {/* Vertical line */}
          {steps.length > 0 && (
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-zinc-800" />
          )}

          {steps.map((step, i) => {
            const StepIcon = STEP_ICONS[step.type] || Circle;
            const stepColor = STEP_COLORS[step.type] || "text-zinc-400";
            const isLast = i === steps.length - 1;

            return (
              <div key={step.id} className="relative flex gap-3 pb-4">
                {/* Dot / Icon */}
                <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
                  {step.status === "running" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20">
                      <Loader2
                        className={cn("h-3.5 w-3.5 animate-spin", stepColor)}
                      />
                    </div>
                  ) : step.status === "completed" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                  ) : step.status === "error" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/10">
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800">
                      <StepIcon className={cn("h-3 w-3", stepColor)} />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        step.status === "running"
                          ? "text-blue-300"
                          : step.status === "completed"
                            ? "text-zinc-300"
                            : step.status === "error"
                              ? "text-red-300"
                              : "text-zinc-500",
                      )}
                    >
                      {step.label}
                    </span>
                    {step.durationMs !== undefined && (
                      <span className="text-[10px] tabular-nums text-zinc-600">
                        {step.durationMs}ms
                      </span>
                    )}
                  </div>
                  {step.detail && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">
                      {step.detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Running indicator at bottom */}
          {isRunning && (
            <div className="relative flex gap-3 pb-2">
              <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              </div>
              <span className="pt-1 text-[11px] text-zinc-600 italic">
                Processing…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Message Bubble
   ═══════════════════════════════════════════════════ */

function MessageBubble({
  message,
  onCopy,
}: {
  message: ChatMessage;
  onCopy: (content: string) => void;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-zinc-800/60 px-3 py-1 text-[10px] text-zinc-500">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex gap-3 py-3 chat-message-enter",
        isUser ? "flex-row-reverse" : "",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
          isUser
            ? "bg-blue-500/20 text-blue-400"
            : "bg-violet-500/20 text-violet-400",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div
        className={cn("max-w-[75%] min-w-0", isUser ? "text-right" : "")}
      >
        <div
          className={cn(
            "inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-blue-600 text-blue-50 rounded-tr-md"
              : "bg-zinc-800/70 text-zinc-200 rounded-tl-md border border-zinc-700/50",
          )}
        >
          {/* Render markdown-like content */}
          <div className="chat-content whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>

        {/* Meta */}
        <div
          className={cn(
            "mt-1 flex items-center gap-2 text-[10px] text-zinc-600",
            isUser ? "justify-end" : "",
          )}
        >
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {message.tokens && (
            <span className="flex items-center gap-0.5">
              <Sparkles className="h-2.5 w-2.5" />
              {message.tokens}
            </span>
          )}
          {message.durationMs && (
            <span>{(message.durationMs / 1000).toFixed(1)}s</span>
          )}
          {!isUser && (
            <button
              onClick={() => onCopy(message.content)}
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-zinc-700"
            >
              <Copy className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Streaming Indicator
   ═══════════════════════════════════════════════════ */

function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="group flex gap-3 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 text-violet-400">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[75%] min-w-0">
        <div className="inline-block rounded-2xl rounded-tl-md border border-zinc-700/50 bg-zinc-800/70 px-4 py-2.5 text-sm leading-relaxed text-zinc-200">
          <div className="chat-content whitespace-pre-wrap break-words">
            {content}
            <span className="inline-block w-2 h-4 ml-0.5 bg-violet-400/60 animate-pulse rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Main Chat Page
   ═══════════════════════════════════════════════════ */

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [sessionPanelOpen, setSessionPanelOpen] = useState(true);
  const [execPanelOpen, setExecPanelOpen] = useState(true);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [model, setModel] = useState("llama3.1:8b");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load sessions on mount
  useEffect(() => {
    fetch("/api/chat/sessions")
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        if (d.sessions?.length > 0) {
          setActiveSessionId(d.sessions[d.sessions.length - 1].id);
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

  const addStep = useCallback(
    (
      label: string,
      type: TaskStep["type"],
      status: TaskStep["status"] = "running",
      detail?: string,
    ) => {
      const step: TaskStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        type,
        status,
        detail,
        startedAt: new Date().toISOString(),
      };
      setSteps((prev) => [...prev, step]);
      return step.id;
    },
    [],
  );

  const updateStep = useCallback(
    (id: string, updates: Partial<TaskStep>) => {
      setSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      );
    },
    [],
  );

  const createNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: "New session",
      model,
      provider: "ollama",
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
  }, [model]);

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

  /* ─── Send Message ─── */
  const sendMessage = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || isStreaming) return;

      // Create session if needed
      if (!activeSessionId) {
        createNewSession();
      }

      // Clear & add user message
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
        const title =
          text.length > 40 ? text.slice(0, 40) + "…" : text;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, title } : s,
          ),
        );
      }

      // Reset execution panel
      setSteps([]);
      setElapsed(0);
      setIsStreaming(true);
      setStreamContent("");
      startTimeRef.current = Date.now();

      // Elapsed timer
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);

      // Execution steps
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

      const genId = addStep("Generating response", "code", "running", `Model: ${model}`);

      // Build context from recent messages
      const context = [...messages, userMsg]
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
            context: context.slice(0, -1), // exclude the current message
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

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

        // Finalize
        const duration = Date.now() - startTimeRef.current;
        updateStep(genId, {
          status: "completed",
          durationMs: duration,
          detail: `${tokensUsed || "?"} tokens generated`,
        });

        // Add eval step
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

        // Update session stats
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
          updateStep(genId, {
            status: "error",
            detail: "Cancelled by user",
          });
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
          updateStep(genId, {
            status: "error",
            detail: error.message,
          });
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
        if (elapsedTimerRef.current) {
          clearInterval(elapsedTimerRef.current);
        }
      }
    },
    [
      input,
      isStreaming,
      activeSessionId,
      messages,
      model,
      addStep,
      updateStep,
      createNewSession,
      streamContent,
    ],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Auto-resize textarea
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
            <MessageSquare className="h-4 w-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-300">
              {sessions.find((s) => s.id === activeSessionId)?.title ||
                "New Chat"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Model selector */}
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
              <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 p-6">
                  <Bot className="h-10 w-10 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-200">
                    Agentic Lab Chat
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500 leading-relaxed">
                    Interact with the multi-loop engine. Ask about your
                    pipelines, debug configurations, or let the agent help
                    you build.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {[
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
            />
          ))}

          {isStreaming && streamContent && (
            <StreamingBubble content={streamContent} />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
          <form onSubmit={sendMessage} className="mx-auto max-w-3xl">
            <div className="relative flex items-end rounded-2xl border border-zinc-700 bg-zinc-800/50 transition-colors focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/20">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Send a message…"
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
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-zinc-700 text-zinc-500",
                    )}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-zinc-600">
              Enter to send · Shift+Enter for new line · Using{" "}
              <span className="text-zinc-500">{model}</span> via Ollama
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
      />
    </div>
  );
}
