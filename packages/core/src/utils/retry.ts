// ============================================
// Retry with Exponential Backoff + Jitter
// ============================================
// Wraps transient operations (LLM provider network calls) so a single
// blip — a 429, a 5xx, a dropped connection — does not abort a long
// multi-iteration loop. Honors AbortSignal: never retries an aborted call,
// and cancels the backoff sleep immediately on abort.

/** True when the error is an AbortError (do not retry). */
export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}

/**
 * Heuristic for whether an error from an LLM SDK / fetch is worth retrying.
 * Retries: rate limits (429), request timeout (408), conflict (409), and
 * 5xx server errors, plus common transient network conditions.
 */
export function isRetryableError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (typeof err !== "object" || err === null) return false;

  const e = err as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    message?: string;
  };

  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 409 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    // Other 4xx are client errors — not retryable.
    if (status >= 400 && status < 500) return false;
  }

  // SDK-specific connection error classes (OpenAI/Anthropic).
  if (e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError") {
    return true;
  }

  // Node network error codes.
  const code = e.code ?? "";
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "EPIPE"
  ) {
    return true;
  }

  // Last resort: message-based detection of transient failures.
  const msg = (e.message ?? "").toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }

  return false;
}

/** Sleep that resolves after `ms`, or rejects immediately if the signal aborts. */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryOptions {
  /** Max number of retries after the first attempt. Default: 3. */
  maxRetries?: number;
  /** Base delay in ms for the first backoff. Default: 500. */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms. Default: 8000. */
  maxDelayMs?: number;
  /** Apply random jitter (50–100% of the computed delay). Default: true. */
  jitter?: boolean;
  /** Abort signal — aborts both the operation and any pending backoff. */
  signal?: AbortSignal;
  /** Override the retryable-error predicate. */
  isRetryable?: (err: unknown) => boolean;
  /** Called before each backoff sleep (for logging/observability). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Run `fn` with exponential backoff + jitter on transient failures.
 * `fn` receives the attempt number (0-based). Never retries aborted or
 * non-retryable errors. Returns the first successful result.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    jitter = true,
    signal,
    isRetryable = isRetryableError,
    onRetry,
  } = options;

  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn(attempt);
    } catch (err) {
      attempt++;
      if (attempt > maxRetries || isAbortError(err) || !isRetryable(err)) {
        throw err;
      }
      let delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      if (jitter) delay = Math.round(delay * (0.5 + Math.random() * 0.5));
      onRetry?.({ attempt, delayMs: delay, error: err });
      await sleepWithAbort(delay, signal);
    }
  }
}
