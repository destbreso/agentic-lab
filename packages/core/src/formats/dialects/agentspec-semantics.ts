// ============================================
// Agent Spec rules a JSON Schema cannot state
// ============================================
// The language specification (26.3.1) asks more of a document than its schema
// checks: references resolve, a flow's start node is one of its nodes, edges
// connect nodes of the same flow by branches and properties those nodes
// declare, an agent's inputs are the placeholders of its system prompt, a
// BranchingNode's branches are its mapping's values plus "default", and a
// flow's inputs are its StartNode's. Each rule cites the section it comes from.

import { issue, type FormatIssue } from "../model.js";
import { ComponentIndex, placeholders, titles, type Json } from "./agentspec-refs.js";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function checkAgent(agent: Json, path: string, out: FormatIssue[]): void {
  const prompt = typeof agent.system_prompt === "string" ? agent.system_prompt : "";
  const declared = titles(agent.inputs);
  const inferred = placeholders(prompt);
  // "Input/output schemas, validation": the declared inputs and the ones the prompt's placeholders infer have the same names.
  if (agent.inputs !== undefined && !sameSet(declared, inferred)) {
    out.push(issue(`${path}/inputs`, `the inputs (${declared.join(", ") || "none"}) are not the system prompt's placeholders (${inferred.join(", ") || "none"})`));
  }
}

function checkFlow(index: ComponentIndex, flow: Json, path: string, out: FormatIssue[], seen: Set<Json>): void {
  if (seen.has(flow)) return;
  seen.add(flow);
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const members = new Map<string, Json>();
  nodes.forEach((n, i) => {
    const found = index.resolve(n, `${path}/nodes/${i}`);
    if (found) members.set(String(found.component.id), found.component);
  });
  // "Flow": the start node is unique and is one of the flow's nodes; the flow exposes its inputs.
  const start = index.resolve(flow.start_node, `${path}/start_node`);
  if (start) {
    if (start.component.component_type !== "StartNode") out.push(issue(`${path}/start_node`, "the start node is not a StartNode"));
    if (!members.has(String(start.component.id))) out.push(issue(`${path}/start_node`, "the start node is not in the flow's nodes"));
    if (flow.inputs !== undefined && flow.inputs !== null && !sameSet(titles(flow.inputs), titles(start.component.inputs))) {
      out.push(issue(`${path}/inputs`, "a flow's inputs are its StartNode's inputs"));
    }
  }
  // "Relationships / Edges": control edges join nodes of this flow, from a branch the source node has.
  const control = Array.isArray(flow.control_flow_connections) ? flow.control_flow_connections : [];
  control.forEach((edge, i) => {
    const p = `${path}/control_flow_connections/${i}`;
    const e = index.resolve(edge, p)?.component;
    if (!e) return;
    const from = index.resolve(e.from_node, `${p}/from_node`)?.component;
    const to = index.resolve(e.to_node, `${p}/to_node`)?.component;
    if (from && !members.has(String(from.id))) out.push(issue(`${p}/from_node`, `"${String(from.id)}" is not a node of this flow`));
    if (to && !members.has(String(to.id))) out.push(issue(`${p}/to_node`, `"${String(to.id)}" is not a node of this flow`));
    const branch = e.from_branch;
    if (from && typeof branch === "string" && Array.isArray(from.branches) && !from.branches.includes(branch)) {
      out.push(issue(`${p}/from_branch`, `"${branch}" is not a branch of "${String(from.id)}" (${(from.branches as string[]).join(", ")})`));
    }
  });
  // Data edges connect an output the source declares to an input the destination declares.
  const data = Array.isArray(flow.data_flow_connections) ? flow.data_flow_connections : [];
  data.forEach((edge, i) => {
    const p = `${path}/data_flow_connections/${i}`;
    const e = index.resolve(edge, p)?.component;
    if (!e) return;
    const src = index.resolve(e.source_node, `${p}/source_node`)?.component;
    const dst = index.resolve(e.destination_node, `${p}/destination_node`)?.component;
    if (src && !members.has(String(src.id))) out.push(issue(`${p}/source_node`, `"${String(src.id)}" is not a node of this flow`));
    if (dst && !members.has(String(dst.id))) out.push(issue(`${p}/destination_node`, `"${String(dst.id)}" is not a node of this flow`));
    if (src && !titles(src.outputs).includes(String(e.source_output))) {
      out.push(issue(`${p}/source_output`, `"${String(e.source_output)}" is not an output of "${String(src.id)}"`));
    }
    if (dst && !titles(dst.inputs).includes(String(e.destination_input))) {
      out.push(issue(`${p}/destination_input`, `"${String(e.destination_input)}" is not an input of "${String(dst.id)}"`));
    }
  });
  for (const [id, node] of members) {
    const at = index.byId.get(id)?.path ?? path;
    switch (node.component_type) {
      case "BranchingNode": {
        // "BranchingNode": one branch per value of the mapping, plus "default".
        const mapping = (node.mapping ?? {}) as Record<string, string>;
        const expected = [...new Set(Object.values(mapping)), "default"];
        if (Array.isArray(node.branches) && !sameSet(node.branches as string[], expected)) {
          out.push(issue(`${at}/branches`, `the branches are the mapping's values plus "default" (${expected.join(", ")})`));
        }
        break;
      }
      case "AgentNode": {
        const agent = index.resolve(node.agent, `${at}/agent`);
        if (agent?.component.component_type === "Agent") checkAgent(agent.component, agent.path, out);
        if (agent?.component.component_type === "Flow") checkFlow(index, agent.component, agent.path, out, seen);
        break;
      }
      case "LlmNode": {
        const inferred = placeholders(String(node.prompt_template ?? ""));
        if (node.inputs !== undefined && !sameSet(titles(node.inputs), inferred)) {
          out.push(issue(`${at}/inputs`, `the inputs are the prompt template's placeholders (${inferred.join(", ") || "none"})`));
        }
        break;
      }
      case "FlowNode":
      case "MapNode":
      case "ParallelMapNode":
      case "CatchExceptionNode": {
        const sub = index.resolve(node.subflow, `${at}/subflow`);
        if (sub) checkFlow(index, sub.component, sub.path, out, seen);
        break;
      }
    }
  }
}

/** The rules of the language specification a schema cannot check, over a whole document. */
export function checkAgentSpecSemantics(doc: Json): FormatIssue[] {
  const index = new ComponentIndex(doc);
  const out: FormatIssue[] = [];
  if (doc.component_type === "Flow") checkFlow(index, doc, "", out, new Set());
  else if (doc.component_type === "Agent") checkAgent(doc, "", out);
  return [...index.issues, ...out];
}
