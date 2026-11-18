// ============================================
// Agent Spec 26.3.1 with the lab's extension: writing
// ============================================
// A topology is written as an Agent Spec Flow any Agent Spec runtime can
// read: each role an AgentNode in the drawn order, each wire a data edge, and
// each way back a BranchingNode on the deciding role's `way` output with a
// control-flow edge back through a round counter, so the flow stops at the
// round limit even where the extension is ignored. What Agent Spec has no
// construct for is the extension block in the Flow's metadata. The writer is
// deterministic: the same topology always gives the same document.

import { createDefaultToolkit } from "../../tools/defaults.js";
import type { SerializedNode, ToolPolicy } from "../../types/pipeline.js";
import { signalFields, type FieldSpec } from "../../engine/provenance.js";
import { AGENTSPEC_VERSION, EXTENSION_PROFILE } from "../schemas.js";
import { deciderOf, nodeOfPort, portNameOf, type ConsultEdge, type Loss, type Topology } from "../model.js";

type Json = Record<string, unknown>;

export const IDS = {
  start: "start",
  end: "end",
  runModel: "model.run",
  rounds: "rounds",
  roleModel: (role: string) => `model.${role}`,
  agent: (role: string) => `${role}.agent`,
  tool: (name: string) => `tool.${name}`,
  consultTool: (consult: string) => `tool.consult.${consult}`,
  way: (decider: string) => `${decider}.way`,
  counter: (wayBack: string) => `rounds.${wayBack}`,
} as const;

/** Names a role's AgentNode uses beside its ports; no port may take them. */
export const RESERVED_INPUTS = ["run_task", "run_inputs", "way"] as const;
export const RESERVED_ROLE_IDS = [IDS.start, IDS.end, IDS.rounds] as const;
export const RUN_MODEL_ID = "chosen-at-run";
export const EXECUTOR = "agentic-lab";
export const CONSULT_TOOL_TYPE = "agentic_lab.consult";

const ref = (id: string) => ({ $component_ref: id });
const prop = (title: string, description: string, defaultValue?: string): Json => ({
  title,
  type: "string",
  ...(description ? { description } : {}),
  ...(defaultValue !== undefined ? { default: defaultValue } : {}),
});

/** The tools a role is offered, from its policy over the lab's default toolkit. */
export function toolsOf(node: SerializedNode): string[] {
  const all = createDefaultToolkit().getAll().map((t) => t.definition.name);
  const policy: ToolPolicy | undefined =
    node.config.toolPolicy ?? (node.config.enabledTools?.length ? { allow: node.config.enabledTools } : undefined);
  const base = policy?.allow ?? all;
  const deny = new Set(policy?.deny ?? []);
  return base.filter((t) => !deny.has(t));
}

function builtinTool(name: string): Json {
  const def = createDefaultToolkit().get(name)?.definition;
  return {
    component_type: "BuiltinTool",
    id: IDS.tool(name),
    name,
    description: def?.description ?? "A tool the lab's run provides under this name.",
    inputs: Object.entries(def?.parameters.properties ?? {}).map(([title, p]) => ({
      title,
      type: p.type === "array" ? "array" : p.type,
      ...(p.type === "array" ? { items: { type: p.items?.type ?? "string" } } : {}),
      ...(p.description ? { description: p.description } : {}),
    })),
    outputs: [prop("result", "What the tool returned")],
    requires_confirmation: false,
    tool_type: name,
    executor_name: EXECUTOR,
  };
}

function consultTool(c: ConsultEdge): Json {
  return {
    component_type: "BuiltinTool",
    id: IDS.consultTool(c.id),
    name: `consult_${c.role.id}`,
    description: `Ask ${c.role.face.label} for advice, at most ${c.limit} times a turn. It sees: ${c.sees.join(", ")}.`,
    inputs: c.sees.includes("question") ? [prop("question", "What you want advice on")] : [],
    outputs: [prop("advice", "What it advised")],
    requires_confirmation: false,
    tool_type: CONSULT_TOOL_TYPE,
    configuration: { role: c.role.id, limit: c.limit, sees: c.sees },
    executor_name: EXECUTOR,
  };
}

