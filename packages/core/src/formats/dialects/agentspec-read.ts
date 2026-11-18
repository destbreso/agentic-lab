// ============================================
// Agent Spec 26.3.1 with the lab's extension: reading
// ============================================
// With the extension, the native part of the document owns what Agent Spec
// can say (the topology's name, each role's AgentNode, name, description and
// model, each wire's data edge) and the extension owns the rest (engines,
// walls, ports, conditions, consults, limits). Everything the writer derives
// from those (system prompts, tools, the way node, the round counter) is
// written again from the model and compared with the document: a difference is
// a loss, reported at its path, never a silent change.

import type { NodeBrainConfig, PortDirection, Recipe, SerializedNode, Wire } from "../../types/pipeline.js";
import { signalFields } from "../../engine/provenance.js";
import { validateExtension } from "../schemas.js";
import { issue, pointer, type FormatIssue, type Loss, type Topology } from "../model.js";
import { ComponentIndex, type Json } from "./agentspec-refs.js";
import { expandInferred } from "./agentspec-infer.js";
import { IDS, RESERVED_INPUTS, RESERVED_ROLE_IDS, RUN_MODEL_ID, provenanceBlock, writeAgentSpec } from "./agentspec-write.js";

const EXT = pointer("metadata", "agentic_lab");

export interface ReadOutcome {
  topology: Topology | null;
  issues: FormatIssue[];
  losses: Loss[];
}

/** Every path where two JSON values differ, cut at the first difference down each branch. */
export function differences(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (a === b) return out;
  const isObj = (x: unknown) => x !== null && typeof x === "object";
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(path);
      return out;
    }
    a.forEach((x, i) => differences(x, b[i], `${path}/${i}`, out));
    return out;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as Json).filter((k) => (a as Json)[k] !== undefined);
    const kb = Object.keys(b as Json).filter((k) => (b as Json)[k] !== undefined);
    for (const k of new Set([...ka, ...kb])) differences((a as Json)[k], (b as Json)[k], `${path}${pointer(k)}`, out);
    return out;
  }
  out.push(path);
  return out;
}

function brainOf(index: ComponentIndex, agent: Json, path: string): NodeBrainConfig | undefined {
  const model = index.resolve(agent.llm_config, `${path}/llm_config`)?.component;
  if (!model || model.id === IDS.runModel) return undefined;
  const params = (model.default_generation_parameters ?? {}) as Json;
  const brain: NodeBrainConfig = {};
  const provider = model.api_provider ?? model.provider;
  if (typeof provider === "string") brain.provider = provider;
  if (typeof model.model_id === "string" && model.model_id !== RUN_MODEL_ID) brain.model = model.model_id;
  if (typeof params.temperature === "number") brain.temperature = params.temperature;
  if (typeof params.max_tokens === "number") brain.maxTokens = params.max_tokens;
  return brain;
}

const portsOf = (list: Array<Json>, direction: PortDirection) =>
  list.map((p) => ({
    name: String(p.name),
    direction,
    signalTypes: (p.signals as string[]) ?? [],
    ...(p.description !== undefined ? { description: String(p.description) } : {}),
    ...(direction === "input" && p.required !== undefined ? { required: Boolean(p.required) } : {}),
  }));

