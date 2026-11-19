// ============================================
// The model catalog: what each available model can do, and the brains over it
// ============================================
// Every model a configured or discovered entry really lists, with what it can
// do: whether it uses tools, its context window, local or cloud, its price
// when known. Read where providers say it (Ollama's /api/show, OpenRouter's
// /models), otherwise from a small table of known families bundled here and
// marked as such, otherwise unknown. The shipped brains and the default model
// are chosen from this catalog only, so they never name a model that is not
// there.

import type { Brains } from "./brains.js";

/** A model that only embeds or ranks text: it cannot answer a role. */
const NOT_CHAT = /(^|[-_/:.])(embed|embedding|embeddings|rerank|reranker)([-_/:.]|$)|^text-embedding|nomic-embed|bge-|e5-/i;

export interface ModelInfo {
  /** "<entry>/<model>". */
  ref: string;
  entry: string;
  model: string;
  local: boolean;
  /** Whether it can call tools; null when nobody says. */
  tools: boolean | null;
  /** Context window in tokens, when known. */
  context?: number;
  /** Billions of parameters, when the provider says. */
  params?: number;
  /** Dollars per million tokens, when the provider says. */
  price?: { input: number; output: number };
  /** Where the capabilities came from: the provider itself, the bundled table, or nowhere. */
  source: "provider" | "table" | "unknown";
}

/** A small table of known model families, used only when the provider does not say. Its rows are approximate on purpose. */
export const KNOWN_FAMILIES: Array<{ match: RegExp; tools: boolean; context?: number }> = [
  { match: /^claude-/, tools: true, context: 200_000 },
  { match: /^(gpt-4o|gpt-4\.1|gpt-5|o[134](-|$))/, tools: true, context: 128_000 },
  { match: /^gpt-3\.5/, tools: true, context: 16_385 },
  { match: /^gemini-/, tools: true, context: 1_000_000 },
  { match: /deepseek-r1/, tools: false, context: 64_000 },
  { match: /deepseek-(v3|chat)/, tools: true, context: 64_000 },
  { match: /(^|\/)(llama3\.[123]|llama-3\.[123])/, tools: true, context: 128_000 },
  { match: /(^|\/)(qwen2\.5|qwen3|qwq)/i, tools: true, context: 32_768 },
  { match: /(^|\/)(mistral|mixtral|ministral)/i, tools: true, context: 32_768 },
  { match: /(^|\/)command-r/, tools: true, context: 128_000 },
  { match: /(^|\/)(llama2|codellama|tinyllama|gemma|phi3|phi-3|llava|bakllava|moondream)/i, tools: false },
];

/** What the bundled table says of a model, or null. */
export function fromTable(model: string): { tools: boolean; context?: number } | null {
  const name = model.toLowerCase();
  const row = KNOWN_FAMILIES.find((f) => f.match.test(name));
  return row ? { tools: row.tools, ...(row.context ? { context: row.context } : {}) } : null;
}

/** "7.6B" as 7.6, "500M" as 0.5. */
export function parseParams(size: unknown): number | undefined {
  const m = /^([\d.]+)\s*([BM])/i.exec(String(size ?? ""));
  if (!m) return undefined;
  return m[2].toUpperCase() === "M" ? Number(m[1]) / 1000 : Number(m[1]);
}

/** What Ollama says of one of its models: tools, context length, parameters. */
export async function ollamaShow(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch, timeoutMs = 1500): Promise<(Partial<ModelInfo> & { chat?: false }) | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown>; details?: { parameter_size?: string } };
    const context = Object.entries(body.model_info ?? {}).find(([k]) => k.endsWith(".context_length"))?.[1];
    return {
      // An embedding model lists no completion: it cannot answer a role, and never joins a brain.
      ...(Array.isArray(body.capabilities) ? { tools: body.capabilities.includes("tools"), ...(body.capabilities.includes("completion") ? {} : { chat: false }) } : {}),
      ...(typeof context === "number" ? { context } : {}),
      ...(parseParams(body.details?.parameter_size) !== undefined ? { params: parseParams(body.details?.parameter_size) } : {}),
    };
  } catch {
    return null;
  }
}

/** What OpenRouter says of its models: context, price per million tokens, tool use. */
export async function openRouterModels(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<Map<string, Partial<ModelInfo>>> {
  const out = new Map<string, Partial<ModelInfo>>();
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return out;
    const body = (await res.json()) as { data?: Array<{ id: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }> };
    for (const m of body.data ?? []) {
      const input = Number(m.pricing?.prompt);
      const output = Number(m.pricing?.completion);
      out.set(m.id, {
        ...(Array.isArray(m.supported_parameters) ? { tools: m.supported_parameters.includes("tools") } : {}),
        ...(typeof m.context_length === "number" ? { context: m.context_length } : {}),
        ...(Number.isFinite(input) && Number.isFinite(output) ? { price: { input: input * 1e6, output: output * 1e6 } } : {}),
      });
    }
  } catch {
    /* no answer: the table, or nothing */
  }
  return out;
}