function llmConfig(id: string, name: string, brain?: { provider?: string; model?: string; temperature?: number; maxTokens?: number }): Json {
  const params: Json = {};
  if (brain?.temperature !== undefined) params.temperature = brain.temperature;
  if (brain?.maxTokens !== undefined) params.max_tokens = brain.maxTokens;
  return {
    component_type: "LlmConfig",
    id,
    name,
    ...(brain
      ? {}
      : { description: "Chosen when a run starts: every role uses the model you run with, unless it names its own." }),
    model_id: brain?.model ?? RUN_MODEL_ID,
    ...(brain?.provider ? { api_provider: brain.provider } : {}),
    ...(Object.keys(params).length ? { default_generation_parameters: params } : {}),
  };
}

const readsTask = (node: SerializedNode, defaults: string[]) => (node.config.runInputs ?? defaults).includes("task");
const readsOthers = (node: SerializedNode, defaults: string[]) =>
  (node.config.runInputs ?? defaults).some((r) => r !== "task");

/** The run inputs a category reads when its definition does not say (mirrors the engine's DEFAULT_RUN_INPUTS). */
const DEFAULT_READS: Record<string, string[]> = {
  planning: ["task", "*"],
  execution: ["task", "*"],
  evaluation: ["task", "*"],
};

function provenanceOf(spec: FieldSpec): unknown {
  if (typeof spec === "string") return spec;
  if ("varies" in spec) return "measured or written";
  return Object.fromEntries(Object.entries(spec.shape).map(([k, v]) => [k, provenanceOf(v)]));
}

/** What the engine declares for each signal type the topology's roles emit. */
export function provenanceBlock(t: Topology): Json {
  const types = new Set(t.nodes.flatMap((n) => n.ports.outputs.flatMap((p) => p.signalTypes)));
  const out: Json = {};
  for (const type of [...types].sort()) {
    const fields = signalFields(type);
    if (!fields) continue;
    out[type] = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, provenanceOf(v)]));
  }
  return out;
}

