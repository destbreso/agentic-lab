// ============================================
// Importing a plain Agent Spec document: the extension's defaults
// ============================================
// A document the lab did not write has no extension block. The lab reads what
// it can run: every AgentNode and LlmNode becomes a Do role on the lab's
// execution engine, with the agent's system prompt (or the node's prompt
// template) as its instructions, in the order the control flow first reaches
// them. A data edge between two roles is a wire; a BranchingNode keyed on a
// role's output that leads back to an earlier role is a way back, carried by
// a wire that fires on the mapped value. Everything else is reported as lost.

import type { Recipe, SerializedNode, Wire } from "../../types/pipeline.js";
import { createDefaultToolkit } from "../../tools/defaults.js";
import { DEFAULT_FACES, issue, type FormatIssue, type Loss, type Topology, type WayBack } from "../model.js";
import { ComponentIndex, titles, type Json } from "./agentspec-refs.js";
import { inputsOf, outputsOf } from "./agentspec-infer.js";

/** Rounds a run of an imported topology may take when the document sets no limit. */
export const IMPORT_ROUND_LIMIT = 5;

const ROLE_TYPES = new Set(["AgentNode", "LlmNode"]);
const STRUCTURE = new Set(["StartNode", "EndNode", "BranchingNode"]);
const ACCEPTS = ["task", "plan", "corrections", "context", "execution_result"];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "imported";

const firstSentence = (text: string) => {
  const line = text.trim().split(/\n/)[0] ?? "";
  const cut = /^(.{1,160}?[.!?])(\s|$)/.exec(line);
  return (cut ? cut[1] : line.slice(0, 160)).trim();
};

export interface ImportOutcome {
  topology: Topology | null;
  issues: FormatIssue[];
  losses: Loss[];
}

