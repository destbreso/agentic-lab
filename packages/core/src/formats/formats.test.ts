// The formats module: the syntax layer, the Agent Spec dialect with the lab's
// extension, the legacy recipes, and every registered dialect's contract.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";
import YAML from "yaml";
import {
  FormatError,
  convertTopologyText,
  ignoredElsewhere,
  listDialects,
  parseText,
  readTopologyText,
  validateAgentSpec,
  validateTopologyText,
  writeTopologyText,
  type Topology,
} from "./index.js";
import { loadBuiltinTopologies, builtinFile } from "./builtin.js";
import { coreFile } from "./files.js";
import { dialectContract, type InvalidCase } from "../test-support/dialect-contract.js";
import { agentSpecDialect } from "./dialects/agentspec.js";
import { legacyDialect } from "./dialects/legacy.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import { AgentSession } from "../engine/agent-session.js";
import { createDefaultToolkit } from "../tools/defaults.js";

const builtins = loadBuiltinTopologies();
const docOf = (id: string) => YAML.parse(readFileSync(builtinFile(id), "utf-8")) as Record<string, any>;
const fixture = (name: string) => readFileSync(join(coreFile("src", "formats", "__fixtures__"), name), "utf-8");
const legacyRecipes = JSON.parse(fixture("legacy-recipes.json")) as Array<Record<string, any>>;

describe("the syntax layer", () => {
  it("reads a YAML document and its JSON twin to the same data", () => {
    const yaml = readFileSync(builtinFile("deep-reasoning"), "utf-8");
    const json = readFileSync(builtinFile("deep-reasoning", "json"), "utf-8");
    expect(parseText(yaml, { filename: "x.yaml" }).data).toEqual(parseText(json, { filename: "x.json" }).data);
  });

  it("reads YAML 1.2: yes stays a string, a date stays a string", () => {
    expect(parseText("a: yes\nb: 2025-01-01T00:00:00Z\nc: '1'\n", { syntax: "yaml" }).data).toEqual({ a: "yes", b: "2025-01-01T00:00:00Z", c: "1" });
  });

  it("says on which line a path lands, in YAML and in JSON", () => {
    const yaml = parseText("a:\n  b:\n    - x\n    - y\n", { syntax: "yaml" });
    expect(yaml.locate("/a/b/1")?.line).toBe(4);
    const json = parseText('{\n  "a": {\n    "b": [\n      "x",\n      "y"\n    ]\n  }\n}\n', { syntax: "json" });
    expect(json.locate("/a/b/1")?.line).toBe(5);
  });

  it("refuses broken text with the line it breaks on", () => {
    expect(() => parseText("a: [1, 2\nb: 3\n", { syntax: "yaml" })).toThrow(FormatError);
    try {
      parseText('{\n  "a": 1,\n  "b": [1, 2\n}', { syntax: "json" });
    } catch (error) {
      expect((error as FormatError).issues[0].line).toBe(4);
    }
    expect(() => parseText("a: 1\na: 2\n", { syntax: "yaml" })).toThrow(/Map keys must be unique/);
  });
});

