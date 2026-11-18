// ============================================
// A topology on the command line: a built-in id or a definition file
// ============================================
// A file is read through the core's formats module, in any syntax and
// dialect it knows; its warnings go to the caller, never silently dropped.

import { existsSync } from "fs";
import * as path from "path";
import {
  BUILT_IN_TOPOLOGIES,
  describeIssue,
  getRecipe,
  listRecipes,
  readTopologyFile,
  type FormatIssue,
  type Loss,
  type Topology,
} from "jig-core";

export interface ResolvedTopology {
  topology: Topology;
  /** Where it came from: "built in" or the file's path. */
  source: string;
  builtIn: boolean;
  warnings: FormatIssue[];
  losses: Loss[];
}

export async function resolveTopology(arg: string, cwd = process.cwd()): Promise<ResolvedTopology> {
  const file = path.resolve(cwd, arg);
  const looksLikeFile = /[\\/]|\.(ya?ml|json)$/i.test(arg);
  if (looksLikeFile || (!getRecipe(arg) && existsSync(file))) {
    if (!existsSync(file)) throw new Error(`No file ${arg}`);
    const read = await readTopologyFile(file);
    return { topology: read.topology, source: path.basename(file), builtIn: false, warnings: read.warnings, losses: read.losses };
  }
  const topology = getRecipe(arg);
  if (!topology) {
    throw new Error(`Unknown topology "${arg}". Available: ${listRecipes().map((r) => r.id).join(", ")}; or give a .yaml or .json file`);
  }
  const builtIn = (BUILT_IN_TOPOLOGIES as readonly string[]).includes(arg);
  return { topology, source: builtIn ? `topologies/${arg}.yaml` : "registered in code", builtIn, warnings: [], losses: [] };
}

export const formatIssues = (issues: FormatIssue[]): string => issues.map(describeIssue).join("\n");
