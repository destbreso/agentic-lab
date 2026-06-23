// ============================================
// Memory Gateway — Unit Tests
// ============================================

import { describe, it, expect } from "vitest";
import { createMemoryGateway } from "./memory-gateway.js";
import type { MemoryStore, MemoryItem } from "../types/storage.js";

function item(key: string, content: string, ns: string[] = ["shared"]): MemoryItem {
  return { id: key, namespace: ns, key, value: { content }, createdAt: "", updatedAt: "" };
}

interface FakeOpts {
  semantic?: MemoryItem[];
  text?: MemoryItem[];
  semanticThrows?: boolean;
}

function fakeStore(opts: FakeOpts = {}) {
  const puts: Array<{ ns: string[]; key: string; value: Record<string, unknown> }> = [];
  const calls = { semantic: 0, text: 0 };
  const store: MemoryStore = {
    async put(ns, key, value) {
      puts.push({ ns, key, value });
      return { id: key, namespace: ns, key, value, createdAt: "", updatedAt: "" };
    },
    async get() {
      return null;
    },
    async search() {
      calls.text++;
      return opts.text ?? [];
    },
    async semanticSearch() {
      calls.semantic++;
      if (opts.semanticThrows) throw new Error("no qdrant");
      return opts.semantic ?? [];
    },
    async delete() {
      return true;
    },
    async deleteNamespace() {},
  };
  return { store, puts, calls };
}

describe("createMemoryGateway — no store", () => {
  it("returns a no-op gateway", async () => {
    const gw = createMemoryGateway(undefined);
    expect(gw.contextual).toBe(false);
    expect(await gw.recall("q")).toEqual([]);
    await expect(gw.remember("fact")).resolves.toBeUndefined();
  });
});

describe("createMemoryGateway — recall", () => {
  it("returns semantically recalled memories mapped to content", async () => {
    const { store } = fakeStore({ semantic: [item("a", "remember A"), item("b", "remember B")] });
    const gw = createMemoryGateway(store);
    const out = await gw.recall("query");
    expect(out.map((m) => m.content)).toEqual(["remember A", "remember B"]);
  });

  it("falls back to text search when semantic search is empty", async () => {
    const { store, calls } = fakeStore({ semantic: [], text: [item("a", "from text")] });
    const gw = createMemoryGateway(store);
    const out = await gw.recall("query");
    expect(out[0].content).toBe("from text");
    expect(calls.semantic).toBe(1);
    expect(calls.text).toBe(1);
  });

  it("falls back to text search when semantic search throws", async () => {
    const { store } = fakeStore({ semanticThrows: true, text: [item("a", "from text")] });
    const gw = createMemoryGateway(store);
    const out = await gw.recall("query");
    expect(out[0].content).toBe("from text");
  });

  it("dedupes by namespace:key across read scopes", async () => {
    const dup = item("same", "dup", ["shared"]);
    const { store } = fakeStore({ semantic: [dup] });
    const gw = createMemoryGateway(store, { readScopes: ["shared", "other"] });
    const out = await gw.recall("query");
    // Both read scopes return the same item; it appears once.
    expect(out).toHaveLength(1);
  });
});

describe("createMemoryGateway — remember", () => {
  it("persists to the default 'shared' write namespace with content", async () => {
    const { store, puts } = fakeStore();
    const gw = createMemoryGateway(store);
    await gw.remember("a durable fact", { metadata: { source: "test" } });
    expect(puts).toHaveLength(1);
    expect(puts[0].ns).toEqual(["shared"]);
    expect(puts[0].value).toMatchObject({ content: "a durable fact", source: "test" });
  });

  it("writes to the configured write scope (slash → namespace path)", async () => {
    const { store, puts } = fakeStore();
    const gw = createMemoryGateway(store, { writeScope: "proj/run1" });
    await gw.remember("x");
    expect(puts[0].ns).toEqual(["proj", "run1"]);
  });
});

describe("createMemoryGateway — policy", () => {
  it("reflects the contextual flag", () => {
    const { store } = fakeStore();
    expect(createMemoryGateway(store, { contextual: true }).contextual).toBe(true);
    expect(createMemoryGateway(store).contextual).toBe(false);
  });
});
