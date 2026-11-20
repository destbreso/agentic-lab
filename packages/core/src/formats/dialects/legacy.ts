// ============================================
// The legacy recipe dialect, for migration
// ============================================
// The recipe objects the lab defined in code before definition files, and the
// shape `pipelineToRecipe` still saves. Reading one derives a drawing for it
// (formats/derive.ts); writing one keeps only the recipe, and says what it
// drops: faces, the ways back's words, the also edges, the consult edges and
// the exit.

import type { Recipe } from "../../types/pipeline.js";
import { FormatError, issue, pointer, type FormatIssue, type Loss, type Topology } from "../model.js";
import { assertModel, type DialectPlugin } from "../dialect.js";
import { checkTopology } from "../check.js";
import { asTopology, deriveDrawing } from "../derive.js";

type Json = Record<string, unknown>;
const isObject = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

const RECIPE_KEYS = ["id", "name", "description", "version", "author", "tags", "category", "nodes", "wires", "defaults", "parameters", "createdAt", "updatedAt"] as const;
const DEFAULT_KEYS = new Set(["maxCycles", "delayMs", "repeat", "tokenBudget", "timeoutMs"]);

function shape(data: unknown): FormatIssue[] {
  if (!isObject(data)) return [issue("", "a recipe is an object")];
  const out: FormatIssue[] = [];
  for (const key of ["id", "name"] as const) if (typeof data[key] !== "string") out.push(issue(pointer(key), `a recipe has a ${key}`));
  if (!Array.isArray(data.nodes)) out.push(issue("/nodes", "a recipe has a list of nodes"));
  if (!Array.isArray(data.wires)) out.push(issue("/wires", "a recipe has a list of wires"));
  if (!isObject(data.defaults)) out.push(issue("/defaults", "a recipe has defaults"));
  (Array.isArray(data.nodes) ? data.nodes : []).forEach((n, i) => {
    if (!isObject(n)) return out.push(issue(pointer("nodes", i), "a node is an object"));
    for (const key of ["id", "type", "name", "category"] as const) {
      if (typeof n[key] !== "string") out.push(issue(pointer("nodes", i, key), `a node has a ${key}`));
    }
    if (!isObject(n.config)) out.push(issue(pointer("nodes", i, "config"), "a node has a config"));
    if (!isObject(n.ports) || !Array.isArray(n.ports.inputs) || !Array.isArray(n.ports.outputs)) {
      out.push(issue(pointer("nodes", i, "ports"), "a node lists its input and output ports"));
    }
  });
  (Array.isArray(data.wires) ? data.wires : []).forEach((w, i) => {
    if (!isObject(w)) return out.push(issue(pointer("wires", i), "a wire is an object"));
    for (const key of ["id", "sourcePortId", "targetPortId"] as const) {
      if (typeof w[key] !== "string") out.push(issue(pointer("wires", i, key), `a wire has a ${key}`));
    }
  });
  return out;
}

function toTopology(data: Json): Topology {
  const recipe = structuredClone(data) as unknown as Recipe;
  recipe.tags ??= [];
  recipe.description ??= "";
  recipe.version ??= "1.0.0";
  return { ...recipe, ...deriveDrawing(recipe) };
}

export const legacyDialect: DialectPlugin = {
  id: "legacy",
  title: "the lab's recipe objects, before definition files (for migration)",
  writes: true,
  recognise: (data) => isObject(data) && data.component_type === undefined && Array.isArray(data.nodes) && Array.isArray(data.wires),
  validate(data) {
    const problems = shape(data);
    if (problems.length) return problems;
    const extra = Object.keys((data as Json).defaults as Json).filter((k) => !DEFAULT_KEYS.has(k));
    return [
      ...checkTopology(toTopology(data as Json)),
      ...extra.map((k) => issue(pointer("defaults", k), `"${k}" is not a limit the lab's definition files keep`, "warning")),
    ];
  },
  read(data) {
    const problems = shape(data);
    if (problems.length) throw new FormatError(problems, "Not a recipe");
    const topology = toTopology(data as Json);
    assertModel(topology, "a recipe");
    const extra = Object.keys((data as Json).defaults as Json).filter((k) => !DEFAULT_KEYS.has(k));
    const losses: Loss[] = extra.map((k) => ({ path: pointer("defaults", k), what: `the default "${k}"`, kind: "dropped" }));
    for (const k of extra) delete (topology.defaults as Json)[k];
    return { topology, warnings: [], losses };
  },
  write(topology) {
    const t = asTopology(topology);
    const data: Json = {};
    for (const key of RECIPE_KEYS) if (t[key] !== undefined) data[key] = structuredClone(t[key]);
    const derived = deriveDrawing(t);
    const losses: Loss[] = [];
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(t.faces, derived.faces)) losses.push({ path: "/faces", what: "each role's label, icon and sentence", kind: "dropped" });
    if (!same(t.waysBack, derived.waysBack)) losses.push({ path: "/waysBack", what: "the ways back's conditions in words", kind: "dropped" });
    if (!same(t.also, derived.also)) losses.push({ path: "/also", what: "the also edges' labels", kind: "dropped" });
    if (t.recommendedFor?.length) losses.push({ path: "/recommendedFor", what: "what the topology is meant for", kind: "dropped" });
    if (t.references?.length) losses.push({ path: "/references", what: `${t.references.length} reference(s) to research`, kind: "dropped" });
    if (t.consults.length) losses.push({ path: "/consults", what: `${t.consults.length} consult edge(s): a recipe has no way to hold them, and the run would not consult`, kind: "dropped" });
    if (!same(t.exit, derived.exit)) losses.push({ path: "/exit", what: "the exit's words", kind: "dropped" });
    return { data, losses };
  },
};
