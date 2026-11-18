// ============================================
// The Agent Spec 26.3.1 dialect, with the lab's extension
// ============================================

import { FormatError, issue, type FormatIssue, type Topology } from "../model.js";
import { AGENTSPEC_VERSION, validateAgentSpec } from "../schemas.js";
import { assertModel, type DialectPlugin, type DialectRead } from "../dialect.js";
import { checkAgentSpecSemantics } from "./agentspec-semantics.js";
import { readWithExtension } from "./agentspec-read.js";
import { importPlain } from "./agentspec-import.js";
import { ignoredElsewhere, writeAgentSpec } from "./agentspec-write.js";
import type { Json } from "./agentspec-refs.js";

const isObject = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

function hasExtension(doc: Json): boolean {
  return isObject(doc.metadata) && (doc.metadata as Json).agentic_lab !== undefined;
}

function checkVersion(doc: Json): FormatIssue[] {
  const version = doc.agentspec_version;
  if (version === undefined) {
    return [issue("/agentspec_version", `no agentspec_version: read as ${AGENTSPEC_VERSION}, the version this dialect is pinned to`, "warning")];
  }
  if (version !== AGENTSPEC_VERSION) {
    return [issue("/agentspec_version", `written for Agent Spec ${String(version)}; this dialect reads ${AGENTSPEC_VERSION}, and versions may differ in breaking ways`, "warning")];
  }
  return [];
}

function validate(data: unknown): FormatIssue[] {
  if (!isObject(data)) return [issue("", "an Agent Spec document is an object")];
  const schema = validateAgentSpec(data);
  if (schema.some((i) => i.severity === "error")) return [...checkVersion(data), ...schema];
  const semantics = checkAgentSpecSemantics(data);
  const out = [...checkVersion(data), ...schema, ...semantics];
  if (semantics.some((i) => i.severity === "error")) return out;
  const read = hasExtension(data) ? readWithExtension(data) : importPlain(data);
  return [...out, ...read.issues];
}

export const agentSpecDialect: DialectPlugin = {
  id: "agentspec",
  title: `Agent Spec ${AGENTSPEC_VERSION} with the lab's extension`,
  writes: true,
  recognise: (data) => isObject(data) && (typeof data.component_type === "string" || typeof data.agentspec_version === "string"),
  validate,
  read(data): DialectRead {
    if (!isObject(data)) throw new FormatError([issue("", "an Agent Spec document is an object")]);
    const schema = validateAgentSpec(data);
    const semantics = schema.some((i) => i.severity === "error") ? [] : checkAgentSpecSemantics(data);
    const before = [...checkVersion(data), ...schema, ...semantics];
    if (before.some((i) => i.severity === "error")) throw new FormatError(before.filter((i) => i.severity === "error"));
    const outcome = hasExtension(data) ? readWithExtension(data) : importPlain(data);
    const all = [...before, ...outcome.issues];
    if (!outcome.topology || all.some((i) => i.severity === "error")) throw new FormatError(all.filter((i) => i.severity === "error"));
    assertModel(outcome.topology, "an Agent Spec document");
    return { topology: outcome.topology, warnings: all.filter((i) => i.severity === "warning"), losses: outcome.losses };
  },
  write(topology: Topology) {
    const { data } = writeAgentSpec(topology);
    return { data, losses: ignoredElsewhere(topology) };
  },
};
