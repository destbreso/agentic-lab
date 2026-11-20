// ============================================
// The built-in topologies, read from their definition files
// ============================================
// Each built-in topology is a YAML file in packages/core/topologies, read
// through the formats module like any other definition. The list fixes the
// order the lab shows them in.

import { readFileSync } from "node:fs";
import { coreFile } from "./files.js";
import { readTopologyText } from "./index.js";
import type { Topology } from "./model.js";

export const BUILT_IN_TOPOLOGIES = [
  "ralph-loop",
  "full-agent-pipeline",
  "exec-eval",
  "deep-reasoning",
  "supervised-coder",
  "adversarial-duel",
  "advisor",
  "plan-execute",
  "reflexion",
] as const;

/** The file a built-in topology is defined in. */
export const builtinFile = (id: string, syntax: "yaml" | "json" = "yaml"): string => coreFile("topologies", `${id}.${syntax}`);

export function loadBuiltinTopologies(): Topology[] {
  return BUILT_IN_TOPOLOGIES.map((id) => {
    const file = builtinFile(id);
    const { topology } = readTopologyText(readFileSync(file, "utf-8"), { filename: file });
    if (topology.id !== id) throw new Error(`${file} defines "${topology.id}", not "${id}"`);
    return topology;
  });
}