function extensionBlock(t: Topology): Json {
  const roles: Json = {};
  for (const n of t.nodes) {
    const { runInputs, brain: _brain, ...config } = n.config;
    roles[n.id] = {
      engine: n.type,
      category: n.category,
      ...(n.version && n.version !== "1.0.0" ? { version: n.version } : {}),
      face: t.faces[n.id],
      ...(runInputs ? { reads: runInputs } : {}),
      config,
      ...(n.metadata && Object.keys(n.metadata).length ? { params: n.metadata } : {}),
      ports: {
        inputs: n.ports.inputs.map((p) => ({
          name: p.name,
          signals: p.signalTypes,
          ...(p.description ? { description: p.description } : {}),
          ...(p.required !== undefined ? { required: p.required } : {}),
        })),
        outputs: n.ports.outputs.map((p) => ({
          name: p.name,
          signals: p.signalTypes,
          ...(p.description ? { description: p.description } : {}),
        })),
      },
    };
  }
  const wires: Json = {};
  for (const w of t.wires) {
    wires[w.id] = {
      ...(w.fields ? { fields: w.fields } : {}),
      ...(w.feedback ? { feedback: w.feedback } : {}),
      ...(w.enabled === false ? { enabled: false } : {}),
      ...(w.transformName ? { transform: w.transformName } : {}),
      ...(w.filterName ? { filter: w.filterName } : {}),
    };
  }
  const d = t.defaults;
  return {
    profile: EXTENSION_PROFILE,
    version: t.version,
    ...(t.author ? { author: t.author } : {}),
    ...(t.category ? { category: t.category } : {}),
    tags: t.tags,
    ...(t.createdAt ? { created_at: t.createdAt } : {}),
    ...(t.updatedAt ? { updated_at: t.updatedAt } : {}),
    order: t.nodes.map((n) => n.id),
    roles,
    wires,
    provenance: provenanceBlock(t),
    ways_back: t.waysBack.map((w) => ({ id: w.id, from: w.from, to: w.to, label: w.label, when: w.when, wires: w.wires })),
    also: t.also.map((a) => ({ id: a.id, from: a.from, to: a.to, label: a.label, wires: a.wires })),
    consults: t.consults.map((c) => ({
      id: c.id,
      from: c.from,
      role: {
        id: c.role.id,
        name: c.role.name,
        description: c.role.description,
        face: c.role.face,
        ...(c.role.brain ? { brain: c.role.brain } : {}),
        ...(c.role.systemMessage ? { instructions: c.role.systemMessage } : {}),
        ...(c.role.maxTokens ? { max_tokens: c.role.maxTokens } : {}),
      },
      limit: c.limit,
      sees: c.sees,
      label: c.label,
    })),
    exit: t.exit,
    limits: {
      rounds: d.maxCycles ?? 0,
      ...(d.delayMs !== undefined ? { delay_ms: d.delayMs } : {}),
      ...(d.tokenBudget !== undefined ? { token_budget: d.tokenBudget } : {}),
      ...(d.timeoutMs !== undefined ? { timeout_ms: d.timeoutMs } : {}),
      ...(d.repeat ? { repeat: { until: d.repeat.until, ...(d.repeat.planFile ? { plan_file: d.repeat.planFile } : {}) } } : {}),
    },
    ...(t.parameters?.length ? { parameters: t.parameters } : {}),
  };
}

/** The round counter: round k below the limit goes on as round k+1; the limit stops. */
function counterFlow(limit: number): Json {
  const nodes: Json[] = [];
  const control: Json[] = [];
  const round = (value: string) => [prop("round", "The round the run is in", value)];
  nodes.push({ component_type: "StartNode", id: "rounds.start", name: "round", inputs: round("1"), outputs: round("1"), branches: ["next"] });
  const mapping: Record<string, string> = {};
  for (let k = 1; k < limit; k++) mapping[String(k)] = `r${k}`;
  nodes.push({
    component_type: "BranchingNode",
    id: "rounds.check",
    name: "below the limit?",
    inputs: round("1"),
    outputs: [],
    branches: [...Object.values(mapping), "default"],
    mapping,
  });
  control.push({ component_type: "ControlFlowEdge", id: "rounds.cf.start", name: "count", from_node: ref("rounds.start"), to_node: ref("rounds.check") });
  for (let k = 1; k < limit; k++) {
    const id = `rounds.next.${k + 1}`;
    nodes.push({ component_type: "EndNode", id, name: `round ${k + 1}`, inputs: round(String(k + 1)), outputs: round(String(k + 1)), branches: [], branch_name: "again" });
    control.push({ component_type: "ControlFlowEdge", id: `rounds.cf.${k + 1}`, name: `round ${k} done`, from_node: ref("rounds.check"), from_branch: `r${k}`, to_node: ref(id) });
  }
  nodes.push({ component_type: "EndNode", id: "rounds.limit", name: "the limit", inputs: round(String(limit)), outputs: round(String(limit)), branches: [], branch_name: "limit" });
  control.push({ component_type: "ControlFlowEdge", id: "rounds.cf.limit", name: "limit reached", from_node: ref("rounds.check"), from_branch: "default", to_node: ref("rounds.limit") });
  const referenced: Json = {};
  for (const n of nodes) referenced[n.id as string] = n;
  return {
    component_type: "Flow",
    id: IDS.rounds,
    name: "round counter",
    description: `Counts the rounds a run takes: a round below ${limit} goes on as the next round, round ${limit} stops the run.`,
    inputs: round("1"),
    outputs: [prop("round", "The round the run goes on to")],
    start_node: ref("rounds.start"),
    nodes: nodes.map((n) => ref(n.id as string)),
    control_flow_connections: control,
    data_flow_connections: [
      {
        component_type: "DataFlowEdge",
        id: "rounds.df.round",
        name: "round",
        source_node: ref("rounds.start"),
        source_output: "round",
        destination_node: ref("rounds.check"),
        destination_input: "round",
      },
    ],
    $referenced_components: referenced,
  };
}

