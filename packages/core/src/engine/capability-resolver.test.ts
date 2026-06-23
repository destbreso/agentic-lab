// ============================================
// Capability Resolver — Unit Tests
// ============================================

import { describe, it, expect, vi } from "vitest";
import {
  scopeToolRegistry,
  toolPolicyFromConfig,
  resolveBrain,
  isToolRegistry,
  InMemorySharedStore,
} from "./capability-resolver.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";
import type { LLMProvider } from "../types/llm.js";

function makeRegistry(names: string[]): ToolRegistry {
  const tools = new Map<string, AgentTool>();
  for (const n of names) {
    tools.set(n, {
      definition: { name: n, description: n, parameters: { type: "object", properties: {} } },
      execute: async () => n,
    });
  }
  return {
    register: (t) => tools.set(t.definition.name, t),
    get: (n) => tools.get(n),
    getAll: () => [...tools.values()],
    getDefinitions: () => [...tools.values()].map((t) => t.definition),
    has: (n) => tools.has(n),
    remove: (n) => tools.delete(n),
  };
}

const names = (r: ToolRegistry) => r.getDefinitions().map((d) => d.name).sort();

describe("scopeToolRegistry", () => {
  it("returns the same registry when no policy", () => {
    const base = makeRegistry(["a", "b"]);
    expect(scopeToolRegistry(base)).toBe(base);
    expect(scopeToolRegistry(base, {})).toBe(base);
  });

  it("allow-list exposes only allowed tools", () => {
    const base = makeRegistry(["a", "b", "c"]);
    const scoped = scopeToolRegistry(base, { allow: ["a"] });
    expect(names(scoped)).toEqual(["a"]);
    expect(scoped.get("a")).toBeDefined();
    expect(scoped.get("b")).toBeUndefined();
    expect(scoped.has("b")).toBe(false);
    expect(scoped.getAll()).toHaveLength(1);
  });

  it("deny-list hides denied tools", () => {
    const base = makeRegistry(["a", "b", "c"]);
    const scoped = scopeToolRegistry(base, { deny: ["b"] });
    expect(names(scoped)).toEqual(["a", "c"]);
    expect(scoped.has("b")).toBe(false);
  });

  it("allow + deny: deny wins over allow", () => {
    const base = makeRegistry(["a", "b", "c"]);
    const scoped = scopeToolRegistry(base, { allow: ["a", "b"], deny: ["b"] });
    expect(names(scoped)).toEqual(["a"]);
  });

  it("does not mutate the base registry", () => {
    const base = makeRegistry(["a", "b"]);
    scopeToolRegistry(base, { allow: ["a"] });
    expect(names(base)).toEqual(["a", "b"]);
  });
});

describe("toolPolicyFromConfig", () => {
  it("prefers an explicit toolPolicy", () => {
    expect(toolPolicyFromConfig({ toolPolicy: { allow: ["x"] }, enabledTools: ["y"] })).toEqual({
      allow: ["x"],
    });
  });
  it("maps legacy enabledTools to an allow-list", () => {
    expect(toolPolicyFromConfig({ enabledTools: ["y"] })).toEqual({ allow: ["y"] });
  });
  it("returns undefined when neither is set", () => {
    expect(toolPolicyFromConfig({})).toBeUndefined();
    expect(toolPolicyFromConfig({ enabledTools: [] })).toBeUndefined();
  });
});

describe("resolveBrain", () => {
  const def = { name: "default" } as unknown as LLMProvider;
  const built = { name: "built" } as unknown as LLMProvider;

  it("builds a dedicated provider when brain + factory are present", () => {
    const factory = vi.fn(() => built);
    expect(resolveBrain({ provider: "x", model: "m" }, def, factory)).toBe(built);
    expect(factory).toHaveBeenCalledWith({ provider: "x", model: "m" });
  });

  it("falls back to default when no factory", () => {
    expect(resolveBrain({ provider: "x" }, def)).toBe(def);
  });

  it("falls back to default when no brain", () => {
    expect(resolveBrain(undefined, def, () => built)).toBe(def);
    expect(resolveBrain({}, def, () => built)).toBe(def);
  });

  it("falls back to default when the factory throws", () => {
    expect(resolveBrain({ model: "m" }, def, () => { throw new Error("boom"); })).toBe(def);
  });
});

describe("isToolRegistry", () => {
  it("is true for a registry", () => {
    expect(isToolRegistry(makeRegistry([]))).toBe(true);
  });
  it("is false for non-registries", () => {
    expect(isToolRegistry(null)).toBe(false);
    expect(isToolRegistry({})).toBe(false);
    expect(isToolRegistry({ get: () => {} })).toBe(false);
  });
});

describe("InMemorySharedStore", () => {
  it("set/get/has/keys", () => {
    const s = new InMemorySharedStore();
    expect(s.has("k")).toBe(false);
    s.set("k", 1);
    expect(s.get<number>("k")).toBe(1);
    expect(s.has("k")).toBe(true);
    expect(s.keys()).toEqual(["k"]);
  });

  it("append creates, extends, and promotes scalars to arrays", () => {
    const s = new InMemorySharedStore();
    s.append("list", "a");
    expect(s.get("list")).toEqual(["a"]);
    s.append("list", "b");
    expect(s.get("list")).toEqual(["a", "b"]);
    s.set("scalar", 1);
    s.append("scalar", 2);
    expect(s.get("scalar")).toEqual([1, 2]);
  });

  it("all() returns a snapshot copy", () => {
    const backing: Record<string, unknown> = {};
    const s = new InMemorySharedStore(backing);
    s.set("a", 1);
    const snap = s.all();
    expect(snap).toEqual({ a: 1 });
    snap.a = 999; // mutating snapshot must not affect the store
    expect(s.get("a")).toBe(1);
    // backing object is the live store
    expect(backing.a).toBe(1);
  });
});
