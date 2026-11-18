// ============================================
// The contract every dialect plugin passes
// ============================================
// A plugin is registered only once it passes this, over the built-in
// topologies as fixtures and invalid documents of its own:
//   1. a round trip without loss, or with the loss declared: whatever the
//      model loses through the plugin's write and read is named by a "dropped"
//      loss whose path is where it was;
//   2. an invalid document is refused, with an error at the exact path;
//   3. JSON and YAML are equivalent: the same document in either syntax
//      reads to the same topology.

import { expect, it } from "vitest";
import { FormatError, readTopologyText, validateTopologyText, writeTopologyText, type DialectPlugin, type Topology } from "../formats/index.js";
import { differences } from "../formats/dialects/agentspec-read.js";

export interface InvalidCase {
  name: string;
  data: unknown;
  /** The JSON Pointer the error must be at. */
  path: string;
  /** A piece of the error's message. */
  message: string;
}

/** The model as data, without the undefined values JSON drops. */
const plain = (t: Topology) => JSON.parse(JSON.stringify(t)) as Record<string, unknown>;

export function dialectContract(plugin: DialectPlugin, fixtures: Topology[], invalid: InvalidCase[]): void {
  it.each(fixtures.map((t) => [t.id, t] as const))(`${plugin.id}: %s round-trips without loss or with the loss declared`, (_id, t) => {
    const written = plugin.write(t);
    const read = plugin.read(written.data);
    const dropped = written.losses.filter((l) => l.kind === "dropped").map((l) => l.path);
    for (const path of differences(plain(t), plain(read.topology))) {
      expect(
        dropped.some((d) => path === d || path.startsWith(`${d}/`)),
        `${path} changed in the round trip and no loss names it`,
      ).toBe(true);
    }
    // Writing what was read gives the same document: the round trip is stable.
    expect(plugin.write(read.topology).data).toEqual(written.data);
  });

  it.each(invalid.map((c) => [c.name, c] as const))(`${plugin.id}: refuses %s, at the exact path`, (_name, c) => {
    const issues = plugin.validate(c.data).filter((i) => i.severity === "error");
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^${c.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .*${c.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))]),
    );
    expect(() => plugin.read(c.data)).toThrow(FormatError);
  });

  it.each(fixtures.map((t) => [t.id, t] as const))(`${plugin.id}: %s reads the same in JSON and in YAML`, (_id, t) => {
    if (!plugin.writes) return;
    const json = writeTopologyText(t, { dialect: plugin.id, syntax: "json" }).text;
    const yaml = writeTopologyText(t, { dialect: plugin.id, syntax: "yaml" }).text;
    const fromJson = readTopologyText(json, { syntax: "json", dialect: plugin.id });
    const fromYaml = readTopologyText(yaml, { syntax: "yaml", dialect: plugin.id });
    expect(fromYaml.topology).toEqual(fromJson.topology);
    const said = (text: string, syntax: "json" | "yaml") =>
      validateTopologyText(text, { syntax, dialect: plugin.id }).issues.map((i) => [i.path, i.message, i.severity]);
    expect(said(yaml, "yaml")).toEqual(said(json, "json"));
  });
}