function systemPrompt(sentence: string, inputs: Json[], waysTo: string[]): string {
  const lines = [sentence.trim() || "Do your part of the task."];
  if (inputs.length) {
    lines.push("");
    for (const i of inputs) lines.push(`${String(i.description || i.title)}: {{${String(i.title)}}}`);
  }
  if (waysTo.length) {
    lines.push("");
    lines.push(`When the work must go back, set way to one of: ${waysTo.join(", ")}. Leave way empty when it is done.`);
  }
  return lines.join("\n");
}

export interface WriteResult {
  data: Json;
  losses: Loss[];
}

/** Write a topology as an Agent Spec 26.3.1 Flow with the lab's extension. */
export function writeAgentSpec(t: Topology): WriteResult {
  const referenced: Json = {};
  const order = t.nodes.map((n) => n.id);
  const decider = t.waysBack[0]?.from ?? deciderOf(t);
  const limit = t.defaults.maxCycles ?? 0;
  const ways = t.waysBack;
  const hasWays = ways.length > 0;
  const execRoles = t.nodes.filter((n) => n.category === "execution");
  const answerFrom = execRoles.at(-1);
  const answerPort = answerFrom?.ports.outputs.find((p) => p.signalTypes.includes("execution_result"));

  // Models and tools, shared by reference.
  referenced[IDS.runModel] = llmConfig(IDS.runModel, "the run's model");
  const toolNames = new Set<string>();
  for (const n of t.nodes) for (const tool of toolsOf(n)) toolNames.add(tool);

  // Roles.
  for (const n of t.nodes) {
    const defaults = DEFAULT_READS[n.category] ?? [];
    const inputs: Json[] = [];
    if (readsTask(n, defaults)) inputs.push(prop("run_task", "Your task"));
    if (readsOthers(n, defaults)) inputs.push(prop("run_inputs", "The run's other inputs", ""));
    for (const p of n.ports.inputs) inputs.push(prop(p.name, p.description ?? "", ""));
    const outputs: Json[] = n.ports.outputs.map((p) => prop(p.name, p.description ?? "", ""));
    const waysTo = n.id === decider && hasWays ? ways.map((w) => w.to) : [];
    if (waysTo.length) outputs.push(prop("way", `Where the work goes back to: ${waysTo.join(", ")}; empty when it is done`, ""));
    const modelId = n.config.brain ? IDS.roleModel(n.id) : IDS.runModel;
    if (n.config.brain) referenced[modelId] = llmConfig(modelId, `${n.name}'s model`, n.config.brain);
    const tools = [
      ...toolsOf(n).map((name) => ref(IDS.tool(name))),
      ...t.consults.filter((c) => c.from === n.id).map((c) => ref(IDS.consultTool(c.id))),
    ];
    referenced[n.id] = {
      component_type: "AgentNode",
      id: n.id,
      name: n.name,
      ...(n.description ? { description: n.description } : {}),
      inputs,
      outputs,
      branches: ["next"],
      agent: {
        component_type: "Agent",
        id: IDS.agent(n.id),
        name: t.faces[n.id]?.label ?? n.name,
        inputs,
        outputs,
        llm_config: ref(modelId),
        system_prompt: systemPrompt(t.faces[n.id]?.sentence ?? n.description, inputs, waysTo),
        tools,
        human_in_the_loop: false,
      },
    };
  }
  for (const name of [...toolNames].sort()) referenced[IDS.tool(name)] = builtinTool(name);
  for (const c of t.consults) referenced[IDS.consultTool(c.id)] = consultTool(c);

  // Start and end.
  const flowInputs = [prop("task", "The task as you give it"), prop("run_inputs", "The run's other inputs: the conversation, recalled memories", "")];
  referenced[IDS.start] = { component_type: "StartNode", id: IDS.start, name: "your task", inputs: flowInputs, outputs: flowInputs, branches: ["next"] };
  const answer = [prop("answer", "What Do wrote in its last turn", "")];
  referenced[IDS.end] = { component_type: "EndNode", id: IDS.end, name: t.exit.label, inputs: answer, outputs: answer, branches: [] };

  const control: Json[] = [];
  const cf = (from: string, to: string, branch?: string) =>
    control.push({
      component_type: "ControlFlowEdge",
      id: `cf.${from}.${branch ?? to}`,
      name: `${from} to ${to}${branch ? ` (${branch})` : ""}`,
      from_node: ref(from),
      ...(branch ? { from_branch: branch } : {}),
      to_node: ref(to),
    });
  cf(IDS.start, order[0]);
  for (let i = 0; i + 1 < order.length; i++) cf(order[i], order[i + 1]);

  const nodeIds = [IDS.start, ...order];
  if (hasWays && decider) {
    const way = IDS.way(decider);
    const mapping = Object.fromEntries(ways.map((w) => [w.to, `back_to_${w.to}`]));
    referenced[way] = {
      component_type: "BranchingNode",
      id: way,
      name: `${t.faces[decider]?.label ?? decider}'s way`,
      description: "Where the deciding role sends the work: back to a role, or on to done.",
      inputs: [prop("way", "Where the work goes back to", "")],
      outputs: [],
      branches: [...Object.values(mapping), "default"],
      mapping,
    };
    cf(order[order.length - 1], way);
    nodeIds.push(way);
    for (const w of ways) {
      if (limit > 0) {
        const counter = IDS.counter(w.id);
        referenced[counter] = {
          component_type: "FlowNode",
          id: counter,
          name: `round counter, ${w.label}`,
          inputs: [prop("round", "The round the run is in", "1")],
          outputs: [prop("round", "The round the run goes on to")],
          branches: ["again", "limit"],
          subflow: ref(IDS.rounds),
        };
        nodeIds.push(counter);
        cf(way, counter, `back_to_${w.to}`);
        cf(counter, w.to, "again");
        cf(counter, IDS.end, "limit");
      } else {
        cf(way, w.to, `back_to_${w.to}`);
      }
    }
    cf(way, IDS.end, "default");
    if (limit > 0) referenced[IDS.rounds] = counterFlow(limit);
  } else {
    cf(order[order.length - 1], IDS.end);
  }
  nodeIds.push(IDS.end);

  // Data: the wires, the run's inputs, the answer, the way, the shared round.
  const data: Json[] = [];
  const df = (id: string, from: string, output: string, to: string, input: string) =>
    data.push({ component_type: "DataFlowEdge", id, name: id, source_node: ref(from), source_output: output, destination_node: ref(to), destination_input: input });
  for (const w of t.wires) df(w.id, nodeOfPort(w.sourcePortId), portNameOf(w.sourcePortId), nodeOfPort(w.targetPortId), portNameOf(w.targetPortId));
  for (const n of t.nodes) {
    const defaults = DEFAULT_READS[n.category] ?? [];
    if (readsTask(n, defaults)) df(`run.task.${n.id}`, IDS.start, "task", n.id, "run_task");
    if (readsOthers(n, defaults)) df(`run.inputs.${n.id}`, IDS.start, "run_inputs", n.id, "run_inputs");
  }
  if (answerFrom && answerPort) df(`answer.${answerFrom.id}`, answerFrom.id, answerPort.name, IDS.end, "answer");
  if (hasWays && decider) {
    df(`way.${decider}`, decider, "way", IDS.way(decider), "way");
    if (limit > 0) {
      for (const a of ways) for (const b of ways) df(`rounds.${a.id}.${b.id}`, IDS.counter(a.id), "round", IDS.counter(b.id), "round");
    }
  }

  const doc: Json = {
    component_type: "Flow",
    id: t.id,
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    metadata: { agentic_lab: extensionBlock(t) },
    inputs: flowInputs,
    outputs: answer,
    start_node: ref(IDS.start),
    nodes: nodeIds.map(ref),
    control_flow_connections: control,
    data_flow_connections: data,
    $referenced_components: referenced,
    agentspec_version: AGENTSPEC_VERSION,
  };

  return { data: doc, losses: [] };
}

