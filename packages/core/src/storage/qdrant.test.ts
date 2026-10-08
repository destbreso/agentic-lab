// ============================================
// Vector Memory Store — collection setup
// ============================================
// The collection must be created with the vector size the embedding model
// actually produces; a mismatch makes Qdrant reject every write and search.

import { describe, it, expect, vi, afterEach } from "vitest";
import { VectorMemoryStore } from "./qdrant.js";
import { InMemoryStorage } from "./memory.js";

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A fake Qdrant: `existing` is the collection info, or null for "no collection". */
function fakeQdrant(existing: { size: number; points: number } | null) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") {
        if (!existing) return new Response("{}", { status: 404 });
        return Response.json({
          result: { points_count: existing.points, config: { params: { vectors: { size: existing.size, distance: "Cosine" } } } },
        });
      }
      return Response.json({ result: true });
    }),
  );
  return calls;
}

function store(dimension: number | undefined, probeLength = 768) {
  const embed = vi.fn(async () => new Array(probeLength).fill(0.1));
  const base = new InMemoryStorage().memory;
  return { embed, vs: new VectorMemoryStore({ embeddingDimension: dimension }, embed, base) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VectorMemoryStore.init", () => {
  it("creates a missing collection with the size the embedding model produces", async () => {
    const calls = fakeQdrant(null);
    const { embed, vs } = store(undefined, 768);
    await vs.init();
    expect(embed).toHaveBeenCalledTimes(1);
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ vectors: { size: 768, distance: "Cosine" } });
    expect(vs.vectorSize).toBe(768);
  });

  it("uses a configured size without probing the model", async () => {
    const calls = fakeQdrant(null);
    const { embed, vs } = store(1536);
    await vs.init();
    expect(embed).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ vectors: { size: 1536, distance: "Cosine" } });
  });

  it("leaves a collection of the right size alone", async () => {
    const calls = fakeQdrant({ size: 768, points: 40 });
    const { vs } = store(768);
    await vs.init();
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("rebuilds an empty collection that was created with the wrong size", async () => {
    const calls = fakeQdrant({ size: 1536, points: 0 });
    const { vs } = store(768);
    await vs.init();
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE", "PUT"]);
    expect(calls[2].body).toEqual({ vectors: { size: 768, distance: "Cosine" } });
  });

  it("refuses a populated collection of another size, and says why", async () => {
    const calls = fakeQdrant({ size: 1536, points: 12 });
    const { vs } = store(768);
    await expect(vs.init()).rejects.toThrow(/12 points of 1536-dimension vectors.*produces 768/);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("reports an unreachable embedding model instead of guessing a size", async () => {
    fakeQdrant(null);
    const base = new InMemoryStorage().memory;
    const vs = new VectorMemoryStore({}, async () => {
      throw new Error("connection refused");
    }, base);
    await expect(vs.init()).rejects.toThrow(/embedding model is not reachable \(connection refused\)/);
  });
});
