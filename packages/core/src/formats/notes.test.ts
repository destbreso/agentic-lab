// What a topology is meant for, and the research behind it: every built-in topology carries both, they make the
// round trip, and the schema refuses a reference with no address.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BUILT_IN_TOPOLOGIES, builtinFile, loadBuiltinTopologies } from "./builtin.js";
import { readTopologyText, validateTopologyText, writeTopologyText } from "./index.js";

describe("what a topology is meant for, and its research", () => {
  it("every built-in topology says what it is meant for and cites research at a real address", () => {
    for (const t of loadBuiltinTopologies()) {
      expect(t.recommendedFor?.length, t.id).toBeGreaterThan(0);
      expect(t.references?.length, t.id).toBeGreaterThan(0);
      for (const r of t.references ?? []) {
        expect(r.url, `${t.id}: ${r.title}`).toMatch(/^https:\/\//);
        expect(r.title.trim(), t.id).not.toBe("");
      }
    }
  });

  it.each(BUILT_IN_TOPOLOGIES.map((id) => [id]))("%s keeps both through a round trip in YAML and JSON", (id) => {
    const { topology } = readTopologyText(readFileSync(builtinFile(id, "yaml"), "utf-8"), { filename: `${id}.yaml` });
    for (const syntax of ["yaml", "json"] as const) {
      const again = readTopologyText(writeTopologyText(topology, { syntax }).text, { filename: `${id}.${syntax}` }).topology;
      expect(again.recommendedFor).toEqual(topology.recommendedFor);
      expect(again.references).toEqual(topology.references);
    }
  });

  it("refuses a reference with no address, at its exact path", () => {
    const text = readFileSync(builtinFile("exec-eval", "yaml"), "utf-8").replace("        url: https://www.anthropic.com/engineering/building-effective-agents\n", "");
    const result = validateTopologyText(text, { filename: "exec-eval.yaml" });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result.issues)).toMatch(/references\/0/);
  });
});
