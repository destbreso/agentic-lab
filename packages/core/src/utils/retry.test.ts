// ============================================
// Retry with Backoff — Unit Tests
// ============================================

import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableError, isAbortError } from "./retry.js";

const fast = { baseDelayMs: 1, jitter: false } as const;

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("isAbortError", () => {
  it("detects DOMException AbortError", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
  });
  it("detects name-based AbortError", () => {
    expect(isAbortError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
  });
  it("is false for ordinary errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    expect(isRetryableError(httpError(503))).toBe(true);
  });
  it("does not retry 4xx client errors (except 408/409/429)", () => {
    expect(isRetryableError(httpError(400))).toBe(false);
    expect(isRetryableError(httpError(401))).toBe(false);
    expect(isRetryableError(httpError(404))).toBe(false);
  });
  it("retries network error codes", () => {
    expect(isRetryableError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
  });
  it("does not retry abort errors", () => {
    expect(isRetryableError(new DOMException("Aborted", "AbortError"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, fast)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValue("recovered");
    const result = await withRetry(fn, { ...fast, maxRetries: 3 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(500));
    await expect(withRetry(fn, { ...fast, maxRetries: 2 })).rejects.toThrow("HTTP 500");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(400));
    await expect(withRetry(fn, { ...fast, maxRetries: 5 })).rejects.toThrow("HTTP 400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the operation throws an AbortError", async () => {
    const fn = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(withRetry(fn, fast)).rejects.toThrow(/abort/i);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("aborts pending backoff via signal", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(httpError(503));
    const promise = withRetry(fn, {
      baseDelayMs: 10_000,
      jitter: false,
      maxRetries: 5,
      signal: controller.signal,
    });
    // Let the first attempt fail, then abort during the long backoff.
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow(/abort/i);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invokes onRetry before each backoff", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(httpError(503)).mockResolvedValue("ok");
    await withRetry(fn, { ...fast, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1 });
  });
});
