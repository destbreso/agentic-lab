// ============================================
// Which brain a built-in role takes (the author's rule, 2026-11-19)
// ============================================
// A role that produces work (Plan, Do, Memory and their kin) uses fast; a
// role that verifies, judges or advises (Check, Critique, Decide, an Advisor)
// uses strong; a topology of a single role keeps default, so a baseline is
// never confounded with a team's verifier; a role that makes no model call
// gets none. Experiments will set models explicitly.

import type { LoopCategory } from "../types/pipeline.js";
import type { Topology } from "./model.js";

const PRODUCES: ReadonlySet<string> = new Set(["planning", "execution", "memory"]);
const JUDGES: ReadonlySet<string> = new Set(["evaluation", "critic", "refinement"]);

/** The brain for a role of a topology, by its category; "consulted" is a role another consults. */
export function brainForRole(t: Pick<Topology, "nodes">, category: LoopCategory | "consulted", callsAModel = true): "default" | "fast" | "strong" | undefined {
  if (!callsAModel) return undefined;
  if (category === "consulted") return "strong";
  if (t.nodes.length === 1) return "default";
  if (JUDGES.has(category)) return "strong";
  if (PRODUCES.has(category)) return "fast";
  return undefined;
}
