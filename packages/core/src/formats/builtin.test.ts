// The built-in topologies are definition files. Each migrated one produces
// the nodes, wires and limits its old recipe did, and the same measured sight
// matrix; each JSON twin is what the round trip writes from the YAML file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_TOPOLOGIES, builtinFile, loadBuiltinTopologies } from "./builtin.js";
import { coreFile } from "./files.js";
import { parseText, readTopologyText, writeTopologyText } from "./index.js";
import { getRecipe, listRecipes } from "../loops/recipes.js";
import { measureSight, renderSight } from "../engine/sight.js";
import type { Recipe } from "../types/pipeline.js";

// The six recipes as recipes.ts defined them before the migration (dashes in five descriptions made colons).
const legacy = JSON.parse(readFileSync(join(coreFile("src", "formats", "__fixtures__"), "legacy-recipes.json"), "utf-8")) as Recipe[];
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** What phase 2 changed on purpose, by topology: nothing else may differ. */
const CHANGED: Record<string, { wires: string[]; ports: Array<[string, string]> }> = {};

describe("the built-in topologies are definition files", () => {
  it("the engine registers every file, in the listed order", () => {
    expect(listRecipes().map((r) => r.id).slice(0, BUILT_IN_TOPOLOGIES.length)).toEqual([...BUILT_IN_TOPOLOGIES]);
  });

  it.each(BUILT_IN_TOPOLOGIES.map((id) => [id]))("%s reads with no warning and no loss", (id) => {
    const read = readTopologyText(readFileSync(builtinFile(id), "utf-8"), { filename: `${id}.yaml` });
    expect(read.warnings).toEqual([]);
    expect(read.losses).toEqual([]);
  });

  it.each(BUILT_IN_TOPOLOGIES.map((id) => [id]))("%s: the JSON twin is what the round trip writes, and the same document", (id) => {
    const yaml = readFileSync(builtinFile(id), "utf-8");
    const json = readFileSync(builtinFile(id, "json"), "utf-8");
    const fromYaml = readTopologyText(yaml, { filename: `${id}.yaml` }).topology;
    expect(json).toBe(writeTopologyText(fromYaml, { syntax: "json" }).text);
    expect(parseText(yaml, { syntax: "yaml" }).data).toEqual(parseText(json, { syntax: "json" }).data);
    // And back: JSON to YAML to the same document.
    const fromJson = readTopologyText(json, { filename: `${id}.json` }).topology;
    expect(parseText(writeTopologyText(fromJson, { syntax: "yaml" }).text, { syntax: "yaml" }).data).toEqual(parseText(json, { syntax: "json" }).data);
  });
});

describe("each migrated recipe and its definition file", () => {
  const files = new Map(loadBuiltinTopologies().map((t) => [t.id, t]));

  it.each(legacy.map((r) => [r.id, r] as const))("%s: the same nodes, wires and limits", (id, old) => {
    const now = plain(files.get(id)!);
    const changed = CHANGED[id] ?? { wires: [], ports: [] };
    const nodes = now.nodes.map((n) => ({
      ...n,
      ports: {
        ...n.ports,
        inputs: n.ports.inputs.filter((p) => !changed.ports.some(([role, port]) => role === n.id && port === p.name)),
      },
    }));
    expect(nodes).toEqual(plain(old.nodes));
    expect(now.wires.filter((w) => !changed.wires.includes(w.id))).toEqual(plain(old.wires));
    expect(now.wires.filter((w) => changed.wires.includes(w.id)).map((w) => w.id)).toEqual(changed.wires);
    expect(now.defaults).toEqual(plain(old.defaults));
    expect(now.parameters).toEqual(plain(old.parameters));
    expect({ id: now.id, name: now.name, description: now.description, version: now.version, tags: now.tags, category: now.category }).toEqual({
      id: old.id,
      name: old.name,
      description: old.description,
      version: old.version,
      tags: old.tags,
      category: old.category,
    });
  });

  it.each(legacy.map((r) => [r.id, r] as const))("%s: the same measured sight matrix", async (id, old) => {
    const before = await measureSight(old);
    const after = await measureSight(getRecipe(id)!);
    expect(after.roles.map((r) => r.id)).toEqual(before.roles.map((r) => r.id));
    for (const row of before.rows) {
      for (const role of before.roles) {
        expect(after.cells[row.key][role.id], `${row.key} → ${role.id}`).toBe(before.cells[row.key][role.id]);
      }
    }
    expect(renderSight(after)).toBe(renderSight(before));
  });
});
