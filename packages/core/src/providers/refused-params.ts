// ============================================
// Parameters a model refuses, learned from its own answer
// ============================================
// Newer models refuse request fields older ones take: Claude's current models
// refuse `temperature`, OpenAI's reasoning models refuse `max_tokens` (they take
// `max_completion_tokens`). The 400 names the field, so the provider learns it
// once per host and model and sends the request again without it; no list of
// models to keep up to date.

/** A request field a model may refuse. */
export type RefusableParam = "temperature" | "max_tokens";

const learned = new Map<string, Set<RefusableParam>>();

/** What a host and model are known to refuse. */
export function refusedParams(key: string): ReadonlySet<RefusableParam> {
  return learned.get(key) ?? new Set();
}

/** Remembers that a host and model refuse a field. */
export function learnRefused(key: string, param: RefusableParam): void {
  const set = learned.get(key) ?? new Set<RefusableParam>();
  set.add(param);
  learned.set(key, set);
}

/** Forgets everything learned (tests). */
export function forgetRefusedParams(): void {
  learned.clear();
}

const REFUSAL = /not supported|unsupported|deprecated|does not support|not allowed|not permitted/i;

/**
 * The field a 400 says the model refuses, among the ones the request sent:
 * from the error's `param` when the API names it (OpenAI), else from its
 * message (Anthropic's "`temperature` is deprecated for this model.").
 */
export function refusedParam(err: unknown, sent: readonly RefusableParam[]): RefusableParam | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown; param?: unknown; message?: unknown; error?: unknown };
  if (e.status !== 400) return null;
  if (typeof e.param === "string" && (sent as readonly string[]).includes(e.param)) return e.param as RefusableParam;
  const text = `${typeof e.message === "string" ? e.message : ""} ${safeJson(e.error)}`;
  if (!REFUSAL.test(text)) return null;
  return sent.find((p) => new RegExp(`(^|[^a-z_])${p}([^a-z_]|$)`).test(text)) ?? null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

/** The note a call carries when a field was left out for the first time. */
export function refusedNote(param: RefusableParam): string {
  return param === "max_tokens"
    ? "the model refuses max_tokens, so the limit was sent as max_completion_tokens"
    : `the model refuses ${param}, so it was left out`;
}
