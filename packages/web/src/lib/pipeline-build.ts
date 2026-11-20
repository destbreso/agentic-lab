// ============================================
// Pipeline build helpers (web)
// ============================================
// Turns the visual editor's graph (nodes + wires, each node carrying its
// capability config) into a core Recipe the engine can instantiate, and builds
// a provider from environment configuration.

import {
  createProvider,
  getNodeType,
  type LLMProvider,
  type LLMProviderConfig,
  type Recipe,
  type SerializedNode,
  type RoleCategory,
  type WireFeedback,
} from "jig-core";

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
  /** The node's own ports, when its definition declares them (a loaded recipe). */
  ports?: SerializedNode["ports"];
}

export interface GraphWire {
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
  /** Optional declarative feedback spec (condition / re-type / cap). */
  feedback?: WireFeedback;
  /** The fields the wire delivers; absent means every field. */
  fields?: string[];
}

export interface GraphPayload {
  nodes: GraphNode[];
  wires: GraphWire[];
  name?: string;
  description?: string;
}

/** Build an LLM provider from a name + model, reading keys from the environment. */
export function createWebProvider(providerName: string, model: string): LLMProvider {
  const config: LLMProviderConfig = { model };
  switch (providerName) {
    case "ollama":
      config.baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      break;
    case "openai":
      config.apiKey = process.env.OPENAI_API_KEY;
      break;
    case "anthropic":
      config.apiKey = process.env.ANTHROPIC_API_KEY;
      break;
    case "openrouter":
      config.apiKey = process.env.OPENROUTER_API_KEY;
      config.baseUrl = "https://openrouter.ai/api/v1";
      break;
    case "google":
      config.apiKey = process.env.GOOGLE_API_KEY;
      config.baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
      break;
  }
  return createProvider(providerName, config);
}

/**
 * Convert an editor graph into a core Recipe. Each node's config is passed
 * through verbatim (so per-node brain/toolPolicy/skills/memory are honored at
 * instantiation); ports are the node's own when it has them, else its type's.
 * Nodes are listed left to right: the round schedule runs the drawn order, and
 * a wire to a node further left is a way back.
 */
export function graphToRecipe(graph: GraphPayload): Recipe {
  const now = new Date().toISOString();
  const drawn = graph.nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.x - b.n.x || a.i - b.i)
    .map(({ n }) => n);

  const nodes: SerializedNode[] = drawn.map((n) => {
    const nt = getNodeType(n.type);
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      category: (nt?.category ?? "custom") as RoleCategory,
      description: nt?.description ?? "",
      version: nt?.version ?? "1.0.0",
      config: {
        maxIterations: 1,
        delayMs: 0,
        ...(nt?.defaultConfig ?? {}),
        ...(n.config ?? {}),
      } as SerializedNode["config"],
      ports: n.ports ??
        (nt
          ? { inputs: nt.defaultPorts.inputs, outputs: nt.defaultPorts.outputs }
          : { inputs: [], outputs: [] }),
      metadata: { x: n.x, y: n.y },
    };
  });

  const wires = graph.wires.map((w, i) => ({
    id: `w-${i}`,
    sourcePortId: `${w.from.nodeId}:out:${w.from.port}`,
    targetPortId: `${w.to.nodeId}:in:${w.to.port}`,
    enabled: true,
    // Pass per-wire feedback through so the engine compiles it into
    // filter + transform at instantiation, and the fields the wire delivers.
    feedback: w.feedback,
    ...(w.fields ? { fields: w.fields } : {}),
  }));

  return {
    id: `pipeline-${Date.now()}`,
    name: graph.name ?? "Untitled Pipeline",
    description: graph.description ?? "",
    version: "1.0.0",
    tags: [],
    nodes,
    wires,
    defaults: {},
    createdAt: now,
    updatedAt: now,
  };
}
