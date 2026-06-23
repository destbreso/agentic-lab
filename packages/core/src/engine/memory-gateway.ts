// ============================================
// Memory Gateway
// ============================================
// Per-node access to contextual + durable memory, scoped to the node's
// MemoryPolicy. recall() is semantic (with a text-search fallback so it keeps
// working without a vector store); remember() persists a durable fact to the
// node's write scope. When no store is available a no-op gateway is returned,
// so callers never need to null-check — graceful degradation by construction.

import { nanoid } from "nanoid";
import type { MemoryStore } from "../types/storage.js";
import type {
  MemoryGateway,
  MemoryPolicy,
  RecalledMemory,
} from "../types/pipeline.js";

const DEFAULT_SCOPE = "shared";
const DEFAULT_TOPK = 5;

/** Convert a scope string ("a/b") into a namespace array. */
function toNamespace(scope: string): string[] {
  return scope
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extract human-readable content from a stored memory value. */
function extractContent(value: Record<string, unknown>): string {
  for (const key of ["content", "summary", "text", "value"]) {
    const v = value[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return JSON.stringify(value);
}

/** A no-op gateway used when no memory store is available. */
const NOOP_GATEWAY: MemoryGateway = {
  contextual: false,
  async recall() {
    return [];
  },
  async remember() {
    /* no store — best-effort no-op */
  },
};

/**
 * Build a per-node MemoryGateway over a MemoryStore, scoped to `policy`.
 * Returns a no-op gateway when there is no store.
 */
export function createMemoryGateway(
  store: MemoryStore | undefined | null,
  policy?: MemoryPolicy,
): MemoryGateway {
  if (!store) return NOOP_GATEWAY;

  const writeScope = policy?.writeScope ?? DEFAULT_SCOPE;
  const readScopes =
    policy?.readScopes && policy.readScopes.length > 0
      ? policy.readScopes
      : [writeScope];
  const readNamespaces = readScopes.map(toNamespace);
  const writeNamespace = toNamespace(writeScope);
  const defaultTopK = policy?.topK ?? DEFAULT_TOPK;
  const contextual = policy?.contextual ?? false;

  return {
    contextual,

    async recall(query, opts): Promise<RecalledMemory[]> {
      const limit = opts?.topK ?? defaultTopK;
      const out: RecalledMemory[] = [];
      const seen = new Set<string>();

      for (const ns of readNamespaces) {
        let items: Awaited<ReturnType<MemoryStore["search"]>> = [];
        try {
          items = await store.semanticSearch(ns, query, { limit });
        } catch {
          items = [];
        }
        // Fall back to text search when semantic search is unavailable/empty.
        if (items.length === 0) {
          try {
            items = await store.search(ns, { limit });
          } catch {
            items = [];
          }
        }
        for (const item of items) {
          const dedupeKey = `${item.namespace.join("/")}:${item.key}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          out.push({
            content: extractContent(item.value),
            namespace: item.namespace,
            key: item.key,
          });
        }
      }

      return out.slice(0, limit);
    },

    async remember(content, opts): Promise<void> {
      const key = opts?.key ?? `mem-${Date.now()}-${nanoid(6)}`;
      try {
        await store.put(writeNamespace, key, {
          content,
          ...(opts?.metadata ?? {}),
        });
      } catch {
        /* best-effort persistence */
      }
    },
  };
}
