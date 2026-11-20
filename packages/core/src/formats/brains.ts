// ============================================
// Which brain a built-in role takes (the author's rule, 2026-11-19)
// ============================================
// A role that produces work (Plan, Do, Memory and their kin) uses fast; a
// role that verifies, judges or advises (Check, Critique, Decide, an Advisor)
// uses strong; a role that makes no model call gets none. A topology of a
// single role is no exception: its Do uses fast, as Do does in a team, so a
// baseline and a team differ by their roles and not by Do's model (the author,
// 2026-11-19, when default stopped being a choice of its own). Experiments
// will set models explicitly.

import type { RoleCategory } from "../types/pipeline.js";
import type { Topology } from "./model.js";

const PRODUCES: ReadonlySet<string> = new Set(["planning", "execution", "memory"]);
const JUDGES: ReadonlySet<string> = new Set(["evaluation", "critic", "refinement"]);

/** The brain for a role of a topology, by its category; "consulted" is a role another consults. */
export function brainForRole(_t: Pick<Topology, "nodes">, category: RoleCategory | "consulted", callsAModel = true): "fast" | "strong" | undefined {
  if (!callsAModel) return undefined;
  if (category === "consulted") return "strong";
  if (JUDGES.has(category)) return "strong";
  if (PRODUCES.has(category)) return "fast";
  return undefined;
}
