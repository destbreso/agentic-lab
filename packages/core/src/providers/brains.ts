// ============================================
// Brains: named chains of models, with fallback on unavailability only
// ============================================
// A brain is a name for an ordered chain of models ("strong": a hosted model,
// then another, then a local one). A role names a brain, a concrete
// "<entry>/<model>" (a chain of one), or a chain of its own. A run tries the
// chain from its start and moves on only when a provider is unavailable: no
// entry or key, the connection refused or timed out, a 5xx after the retries,
// a 429 after its retry window, or the model not found. A bad, empty or
// unreadable answer never moves it: that would be best-of-N in disguise, and
// the lab claims only what it measures. Once a role falls back it stays there
// for the rest of the run, so one role is never two models within a run; the
// next run starts from the top again. Every fallback is recorded on the call.

import type { ChatCompletionOptions, ChatCompletionResult, LLMProvider } from "../types/llm.js";
import { ModelCallTimeoutError } from "./call-limits.js";

export type Brains = Record<string, string[]>;

export type Unavailability = "no-entry" | "no-key" | "connection" | "timeout" | "server" | "rate-limit" | "model-not-found";

export interface Fallback {
  /** The model that could not answer, and the one tried next. */
  from: string;
  to: string;
  reason: Unavailability;
  /** What happened, in words (no key ever: errors are redacted). */
  error: string;
}

/** Which model answered a call, from which chain, after which fallbacks. */
export interface Route {
  chain: string[];
  /** The brain's name, when the role named one. */
  brain?: string;
  answeredBy: string;
  /** Every fallback in this role's run so far, the latest last. */
  fallbacks: Fallback[];
}

/** A provider that cannot be made: the reference names nothing configured, or its key is missing. */
export class UnavailableModel extends Error {
  constructor(
    readonly reason: "no-entry" | "no-key",
    message: string,
  ) {
    super(message);
    this.name = "UnavailableModel";
  }
}

/** Whether an error means the provider is unavailable, and how; null for anything else (a bad answer, a refused key). */
export function unavailability(error: unknown): Unavailability | null {
  if (error instanceof UnavailableModel) return error.reason;
  if (error instanceof ModelCallTimeoutError) return "timeout";
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: number; statusCode?: number; code?: string; name?: string; message?: string; cause?: { code?: string } };
  if (e.name === "AbortError") return null;
  const status = e.status ?? e.statusCode;
  if (status === 404) return "model-not-found";
  if (status === 429) return "rate-limit";
  if (typeof status === "number" && status >= 500) return "server";
  const code = e.code ?? e.cause?.code ?? "";
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"].includes(code)) return "connection";
  if (code === "ETIMEDOUT" || e.name === "APIConnectionTimeoutError") return "timeout";
  if (e.name === "APIConnectionError") return "connection";
  const msg = (e.message ?? "").toLowerCase();
  if (/model ['"]?[^'"]*['"]? not found|model not found|no such model|try pulling it first/.test(msg)) return "model-not-found";
  if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("connection refused")) return "connection";
  return null;
}

/** "ollama/qwen2.5:7b" is a model; a name with no slash is a brain. */
export const isModelRef = (name: string): boolean => name.includes("/");

/** The chain a role's choice stands for: a brain's chain, a model as a chain of one, or a chain as given. */
export function chainOf(choice: string | string[], brains: Brains): string[] {
  if (Array.isArray(choice)) return choice.flatMap((c) => chainOf(c, brains));
  if (isModelRef(choice)) return [choice];
  const chain = brains[choice];
  if (!chain) throw new UnavailableModel("no-entry", `no brain named ${choice} (brains: ${Object.keys(brains).join(", ") || "none"})`);
  return chain.flatMap((c) => (isModelRef(c) ? [c] : []));
}

/**
 * The brains Jig ships, over whatever is configured: each entry's default
 * model, hosted entries first for "strong", local ones first for "fast",
 * local ones alone for "local". With only Ollama, every brain is the local model.
 */