/** Read a plain Agent Spec Flow or Agent into a topology the lab can run. */
export function importPlain(doc: Json): ImportOutcome {
  const index = new ComponentIndex(doc);
  const issues: FormatIssue[] = [...index.issues];
  const losses: Loss[] = [];
  const lose = (path: string, what: string) => losses.push({ path, what, kind: "dropped" });
  const known = new Set(createDefaultToolkit().getAll().map((t) => t.definition.name));

  const taken = new Set<string>();
  const roleFrom = (node: Json, path: string): SerializedNode => {
    // Named for people, not by the document's generated ids.
    let id = slug(String(node.name ?? node.id));
    for (let n = 2; taken.has(id); n++) id = `${slug(String(node.name ?? node.id))}-${n}`;
    taken.add(id);
    let instructions = "";
    let tools: string[] = [];
    if (node.component_type === "LlmNode" || node.component_type === undefined) {
      instructions = String(node.prompt_template ?? "");
    }
    if (node.component_type === "AgentNode" || node.component_type === "Agent") {
      const agent = node.component_type === "Agent" ? { component: node, path } : index.resolve(node.agent, `${path}/agent`);
      const a = agent?.component ?? {};
      if (a.component_type !== "Agent") {
        lose(`${path}/agent`, `a ${String(a.component_type)} run as a node: the lab runs only an Agent as a role`);
      }
      instructions = String(a.system_prompt ?? "");
      ((a.tools as unknown[]) ?? []).forEach((t, i) => {
        const tool = index.resolve(t, `${agent?.path}/tools/${i}`)?.component;
        const name = String(tool?.name ?? "");
        if (known.has(name)) tools.push(name);
        else lose(`${agent?.path}/tools/${i}`, `the tool "${name}" (${String(tool?.component_type)}): the lab has no tool of that name`);
      });
      if (Array.isArray(a.toolboxes) && a.toolboxes.length) lose(`${agent?.path}/toolboxes`, "toolboxes: the lab does not connect to them");
      if (a.llm_config) {
        const model = index.resolve(a.llm_config, `${agent?.path}/llm_config`)?.component;
        lose(`${agent?.path}/llm_config`, `the model (${String(model?.component_type)} ${String(model?.model_id ?? "")}): the lab runs the role on the model you start the run with`);
      }
    } else if (node.llm_config) {
      const model = index.resolve(node.llm_config, `${path}/llm_config`)?.component;
      lose(`${path}/llm_config`, `the model (${String(model?.component_type)} ${String(model?.model_id ?? "")}): the lab runs the role on the model you start the run with`);
    }
    if (/\{\{\s*[A-Za-z_]/.test(instructions)) {
      lose(`${path}`, "the prompt's {{placeholders}} are kept as text: the lab gives a role its inputs as sections of its prompt");
    }
    tools = [...new Set(tools)];
    const inputs = titles(inputsOf(index, node));
    const outputs = titles(outputsOf(index, node));
    return {
      id,
      type: "execution",
      name: String(node.name ?? id),
      category: "execution",
      description: typeof node.description === "string" ? node.description : firstSentence(instructions),
      version: "1.0.0",
      config: { maxIterations: 1, delayMs: 0, concurrent: false, toolPolicy: { allow: tools }, runInputs: [] },
      ports: {
        inputs: inputs.map((name) => ({ name, direction: "input" as const, signalTypes: ACCEPTS, required: false })),
        outputs: (outputs.length ? outputs : ["result"]).map((name) => ({ name, direction: "output" as const, signalTypes: ["execution_result"] })),
      },
      metadata: { systemMessage: instructions },
    };
  };

  if (doc.component_type === "Agent") {
    const role = roleFrom(doc, "");
    role.ports.inputs = [];
    role.config.runInputs = ["task", "*"];
    const topology = assemble(doc, [role], [], [], 1);
    return { topology, issues, losses };
  }
  if (doc.component_type !== "Flow") {
    issues.push(issue("/component_type", `the lab imports a Flow or an Agent, not a ${String(doc.component_type)}`));
    return { topology: null, issues, losses };
  }

  // The order the control flow first reaches each node.
  const edges = ((doc.control_flow_connections as unknown[]) ?? [])
    .map((e, i) => index.resolve(e, `/control_flow_connections/${i}`)?.component)
    .filter((e): e is Json => !!e);
  const out = new Map<string, Array<{ to: string; branch: string | null }>>();
  for (const e of edges) {
    const from = index.idOf(e.from_node)!;
    const list = out.get(from) ?? [];
    list.push({ to: index.idOf(e.to_node)!, branch: (e.from_branch as string | null) ?? null });
    out.set(from, list);
  }
  const startId = index.idOf(doc.start_node)!;
  const visit: string[] = [];
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visit.includes(id)) continue;
    visit.push(id);
    for (const e of out.get(id) ?? []) if (!visit.includes(e.to)) queue.push(e.to);
  }
  const nodeOf = (id: string) => index.byId.get(id);
  const roles: SerializedNode[] = [];
  const roleOfNode = new Map<string, SerializedNode>();
  for (const id of visit) {
    const found = nodeOf(id);
    if (!found) continue;
    const type = String(found.component.component_type);
    if (ROLE_TYPES.has(type)) {
      const role = roleFrom(found.component, found.path);
      roles.push(role);
      roleOfNode.set(id, role);
    } else if (!STRUCTURE.has(type)) {
      lose(found.path, `the ${type} "${String(found.component.name)}": the lab has no role for it, and the flow runs without it`);
    }
  }
  if (roles.length === 0) {
    issues.push(issue("/nodes", "the flow has no AgentNode or LlmNode the lab can run"));
    return { topology: null, issues, losses };
  }

  // Data edges: between roles a wire, from the start the task, into a branch a way back's key.
  const wires: Recipe["wires"] = [];
  const keyOf = new Map<string, { role: SerializedNode; output: string; node: string }>();
  ((doc.data_flow_connections as unknown[]) ?? []).forEach((edge, i) => {
    const p = `/data_flow_connections/${i}`;
    const e = index.resolve(edge, p)?.component;
    if (!e) return;
    const from = index.idOf(e.source_node)!;
    const to = index.idOf(e.destination_node)!;
    const src = roleOfNode.get(from);
    const dst = roleOfNode.get(to);
    const toType = nodeOf(to)?.component.component_type;
    const fromType = nodeOf(from)?.component.component_type;
    if (src && dst) {
      wires.push({ id: slug(String(e.id ?? e.name)), sourcePortId: `${src.id}:out:${String(e.source_output)}`, targetPortId: `${dst.id}:in:${String(e.destination_input)}`, enabled: true });
    } else if (fromType === "StartNode" && dst) {
      dst.config.runInputs = ["task", "*"];
      dst.ports.inputs = dst.ports.inputs.filter((p2) => p2.name !== e.destination_input);
    } else if (src && toType === "BranchingNode") {
      keyOf.set(to, { role: src, output: String(e.source_output), node: from });
    } else if (src && toType === "EndNode") {
      // The flow's answer: the lab's answer is what the last Do wrote.
    } else {
      lose(p, `the data edge "${String(e.name ?? e.id)}": it joins nodes the lab does not run`);
    }
  });
  if (doc.data_flow_connections === null || doc.data_flow_connections === undefined) {
    lose("/data_flow_connections", "data passed by name (no data edges): the lab passes data only along edges, so roles read only the task");
  }

  // Ways back: a branch that returns to a role already reached.
  const waysBack: WayBack[] = [];
  const exitWhen: string[] = [];
  const rank = new Map(visit.map((id, i) => [id, i]));
  for (const [branchId, key] of keyOf) {
    const branch = nodeOf(branchId)!.component;
    const mapping = (branch.mapping ?? {}) as Record<string, string>;
    for (const e of out.get(branchId) ?? []) {
      const target = roleOfNode.get(e.to);
      const valueKeys = Object.entries(mapping).filter(([, b]) => b === (e.branch ?? "next")).map(([k]) => k);
      const isDefault = (e.branch ?? "default") === "default";
      if (target && (rank.get(e.to) ?? 0) <= (rank.get(key.node) ?? 0)) {
        const port = `back_from_${key.role.id}`.replace(/-/g, "_");
        if (!target.ports.inputs.some((p) => p.name === port)) {
          target.ports.inputs.push({ name: port, direction: "input", signalTypes: ["corrections", "execution_result"], required: false });
        }
        const where: NonNullable<Wire["feedback"]>["where"] = isDefault
          ? Object.keys(mapping).map((k) => ({ field: "responseText", op: "ne" as const, value: k }))
          : undefined;
        const wireIds: string[] = [];
        const make = (suffix: string, w?: NonNullable<Wire["feedback"]>["where"]) => {
          const id = slug(`back-${branchId}-${suffix}`);
          wireIds.push(id);
          wires.push({ id, sourcePortId: `${key.role.id}:out:${key.output}`, targetPortId: `${target.id}:in:${port}`, enabled: true, feedback: { where: w } });
        };
        if (isDefault) make("default", where);
        else for (const k of valueKeys) make(k, [{ field: "responseText", op: "eq", value: k }]);
        const words = isDefault ? `anything but ${Object.keys(mapping).join(", ")}` : valueKeys.join(" or ");
        waysBack.push({
          id: slug(`back-to-${target.id}`),
          from: key.role.id,
          to: target.id,
          label: `${words}: back to ${target.name}`,
          when: `${key.role.name} answers ${words}`,
          wires: wireIds,
        });
      } else if (nodeOf(e.to)?.component.component_type === "EndNode") {
        exitWhen.push(isDefault ? "otherwise," : `${key.role.name} answers ${valueKeys.join(" or ")},`);
      }
    }
  }
  if (waysBack.length) {
    issues.push(
      issue(
        "/control_flow_connections",
        `the way${waysBack.length > 1 ? "s" : ""} back ${waysBack.map((w) => `to ${w.to}`).join(", ")} ha${waysBack.length > 1 ? "ve" : "s"} no limit in the document; the lab stops the run after ${IMPORT_ROUND_LIMIT} rounds`,
        "warning",
      ),
    );
  }
  const topology = assemble(doc, roles, wires, waysBack, waysBack.length ? IMPORT_ROUND_LIMIT : 1, exitWhen);
  return { topology, issues, losses };
}

function assemble(doc: Json, nodes: SerializedNode[], wires: Recipe["wires"], waysBack: WayBack[], rounds: number, exitWhen: string[] = []): Topology {
  const faces = Object.fromEntries(
    nodes.map((n) => [n.id, { label: n.name, icon: DEFAULT_FACES.execution.icon, sentence: n.description || `${n.name} does its part of the task.` }]),
  );
  return {
    id: slug(String(doc.name ?? doc.id)),
    name: String(doc.name ?? "Imported"),
    description: typeof doc.description === "string" ? doc.description : "",
    version: "1.0.0",
    tags: ["imported", "agentspec"],
    category: "imported",
    nodes,
    wires,
    defaults: { maxCycles: rounds, delayMs: 0 },
    createdAt: "",
    updatedAt: "",
    faces,
    waysBack,
    also: [],
    consults: [],
    exit: { label: "done", when: exitWhen.length ? [...exitWhen.slice(0, -1), exitWhen.at(-1)!.replace(/,$/, "")].concat(waysBack.length ? [`or round ${rounds}`] : []) : waysBack.length ? [`no way back, or round ${rounds}`] : ["after one round"] },
  };
}
