// ============================================
// The formats module: detect, parse, validate, convert, write
// ============================================
// The only place the lab handles a definition file. Two layers, each growing
// without touching the other: the syntax layer (JSON, YAML) turns text into
// data, the dialect layer (Agent Spec 26.3.1 with the lab's extension, the
// legacy recipes) turns data into the topology model. Conversions go through
// the model. The rest of the engine sees only a validated Topology.

import { readFile, writeFile } from "node:fs/promises";
import { FormatError, describeIssue, type FormatIssue, type Loss, type Topology } from "./model.js";
import { detectSyntax, parseText, syntaxById, type SyntaxId } from "./syntax.js";
import { getDialect, listDialects, recogniseDialect, registerDialect, type DialectPlugin } from "./dialect.js";
import { agentSpecDialect } from "./dialects/agentspec.js";
import { legacyDialect } from "./dialects/legacy.js";

registerDialect(agentSpecDialect);
registerDialect(legacyDialect);

export interface ReadOptions {
  /** The file's name, which says its syntax when it ends in .json, .yaml or .yml. */
  filename?: string;
  syntax?: SyntaxId;
  /** Read as this dialect instead of recognising it. */
  dialect?: string;
}

export interface ReadResult {
  topology: Topology;
  syntax: SyntaxId;
  dialect: string;
  warnings: FormatIssue[];
  losses: Loss[];
}

/** Put line numbers on issues, where the text has them. */
function located(issues: FormatIssue[], locate: (path: string) => { line: number; column: number } | undefined): FormatIssue[] {
  return issues.map((i) => {
    if (i.line !== undefined) return i;
    const pos = locate(i.path);
    return pos ? { ...i, line: pos.line, column: pos.column } : i;
  });
}

function pick(data: unknown, dialect?: string): DialectPlugin {
  if (dialect) return getDialect(dialect);
  const found = recogniseDialect(data);
  if (!found) {
    throw new FormatError(
      [{ path: "", message: `not a document any dialect recognises (${listDialects().map((d) => d.id).join(", ")})`, severity: "error" }],
      "Unknown kind of document",
    );
  }
  return found;
}

/** Read a definition from text: any syntax, any registered dialect. Throws a FormatError when it is invalid. */
export function readTopologyText(text: string, options: ReadOptions = {}): ReadResult {
  const parsed = parseText(text, options);
  const dialect = pick(parsed.data, options.dialect);
  try {
    const read = dialect.read(parsed.data);
    return {
      topology: read.topology,
      syntax: parsed.syntax,
      dialect: dialect.id,
      warnings: located(read.warnings, parsed.locate),
      losses: read.losses,
    };
  } catch (error) {
    if (error instanceof FormatError) throw new FormatError(located(error.issues, parsed.locate));
    throw error;
  }
}

export interface ValidateResult {
  valid: boolean;
  syntax: SyntaxId | null;
  dialect: string | null;
  issues: FormatIssue[];
}

/** Every problem in a text, each at its path and line. Never throws for a bad document. */
export function validateTopologyText(text: string, options: ReadOptions = {}): ValidateResult {
  let parsed;
  try {
    parsed = parseText(text, options);
  } catch (error) {
    if (error instanceof FormatError) return { valid: false, syntax: null, dialect: null, issues: error.issues };
    throw error;
  }
  let dialect: DialectPlugin;
  try {
    dialect = pick(parsed.data, options.dialect);
  } catch (error) {
    if (error instanceof FormatError) return { valid: false, syntax: parsed.syntax, dialect: null, issues: error.issues };
    throw error;
  }
  const issues = located(dialect.validate(parsed.data), parsed.locate);
  return { valid: !issues.some((i) => i.severity === "error"), syntax: parsed.syntax, dialect: dialect.id, issues };
}

export interface WriteOptions {
  dialect?: string;
  syntax?: SyntaxId;
  /** A comment for the top of a YAML file. */
  header?: string;
  /**
   * compact (the default): each component once, referenced wherever it is used,
   * and nothing Agent Spec infers. expanded: every node lists its inputs, outputs
   * and branches. Both read to the same topology.
   */
  form?: "compact" | "expanded";
}

export interface WriteResult {
  text: string;
  data: unknown;
  losses: Loss[];
}

/** Write a topology in a dialect and a syntax (Agent Spec in YAML by default). */
export function writeTopologyText(topology: Topology, options: WriteOptions = {}): WriteResult {
  const dialect = getDialect(options.dialect ?? "agentspec");
  if (!dialect.writes) throw new Error(`The ${dialect.id} dialect is read only`);
  const { data, losses } = dialect.write(topology, { form: options.form ?? "compact" });
  const text = syntaxById(options.syntax ?? "yaml").stringify(data, { header: options.header });
  return { text, data, losses };
}

export interface ConvertResult extends WriteResult {
  from: { syntax: SyntaxId; dialect: string };
  /** What reading the source lost, then what writing the target lost. */
  readLosses: Loss[];
  warnings: FormatIssue[];
}

/** Convert a definition from any dialect and syntax to another, through the model. */
export function convertTopologyText(text: string, to: WriteOptions, from: ReadOptions = {}): ConvertResult {
  const read = readTopologyText(text, from);
  const written = writeTopologyText(read.topology, to);
  return { ...written, from: { syntax: read.syntax, dialect: read.dialect }, readLosses: read.losses, warnings: read.warnings };
}

export async function readTopologyFile(path: string, options: Omit<ReadOptions, "filename"> = {}): Promise<ReadResult> {
  return readTopologyText(await readFile(path, "utf-8"), { ...options, filename: path });
}

export async function writeTopologyFile(path: string, topology: Topology, options: WriteOptions = {}): Promise<WriteResult> {
  const syntax = options.syntax ?? detectSyntax("", path).id;
  const result = writeTopologyText(topology, { ...options, syntax });
  await writeFile(path, result.text, "utf-8");
  return result;
}

export { describeIssue, FormatError, registerDialect, listDialects, getDialect };
export type { DialectPlugin, FormatIssue, Loss, Topology, SyntaxId };
export type { TopologyReference } from "./model.js";
export * from "./model.js";
export { asTopology, deriveDrawing } from "./derive.js";
export { checkTopology } from "./check.js";
export { detectSyntax, parseText, SYNTAXES } from "./syntax.js";
export { AGENTSPEC_VERSION, EXTENSION_PROFILE, validateAgentSpec } from "./schemas.js";
export { ignoredElsewhere } from "./dialects/agentspec-write.js";
export { IMPORT_ROUND_LIMIT } from "./dialects/agentspec-import.js";
