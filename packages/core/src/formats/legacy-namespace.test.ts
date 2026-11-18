// A topology file written before the rename (metadata.agentic_lab, profile
// agentic-lab/topology@1, tools executed by "agentic-lab") reads to the same
// topology, says so in a warning, points its errors at the old key, and is
// written back under metadata.jig.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { readTopologyText, writeTopologyText } from "./index.js";
import { builtinFile } from "./builtin.js";

describe("a topology file written before the rename", () => {
  it.each(["deep-reasoning", "advisor"])("%s under metadata.agentic_lab reads to the same topology, with a warning, and is written back under metadata.jig", (id) => {
    const today = readFileSync(builtinFile(id), "utf-8");
    const doc = YAML.parse(today);
    const { jig, ...rest } = doc.metadata;
    doc.metadata = { ...rest, agentic_lab: { ...jig, profile: "agentic-lab/topology@1" } };
    const old = YAML.stringify(doc).replace(/executor_name: jig/g, "executor_name: agentic-lab").replace(/tool_type: jig\.consult/g, "tool_type: agentic_lab.consult");
    expect(old).not.toMatch(/\bjig\b/);
    const read = readTopologyText(old, { filename: `${id}.yaml` });
    expect(read.warnings.map((w) => w.path)).toEqual(["/metadata/agentic_lab"]);
    expect(read.losses).toEqual([]);
    expect(read.topology).toEqual(readTopologyText(today, { filename: `${id}.yaml` }).topology);
    expect(writeTopologyText(read.topology, { syntax: "yaml" }).text).toMatch(/^ {2}jig:\n {4}profile: jig\/topology@1/m);
  });

  it("points an error in an old document at its old key", () => {
    const doc = YAML.parse(readFileSync(builtinFile("deep-reasoning"), "utf-8"));
    const { jig, ...rest } = doc.metadata;
    doc.metadata = { ...rest, agentic_lab: { ...jig, profile: "agentic-lab/topology@1", order: ["plan", "ghost", "eval", "critic", "refine"] } };
    const read = (() => {
      try {
        return readTopologyText(YAML.stringify(doc), { filename: "x.yaml" });
      } catch (e) {
        return e as { issues: Array<{ path: string }> };
      }
    })();
    expect(JSON.stringify(read)).toContain("/metadata/agentic_lab/order/1");
  });
});
