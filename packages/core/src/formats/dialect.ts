// ============================================
// The dialect layer: what a document means
// ============================================
// A dialect plugin reads parsed data into the topology model and writes the
// model back as data, whatever the syntax. Every plugin has the same small
// interface, and every registered plugin passes the same contract test
// (src/test-support/dialect-contract.ts): a round trip without loss or with
// the loss declared, invalid documents refused at the exact path, JSON and
// YAML equivalent. Conversions always go through the model.

import { FormatError, type FormatIssue, type Loss, type Topology } from "./model.js";
import { checkTopology } from "./check.js";

export interface DialectRead {
  topology: Topology;
  /** Warnings the document raised; errors are thrown as a FormatError. */
  warnings: FormatIssue[];
  /** What the model does not keep of the document. */
  losses: Loss[];
}

export interface DialectWrite {
  data: unknown;
  /** What the document does not keep of the model ("dropped"), or keeps only for the lab ("ignored"). */
  losses: Loss[];
}

export interface DialectPlugin {
  /** A stable name, used on the command line: "agentspec", "legacy". */
  readonly id: string;
  readonly title: string;
  /** Whether it can write, or only reads (for migration). */
  readonly writes: boolean;
  /** Whether parsed data looks like this dialect. */
  recognise(data: unknown): boolean;
  /** Every problem, each at its exact path; errors make the document unreadable. */
  validate(data: unknown): FormatIssue[];
  /** The document as a topology; throws a FormatError when it is invalid. */
  read(data: unknown): DialectRead;
  write(topology: Topology): DialectWrite;
}

const registry: DialectPlugin[] = [];

export function registerDialect(plugin: DialectPlugin): void {
  for (const key of ["id", "title", "recognise", "validate", "read", "write"] as const) {
    if (!(key in plugin)) throw new Error(`A dialect plugin needs "${key}"`);
  }
  const at = registry.findIndex((p) => p.id === plugin.id);
  if (at >= 0) registry[at] = plugin;
  else registry.push(plugin);
}

export function listDialects(): DialectPlugin[] {
  return [...registry];
}

export function getDialect(id: string): DialectPlugin {
  const found = registry.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown dialect "${id}". Known: ${registry.map((p) => p.id).join(", ")}`);
  return found;
}

/** The first registered dialect that recognises the data. */
export function recogniseDialect(data: unknown): DialectPlugin | null {
  return registry.find((p) => p.recognise(data)) ?? null;
}

/** Throw a FormatError when the model a plugin produced fails the model's own checks. */
export function assertModel(topology: Topology, source: string): void {
  const problems = checkTopology(topology).filter((i) => i.severity === "error");
  if (problems.length) throw new FormatError(problems, `The topology read from ${source} is not valid`);
}