describe("Agent Spec 26.3.1 with the lab's extension", () => {
  it.each(builtins.map((t) => [t.id]))("%s is a valid Agent Spec document", (id) => {
    expect(validateAgentSpec(docOf(id))).toEqual([]);
    const result = validateTopologyText(readFileSync(builtinFile(id), "utf-8"), { filename: `${id}.yaml` });
    expect(result).toMatchObject({ valid: true, dialect: "agentspec", syntax: "yaml", issues: [] });
  });

  it("checks the version apart: the published schema refuses every versioned document as written", () => {
    const schema = JSON.parse(readFileSync(coreFile("schemas", "agentspec", "26.3.1", "agentspec_json_spec_26_3_1.json"), "utf-8"));
    const Ajv = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as unknown as typeof Ajv2020Module.default;
    const raw = new Ajv({ strict: false, logger: false, validateFormats: false }).compile(schema);
    const doc = docOf("exec-eval");
    expect(raw(doc)).toBe(false);
    const { agentspec_version: _v, ...rest } = doc;
    expect(raw(rest)).toBe(true);
    expect(validateAgentSpec({ ...doc, agentspec_version: "9.9.9" })).toEqual([
      expect.objectContaining({ path: "/agentspec_version", message: expect.stringContaining("not an Agent Spec version") }),
    ]);
  });

  it("points at the exact path and line of a schema error", () => {
    const doc = docOf("deep-reasoning");
    delete doc.$referenced_components["model.run"].model_id;
    const text = YAML.stringify(doc);
    const result = validateTopologyText(text, { syntax: "yaml" });
    expect(result.valid).toBe(false);
    const found = result.issues.find((i) => i.severity === "error")!;
    expect(found.path).toBe("/$referenced_components/model.run");
    expect(found.message).toContain('missing required property "model_id"');
    expect(text.split("\n")[found.line! - 1]).toContain("component_type: LlmConfig");
  });

  it("names a property Agent Spec does not have, at its own path", () => {
    const doc = docOf("exec-eval");
    doc.$referenced_components.exec.colour = "red";
    expect(validateAgentSpec(doc)).toEqual([
      expect.objectContaining({ path: "/$referenced_components/exec/colour", message: '"colour" is not a property of a AgentNode' }),
    ]);
  });

  it("refuses an edge from a branch the node does not have (a rule the schema cannot state)", () => {
    const doc = docOf("exec-eval");
    const edge = doc.control_flow_connections.find((e: any) => e.from_branch === "default");
    edge.from_branch = "otherwise";
    const issues = validateTopologyText(JSON.stringify(doc), { syntax: "json" }).issues;
    const i = doc.control_flow_connections.indexOf(edge);
    expect(issues).toContainEqual(expect.objectContaining({ path: `/control_flow_connections/${i}/from_branch`, severity: "error" }));
  });

  it("refuses an extension that breaks its schema, at the exact path", () => {
    const doc = docOf("deep-reasoning");
    doc.metadata.jig.roles.critic.reads = "task";
    const issues = validateTopologyText(JSON.stringify(doc), { syntax: "json" }).issues;
    expect(issues).toContainEqual(expect.objectContaining({ path: "/metadata/jig/roles/critic/reads", message: "must be array", severity: "error" }));
  });

  it("reports an edit to a part the lab writes itself as a loss, at its path", () => {
    const doc = docOf("deep-reasoning");
    doc.$referenced_components["rounds"].$referenced_components["rounds.next.3"].inputs[0].default = "7";
    const read = readTopologyText(JSON.stringify(doc), { syntax: "json" });
    expect(read.losses).toContainEqual(expect.objectContaining({ path: "/$referenced_components/rounds/$referenced_components/rounds.next.3/inputs/0/default", kind: "dropped" }));
    expect(read.warnings.length).toBeGreaterThan(0);
  });

  it("says when a document's provenance is not the engine's", () => {
    const doc = docOf("exec-eval");
    doc.metadata.jig.provenance.execution_result.toolCallCount = "written";
    const read = readTopologyText(JSON.stringify(doc), { syntax: "json" });
    expect(read.warnings).toContainEqual(expect.objectContaining({ path: "/metadata/jig/provenance/execution_result/toolCallCount", severity: "warning" }));
  });

  it("writes each way back as a BranchingNode with a round counter, so the flow stops where the extension is ignored", () => {
    const doc = docOf("deep-reasoning");
    const way = doc.$referenced_components["refine.way"];
    expect(way).toMatchObject({ component_type: "BranchingNode", mapping: { exec: "back_to_exec", plan: "back_to_plan" } });
    const counter = doc.$referenced_components.rounds;
    expect(counter.$referenced_components["rounds.check"].mapping).toEqual({ "1": "r1", "2": "r2", "3": "r3", "4": "r4" });
    expect(counter.$referenced_components["rounds.limit"]).toMatchObject({ branch_name: "limit" });
    const back = doc.control_flow_connections.filter((e: any) => e.from_branch === "again").map((e: any) => e.to_node.$component_ref);
    expect(back.sort()).toEqual(["exec", "plan"]);
  });

  it("reports what another runtime ignores in an export of Deep Reasoning", () => {
    const dr = builtins.find((t) => t.id === "deep-reasoning")!;
    const report = ignoredElsewhere(dr);
    expect(report.every((l) => l.kind === "ignored")).toBe(true);
    const paths = report.map((l) => l.path);
    for (const p of ["/metadata/jig/roles/*/reads", "/metadata/jig/wires", "/metadata/jig/provenance", "/metadata/jig/ways_back", "/metadata/jig/also"]) {
      expect(paths).toContain(p);
    }
    expect(writeTopologyText(dr).losses).toEqual(report);
  });
});