/** Read a Flow that carries the lab's extension. */
export function readWithExtension(doc: Json): ReadOutcome {
  const issues: FormatIssue[] = [];
  const losses: Loss[] = [];
  const ext = (doc.metadata as Json).agentic_lab as Json;
  issues.push(...validateExtension(ext));
  if (issues.some((i) => i.severity === "error")) return { topology: null, issues, losses };

  const index = new ComponentIndex(doc);
  const order = ext.order as string[];
  const roles = ext.roles as Record<string, Json>;
  const members = new Map<string, Json>();
  (doc.nodes as unknown[]).forEach((n, i) => {
    const found = index.resolve(n, `/nodes/${i}`);
    if (found) members.set(String(found.component.id), found.component);
  });

  for (const id of Object.keys(roles)) {
    if (!order.includes(id)) issues.push(issue(`${EXT}/roles${pointer(id)}`, `"${id}" is not in order`));
  }
  const nodes: SerializedNode[] = [];
  order.forEach((id, i) => {
    const at = `${EXT}/order/${i}`;
    if ((RESERVED_ROLE_IDS as readonly string[]).includes(id)) {
      issues.push(issue(at, `"${id}" is a name the format keeps for itself (${RESERVED_ROLE_IDS.join(", ")})`));
      return;
    }
    const role = roles[id];
    if (!role) {
      issues.push(issue(at, `no role "${id}" in roles`));
      return;
    }
    const node = members.get(id);
    if (!node || node.component_type !== "AgentNode") {
      issues.push(issue(at, `the flow has no AgentNode with the id "${id}"`));
      return;
    }
    const nodePath = index.byId.get(id)!.path;
    const agent = index.resolve(node.agent, `${nodePath}/agent`);
    const ports = role.ports as { inputs: Json[]; outputs: Json[] };
    for (const [dir, list] of Object.entries(ports)) {
      list.forEach((p, j) => {
        if ((RESERVED_INPUTS as readonly string[]).includes(String(p.name))) {
          issues.push(issue(`${EXT}/roles${pointer(id)}/ports/${dir}/${j}/name`, `"${String(p.name)}" is a name the format keeps for itself`));
        }
      });
    }
    const brain = agent ? brainOf(index, agent.component, agent.path) : undefined;
    const config = { ...(role.config as Json) } as unknown as SerializedNode["config"];
    if (role.reads) config.runInputs = role.reads as string[];
    if (brain) config.brain = brain;
    nodes.push({
      id,
      type: String(role.engine),
      name: String(node.name),
      category: role.category as SerializedNode["category"],
      description: typeof node.description === "string" ? node.description : "",
      version: typeof role.version === "string" ? role.version : "1.0.0",
      config,
      ports: { inputs: portsOf(ports.inputs, "input"), outputs: portsOf(ports.outputs, "output") },
      ...(role.params ? { metadata: role.params as Json } : {}),
    });
  });

  // Wires: the data edges between two roles that the writer did not make for itself.
  const wiresExt = ext.wires as Record<string, Json>;
  const wires: Recipe["wires"] = [];
  const generated = /^(run\.|answer\.|way\.|rounds\.)/;
  const roleIds = new Set(order);
  ((doc.data_flow_connections as unknown[]) ?? []).forEach((edge, i) => {
    const p = `/data_flow_connections/${i}`;
    const e = index.resolve(edge, p)?.component;
    if (!e) return;
    const id = String(e.id);
    const from = index.idOf(e.source_node);
    const to = index.idOf(e.destination_node);
    if (generated.test(id) || !from || !to || !roleIds.has(from) || !roleIds.has(to)) return;
    const src = nodes.find((n) => n.id === from);
    const dst = nodes.find((n) => n.id === to);
    if (src && !src.ports.outputs.some((o) => o.name === e.source_output)) {
      issues.push(issue(`${p}/source_output`, `"${String(e.source_output)}" is not an output port of "${from}" in the extension`));
    }
    if (dst && !dst.ports.inputs.some((o) => o.name === e.destination_input)) {
      issues.push(issue(`${p}/destination_input`, `"${String(e.destination_input)}" is not an input port of "${to}" in the extension`));
    }
    const x = wiresExt[id] ?? {};
    if (!wiresExt[id]) issues.push(issue(`${EXT}/wires`, `the data edge "${id}" has no entry in wires`, "warning"));
    const wire: Recipe["wires"][number] = {
      id,
      sourcePortId: `${from}:out:${String(e.source_output)}`,
      targetPortId: `${to}:in:${String(e.destination_input)}`,
      enabled: x.enabled === false ? false : true,
      ...(x.feedback ? { feedback: x.feedback as Wire["feedback"] } : {}),
      ...(x.fields ? { fields: x.fields as string[] } : {}),
      ...(x.transform ? { transformName: String(x.transform) } : {}),
      ...(x.filter ? { filterName: String(x.filter) } : {}),
    };
    wires.push(wire);
  });
  const wireIds = new Set(wires.map((w) => w.id));
  for (const id of Object.keys(wiresExt)) {
    if (!wireIds.has(id)) issues.push(issue(`${EXT}/wires${pointer(id)}`, `no data edge between two roles has the id "${id}"`));
  }

  const checkEdge = (list: Json[], key: string) =>
    list.forEach((w, i) => {
      for (const end of ["from", "to"]) {
        if (!roleIds.has(String(w[end]))) issues.push(issue(`${EXT}/${key}/${i}/${end}`, `"${String(w[end])}" is not a role`));
      }
      ((w.wires as string[]) ?? []).forEach((wid, j) => {
        if (!wireIds.has(wid)) issues.push(issue(`${EXT}/${key}/${i}/wires/${j}`, `no wire "${wid}"`));
      });
    });
  checkEdge(ext.ways_back as Json[], "ways_back");
  checkEdge(ext.also as Json[], "also");
  const deciders = new Set((ext.ways_back as Json[]).map((w) => w.from));
  if (deciders.size > 1) issues.push(issue(`${EXT}/ways_back`, "every way back leaves from the same deciding role"));
  (ext.consults as Json[]).forEach((c, i) => {
    if (!roleIds.has(String(c.from))) issues.push(issue(`${EXT}/consults/${i}/from`, `"${String(c.from)}" is not a role`));
    const rid = String((c.role as Json).id);
    if (roleIds.has(rid) || (RESERVED_ROLE_IDS as readonly string[]).includes(rid)) {
      issues.push(issue(`${EXT}/consults/${i}/role/id`, `"${rid}" is already a role's id`));
    }
  });

  // Provenance is the engine's: a document that says otherwise is out of date.
  const declared = ext.provenance as Json;
  const fresh = provenanceBlock({ nodes } as Topology);
  for (const path of differences(declared, fresh)) {
    issues.push(issue(`${EXT}/provenance${path}`, "differs from what the engine declares for this field; the engine's declaration is the one that holds", "warning"));
  }

  if (issues.some((i) => i.severity === "error")) return { topology: null, issues, losses };

  const limits = ext.limits as Json;
  const repeat = limits.repeat as Json | undefined;
  const defaults: Recipe["defaults"] = { maxCycles: Number(limits.rounds) };
  if (limits.delay_ms !== undefined) defaults.delayMs = Number(limits.delay_ms);
  if (limits.token_budget !== undefined) defaults.tokenBudget = Number(limits.token_budget);
  if (limits.timeout_ms !== undefined) defaults.timeoutMs = Number(limits.timeout_ms);
  if (repeat) defaults.repeat = { until: "plan-done", ...(repeat.plan_file ? { planFile: String(repeat.plan_file) } : {}) };

  const topology: Topology = {
    id: String(doc.id ?? ""),
    name: String(doc.name),
    description: typeof doc.description === "string" ? doc.description : "",
    version: String(ext.version),
    ...(ext.author ? { author: String(ext.author) } : {}),
    tags: (ext.tags as string[]) ?? [],
    ...(ext.category ? { category: String(ext.category) } : {}),
    nodes,
    wires,
    defaults,
    ...(ext.parameters ? { parameters: ext.parameters as Recipe["parameters"] } : {}),
    createdAt: String(ext.created_at ?? ""),
    updatedAt: String(ext.updated_at ?? ""),
    faces: Object.fromEntries(order.map((id) => [id, roles[id].face as Topology["faces"][string]])),
    waysBack: (ext.ways_back as Json[]).map((w) => ({
      id: String(w.id),
      from: String(w.from),
      to: String(w.to),
      label: String(w.label),
      when: String(w.when),
      wires: (w.wires as string[]) ?? [],
    })),
    also: (ext.also as Json[]).map((a) => ({ id: String(a.id), from: String(a.from), to: String(a.to), label: String(a.label), wires: a.wires as string[] })),
    consults: (ext.consults as Json[]).map((c) => {
      const r = c.role as Json;
      return {
        id: String(c.id),
        from: String(c.from),
        limit: Number(c.limit),
        sees: c.sees as Topology["consults"][number]["sees"],
        label: String(c.label),
        role: {
          id: String(r.id),
          name: String(r.name),
          description: String(r.description),
          face: r.face as Topology["faces"][string],
          ...(r.brain ? { brain: r.brain as NodeBrainConfig } : {}),
          ...(r.instructions ? { systemMessage: String(r.instructions) } : {}),
          ...(r.max_tokens ? { maxTokens: Number(r.max_tokens) } : {}),
        },
      };
    }),
    exit: ext.exit as Topology["exit"],
  };
  if (!doc.id) issues.push(issue("/id", "the flow has no id; the topology needs one", "error"));

  // What the writer derives must be what the document holds; anything else is lost on the next write.
  // Both sides are compared written out in full, so a compact document and a full one read alike;
  // a value the document left to inference differs only when its source does, which is reported there.
  const rewritten = writeAgentSpec(topology, { form: "expanded" }).data;
  const { doc: full, filled } = expandInferred(doc);
  const { agentspec_version: _v, ...docRest } = full;
  const { agentspec_version: _w, ...newRest } = rewritten;
  const inferred = (path: string) => filled.some((f) => path === f || path.startsWith(`${f}/`));
  for (const path of differences(docRest, newRest)) {
    if (path.startsWith(`${EXT}/provenance`) || inferred(path)) continue;
    losses.push({ path, what: "the lab writes this from the topology, so the value in the document is not read and changes on the next write", kind: "dropped" });
    issues.push(issue(path, "the lab writes this part from the rest of the document; this value is not read", "warning"));
  }
  return { topology, issues, losses };
}

/** Signal types a topology's ports use that the engine has no provenance for. */
export function undeclaredSignalTypes(t: Pick<Topology, "nodes">): string[] {
  const types = new Set(t.nodes.flatMap((n) => n.ports.outputs.flatMap((p) => p.signalTypes)));
  return [...types].filter((type) => !signalFields(type));
}
