// ============================================
// The syntax layer: bytes to data and back, JSON and YAML alike
// ============================================
// A syntax plugin knows nothing of what a document means. It parses text to
// plain data (objects, arrays, strings, numbers, booleans, null) and can say
// on which line a JSON Pointer lands, so a dialect's errors point at the text.
// YAML is read with the core schema of YAML 1.2: no custom tags, no
// timestamps, "yes" stays a string, so a YAML document and its JSON twin
// parse to the same data.

import YAML, { isCollection, isMap, isScalar, isSeq, LineCounter, type Document, type Node as YamlNode } from "yaml";
import { FormatError, issue, type FormatIssue } from "./model.js";

export type SyntaxId = "json" | "yaml";

export interface ParsedText {
  syntax: SyntaxId;
  data: unknown;
  /** The line and column (1-based) a JSON Pointer lands on, when the text has it. */
  locate(path: string): { line: number; column: number } | undefined;
}

export interface SyntaxPlugin {
  id: SyntaxId;
  extensions: string[];
  /** Whether the text looks like this syntax (used when there is no file name). */
  sniff(text: string): boolean;
  parse(text: string): ParsedText;
  stringify(data: unknown, options?: { header?: string }): string;
}

function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** A locator over a YAML document (JSON is YAML 1.2, so it serves both). */
function locator(doc: Document.Parsed, counter: LineCounter): ParsedText["locate"] {
  return (path) => {
    const tokens = path === "" ? [] : path.split("/").slice(1).map(unescapeToken);
    let node: unknown = doc.contents;
    let at: YamlNode | null = (doc.contents as YamlNode | null) ?? null;
    for (const token of tokens) {
      let next: unknown;
      if (isSeq(node)) next = node.get(Number(token), true);
      else if (isMap(node)) next = node.get(token, true);
      else break;
      if (next === undefined) break;
      node = next;
      if (isCollection(next) || isScalar(next)) at = next as YamlNode;
    }
    const offset = at?.range?.[0];
    if (offset === undefined) return undefined;
    const pos = counter.linePos(offset);
    return { line: pos.line, column: pos.col };
  };
}

function parseYamlDocument(text: string, syntax: SyntaxId): { doc: Document.Parsed; counter: LineCounter } {
  const counter = new LineCounter();
  const doc = YAML.parseDocument(text, { lineCounter: counter, uniqueKeys: true, version: "1.2", schema: "core" });
  const problems: FormatIssue[] = doc.errors.map((e) => {
    const pos = e.linePos?.[0];
    return { ...issue("", e.message.split("\n")[0]), ...(pos ? { line: pos.line, column: pos.col } : {}) };
  });
  if (problems.length > 0) throw new FormatError(problems, `Not valid ${syntax === "json" ? "JSON" : "YAML"}`);
  return { doc, counter };
}

export const jsonSyntax: SyntaxPlugin = {
  id: "json",
  extensions: [".json"],
  sniff: (text) => /^\s*[[{]/.test(text),
  parse(text) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const message = (error as Error).message;
      const at = /position (\d+)/.exec(message);
      let line = at ? text.slice(0, Number(at[1])).split("\n").length : undefined;
      if (line === undefined) {
        // Node's message may give no position; YAML, which reads JSON, says where it breaks.
        try {
          parseYamlDocument(text, "json");
        } catch (yamlError) {
          line = (yamlError as FormatError).issues?.[0]?.line;
        }
      }
      throw new FormatError([{ ...issue("", message), ...(line ? { line } : {}) }], "Not valid JSON");
    }
    // Positions come from reading the same text as YAML 1.2, of which JSON is a subset.
    let locate: ParsedText["locate"] = () => undefined;
    try {
      const { doc, counter } = parseYamlDocument(text, "json");
      locate = locator(doc, counter);
    } catch {
      // A JSON text YAML cannot read (a duplicate key, say) still parses; it just has no lines.
    }
    return { syntax: "json", data, locate };
  },
  stringify: (data) => `${JSON.stringify(data, null, 2)}\n`,
};

export const yamlSyntax: SyntaxPlugin = {
  id: "yaml",
  extensions: [".yaml", ".yml"],
  sniff: () => true,
  parse(text) {
    const { doc, counter } = parseYamlDocument(text, "yaml");
    // Aliases are allowed but bounded, so a document cannot expand without end.
    const data = doc.toJS({ maxAliasCount: 100 });
    return { syntax: "yaml", data, locate: locator(doc, counter) };
  },
  stringify(data, options) {
    // Short lists of scalars and small maps of scalars go on one line; nothing else changes the data.
    const doc = new YAML.Document(data, { version: "1.2", aliasDuplicateObjects: false });
    YAML.visit(doc, {
      Seq(_, node) {
        if (node.items.length > 0 && node.items.every((i) => isScalar(i)) && JSON.stringify(node.toJSON()).length <= 80) node.flow = true;
      },
      Map(_, node) {
        const scalars = node.items.every((p) => isScalar(p.value));
        if (node.items.length > 0 && node.items.length <= 4 && scalars && JSON.stringify(node.toJSON()).length <= 90) node.flow = true;
      },
    });
    const body = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
    const header = options?.header ? `${options.header.split("\n").map((l) => (l ? `# ${l}` : "#")).join("\n")}\n` : "";
    return header + body;
  },
};

export const SYNTAXES: readonly SyntaxPlugin[] = [jsonSyntax, yamlSyntax];

export function syntaxById(id: SyntaxId): SyntaxPlugin {
  const s = SYNTAXES.find((p) => p.id === id);
  if (!s) throw new Error(`Unknown syntax "${id}"`);
  return s;
}

/** The syntax of a text: from its file name when it has one, else from how it starts. */
export function detectSyntax(text: string, filename?: string): SyntaxPlugin {
  if (filename) {
    const lower = filename.toLowerCase();
    const byName = SYNTAXES.find((s) => s.extensions.some((e) => lower.endsWith(e)));
    if (byName) return byName;
  }
  return jsonSyntax.sniff(text) ? jsonSyntax : yamlSyntax;
}

export function parseText(text: string, options: { filename?: string; syntax?: SyntaxId } = {}): ParsedText {
  const plugin = options.syntax ? syntaxById(options.syntax) : detectSyntax(text, options.filename);
  return plugin.parse(text);
}
