// ============================================
// The topology model: what every format reads into and writes from
// ============================================
// A Topology is the lab's internal model of a definition, validated. It is a
// Recipe (the roles, their ports and wires, the limits the engine runs on)
// plus what the drawing and the consult edge need: each role's face, the ways
// back with their conditions, the edges drawn as "also", the consult edges and
// the exit. The engine sees only this model; files are the formats module's.

import type { LoopCategory, NodeBrainConfig, Recipe, Wire } from "../types/pipeline.js";

/** How a role is shown and introduced: a short name, an icon, one sentence. */
export interface RoleFace {
  label: string;
  icon: string;
  sentence: string;
}

/** A way back: the deciding role sends the work back and the next round starts at `to`. */
export interface WayBack {
  id: string;
  /** The deciding role. */
  from: string;
  /** Where the next round starts. */
  to: string;
  /** The condition, short, as drawn on the arc ("refine: back to Do"). */
  label: string;
  /** The condition in full, one sentence. */
  when: string;
  /** The lab's wires that carry it; empty for a loop driven by the plan file. */
  wires: string[];
}

/** A secondary edge, drawn dotted under the boxes: a wire back that starts no round. */
export interface AlsoEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  wires: string[];
}

/** What a consulted role is shown when it is called. */
export type ConsultSight = "task" | "question" | "transcript" | "tool_results" | "checks";

export const CONSULT_SIGHTS: readonly ConsultSight[] = ["task", "question", "transcript", "tool_results", "checks"];

/** The sight the real advisor tool has: the caller's whole transcript, nothing it passes. */
export const FULL_SIGHT: readonly ConsultSight[] = ["task", "transcript"];

/** A role that runs only when another role consults it. */
export interface ConsultedRole {
  id: string;
  name: string;
  description: string;
  face: RoleFace;
  /** Its own model; the run's when absent. */
  brain?: NodeBrainConfig;
  /** Its instructions; the lab's advisor prompt when absent. */
  systemMessage?: string;
  /** The longest answer it may give, in tokens. */
  maxTokens?: number;
}

/** The calling role decides when to consult another role, at most `limit` times a turn. */
export interface ConsultEdge {
  id: string;
  /** The calling role. */
  from: string;
  role: ConsultedRole;
  limit: number;
  /** What the consulted role sees of the caller's turn. */
  sees: ConsultSight[];
  /** As drawn beside the edge ("asks when it wants ∙ 3 a turn"). */
  label: string;
}

/** How a run of the topology ends, as drawn after the last role. */
export interface Exit {
  label: string;
  when: string[];
}

export interface Topology extends Recipe {
  faces: Record<string, RoleFace>;
  waysBack: WayBack[];
  also: AlsoEdge[];
  consults: ConsultEdge[];
  exit: Exit;
}

/** The face a role gets when its definition gives none. */
export const DEFAULT_FACES: Record<LoopCategory, { label: string; icon: string }> = {
  planning: { label: "Plan", icon: "≣" },
  execution: { label: "Do", icon: ">" },
  evaluation: { label: "Check", icon: "⊢" },
  critic: { label: "Critique", icon: "◉" },
  refinement: { label: "Decide", icon: "◊" },
  memory: { label: "Memory", icon: "⊞" },
  custom: { label: "Role", icon: "◦" },
};

export const ADVISOR_FACE: RoleFace = {
  label: "Advisor",
  icon: "✦",
  sentence: "Advisor is consulted when the caller wants, and answers with advice only.",
};

/** The role whose ways back start the next round: the last Decide in the drawn order, else the last Check. */
export function deciderOf(recipe: Pick<Recipe, "nodes">): string | null {
  const last = (category: LoopCategory) => recipe.nodes.filter((n) => n.category === category).at(-1)?.id;
  return last("refinement") ?? last("evaluation") ?? null;
}

export const nodeOfPort = (portId: string): string => {
  const out = portId.indexOf(":out:");
  if (out >= 0) return portId.slice(0, out);
  const inp = portId.indexOf(":in:");
  if (inp >= 0) return portId.slice(0, inp);
  return portId.split(":")[0];
};

export const portNameOf = (portId: string): string => portId.replace(/^.*?:(?:in|out):/, "");

/** Wires that point to the same or an earlier role in the drawn order: the engine's ways back. */
export function backWires(recipe: Pick<Recipe, "nodes" | "wires">): Array<Pick<Wire, "id" | "sourcePortId" | "targetPortId">> {
  const rank = new Map(recipe.nodes.map((n, i) => [n.id, i]));
  return recipe.wires.filter((w) => {
    const from = rank.get(nodeOfPort(w.sourcePortId));
    const to = rank.get(nodeOfPort(w.targetPortId));
    return from !== undefined && to !== undefined && to <= from && w.enabled !== false;
  });
}

/** One problem in a document, at the exact place: a JSON Pointer, and a line when the text gives one. */
export interface FormatIssue {
  /** JSON Pointer (RFC 6901) into the document; "" is the whole document. */
  path: string;
  message: string;
  severity: "error" | "warning";
  line?: number;
  column?: number;
}

/**
 * What a conversion loses. "dropped": the written document does not hold it.
 * "ignored": the document holds it only in the lab's extension, so another
 * runtime reading the document ignores it.
 */
export interface Loss {
  path: string;
  what: string;
  kind: "dropped" | "ignored";
}

export class FormatError extends Error {
  constructor(readonly issues: FormatIssue[], prefix = "Invalid document") {
    super(`${prefix}:\n${issues.map(describeIssue).join("\n")}`);
    this.name = "FormatError";
  }
}

export function describeIssue(issue: FormatIssue): string {
  const at = issue.line !== undefined ? `line ${issue.line}${issue.column !== undefined ? `:${issue.column}` : ""}, ` : "";
  return `  ${issue.severity === "error" ? "✗" : "!"} ${at}${issue.path || "(document)"}: ${issue.message}`;
}

/** Escape one JSON Pointer token. */
export const pointerToken = (token: string | number): string => String(token).replace(/~/g, "~0").replace(/\//g, "~1");

export const pointer = (...tokens: Array<string | number>): string => tokens.map((t) => `/${pointerToken(t)}`).join("");

export const issue = (path: string, message: string, severity: FormatIssue["severity"] = "error"): FormatIssue => ({
  path,
  message,
  severity,
});
