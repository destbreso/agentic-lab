// The built-in topologies' brains, by the author's rule (2026-11-19): a role
// that produces work uses fast, one that verifies, judges or advises uses
// strong, a topology of a single role is no exception, and a role that makes
// no model call gets none. Every file still validates, and keeps its brains
// through a round trip.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BUILT_IN_TOPOLOGIES, builtinFile, loadBuiltinTopologies } from "./builtin.js";
import { readTopologyText, validateTopologyText, writeTopologyText } from "./index.js";
import { brainForRole } from "./brains.js";

const EXPECTED: Record<string, Record<string, string>> = {
  "ralph-loop": { exec: "fast" },
  "full-agent-pipeline": { planner: "fast", executor: "fast", evaluator: "strong", critic: "strong", memory: "fast" },
  "exec-eval": { exec: "fast", eval: "strong" },
  "deep-reasoning": { plan: "fast", exec: "fast", eval: "strong", critic: "strong", refine: "strong" },
  "supervised-coder": { planner: "fast", coder: "fast", reviewer: "strong" },
  "adversarial-duel": { arena: "fast", alpha: "fast", beta: "fast", arbiter: "strong" },
  advisor: { exec: "fast", advisor: "strong" },
  "plan-execute": { planner: "fast", coder: "fast" },
  reflexion: { exec: "fast", eval: "strong", memory: "fast" },
};

describe("the built-in topologies' brains", () => {
  it("give every role the brain the rule says, and nothing else about its model", () => {
    const seen: Record<string, Record<string, string>> = {};
    for (const t of loadBuiltinTopologies()) {
      seen[t.id] = {};
      for (const n of t.nodes) seen[t.id][n.id] = n.config.brain?.brain ?? "none";
      for (const c of t.consults) seen[t.id][c.role.id] = c.role.brain?.brain ?? "none";
      for (const n of t.nodes) expect(n.config.brain, `${t.id}/${n.id}`).toEqual({ brain: EXPECTED[t.id][n.id] });
    }
    expect(seen).toEqual(EXPECTED);
  });

  it("gives no brain to a role that makes no model call, and fast to the Do of a topology of one role, as in a team", () => {
    const one = { nodes: [{}] } as never;
    const team = { nodes: [{}, {}] } as never;
    expect(brainForRole(team, "evaluation", false)).toBeUndefined();
    expect(brainForRole(one, "execution")).toBe("fast");
    expect(brainForRole(one, "consulted")).toBe("strong");
    expect(brainForRole(team, "custom")).toBeUndefined();
  });

  it.each(BUILT_IN_TOPOLOGIES)("%s still validates in YAML and JSON, and keeps its brains through a round trip", (id) => {
    for (const syntax of ["yaml", "json"] as const) {
      const text = readFileSync(builtinFile(id, syntax), "utf-8");
      expect(validateTopologyText(text, { filename: `${id}.${syntax}` }).valid).toBe(true);
      const read = readTopologyText(text, { filename: `${id}.${syntax}` });
      expect(read.losses).toEqual([]);
      const again = readTopologyText(writeTopologyText(read.topology, { syntax }).text, { filename: `x.${syntax}` }).topology;
      expect(again.nodes.map((n) => n.config.brain)).toEqual(read.topology.nodes.map((n) => n.config.brain));
    }
  });
});
