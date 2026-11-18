// ============================================
// The JSON Schemas a document is checked against
// ============================================
// Agent Spec 26.3.1's own schema, vendored unchanged (schemas/agentspec), and
// the lab's extension profile (schemas/jig-topology.schema.json).
// Both are compiled once, on first use.
//
// Agent Spec's schema is a tree of anyOf branches, one per component type.
// Collecting every error of such a tree is exponential, so a document is
// first validated stopping at the first error; only when it fails is each of
// its components validated alone, against the branch its component_type names,
// deepest first. The first component that fails on its own gives the error,
// at its exact path.

import Ajv2020Module, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { readCoreJson } from "./files.js";
import { issue, pointer, type FormatIssue } from "./model.js";

export const AGENTSPEC_VERSION = "26.3.1";
export const EXTENSION_PROFILE = "jig/topology@1";
/** The extension's metadata key, and its key and profile before the rename, which are still read. */
export const EXTENSION_KEY = "jig";
export const LEGACY_EXTENSION_KEY = "agentic_lab";
export const LEGACY_EXTENSION_PROFILE = "agentic-lab/topology@1";
const SCHEMA_KEY = "agentspec";

// Ajv is CommonJS; under NodeNext its default import is the module, whose default is the class.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as unknown as typeof Ajv2020Module.default;
type Ajv = InstanceType<typeof Ajv2020>;

function newAjv(allErrors: boolean): Ajv {
  // Formats are annotations here: Agent Spec's schema names "binary", which no validator checks.
  return new Ajv2020({ allErrors, strict: false, logger: false, validateFormats: false });
}

interface Loaded {
  ajv: Ajv;
  whole: ValidateFunction;
  /** The schema path of each component type's own branch. */
  branches: Map<string, string>;
  versions: string[];
}

let loaded: Loaded | null = null;
let extensionValidator: ValidateFunction | null = null;

type SchemaNode = { anyOf?: SchemaNode[]; enum?: string[]; properties?: Record<string, { const?: string }> };

function loadAgentSpec(): Loaded {
  if (loaded) return loaded;
  const schema = readCoreJson<{ $defs: Record<string, SchemaNode> }>(
    "schemas",
    "agentspec",
    AGENTSPEC_VERSION,
    `agentspec_json_spec_${AGENTSPEC_VERSION.replace(/\./g, "_")}.json`,
  );
  // A component type's branch: a $defs entry whose component_type is const, or an
  // inline anyOf member of a Base entry (a concrete parent type, such as LlmConfig).
  const branches = new Map<string, string>();
  for (const [name, def] of Object.entries(schema.$defs)) {
    const own = def.properties?.component_type?.const;
    if (typeof own === "string" && !branches.has(own)) branches.set(own, `#/$defs/${name}`);
    def.anyOf?.forEach((member, i) => {
      const inner = member.properties?.component_type?.const;
      if (typeof inner === "string" && !branches.has(inner)) branches.set(inner, `#/$defs/${name}/anyOf/${i}`);
    });
  }
  const ajv = newAjv(false);
  ajv.addSchema(schema, SCHEMA_KEY);
  const whole = ajv.getSchema(SCHEMA_KEY)!;
  loaded = { ajv, whole, branches, versions: schema.$defs.AgentSpecVersionEnum?.enum ?? [] };
  return loaded;
}

/** The component types Agent Spec 26.3.1 defines. */
export function agentSpecComponentTypes(): Set<string> {
  return new Set(loadAgentSpec().branches.keys());
}

function describe(error: ErrorObject, base: string, what: string): FormatIssue {
  const where = base + error.instancePath;
  switch (error.keyword) {
    case "required":
      return issue(where, `missing required property "${(error.params as { missingProperty: string }).missingProperty}" of ${what}`);
    case "additionalProperties": {
      const name = (error.params as { additionalProperty: string }).additionalProperty;
      return issue(`${where}${pointer(name)}`, `"${name}" is not a property of ${what}`);
    }
    case "const":
      return issue(where, `must be ${JSON.stringify((error.params as { allowedValue: unknown }).allowedValue)}`);
    case "enum":
      return issue(where, `must be one of ${((error.params as { allowedValues: unknown[] }).allowedValues ?? []).map((v) => JSON.stringify(v)).join(", ")}`);
    default:
      return issue(where, error.message ?? error.keyword);
  }
}

