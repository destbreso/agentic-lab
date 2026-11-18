// The compact form the lab writes: every component written once and
// referenced wherever it is used, and nothing Agent Spec infers. It reads to
// the same topology as the full form, it is checked against the same rules
// (with the inferred inputs, outputs and branches), and a document whose top
// is itself a reference reads too.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { loadBuiltinTopologies, builtinFile } from "./builtin.js";
import { parseText, readTopologyText, validateAgentSpec, validateTopologyText, writeTopologyText } from "./index.js";

const builtins = loadBuiltinTopologies();
const docOf = (id: string) => YAML.parse(readFileSync(builtinFile(id), "utf-8")) as Record<string, any>;

/** Every component written inline in a document, by id, with how many times. */
function inlineComponents(node: unknown, out = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(node)) node.forEach((x) => inlineComponents(x, out));
  else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.component_type === "string" && typeof obj.id === "string") out.set(obj.id, (out.get(obj.id) ?? 0) + 1);
    for (const [k, v] of Object.entries(obj)) if (k !== "metadata") inlineComponents(v, out);
  }
  return out;
}

describe("the compact form", () => {
  it.each(builtins.map((t) => [t.id, t] as const))("%s: compact and full read to the same topology, with no warning and no loss", (_id, t) => {
    const compact = writeTopologyText(t).text;
    const full = writeTopologyText(t, { form: "expanded" }).text;
    expect(compact.split("\n").length).toBeLessThan(full.split("\n").length);
    for (const text of [compact, full]) {
      const read = readTopologyText(text, { syntax: "yaml" });
      expect(read.topology).toEqual(t);
      expect(read.warnings).toEqual([]);
      expect(read.losses).toEqual([]);
      expect(validateTopologyText(text, { syntax: "yaml" }).issues).toEqual([]);
      expect(validateAgentSpec(parseText(text, { syntax: "yaml" }).data as Record<string, unknown>)).toEqual([]);
    }
  });

  it.each(builtins.map((t) => [t.id]))("%s: each component is written once, and referenced everywhere else", (id) => {
    const doc = docOf(id);
    for (const [component, times] of inlineComponents(doc)) expect(times, component).toBe(1);
    // The tools and the run's model are defined once and shared by every agent that uses them.
    const agents = Object.values(doc.$referenced_components).filter((c: any) => c.component_type === "AgentNode").map((n: any) => n.agent);
    for (const a of agents) {
      expect(a.llm_config).toHaveProperty("$component_ref");
      for (const tool of a.tools) expect(Object.keys(tool)).toEqual(["$component_ref"]);
    }
  });

  it("leaves out only what Agent Spec infers, and says it the full form's way when asked", () => {
    const dr = builtins.find((t) => t.id === "deep-reasoning")!;
    const compact = writeTopologyText(dr, { syntax: "json" }).data as Record<string, any>;
    const full = writeTopologyText(dr, { syntax: "json", form: "expanded" }).data as Record<string, any>;
    const node = compact.$referenced_components.exec;
    // An AgentNode's inputs, outputs and branches are its agent's.
    expect(node.inputs).toBeUndefined();
    expect(node.branches).toBeUndefined();
    expect(full.$referenced_components.exec.inputs).toEqual(node.agent.inputs);
    expect(full.$referenced_components.exec.outputs).toEqual(node.agent.outputs);
    // A FlowNode's are its subflow's; a StartNode's outputs are its inputs; a flow's inputs are its start's.
    expect(compact.$referenced_components["rounds.refine"].branches).toBeUndefined();
    expect(full.$referenced_components["rounds.refine"].branches).toEqual(["again", "limit"]);
    expect(compact.$referenced_components.start.outputs).toBeUndefined();
    expect(full.$referenced_components.start.outputs).toEqual(compact.$referenced_components.start.inputs);
    expect(compact.inputs).toBeUndefined();
    // What inference cannot give back stays: an agent's inputs keep their defaults, a counter's end nodes their rounds.
    expect(node.agent.inputs[2]).toMatchObject({ title: "task", default: "" });
    expect(compact.$referenced_components.rounds.$referenced_components["rounds.next.3"].inputs[0].default).toBe("3");
  });

  it("checks edges against the inferred inputs and branches", () => {
    const doc = docOf("deep-reasoning");
    const edge = doc.data_flow_connections.find((e: any) => e.id === "w-exec-eval");
    edge.destination_input = "nowhere";
    const back = doc.control_flow_connections.find((e: any) => e.from_branch === "again");
    back.from_branch = "agian";
    const issues = validateTopologyText(JSON.stringify(doc), { syntax: "json" }).issues.filter((i) => i.severity === "error");
    expect(issues).toContainEqual(expect.objectContaining({ message: '"nowhere" is not an input of "eval"' }));
    expect(issues).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/"agian" is not a branch of "rounds\.[a-z-]+" \(again, limit\)/) }));
  });

  it("an edit to the agent a node infers from is a loss at the agent, not twice", () => {
    const doc = docOf("exec-eval");
    doc.$referenced_components.exec.agent.outputs[0].description = "changed";
    const read = readTopologyText(JSON.stringify(doc), { syntax: "json" });
    expect(read.losses.map((l) => l.path)).toEqual(["/$referenced_components/exec/agent/outputs/0/description"]);
  });

  it("reads a document whose top is a reference, and points its errors into it as written", () => {
    const doc = docOf("exec-eval");
    const { agentspec_version, $referenced_components, ...flow } = doc;
    const wrapped = { $component_ref: flow.id, $referenced_components: { [flow.id]: flow, ...$referenced_components }, agentspec_version };
    expect(validateAgentSpec(wrapped)).toEqual([]);
    const read = readTopologyText(JSON.stringify(wrapped), { syntax: "json" });
    expect(read.topology).toEqual(builtins.find((t) => t.id === "exec-eval"));
    expect(read.warnings).toEqual([]);

    wrapped.$referenced_components[flow.id].metadata.agentic_lab.order[1] = "ghost";
    delete wrapped.$referenced_components["model.run"].model_id;
    const schema = validateTopologyText(JSON.stringify(wrapped), { syntax: "json" }).issues;
    expect(schema).toContainEqual(expect.objectContaining({ path: "/$referenced_components/model.run", severity: "error" }));
    wrapped.$referenced_components["model.run"].model_id = "chosen-at-run";
    const text = JSON.stringify(wrapped, null, 2);
    const issues = validateTopologyText(text, { syntax: "json" }).issues;
    const ghost = issues.find((i) => i.message.includes("ghost"))!;
    expect(ghost.path).toBe("/$referenced_components/exec-eval/metadata/agentic_lab/order/1");
    expect(text.split("\n")[ghost.line! - 1]).toContain('"ghost"');
  });

  it("puts small things on one line in YAML, never a text of several lines", () => {
    const text = readFileSync(builtinFile("deep-reasoning"), "utf-8");
    expect(text).toMatch(/^ {2}- \{component_type: DataFlowEdge, id: w-plan-exec, name: w-plan-exec, /m);
    expect(text).not.toMatch(/\{[^}\n]*\\n/);
    expect(text).toMatch(/system_prompt: \|-\n/);
  });
});
