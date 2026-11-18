// ============================================
// A drawing for a recipe that has none
// ============================================
// A legacy recipe (or one built in code) says nothing of faces, ways back or
// the exit. These are derived from what the engine will do: the deciding
// role's wires back are ways back, every other wire back is drawn as "also",
// a repeat until the plan is done is a way back from the last role to the
// first, and the exit names the rule that ends the run. Plain, generic words:
// a definition file is where better ones are written.

import type { Recipe } from "../types/pipeline.js";
import { DEFAULT_FACES, backWires, deciderOf, nodeOfPort, type AlsoEdge, type Exit, type RoleFace, type Topology, type WayBack } from "./model.js";

export function defaultFaces(recipe: Pick<Recipe, "nodes">): Record<string, RoleFace> {
  const count = new Map<string, number>();
  for (const n of recipe.nodes) count.set(n.category, (count.get(n.category) ?? 0) + 1);
  return Object.fromEntries(
    recipe.nodes.map((n) => {
      const base = DEFAULT_FACES[n.category] ?? DEFAULT_FACES.custom;
      // Two roles of one kind keep their own names, so they can be told apart.
      const label = (count.get(n.category) ?? 0) > 1 ? n.name : base.label;
      return [n.id, { label, icon: base.icon, sentence: n.description }];
    }),
  );
}

export function deriveDrawing(recipe: Recipe): Pick<Topology, "faces" | "waysBack" | "also" | "consults" | "exit"> {
  const faces = defaultFaces(recipe);
  const label = (id: string) => faces[id]?.label ?? id;
  const decider = deciderOf(recipe);
  const groups = new Map<string, { from: string; to: string; wires: string[] }>();
  for (const w of backWires(recipe)) {
    const from = nodeOfPort(w.sourcePortId);
    const to = nodeOfPort(w.targetPortId);
    const key = `${from}>${to}`;
    const g = groups.get(key) ?? { from, to, wires: [] };
    g.wires.push(w.id);
    groups.set(key, g);
  }
  const waysBack: WayBack[] = [];
  const also: AlsoEdge[] = [];
  for (const g of groups.values()) {
    if (g.from === decider) {
      waysBack.push({ id: `back-to-${g.to}`, from: g.from, to: g.to, label: `back to ${label(g.to)}`, when: `${label(g.from)} sends the work back to ${label(g.to)}`, wires: g.wires });
    } else {
      also.push({ id: `also-${g.from}-${g.to}`, from: g.from, to: g.to, label: `also: ${label(g.from)} to ${label(g.to)}`, wires: g.wires });
    }
  }
  const rounds = recipe.defaults.maxCycles ?? 0;
  const first = recipe.nodes[0]?.id;
  const last = recipe.nodes.at(-1)?.id;
  if (recipe.defaults.repeat && first && last && !waysBack.length) {
    waysBack.push({ id: "again", from: last, to: first, label: "plan not done: again", when: "the plan file still has unchecked items", wires: [] });
  }
  const limit = rounds > 0 ? [`or round ${rounds}`] : [];
  let exit: Exit;
  if (recipe.defaults.repeat) exit = { label: "done", when: ["plan file done,", ...(rounds > 0 ? [`or turn ${rounds}`] : [])] };
  else if (decider && recipe.nodes.find((n) => n.id === decider)?.category === "refinement") exit = { label: "done", when: [`${label(decider)} converges,`, ...limit] };
  else if (decider) exit = { label: "done", when: [`${label(decider)} passes,`, ...limit] };
  else exit = { label: "done", when: ["after one round"] };
  return { faces, waysBack, also, consults: [], exit };
}

/** A recipe as a topology: its own drawing when it has one, a derived one otherwise. */
export function asTopology(recipe: Recipe | Topology): Topology {
  const t = recipe as Partial<Topology>;
  if (t.faces && t.waysBack && t.also && t.consults && t.exit) return recipe as Topology;
  return { ...recipe, ...deriveDrawing(recipe) };
}
