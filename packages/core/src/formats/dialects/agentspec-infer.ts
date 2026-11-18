// ============================================
// What Agent Spec infers when a document leaves it out
// ============================================
// Agent Spec 26.3.1 lets a node's inputs, outputs and branches be inferred
// (the node table of the language specification, and pyagentspec's nodes): an
// AgentNode's from its agent, a FlowNode's from its subflow, a StartNode's
// outputs from its inputs, an EndNode's from each other, a BranchingNode's
// branches from its mapping, a flow's inputs from its StartNode, an agent's
// inputs from its prompt's placeholders. The compact form the lab writes
// leaves out exactly what these rules give back; reading fills it in again,
// so a compact and a full document read the same.

import { ComponentIndex, placeholders, type Json } from "./agentspec-refs.js";
import { pointer } from "../model.js";

const has = (c: Json, key: string) => c[key] !== undefined && c[key] !== null;
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

/** A flow's end nodes, resolved. */
function endNodes(index: ComponentIndex, flow: Json): Json[] {
  return list(flow.nodes)
    .map((n) => index.resolve(n, "")?.component)
    .filter((n): n is Json => n?.component_type === "EndNode");
}

/** The inputs a component has: its own, or what Agent Spec infers for it. */
export function inputsOf(index: ComponentIndex, c: Json): Json[] {
  if (has(c, "inputs")) return list(c.inputs);
  switch (c.component_type) {
    case "Agent":
      return placeholders(String(c.system_prompt ?? "")).map((title) => ({ title, type: "string" }));
    case "AgentNode": {
      const agent = index.resolve(c.agent, "")?.component;
      return agent ? inputsOf(index, agent) : [];
    }
    case "FlowNode": {
      const sub = index.resolve(c.subflow, "")?.component;
      return sub ? inputsOf(index, sub) : [];
    }
    case "Flow": {
      const start = index.resolve(c.start_node, "")?.component;
      return start ? inputsOf(index, start) : [];
    }
    case "StartNode":
    case "EndNode":
      return list(c.outputs);
    default:
      return [];
  }
}

/** The outputs a component has: its own, or what Agent Spec infers for it. */
export function outputsOf(index: ComponentIndex, c: Json): Json[] {
  if (has(c, "outputs")) return list(c.outputs);
  switch (c.component_type) {
    case "AgentNode": {
      const agent = index.resolve(c.agent, "")?.component;
      return agent ? outputsOf(index, agent) : [];
    }
    case "FlowNode": {
      const sub = index.resolve(c.subflow, "")?.component;
      return sub ? outputsOf(index, sub) : [];
    }
    case "Flow": {
      // The outputs every end node has, each as the first end node writes it.
      const ends = endNodes(index, c);
      const first = ends[0] ? outputsOf(index, ends[0]) : [];
      return first.filter((p) => ends.every((e) => outputsOf(index, e).some((q) => q.title === p.title)));
    }
    case "StartNode":
    case "EndNode":
      return list(c.inputs);
    default:
      return [];
  }
}

/** The branches a node has: its own, or what Agent Spec infers for it. */
export function branchesOf(index: ComponentIndex, c: Json): string[] {
  if (Array.isArray(c.branches)) return c.branches as string[];
  switch (c.component_type) {
    case "EndNode":
      return [];
    case "BranchingNode":
      return [...new Set(Object.values((c.mapping ?? {}) as Record<string, string>)), "default"];
    case "FlowNode": {
      const sub = index.resolve(c.subflow, "")?.component;
      const names = sub ? endNodes(index, sub).map((e) => (typeof e.branch_name === "string" ? e.branch_name : "next")) : [];
      return names.length ? [...new Set(names)] : ["next"];
    }
    default:
      return ["next"];
  }
}

/** Fields Agent Spec infers when a document leaves them out, by component type: reading fills them in. */
const INFERABLE: Record<string, Array<"inputs" | "outputs" | "branches">> = {
  AgentNode: ["inputs", "outputs", "branches"],
  FlowNode: ["inputs", "outputs", "branches"],
  StartNode: ["outputs", "branches"],
  EndNode: ["branches"],
  BranchingNode: ["outputs", "branches"],
  Flow: ["inputs"],
};

/**
 * What the compact form leaves out: the same, except a BranchingNode's
 * branches, which pyagentspec infers as a set, so their order would change.
 */
const LEFT_OUT: Record<string, Array<"inputs" | "outputs" | "branches">> = { ...INFERABLE, BranchingNode: ["outputs"] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function eachComponent(node: unknown, path: string, visit: (c: Json, path: string) => void): void {
  if (Array.isArray(node)) {
    node.forEach((x, i) => eachComponent(x, `${path}/${i}`, visit));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Json;
  if (typeof obj.component_type === "string") visit(obj, path);
  for (const [k, v] of Object.entries(obj)) if (k !== "metadata") eachComponent(v, `${path}${pointer(k)}`, visit);
}

function inferred(index: ComponentIndex, c: Json, field: "inputs" | "outputs" | "branches"): unknown {
  const bare = { ...c, [field]: undefined };
  return field === "inputs" ? inputsOf(index, bare) : field === "outputs" ? outputsOf(index, bare) : branchesOf(index, bare);
}

/**
 * The document with every inferable field written out, and the paths that
 * were filled in. Inference reads the document as it was given, so a filled
 * value is what Agent Spec would infer from it.
 */
export function expandInferred(doc: Json): { doc: Json; filled: string[] } {
  const copy = structuredClone(doc);
  const index = new ComponentIndex(structuredClone(doc));
  const filled: string[] = [];
  const fills: Array<() => void> = [];
  eachComponent(copy, "", (c, path) => {
    const original = index.byId.get(String(c.id))?.component ?? c;
    for (const field of INFERABLE[String(c.component_type)] ?? []) {
      if (c[field] !== undefined && c[field] !== null) continue;
      const value = inferred(index, original, field);
      filled.push(`${path}${pointer(field)}`);
      fills.push(() => {
        c[field] = value;
      });
    }
  });
  for (const fill of fills) fill();
  return { doc: copy, filled };
}

/** The document without the fields Agent Spec infers to the same value: the compact form. */
export function compactInferred(doc: Json): Json {
  const copy = structuredClone(doc);
  const index = new ComponentIndex(doc);
  eachComponent(copy, "", (c) => {
    const original = index.byId.get(String(c.id))?.component ?? c;
    for (const field of LEFT_OUT[String(c.component_type)] ?? []) {
      if (c[field] !== undefined && same(c[field], inferred(index, original, field))) delete c[field];
    }
  });
  return copy;
}
