"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Brain,
  Search,
  Plus,
  Trash2,
  FolderTree,
  RefreshCw,
  Loader2,
  ChevronRight,
  Copy,
  Check,
  Sparkles,
  Database,
  Tag,
  Clock,
  AlertTriangle,
  X,
  Eye,
  FileJson,
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

/* ─── Types ──────────────────────────────────────── */

interface MemoryItem {
  id: string;
  namespace: string[];
  key: string;
  value: Record<string, unknown>;
  qdrantPointId?: string;
  createdAt: string;
  updatedAt: string;
}

interface NamespaceInfo {
  path: string;
  segments: string[];
  count: number;
}

/* ─── Helpers ────────────────────────────────────── */

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function extractPreview(value: Record<string, unknown>): string {
  for (const field of [
    "text",
    "content",
    "description",
    "summary",
    "memory",
    "note",
  ]) {
    if (typeof value[field] === "string") {
      const text = value[field] as string;
      return text.length > 200 ? text.slice(0, 200) + "…" : text;
    }
  }
  const json = JSON.stringify(value);
  return json.length > 200 ? json.slice(0, 200) + "…" : json;
}

/* ─── Page ───────────────────────────────────────── */

export default function MemoriesPage() {
  const infra = useInfraStatus();
  const qdrantOk = infra.capabilities?.semanticSearch ?? false;
  const pgOk = infra.capabilities?.persistence ?? false;

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [searchType, setSearchType] = useState<string>("");
  const [selectedNamespace, setSelectedNamespace] = useState<string>("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createNs, setCreateNs] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [createValue, setCreateValue] = useState("{}");
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedNamespace)
        params.set("namespace", selectedNamespace.replace(/\//g, ","));
      if (activeSearch) params.set("q", activeSearch);
      params.set("limit", "100");

      const res = await fetch(`/api/memories?${params}`);
      const data = await res.json();
      setMemories(data.memories || []);
      setTotalCount(data.total || 0);
      setSearchType(data.searchType || "");
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, [selectedNamespace, activeSearch]);

  const fetchNamespaces = useCallback(async () => {
    try {
      const res = await fetch("/api/memories/namespaces");
      const data = await res.json();
      setNamespaces(data.namespaces || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchMemories();
    fetchNamespaces();
  }, [fetchMemories, fetchNamespaces]);

  const handleSearch = () => {
    setActiveSearch(searchQuery);
  };

  const handleCreate = async () => {
    if (!createKey.trim()) return;
    setCreating(true);
    try {
      const ns = createNs
        .split(/[/,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(createValue);
      } catch {
        // If not valid JSON, wrap as text content
        parsed = { text: createValue };
      }

      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace: ns,
          key: createKey.trim(),
          value: parsed,
        }),
      });

      if (res.ok) {
        setShowCreate(false);
        setCreateNs("");
        setCreateKey("");
        setCreateValue("{}");
        fetchMemories();
        fetchNamespaces();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (item: MemoryItem) => {
    try {
      const ns = item.namespace.join(",");
      const res = await fetch(
        `/api/memories/${encodeURIComponent(item.key)}?namespace=${ns}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== item.id));
        setDeletingKey(null);
        fetchNamespaces();
      }
    } catch {
      /* ignore */
    }
  };

  const copyValue = (item: MemoryItem) => {
    navigator.clipboard.writeText(JSON.stringify(item.value, null, 2));
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const vectorCount = memories.filter((m) => m.qdrantPointId).length;

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-purple-500" />
          <div>
            <h1 className="text-lg font-bold">Contexto Semántico</h1>
            <p className="text-xs text-zinc-500">
              Memorias, vectores y búsqueda semántica
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 text-xs",
              qdrantOk
                ? "border-purple-500/30 text-purple-400"
                : "border-zinc-700 text-zinc-500",
            )}
          >
            <Sparkles className="h-3 w-3" />
            {qdrantOk ? "Qdrant activo" : "Sin vectores"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchMemories();
              fetchNamespaces();
            }}
            className="gap-1 border-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refrescar
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="gap-1 bg-purple-600 hover:bg-purple-700"
            disabled={!pgOk}
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva memoria
          </Button>
        </div>
      </header>

      <InfraBanner
        services={infra.services}
        capabilities={infra.capabilities}
        degraded={infra.degraded}
        status={infra.status}
      />

      {/* Stats bar */}
      <div className="flex items-center gap-4 border-b border-zinc-800/50 px-6 py-2.5 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          {totalCount} memorias
        </span>
        <span className="flex items-center gap-1.5">
          <FolderTree className="h-3.5 w-3.5" />
          {namespaces.length} namespaces
        </span>
        {vectorCount > 0 && (
          <span className="flex items-center gap-1.5 text-purple-400">
            <Sparkles className="h-3.5 w-3.5" />
            {vectorCount} vectorizadas
          </span>
        )}
        {searchType && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              searchType === "semantic"
                ? "border-purple-500/30 text-purple-400"
                : "border-yellow-500/30 text-yellow-400",
            )}
          >
            {searchType === "semantic"
              ? "Búsqueda semántica"
              : "Búsqueda textual"}
          </Badge>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Namespace sidebar ─── */}
        <aside className="w-56 shrink-0 border-r border-zinc-800 overflow-y-auto p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Namespaces
          </p>

          <button
            onClick={() => setSelectedNamespace("")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
              selectedNamespace === ""
                ? "bg-purple-500/10 text-purple-400"
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300",
            )}
          >
            <FolderTree className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Todas</span>
            <span className="ml-auto text-[10px] text-zinc-600">
              {namespaces.reduce((s, n) => s + n.count, 0)}
            </span>
          </button>

          {namespaces.map((ns) => (
            <button
              key={ns.path}
              onClick={() => setSelectedNamespace(ns.path)}
              className={cn(
                "mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                selectedNamespace === ns.path
                  ? "bg-purple-500/10 text-purple-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300",
              )}
            >
              <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
              <span className="truncate font-mono">{ns.path || "(root)"}</span>
              <span className="ml-auto text-[10px] text-zinc-600">
                {ns.count}
              </span>
            </button>
          ))}

          {namespaces.length === 0 && !loading && (
            <p className="mt-4 text-center text-[11px] text-zinc-600">
              Sin namespaces
            </p>
          )}
        </aside>

        {/* ─── Main content ─── */}
        <main className="flex-1 overflow-y-auto">
          {/* Search bar */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-800/50 bg-zinc-950/95 px-4 py-3 backdrop-blur">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={
                  qdrantOk
                    ? "Búsqueda semántica… (significado, no solo texto)"
                    : "Buscar por texto…"
                }
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-10 pr-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="gap-1 bg-purple-600 hover:bg-purple-700"
            >
              {qdrantOk ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              Buscar
            </Button>
            {activeSearch && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchQuery("");
                  setActiveSearch("");
                }}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Content */}
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : memories.length === 0 ? (
              <EmptyState
                hasSearch={!!activeSearch}
                hasInfra={pgOk}
                onCreateClick={() => setShowCreate(true)}
              />
            ) : (
              <div className="space-y-2">
                {memories.map((item) => (
                  <MemoryCard
                    key={item.id}
                    item={item}
                    expanded={expandedItem === item.id}
                    onToggle={() =>
                      setExpandedItem(expandedItem === item.id ? null : item.id)
                    }
                    onCopy={() => copyValue(item)}
                    copied={copiedId === item.id}
                    onDelete={() => setDeletingKey(item.id)}
                    qdrantOk={qdrantOk}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ─── Create Modal ─── */}
      {showCreate && (
        <ModalOverlay onClose={() => setShowCreate(false)}>
          <Card className="w-full max-w-lg border-zinc-700 bg-zinc-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4 text-purple-500" />
                Nueva Memoria
              </CardTitle>
              <CardDescription className="text-xs">
                Almacena un fragmento de contexto semántico.
                {qdrantOk &&
                  " Se vectorizará automáticamente para búsqueda semántica."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Namespace (opcional, separar con /)
                </label>
                <input
                  value={createNs}
                  onChange={(e) => setCreateNs(e.target.value)}
                  placeholder="ej: runs/my-project"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Key *
                </label>
                <input
                  value={createKey}
                  onChange={(e) => setCreateKey(e.target.value)}
                  placeholder="ej: auth-module-insights"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Valor (JSON o texto libre)
                </label>
                <textarea
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  rows={6}
                  placeholder='{"text": "El módulo de auth usa JWT con refresh tokens..."}'
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreate(false)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={creating || !createKey.trim()}
                  className="gap-1 bg-purple-600 hover:bg-purple-700"
                >
                  {creating && <Loader2 className="h-3 w-3 animate-spin" />}
                  Crear
                </Button>
              </div>
            </CardContent>
          </Card>
        </ModalOverlay>
      )}

      {/* ─── Delete confirmation ─── */}
      {deletingKey && (
        <ModalOverlay onClose={() => setDeletingKey(null)}>
          <Card className="w-full max-w-sm border-red-900/50 bg-zinc-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-red-400">
                <Trash2 className="h-4 w-4" />
                Eliminar memoria
              </CardTitle>
              <CardDescription className="text-xs">
                Esta acción no se puede deshacer.
                {qdrantOk && " También se eliminará el vector de Qdrant."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingKey(null)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    const item = memories.find((m) => m.id === deletingKey);
                    if (item) handleDelete(item);
                  }}
                >
                  Eliminar
                </Button>
              </div>
            </CardContent>
          </Card>
        </ModalOverlay>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────── */

function MemoryCard({
  item,
  expanded,
  onToggle,
  onCopy,
  copied,
  onDelete,
  qdrantOk,
}: {
  item: MemoryItem;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
  onDelete: () => void;
  qdrantOk: boolean;
}) {
  const preview = extractPreview(item.value);
  const hasVector = !!item.qdrantPointId;

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        expanded
          ? "border-purple-500/30 bg-zinc-900/80"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700",
      )}
    >
      {/* Header row */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3"
        onClick={onToggle}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-500/10">
          {hasVector ? (
            <Sparkles className="h-4 w-4 text-purple-400" />
          ) : (
            <FileJson className="h-4 w-4 text-zinc-500" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-medium text-zinc-200">
              {item.key}
            </span>
            {hasVector && qdrantOk && (
              <Badge className="shrink-0 bg-purple-500/20 px-1.5 py-0 text-[10px] text-purple-400">
                vectorizado
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            {item.namespace.length > 0 && (
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {item.namespace.join("/")}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(item.updatedAt)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-zinc-600 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </div>
      </div>

      {/* Preview (always visible) */}
      {!expanded && (
        <div className="px-4 pb-3">
          <p className="text-xs leading-relaxed text-zinc-500 line-clamp-2">
            {preview}
          </p>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            <Eye className="h-3 w-3" />
            Contenido completo
          </div>
          <pre className="max-h-80 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
            {JSON.stringify(item.value, null, 2)}
          </pre>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-600">
            <span>ID: {item.id}</span>
            {item.qdrantPointId && <span>Qdrant: {item.qdrantPointId}</span>}
            <span>Creado: {new Date(item.createdAt).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  hasSearch,
  hasInfra,
  onCreateClick,
}: {
  hasSearch: boolean;
  hasInfra: boolean;
  onCreateClick: () => void;
}) {
  if (!hasInfra) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-yellow-500/60" />
        <h3 className="text-sm font-semibold text-zinc-300">
          Infraestructura no disponible
        </h3>
        <p className="mt-1 max-w-sm text-xs text-zinc-500">
          PostgreSQL debe estar activo para almacenar memorias. Ejecuta{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10px]">
            docker compose up -d
          </code>{" "}
          en el directorio raíz.
        </p>
      </div>
    );
  }

  if (hasSearch) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="mb-3 h-10 w-10 text-zinc-700" />
        <h3 className="text-sm font-semibold text-zinc-300">Sin resultados</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Prueba con otros términos de búsqueda.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Brain className="mb-3 h-10 w-10 text-purple-500/40" />
      <h3 className="text-sm font-semibold text-zinc-300">Sin memorias aún</h3>
      <p className="mt-1 max-w-sm text-xs text-zinc-500">
        Las memorias almacenan contexto semántico que persiste entre
        ejecuciones. Los agentes pueden guardar y recuperar conocimiento aquí.
      </p>
      <Button
        size="sm"
        onClick={onCreateClick}
        className="mt-4 gap-1 bg-purple-600 hover:bg-purple-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Crear primera memoria
      </Button>
    </div>
  );
}

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
