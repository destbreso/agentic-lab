// Gives every built-in topology's roles their brain, by the author's rule
// (2026-11-19): a role that produces work uses fast, one that verifies,
// judges or advises uses strong, a topology of a single role included (since
// 0.1.5, when default stopped being a brain of its own). A role that makes no
// model call gets no brain; no built-in role is one today.
// Run after a change to the rule, then npm run topologies for the JSON twins.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTopologyText, writeTopologyText } from "../dist/formats/index.js";
import { brainForRole } from "../dist/formats/brains.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "topologies");
const headerOf = (text) => text.split("\n").filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("#"))).map((l) => l.replace(/^# ?/, "")).join("\n");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  const path = join(dir, file);
  const text = readFileSync(path, "utf-8");
  const { topology } = readTopologyText(text, { filename: file });
  for (const n of topology.nodes) {
    const brain = brainForRole(topology, n.category);
    const { brain: _old, ...rest } = n.config.brain ?? {};
    n.config = { ...n.config, ...(brain ? { brain: { ...rest, brain } } : {}) };
  }
  for (const c of topology.consults) c.role.brain = { ...(c.role.brain ?? {}), brain: brainForRole(topology, "consulted") };
  writeFileSync(path, writeTopologyText(topology, { syntax: "yaml", header: headerOf(text) }).text);
  console.log(`${file}: ${topology.nodes.map((n) => `${n.id} ${n.config.brain?.brain ?? "none"}`).join(", ")}${topology.consults.map((c) => `, ${c.role.id} ${c.role.brain?.brain}`).join("")}`);
}
