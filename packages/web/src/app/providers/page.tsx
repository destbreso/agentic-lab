"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Cpu,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Globe,
  Zap,
  Server,
  AlertTriangle,
  Plus,
  Settings2,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────── */

interface Provider {
  id: string;
  name: string;
  type: "local" | "cloud";
  baseUrl: string;
  models: string[];
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs?: number;
}

/* ─── Constants ──────────────────────────────────── */

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "ollama",
    name: "Ollama",
    type: "local",
    baseUrl: "http://localhost:11434",
    models: [],
    status: "unknown",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "cloud",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
    status: "unknown",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "cloud",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-20250514", "claude-3.5-haiku"],
    status: "unknown",
  },
];

/* ─── Sub-components ─────────────────────────────── */

function StatusDot({ status }: { status: string }) {
  return (
    <div
      className={cn(
        "h-2 w-2 rounded-full",
        status === "healthy" &&
          "bg-emerald-400 shadow-sm shadow-emerald-400/50",
        status === "unhealthy" && "bg-red-400 shadow-sm shadow-red-400/50",
        status === "unknown" && "bg-zinc-500",
      )}
    />
  );
}

function ProviderCard({
  provider,
  onCheck,
  checking,
}: {
  provider: Provider;
  onCheck: () => void;
  checking: boolean;
}) {
  const isLocal = provider.type === "local";

  return (
    <Card className="group flex flex-col transition-all hover:border-zinc-600">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "rounded-xl p-2.5",
                isLocal
                  ? "bg-blue-500/10 text-blue-400"
                  : "bg-violet-500/10 text-violet-400",
              )}
            >
              {isLocal ? (
                <Server className="h-5 w-5" />
              ) : (
                <Globe className="h-5 w-5" />
              )}
            </div>
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                {provider.name}
                <StatusDot status={provider.status} />
              </CardTitle>
              <CardDescription className="text-[10px] font-mono">
                {provider.baseUrl}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={isLocal ? "default" : "outline"}
            className="text-[10px]"
          >
            {isLocal ? "Local" : "Cloud"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-3">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Status</span>
          <Badge
            variant={
              provider.status === "healthy"
                ? "success"
                : provider.status === "unhealthy"
                  ? "error"
                  : "muted"
            }
          >
            {provider.status === "healthy" && (
              <CheckCircle2 className="mr-1 h-3 w-3" />
            )}
            {provider.status === "unhealthy" && (
              <XCircle className="mr-1 h-3 w-3" />
            )}
            {provider.status === "unknown" && (
              <AlertTriangle className="mr-1 h-3 w-3" />
            )}
            {provider.status}
          </Badge>
        </div>

        {provider.latencyMs !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Latency</span>
            <span className="text-xs font-semibold tabular-nums text-zinc-300">
              {provider.latencyMs}ms
            </span>
          </div>
        )}

        {/* Models */}
        {provider.models.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-zinc-500">Available Models</p>
            <div className="flex flex-wrap gap-1.5">
              {provider.models.map((model) => (
                <Badge
                  key={model}
                  variant="muted"
                  className="text-[10px] font-mono"
                >
                  {model}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {provider.models.length === 0 && provider.status !== "healthy" && (
          <p className="text-xs italic text-zinc-600">
            Check connection to discover models
          </p>
        )}
      </CardContent>

      <CardFooter className="border-t border-zinc-800/50 pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={onCheck}
          disabled={checking}
        >
          {checking ? (
            <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Zap className="mr-2 h-3 w-3" />
          )}
          {checking ? "Checking…" : "Test Connection"}
        </Button>
      </CardFooter>
    </Card>
  );
}

/* ─── Main Page ──────────────────────────────────── */

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>(DEFAULT_PROVIDERS);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Check Ollama on mount
  useEffect(() => {
    checkOllama();
  }, []);

  const checkOllama = useCallback(async () => {
    setCheckingId("ollama");
    try {
      const start = Date.now();
      const res = await fetch("http://localhost:11434/api/tags");
      const latencyMs = Date.now() - start;

      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: { name: string }) => m.name);
        setProviders((prev) =>
          prev.map((p) =>
            p.id === "ollama"
              ? { ...p, status: "healthy" as const, models, latencyMs }
              : p,
          ),
        );
      } else {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === "ollama" ? { ...p, status: "unhealthy" as const } : p,
          ),
        );
      }
    } catch {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === "ollama" ? { ...p, status: "unhealthy" as const } : p,
        ),
      );
    } finally {
      setCheckingId(null);
    }
  }, []);

  const checkProvider = useCallback(
    async (id: string) => {
      if (id === "ollama") {
        await checkOllama();
        return;
      }

      setCheckingId(id);
      // For cloud providers, we just simulate — real check would need API keys
      await new Promise((r) => setTimeout(r, 800));
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "unknown" as const,
                latencyMs: undefined,
              }
            : p,
        ),
      );
      setCheckingId(null);
    },
    [checkOllama],
  );

  const healthyCount = providers.filter((p) => p.status === "healthy").length;
  const totalModels = providers.reduce((s, p) => s + p.models.length, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 animate-in fade-in">
      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-400">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Providers</p>
              <p className="text-2xl font-bold tabular-nums text-zinc-50">
                {providers.length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Healthy</p>
              <p className="text-2xl font-bold tabular-nums text-zinc-50">
                {healthyCount}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-400">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Total Models</p>
              <p className="text-2xl font-bold tabular-nums text-zinc-50">
                {totalModels}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onCheck={() => checkProvider(provider.id)}
            checking={checkingId === provider.id}
          />
        ))}
      </div>
    </div>
  );
}