describe("importing an Agent Spec document the lab did not write", () => {
  const flow = fixture("oracle/howto_flow_with_conditional_branches.yaml");

  it("reads Oracle's conditional-branches flow into roles, wires and a way back", () => {
    const read = readTopologyText(flow, { filename: "flow.yaml" });
    const t = read.topology;
    expect(read.dialect).toBe("agentspec");
    expect(t.nodes.map((n) => n.name)).toEqual(["Generate code node", "Review code node", "Check if code is ready node"]);
    expect(t.waysBack).toHaveLength(1);
    expect(t.waysBack[0]).toMatchObject({ to: t.nodes[0].id, label: "no: back to Generate code node" });
    expect(t.defaults.maxCycles).toBe(5);
    expect(read.warnings.map((w) => w.message).join("\n")).toContain("no limit in the document");
    expect(read.losses.map((l) => l.what).join("\n")).toMatch(/model .*VllmConfig/);
  });

  it("reads the YAML and the JSON of the same example to the same topology", () => {
    const fromJson = readTopologyText(fixture("oracle/howto_flow_with_conditional_branches.json"), { filename: "flow.json" }).topology;
    const fromYaml = readTopologyText(flow, { filename: "flow.yaml" }).topology;
    // Oracle generated each twin with its own ids; everything else is the same.
    const shape = (t: Topology) => ({ names: t.nodes.map((n) => n.name), ways: t.waysBack.map((w) => w.label), wires: t.wires.length });
    expect(shape(fromJson)).toEqual(shape(fromYaml));
  });

  it("runs the imported flow: the decision's no sends the work back, its yes ends the run", async () => {
    const t = readTopologyText(flow, { filename: "flow.yaml" }).topology;
    let decisions = 0;
    const provider = scriptedProvider((call) => {
      if (call.system.includes("take a decision")) return ++decisions === 1 ? "no" : "yes";
      if (call.system.includes("highly skilled code reviewer")) return "REVIEW-MARK: handle the empty list";
      return "CODE-MARK: def f(): pass";
    });
    const session = new AgentSession({ provider, tools: createDefaultToolkit(), topology: t, workingDir: "/tmp", delayMs: 0 });
    const run = await session.run("Write a function that sums a list.");
    expect(run.result.totalCycles).toBe(2);
    expect(decisions).toBe(2);
    // The generator reads the task, and in round 2 the review and the decision that sent it back.
    const generator = provider.calls.filter((c) => c.system.includes("Please write the python code"));
    expect(generator[0].prompt).toContain("sums a list");
    expect(generator[1].prompt).toContain("REVIEW-MARK");
    expect(generator[1].prompt).toContain("## What check-if-code-is-ready-node wrote\n\nno");
    expect(generator[1].prompt).toContain("## Your previous answer\n\nCODE-MARK");
  });

  it("reads a standalone agent as one Do role", () => {
    const t = readTopologyText(fixture("oracle/howto_agents.yaml"), { filename: "agent.yaml" }).topology;
    expect(t.nodes).toHaveLength(1);
    expect(t.nodes[0].category).toBe("execution");
    expect(String(t.nodes[0].metadata?.systemMessage)).toContain("helpful");
  });

  it("writes an imported topology back as Agent Spec with the extension, which reads back the same", () => {
    const t = readTopologyText(flow, { filename: "flow.yaml" }).topology;
    const yaml = writeTopologyText(t).text;
    expect(validateTopologyText(yaml, { syntax: "yaml" }).issues).toEqual([]);
    expect(readTopologyText(yaml, { syntax: "yaml" }).topology).toEqual(t);
  });
});