export function defaultBrains(entries: Array<{ name: string; kind: string; defaultModel?: string; local: boolean }>, defaultRef: string): Brains {
  const refs = (xs: typeof entries) => xs.filter((e) => e.defaultModel).map((e) => `${e.name}/${e.defaultModel}`);
  const hosted = refs(entries.filter((e) => !e.local));
  const local = refs(entries.filter((e) => e.local));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    default: uniq([defaultRef, ...local, ...hosted]),
    strong: uniq([...hosted, ...local, defaultRef]),
    fast: uniq([...local, ...hosted, defaultRef]),
    local: uniq(local.length ? local : [defaultRef]),
  };
}

export interface ChainProvider extends LLMProvider {
  /** The model answering now: the first one, or where a fallback left the role. */
  current(): string;
  readonly fallbacks: Fallback[];
}

/**
 * A provider that answers with the first available model of a chain, and
 * stays on a fallback once it took one. `make` builds a model's provider and
 * throws UnavailableModel when it cannot (no entry, no key).
 */
export function chainProvider(
  chain: string[],
  make: (ref: string) => LLMProvider,
  options: {
    brain?: string;
    onFallback?: (f: Fallback) => void;
    /** Which models run on this machine; with it, a fallback stops at the boundary from local to cloud. */
    isLocal?: (ref: string) => boolean;
    /** The brain says a fallback may cross from a local model to a cloud one. */
    crossToCloud?: boolean;
  } = {},
): ChainProvider {
  if (!chain.length) throw new UnavailableModel("no-entry", `the brain ${options.brain ?? ""} has no model`);
  let at = 0;
  const made = new Map<string, LLMProvider>();
  const fallbacks: Fallback[] = [];
  const providerAt = (i: number) => {
    const ref = chain[i];
    if (!made.has(ref)) made.set(ref, make(ref));
    return made.get(ref)!;
  };
  // A local model's work never moves to the cloud on its own: only a brain that says so lets a fallback cross.
  const stopsAtBoundary = () => Boolean(options.isLocal && !options.crossToCloud && options.isLocal(chain[at]) && !options.isLocal(chain[at + 1]));
  const boundary = (error: unknown) =>
    Object.assign(new Error(`${chain[at]} is unavailable (${(error as Error)?.message ?? String(error)}), and ${options.brain ? `the brain ${options.brain}` : "this chain"} does not let a local model's work fall to the cloud (${chain[at + 1]} is next): it stops here. A brain allows it with "crossToCloud": true.`), { boundary: true });
  const fallBack = (error: unknown, reason: Unavailability) => {
    const f: Fallback = { from: chain[at], to: chain[at + 1], reason, error: (error as Error)?.message ?? String(error) };
    fallbacks.push(f);
    options.onFallback?.(f);
    at++;
  };
  return {
    get name() {
      return `chain:${chain[at]}`;
    },
    current: () => chain[at],
    fallbacks,
    async chat(o: ChatCompletionOptions): Promise<ChatCompletionResult> {
      for (;;) {
        let provider: LLMProvider;
        try {
          provider = providerAt(at);
        } catch (error) {
          const reason = unavailability(error);
          if (reason && at < chain.length - 1) {
            if (stopsAtBoundary()) throw boundary(error);
            fallBack(error, reason);
            continue;
          }
          throw error;
        }
        try {
          const result = await provider.chat(o);
          return { ...result, model: chain[at], route: { chain: [...chain], ...(options.brain ? { brain: options.brain } : {}), answeredBy: chain[at], fallbacks: [...fallbacks] } };
        } catch (error) {
          const reason = unavailability(error);
          // A stream that already showed text is not moved: the text would show twice.
          const shown = (error as { noRetry?: unknown })?.noRetry === true;
          if (reason && !shown && at < chain.length - 1 && !o.signal?.aborted) {
            if (stopsAtBoundary()) throw boundary(error);
            fallBack(error, reason);
            continue;
          }
          throw error;
        }
      }
    },
    listModels: async () => [...chain],
    healthCheck: async () => {
      try {
        return await providerAt(at).healthCheck();
      } catch {
        return false;
      }
    },
  };
}