/** What another Agent Spec runtime will ignore when it runs this document: everything only the extension holds. */
export function ignoredElsewhere(t: Topology): Loss[] {
  const base = "/metadata/agentic_lab";
  const out: Loss[] = [];
  const add = (path: string, what: string) => out.push({ path: `${base}${path}`, what, kind: "ignored" });
  add("/roles", `the engine of each role (${[...new Set(t.nodes.map((n) => n.type))].join(", ")}): another runtime runs every AgentNode as a plain agent on its system prompt, not on the lab's ${t.nodes.length} engines and their own prompts`);
  const walls = t.nodes.filter((n) => n.config.runInputs !== undefined).length;
  const fields = t.wires.filter((w) => w.fields).length;
  add("/roles/*/reads", `the walls: which run inputs each role reads${walls ? ` (set on ${walls} roles)` : ""}; Agent Spec shares one conversation with every agent in a flow and says not to use sub-agents for isolation`);
  if (fields) add("/wires", `the fields ${fields} of ${t.wires.length} wires deliver; another runtime passes each output whole`);
  add("/provenance", "where each value comes from (given, measured or written); another runtime does not mark values");
  if (t.waysBack.length) {
    add("/ways_back", `the conditions of ${t.waysBack.length} way${t.waysBack.length > 1 ? "s" : ""} back; another runtime follows the deciding role's way output, which its model must fill, where the lab follows the wires its engine fires`);
  }
  if (t.also.length) add("/also", `${t.also.length} wire${t.also.length > 1 ? "s" : ""} back that start no round (drawn as also)`);
  if (t.consults.length) {
    add("/consults", `${t.consults.length} consult edge${t.consults.length > 1 ? "s" : ""}: the consulted role, its sight and its limit; the caller keeps a BuiltinTool of type ${CONSULT_TOOL_TYPE} that only the lab implements`);
  }
  const d = t.defaults;
  if (d.repeat) add("/limits/repeat", "repeating while the plan file has unchecked items: another runtime repeats only while its model sets way");
  if (d.tokenBudget) add("/limits/token_budget", "the token budget");
  if (d.delayMs) add("/limits/delay_ms", "the pause between rounds");
  if (t.nodes.some((n) => n.metadata && Object.keys(n.metadata).length)) {
    add("/roles/*/params", "the engines' own parameters (Decide's threshold and round limit, among others)");
  }
  if (t.nodes.some((n) => n.config.skills?.length || n.config.memory)) add("/roles/*/config", "skills and memory policies");
  out.push({
    path: `/$referenced_components/${IDS.runModel}`,
    what: `the model: every role points at an LlmConfig whose model_id is "${RUN_MODEL_ID}", which the lab replaces with the model you run with; another runtime must be given a model`,
    kind: "ignored",
  });
  out.push({
    path: "/$referenced_components/tool.*",
    what: `the tools are BuiltinTools executed by "${EXECUTOR}"; another runtime must provide tools of the same names`,
    kind: "ignored",
  });
  return out;
}