describe("the legacy recipes, for migration", () => {
  it("converts a legacy recipe to Agent Spec, and says what the recipe could not hold", () => {
    const base = builtins.find((t) => t.id === "exec-eval")!;
    const withConsult: Topology = {
      ...base,
      consults: [{ id: "ask", from: "exec", limit: 2, sees: ["task", "transcript"], label: "asks", role: { id: "adv", name: "Adv", description: "advises", face: { label: "Advisor", icon: "✦", sentence: "advises" } } }],
    };
    const back = convertTopologyText(writeTopologyText(withConsult).text, { dialect: "legacy", syntax: "json" });
    expect(back.losses.map((l) => l.path)).toEqual(expect.arrayContaining(["/consults", "/faces"]));
  });
});

const dr = () => structuredClone(docOf("deep-reasoning"));
const agentSpecInvalid: InvalidCase[] = [
  { name: "a model without model_id", data: (() => { const d = dr(); delete d.$referenced_components["model.run"].model_id; return d; })(), path: "/$referenced_components/model.run", message: "model_id" },
  { name: "an unknown component type", data: (() => { const d = dr(); d.$referenced_components.start.component_type = "StartingNode"; return d; })(), path: "/$referenced_components/start/component_type", message: "not a component type" },
  { name: "a reference to nothing", data: (() => { const d = dr(); d.nodes[1] = { $component_ref: "nobody" }; return d; })(), path: "/nodes/1/$component_ref", message: "no component has the id" },
  { name: "a role in order with no AgentNode", data: (() => { const d = dr(); d.metadata.jig.order[1] = "ghost"; return d; })(), path: "/metadata/jig/order/1", message: "ghost" },
  { name: "a wire entry for no data edge", data: (() => { const d = dr(); d.metadata.jig.wires.ghost = {}; return d; })(), path: "/metadata/jig/wires/ghost", message: "no data edge" },
  { name: "a way back on a wire that does not exist", data: (() => { const d = dr(); d.metadata.jig.ways_back[0].wires = ["nope"]; return d; })(), path: "/metadata/jig/ways_back/0/wires/0", message: "no wire" },
  { name: "a data edge to a port the extension does not declare", data: (() => { const d = dr(); const e = d.data_flow_connections.find((x: any) => x.id === "w-plan-exec"); e.destination_input = "run_inputs"; return d; })(), path: "/data_flow_connections/0/destination_input", message: "not an input port" },
];
const legacyInvalid: InvalidCase[] = [
  { name: "a wire to a port no role has", data: (() => { const r = structuredClone(legacyRecipes.find((x) => x.id === "exec-eval")!); r.wires[0].targetPortId = "eval:in:nowhere"; return r; })(), path: "/wires/0/targetPortId", message: "not an input port" },
  { name: "a node without a type", data: (() => { const r = structuredClone(legacyRecipes[0]); delete r.nodes[0].type; return r; })(), path: "/nodes/0/type", message: "a node has a type" },
];

describe("every dialect's contract", () => {
  it("registers the Agent Spec and the legacy dialects", () => {
    expect(listDialects().map((d) => d.id)).toEqual(["agentspec", "legacy"]);
  });
  dialectContract(agentSpecDialect, builtins, agentSpecInvalid);
  dialectContract(legacyDialect, builtins, legacyInvalid);
});
