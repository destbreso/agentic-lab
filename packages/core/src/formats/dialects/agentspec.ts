// ============================================
// The Agent Spec 26.3.1 dialect, with the lab's extension
// ============================================

import { FormatError, issue, pointerToken, type FormatIssue, type Topology } from "../model.js";
import { AGENTSPEC_VERSION, EXTENSION_KEY, LEGACY_EXTENSION_KEY, validateAgentSpec } from "../schemas.js";
import { assertModel, type DialectPlugin, type DialectRead } from "../dialect.js";
import { checkAgentSpecSemantics } from "./agentspec-semantics.js";
import { readWithExtension } from "./agentspec-read.js";
import { importPlain } from "./agentspec-import.js";
import { ignoredElsewhere, writeAgentSpec } from "./agentspec-write.js";
import type { Json } from "./agentspec-refs.js";

const isObject = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

function hasExtension(doc: Json): boolean {
  if (!isObject(doc.metadata)) return false;
  const meta = doc.metadata as Json;
  return meta[EXTENSION_KEY] !== undefined || meta[LEGACY_EXTENSION_KEY] !== undefined;
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

interface Root {
  doc: Json;
  /** A path in the document read, as a path in the document given. */
  at: (path: string) => string;
}

/**
 * The component a document is. Agent Spec lets a document's top be a
 * reference into its own $referenced_components ({"$component_ref": id,
 * "$referenced_components": {...}}); it is read as that component, and every
 * path it reports points back into the document as written.
 */
function rootOf(data: Json): Root {
  const ref = data.$component_ref;
  const refs = data.$referenced_components;
  if (typeof ref !== "string" || data.component_type !== undefined || !isObject(refs) || !isObject(refs[ref])) return { doc: data, at: (p) => p };
  const { [ref]: top, ...others } = refs as Record<string, Json>;
  const own = isObject(top.$referenced_components) ? (top.$referenced_components as Json) : {};
  const merged = { ...others, ...own };
  const doc: Json = { ...top, ...(Object.keys(merged).length ? { $referenced_components: merged } : {}) };
  if (data.agentspec_version !== undefined) doc.agentspec_version = data.agentspec_version;
  const base = `/$referenced_components/${pointerToken(ref)}`;
  const outside = new Set(Object.keys(others).filter((k) => !(k in own)).map(pointerToken));
  return {
    doc,
    at: (p) => {
      if (p === "/agentspec_version") return p;
      const m = /^\/\$referenced_components\/([^/]+)/.exec(p);
      return m && outside.has(m[1]) ? p : `${base}${p}`;
    },
  };
}

const moved = <T extends { path: string }>(list: T[], at: Root["at"]): T[] => list.map((x) => ({ ...x, path: at(x.path) }));

function validate(data: unknown): FormatIssue[] {
  if (!isObject(data)) return [issue("", "an Agent Spec document is an object")];
  const schema = validateAgentSpec(data);
  const { doc, at } = rootOf(data);
  if (schema.some((i) => i.severity === "error")) return [...checkVersion(doc), ...schema];
  const semantics = moved(checkAgentSpecSemantics(doc), at);
  const out = [...checkVersion(doc), ...schema, ...semantics];
  if (semantics.some((i) => i.severity === "error")) return out;
  const read = hasExtension(doc) ? readWithExtension(doc) : importPlain(doc);
  return [...out, ...moved(read.issues, at)];
}

export const agentSpecDialect: DialectPlugin = {
  id: "agentspec",
  title: `Agent Spec ${AGENTSPEC_VERSION} with the lab's extension`,
  writes: true,
  recognise: (data) =>
    isObject(data) && (typeof data.component_type === "string" || typeof data.agentspec_version === "string" || (typeof data.$component_ref === "string" && isObject(data.$referenced_components))),
  validate,
  read(data): DialectRead {
    if (!isObject(data)) throw new FormatError([issue("", "an Agent Spec document is an object")]);
    const schema = validateAgentSpec(data);
    const { doc, at } = rootOf(data);
    const semantics = schema.some((i) => i.severity === "error") ? [] : moved(checkAgentSpecSemantics(doc), at);
    const before = [...checkVersion(doc), ...schema, ...semantics];
    if (before.some((i) => i.severity === "error")) throw new FormatError(before.filter((i) => i.severity === "error"));
    const outcome = hasExtension(doc) ? readWithExtension(doc) : importPlain(doc);
    const all = [...before, ...moved(outcome.issues, at)];
    if (!outcome.topology || all.some((i) => i.severity === "error")) throw new FormatError(all.filter((i) => i.severity === "error"));
    assertModel(outcome.topology, "an Agent Spec document");
    return { topology: outcome.topology, warnings: all.filter((i) => i.severity === "warning"), losses: moved(outcome.losses, at) };
  },
  write(topology: Topology, options) {
    const { data } = writeAgentSpec(topology, { form: options?.form ?? "compact" });
    return { data, losses: ignoredElsewhere(topology) };
  },
};
