// ============================================
// Call limits shared by every provider
// ============================================
// A default output limit and a per-call timeout, so one generation can never
// run unbounded, plus the abort plumbing that ties a call to its run.

/** Output limit (tokens) when neither the call nor the provider sets one. */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Timeout (ms) for one non-streaming call when neither the call nor the provider sets one.
 * Long enough that a local 7B model (about 19 tokens/s on a laptop) reaches the
 * output limit first: the timeout catches a call that hangs, not a long answer.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 300_000;

/** Thrown when a model call exceeds its timeout. Not retried: a slow model is slow again. */
export class ModelCallTimeoutError extends Error {
  constructor(
    readonly provider: string,
    readonly timeoutMs: number,
  ) {
    super(`${provider} call timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "ModelCallTimeoutError";
  }
}

export interface CallSignal {
  /** Aborts when the caller's signal aborts or the timeout fires. */
  signal: AbortSignal;
  /** True when the timeout (not the caller) ended the call. */
  timedOut(): boolean;
  timeoutMs: number;
}

/** Combine the caller's signal with a timeout. A timeout of 0 or less disables it. */
export function callSignal(caller: AbortSignal | undefined, timeoutMs: number): CallSignal {
  if (!(timeoutMs > 0)) {
    const signal = caller ?? new AbortController().signal;
    return { signal, timedOut: () => false, timeoutMs };
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  return {
    signal,
    timedOut: () => timeout.aborted && !caller?.aborted,
    timeoutMs,
  };
}

/** Turn whatever a timed-out call threw into a ModelCallTimeoutError; rethrow anything else. */
export function rethrowCallError(err: unknown, call: CallSignal, provider: string): never {
  if (call.timedOut()) throw new ModelCallTimeoutError(provider, call.timeoutMs);
  throw err;
}

/** A fetch bound to a signal, merged with any signal the client sets itself. */
export function fetchWithSignal(signal: AbortSignal): typeof fetch {
  return (input, init) =>
    globalThis.fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    });
}