export interface CatalogSource {
  name: string;
  kind: string;
  baseUrl: string;
  local: boolean;
  /** The models it lists now. */
  models: string[];
}

/** Every listed model with what it can do: the provider's word first, then the table, then unknown. */
export async function buildCatalog(sources: CatalogSource[], o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<ModelInfo[]> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const perSource = await Promise.all(
    sources.map(async (s) => {
      const said = new Map<string, Partial<ModelInfo>>();
      if (s.kind === "ollama") {
        const shown = await Promise.all(s.models.map((m) => ollamaShow(s.baseUrl, m, fetchImpl, o.timeoutMs)));
        s.models.forEach((m, i) => shown[i] && said.set(m, shown[i]!));
      } else if (s.kind === "openrouter") {
        for (const [id, info] of await openRouterModels(s.baseUrl, fetchImpl)) said.set(id, info);
      }
      return s.models.filter((model) => !NOT_CHAT.test(model) && (said.get(model) as { chat?: boolean } | undefined)?.chat !== false).map((model): ModelInfo => {
        const own = said.get(model);
        const table = fromTable(model);
        const tools = own?.tools ?? table?.tools ?? null;
        return {
          ref: `${s.name}/${model}`,
          entry: s.name,
          model,
          local: s.local,
          tools,
          ...((own?.context ?? table?.context) ? { context: own?.context ?? table?.context } : {}),
          ...(own?.params ? { params: own.params } : {}),
          ...(own?.price ? { price: own.price } : {}),
          source: own && own.tools !== undefined ? "provider" : table ? "table" : "unknown",
        };
      });
    }),
  );
  return perSource.flat();
}

/**
 * The rule the shipped brains follow, said once:
 * - only models a configured or discovered entry lists;
 * - a model known to use tools before one that does not say, before one that cannot;
 * - local: the local ones, larger first; fast: local ones, smaller first, then cloud;
 * - strong: cloud ones, the longest context first, then local, larger first;
 * - default: the person's own default when it is listed, else the first local, else the first strong;
 * - a tie goes to the configured entry, then to the name.
 */
export const RANKING_RULE =
  "only listed models; tool users first; local: local, larger first; fast: local, smaller first, then cloud; strong: cloud, longest context first, then local, larger first; default: yours when listed, else the first local, else the first strong";

const toolRank = (m: ModelInfo) => (m.tools === true ? 0 : m.tools === null ? 1 : 2);

/** The shipped brains and the default model, chosen from the catalog by RANKING_RULE. */
export function brainsFromCatalog(catalog: ModelInfo[], o: { preferred?: string; order?: string[] } = {}): { brains: Brains; defaultRef: string | null } {
  const entryRank = (m: ModelInfo) => {
    const i = (o.order ?? []).indexOf(m.entry);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const by = (...keys: Array<(m: ModelInfo) => number>) => (a: ModelInfo, b: ModelInfo) => {
    for (const k of keys) {
      const d = k(a) - k(b);
      if (d) return d;
    }
    return a.ref.localeCompare(b.ref);
  };
  const local = catalog.filter((m) => m.local);
  const cloud = catalog.filter((m) => !m.local);
  const larger = (m: ModelInfo) => -(m.params ?? 0);
  const smaller = (m: ModelInfo) => m.params ?? Number.MAX_SAFE_INTEGER;
  const longer = (m: ModelInfo) => -(m.context ?? 0);
  const refs = (xs: ModelInfo[]) => xs.map((m) => m.ref);
  const localChain = refs([...local].sort(by(toolRank, larger, entryRank)));
  const fast = [...refs([...local].sort(by(toolRank, smaller, entryRank))), ...refs([...cloud].sort(by(toolRank, entryRank)))];
  const strong = [...refs([...cloud].sort(by(toolRank, longer, entryRank))), ...localChain];
  const preferred = o.preferred && catalog.some((m) => m.ref === o.preferred) ? o.preferred : null;
  const defaultRef = preferred ?? localChain[0] ?? strong[0] ?? null;
  const uniq = (xs: string[]) => [...new Set(xs)];
  if (!defaultRef) return { brains: {}, defaultRef: null };
  return {
    brains: {
      default: uniq([defaultRef, ...localChain, ...strong]),
      strong: uniq(strong),
      fast: uniq(fast),
      local: localChain.length ? localChain : [],
    },
    defaultRef,
  };
}
