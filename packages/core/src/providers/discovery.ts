// ============================================
// The model servers running on this machine, found without configuration
// ============================================
// Each well-known local server is asked for its model list on its usual
// port, all at once, with a short timeout. Only this machine is ever asked:
// 127.0.0.1, never a name that could resolve elsewhere and never the
// network. A server on another machine is added by hand. What answers is a
// discovered entry, with its live models; nothing is written to the
// configuration until the person keeps it.

import type { EntryKind } from "./entries.js";

export interface LocalServer {
  /** The entry name a kept server gets. */
  name: string;
  label: string;
  kind: Extract<EntryKind, "ollama" | "openai-compatible">;
  port: number;
  /** Where its models are listed, and the base URL its entry uses. */
  listPath: string;
  basePath: string;
}

/** The servers asked, on their documented default ports. Servers that share a port are told apart by their answer. */
export const LOCAL_SERVERS: LocalServer[] = [
  { name: "ollama", label: "Ollama", kind: "ollama", port: 11434, listPath: "/api/tags", basePath: "" },
  { name: "lmstudio", label: "LM Studio", kind: "openai-compatible", port: 1234, listPath: "/v1/models", basePath: "/v1" },
  { name: "llamacpp", label: "llama.cpp server or llamafile", kind: "openai-compatible", port: 8080, listPath: "/v1/models", basePath: "/v1" },
  { name: "vllm", label: "vLLM", kind: "openai-compatible", port: 8000, listPath: "/v1/models", basePath: "/v1" },
  { name: "jan", label: "Jan", kind: "openai-compatible", port: 1337, listPath: "/v1/models", basePath: "/v1" },
  { name: "textgen", label: "text-generation-webui", kind: "openai-compatible", port: 5000, listPath: "/v1/models", basePath: "/v1" },
  { name: "koboldcpp", label: "KoboldCpp", kind: "openai-compatible", port: 5001, listPath: "/v1/models", basePath: "/v1" },
  { name: "litellm", label: "LiteLLM proxy", kind: "openai-compatible", port: 4000, listPath: "/v1/models", basePath: "/v1" },
  { name: "gpt4all", label: "GPT4All", kind: "openai-compatible", port: 4891, listPath: "/v1/models", basePath: "/v1" },
  { name: "docker", label: "Docker Model Runner", kind: "openai-compatible", port: 12434, listPath: "/engines/v1/models", basePath: "/engines/v1" },
];

/** What an OpenAI-compatible server says owns its models, when it says who it is. */
const OWNERS: Record<string, { name: string; label: string }> = {
  llamacpp: { name: "llamacpp", label: "llama.cpp server" },
  vllm: { name: "vllm", label: "vLLM" },
  koboldcpp: { name: "koboldcpp", label: "KoboldCpp" },
  localai: { name: "localai", label: "LocalAI" },
};

export interface Discovered {
  name: string;
  label: string;
  kind: LocalServer["kind"];
  baseUrl: string;
  models: string[];
  /** How long it took to answer, in milliseconds. */
  ms: number;
}

export interface DiscoverOptions {
  /** The servers to ask (tests give their own, on free ports). */
  servers?: LocalServer[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** The only host ever asked. */
export const DISCOVERY_HOST = "127.0.0.1";

/**
 * The port OLLAMA_HOST names when it points at this machine; null when it is
 * not set, or names another machine (which is never probed: add it by hand).
 */
export function ollamaPort(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.OLLAMA_HOST?.trim();
  if (!raw) return null;
  const url = (() => {
    try {
      return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    } catch {
      return null;
    }
  })();
  if (!url) return null;
  const local = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1", ""].includes(url.hostname);
  if (!local) return null;
  return url.port ? Number(url.port) : 11434;
}

/** Ask every local server at once; resolves with those that answered, in the order of the list. Never slower than the timeout. */
export async function discoverLocal(o: DiscoverOptions = {}): Promise<Discovered[]> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 300;
  const env = o.env ?? process.env;
  const servers = (o.servers ?? LOCAL_SERVERS).map((s) => {
    if (s.kind !== "ollama" || o.servers) return s;
    const port = ollamaPort(env);
    return port ? { ...s, port } : s;
  });
  const probe = async (s: LocalServer): Promise<Discovered | null> => {
    const origin = `http://${DISCOVERY_HOST}:${s.port}`;
    const started = Date.now();
    try {
      const res = await fetchImpl(`${origin}${s.listPath}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, unknown>;
      if (s.kind === "ollama") {
        if (!Array.isArray(body.models)) return null;
        return { name: s.name, label: s.label, kind: s.kind, baseUrl: origin, models: (body.models as Array<{ name?: string }>).map((m) => String(m.name ?? "")).filter(Boolean), ms: Date.now() - started };
      }
      if (!Array.isArray(body.data)) return null;
      const data = body.data as Array<{ id?: string; owned_by?: string }>;
      // A server that names itself in owned_by is told apart from another on the same port.
      const owner = data.map((m) => OWNERS[String(m.owned_by ?? "").toLowerCase()]).find(Boolean);
      return {
        name: owner?.name ?? s.name,
        label: owner?.label ?? s.label,
        kind: s.kind,
        baseUrl: `${origin}${s.basePath}`,
        models: data.map((m) => String(m.id ?? "")).filter(Boolean),
        ms: Date.now() - started,
      };
    } catch {
      return null;
    }
  };
  // One question per port: two servers never share one at the same time.
  const byPort = new Map<number, LocalServer>();
  for (const s of servers) if (!byPort.has(s.port)) byPort.set(s.port, s);
  const found = await Promise.all([...byPort.values()].map(probe));
  return found.filter((d): d is Discovered => d !== null);
}

/** Where an entry's server is, for comparing a configured entry with a discovered one: localhost and 127.0.0.1 are the same. */
export function serverKey(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    const host = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(u.hostname) ? "127.0.0.1" : u.hostname;
    return `${host}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return baseUrl;
  }
}

/** A one-line summary for the header: "ollama up (12 models) ∙ lmstudio up (3)". */
export function discoverySummary(found: Discovered[]): string {
  if (!found.length) return "no local model server found";
  return found.map((d, i) => `${d.name} up (${d.models.length}${i === 0 ? ` model${d.models.length === 1 ? "" : "s"}` : ""})`).join(" ∙ ");
}
