// ============================================
// Capability Resolver
// ============================================
// Resolves per-node capabilities from declarative config:
//   - a scoped tool registry (availability: allow/deny subset of the toolkit)
//   - the node's brain (model) — its own provider, or the pipeline default
//   - the shared blackboard implementation
//
// This is the layer that turns "every node shares one global provider + one
// global toolkit" into "each specialized node gets exactly the capabilities
// it should have". It is intentionally pure and dependency-light so it can be
// used from recipe instantiation, the orchestrator, or custom code.

import type { LLMProvider } from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import type {
  NodeBrainConfig,
  ToolPolicy,
  SharedStore,
} from "../types/pipeline.js";

/**
 * Build a scoped view of a ToolRegistry exposing only the allowed/denied
 * subset. The returned registry is a live view over `base` (registrations and
 * removals delegate to it) — it just hides tools the policy excludes.
 *
 * Resolution: a tool is visible iff (no allow-list OR it is allow-listed) AND
 * (no deny-list OR it is not denied).
 */
export function scopeToolRegistry(
  base: ToolRegistry,
  policy?: ToolPolicy,
): ToolRegistry {
  if (!policy || (!policy.allow && !policy.deny)) return base;

  const allow = policy.allow ? new Set(policy.allow) : null;
  const deny = policy.deny ? new Set(policy.deny) : null;
  const visible = (name: string): boolean =>
    (allow ? allow.has(name) : true) && (deny ? !deny.has(name) : true);

  return {
    register: (tool) => base.register(tool),
    remove: (name) => base.remove(name),
    get: (name) => (visible(name) ? base.get(name) : undefined),
    has: (name) => visible(name) && base.has(name),
    getAll: () => base.getAll().filter((t) => visible(t.definition.name)),
    getDefinitions: () =>
      base.getDefinitions().filter((d) => visible(d.name)),
  };
}

/** Normalize a node's tool config into a single ToolPolicy. */
export function toolPolicyFromConfig(config: {
  toolPolicy?: ToolPolicy;
  enabledTools?: string[];
}): ToolPolicy | undefined {
  if (config.toolPolicy) return config.toolPolicy;
  if (config.enabledTools && config.enabledTools.length > 0) {
    return { allow: config.enabledTools };
  }
  return undefined;
}

/** Factory that builds an LLM provider for a per-node brain config. */
export type ProviderFactory = (brain: NodeBrainConfig) => LLMProvider;

/**
 * Resolve the provider a node should use. If the node declares its own brain
 * and a provider factory is available, build a dedicated provider; otherwise
 * fall back to the pipeline default. Never throws — a failing factory falls
 * back to the default.
 */
export function resolveBrain(
  brain: NodeBrainConfig | undefined,
  defaultProvider: LLMProvider,
  factory?: ProviderFactory,
): LLMProvider {
  if (brain && (brain.provider || brain.model) && factory) {
    try {
      return factory(brain);
    } catch {
      return defaultProvider;
    }
  }
  return defaultProvider;
}

/** Duck-type check that a value looks like a ToolRegistry. */
export function isToolRegistry(value: unknown): value is ToolRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ToolRegistry).getDefinitions === "function" &&
    typeof (value as ToolRegistry).get === "function"
  );
}

/**
 * Default in-memory shared blackboard. Backed by a plain object so it can be
 * surfaced in PipelineState.shared and serialized in run results. Safe for the
 * orchestrator's single-threaded concurrency model (each operation is atomic).
 */
export class InMemorySharedStore implements SharedStore {
  constructor(private readonly store: Record<string, unknown> = {}) {}

  get<T = unknown>(key: string): T | undefined {
    return this.store[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.store[key] = value;
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.store, key);
  }

  keys(): string[] {
    return Object.keys(this.store);
  }

  append(key: string, value: unknown): void {
    const existing = this.store[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (existing === undefined) {
      this.store[key] = [value];
    } else {
      this.store[key] = [existing, value];
    }
  }

  all(): Record<string, unknown> {
    return { ...this.store };
  }
}