type Json = Record<string, unknown>;

/** Validate each component alone, deepest first; return the issues of the first that fails on its own. */
function locate(node: unknown, path: string, l: Loaded, out: FormatIssue[]): boolean {
  if (Array.isArray(node)) {
    let failed = false;
    node.forEach((item, i) => {
      if (!failed) failed = locate(item, `${path}/${i}`, l, out);
    });
    return failed;
  }
  if (!node || typeof node !== "object") return false;
  const obj = node as Json;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "metadata") continue;
    if (locate(value, `${path}${pointer(key)}`, l, out)) return true;
  }
  if (typeof obj.component_type !== "string") return false;
  const branch = l.branches.get(obj.component_type);
  if (!branch) {
    out.push(issue(`${path}/component_type`, `"${obj.component_type}" is not a component type of Agent Spec ${AGENTSPEC_VERSION}`));
    return true;
  }
  const validate = l.ajv.getSchema(`${SCHEMA_KEY}${branch}`)!;
  if (validate(obj)) return false;
  const errors = (validate.errors ?? []).filter((e) => e.keyword !== "anyOf" && e.keyword !== "oneOf");
  // An error on the component itself first; else the shallowest one under it.
  const own = errors.find((e) => e.instancePath === "") ?? [...errors].sort((a, b) => a.instancePath.length - b.instancePath.length)[0];
  if (own) {
    const found = describe(own, path, `a ${obj.component_type}`);
    out.push(own.instancePath === "" ? found : { ...found, message: `not valid here in a ${obj.component_type}: ${found.message}` });
  } else {
    out.push(issue(path, `does not match ${obj.component_type} in Agent Spec ${AGENTSPEC_VERSION}`));
  }
  return true;
}

/**
 * Validate a document against Agent Spec 26.3.1's schema. The schema as
 * published puts `agentspec_version` beside an anyOf whose branches forbid
 * extra properties, so a versioned document never validates as written; the
 * version is checked against the schema's own AgentSpecVersionEnum, and the
 * rest of the document against the schema (docs/FORMAT.md).
 */
export function validateAgentSpec(doc: unknown): FormatIssue[] {
  const l = loadAgentSpec();
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [issue("", "an Agent Spec document is an object")];
  const { agentspec_version: version, ...rest } = doc as Json;
  const issues: FormatIssue[] = [];
  if (version !== undefined && !l.versions.includes(String(version))) {
    issues.push(issue("/agentspec_version", `"${String(version)}" is not an Agent Spec version this schema knows (${l.versions.join(", ")})`));
  }
  if (l.whole(rest as unknown)) return issues;
  if (typeof (rest as Json).component_type !== "string" && !("$component_ref" in (rest as Json))) return [...issues, issue("", "missing component_type")];
  const found: FormatIssue[] = [];
  locate(rest, "", l, found);
  if (found.length === 0) {
    const first = (l.whole.errors ?? []).find((e) => e.keyword !== "anyOf");
    found.push(first ? describe(first, "", "the document") : issue("", `does not match Agent Spec ${AGENTSPEC_VERSION}`));
  }
  return [...issues, ...found];
}

function loadExtension(): ValidateFunction {
  if (extensionValidator) return extensionValidator;
  // The extension schema has no anyOf trees, so every error is collected.
  const compiled = newAjv(true).compile(readCoreJson("schemas", "jig-topology.schema.json"));
  extensionValidator = compiled;
  return compiled;
}

/** Validate the lab's extension block; paths are given from the document's root. */
export function validateExtension(block: unknown, base = pointer("metadata", EXTENSION_KEY)): FormatIssue[] {
  const validate = loadExtension();
  if (validate(block)) return [];
  const seen = new Map<string, FormatIssue>();
  for (const error of validate.errors ?? []) {
    if (error.keyword === "anyOf") continue;
    const found = describe(error, base, "the lab's extension");
    seen.set(`${found.path}|${found.message}`, found);
  }
  return [...seen.values()];
}
