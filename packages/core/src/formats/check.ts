// ============================================
// The topology model, checked
// ============================================
// Whatever dialect a topology came from, the engine gets it only after these
// checks: ids unique, every wire between ports its roles declare, every way
// back and also edge on wires that exist and run back, consult edges from a
// role to a role that is not one, a face for every role. Paths are into the
// model, which is the legacy recipe's shape.

import { CONSULT_SIGHTS, backWires, issue, nodeOfPort, pointer, portNameOf, type FormatIssue, type Topology } from "./model.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CATEGORIES = new Set(["execution", "evaluation", "planning", "critic", "memory", "refinement", "custom"]);

export function checkTopology(t: Topology): FormatIssue[] {
  const out: FormatIssue[] = [];
  if (!t.id || !ID.test(t.id)) out.push(issue("/id", `"${t.id}" is not a topology id (letters, digits, - and _)`));
  if (!Array.isArray(t.nodes) || t.nodes.length === 0) out.push(issue("/nodes", "a topology has at least one role"));
  const ids = new Set<string>();
  (t.nodes ?? []).forEach((n, i) => {
    if (!ID.test(n.id)) out.push(issue(pointer("nodes", i, "id"), `"${n.id}" is not a role id (letters, digits, - and _)`));
    if (ids.has(n.id)) out.push(issue(pointer("nodes", i, "id"), `the role id "${n.id}" is used twice`));
    ids.add(n.id);
    if (!CATEGORIES.has(n.category)) out.push(issue(pointer("nodes", i, "category"), `"${n.category}" is not a role category`));
    for (const dir of ["inputs", "outputs"] as const) {
      const names = new Set<string>();
      (n.ports?.[dir] ?? []).forEach((p, j) => {
        if (names.has(p.name)) out.push(issue(pointer("nodes", i, "ports", dir, j, "name"), `the port "${p.name}" is declared twice`));
        names.add(p.name);
        if (!p.signalTypes?.length) out.push(issue(pointer("nodes", i, "ports", dir, j, "signalTypes"), "a port carries at least one signal type"));
      });
    }
    if (!t.faces?.[n.id]) out.push(issue(pointer("faces", n.id), `the role "${n.id}" has no face`));
  });
  const port = (portId: string, dir: "inputs" | "outputs") =>
    t.nodes.find((n) => n.id === nodeOfPort(portId))?.ports[dir].some((p) => p.name === portNameOf(portId));
  const wireIds = new Set<string>();
  (t.wires ?? []).forEach((w, i) => {
    if (wireIds.has(w.id)) out.push(issue(pointer("wires", i, "id"), `the wire id "${w.id}" is used twice`));
    wireIds.add(w.id);
    if (!/:out:/.test(w.sourcePortId) || !port(w.sourcePortId, "outputs")) {
      out.push(issue(pointer("wires", i, "sourcePortId"), `"${w.sourcePortId}" is not an output port of a role`));
    }
    if (!/:in:/.test(w.targetPortId) || !port(w.targetPortId, "inputs")) {
      out.push(issue(pointer("wires", i, "targetPortId"), `"${w.targetPortId}" is not an input port of a role`));
    }
  });
  const back = new Map(backWires(t).map((w) => [w.id, w]));
  const byId = new Map(t.wires.map((w) => [w.id, w]));
  const edges = (list: Topology["waysBack"] | Topology["also"], key: "waysBack" | "also") =>
    list.forEach((e, i) => {
      if (!ids.has(e.from)) out.push(issue(pointer(key, i, "from"), `"${e.from}" is not a role`));
      if (!ids.has(e.to)) out.push(issue(pointer(key, i, "to"), `"${e.to}" is not a role`));
      e.wires.forEach((wid, j) => {
        const w = byId.get(wid);
        if (!w) out.push(issue(pointer(key, i, "wires", j), `no wire "${wid}"`));
        else if (!back.has(wid)) out.push(issue(pointer(key, i, "wires", j), `the wire "${wid}" runs forward, not back`));
        else if (nodeOfPort(w.sourcePortId) !== e.from || nodeOfPort(w.targetPortId) !== e.to) {
          out.push(issue(pointer(key, i, "wires", j), `the wire "${wid}" does not run from ${e.from} to ${e.to}`));
        }
      });
    });
  edges(t.waysBack ?? [], "waysBack");
  edges(t.also ?? [], "also");
  (t.waysBack ?? []).forEach((w, i) => {
    if (w.wires.length === 0 && !t.defaults.repeat) {
      out.push(issue(pointer("waysBack", i, "wires"), "a way back with no wire is only the plan file's repeat, and this topology does not repeat"));
    }
  });
  const consulted = new Set<string>();
  (t.consults ?? []).forEach((c, i) => {
    if (!ids.has(c.from)) out.push(issue(pointer("consults", i, "from"), `"${c.from}" is not a role`));
    if (ids.has(c.role.id) || consulted.has(c.role.id)) out.push(issue(pointer("consults", i, "role", "id"), `"${c.role.id}" is already used`));
    consulted.add(c.role.id);
    if (!Number.isInteger(c.limit) || c.limit < 1) out.push(issue(pointer("consults", i, "limit"), "a consult limit is a whole number of calls, at least 1"));
    c.sees.forEach((s, j) => {
      if (!CONSULT_SIGHTS.includes(s)) out.push(issue(pointer("consults", i, "sees", j), `"${s}" is not something a consulted role can see`));
    });
  });
  const rounds = t.defaults?.maxCycles;
  if (rounds !== undefined && (!Number.isInteger(rounds) || rounds < 0)) out.push(issue("/defaults/maxCycles", "the round limit is a whole number, 0 for none"));
  return out;
}
