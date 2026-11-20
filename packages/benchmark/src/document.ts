// ============================================
// Reading a YAML or JSON file, with every problem at its path and line
// ============================================
// YAML is read for both (JSON is YAML), so a problem found by the schema can
// be pointed at the line it is on.

import { readFile } from "node:fs/promises";
import { LineCounter, parseDocument } from "yaml";
import type { ZodError, ZodIssue } from "zod";

export interface ParsedFile {
  path: string;
  text: string;
  value: unknown;
  /** The line of a path in the document, or of its nearest parent that exists. */
  lineOf(path: Array<string | number>): number | null;
}

export class FileProblems extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[],
  ) {
    super(`${file}: ${problems.length === 1 ? "1 problem" : `${problems.length} problems`}\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "FileProblems";
  }
}

export function parseText(text: string, path: string): ParsedFile {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) {
    throw new FileProblems(
      path,
      doc.errors.map((e) => `line ${e.linePos?.[0]?.line ?? "?"}: ${e.message.split("\n")[0]}`),
    );
  }
  return {
    path,
    text,
    value: doc.toJS(),
    lineOf(p) {
      for (let i = p.length; i >= 0; i--) {
        const node = doc.getIn(p.slice(0, i), true) as { range?: [number, number, number] } | undefined;
        if (node && typeof node === "object" && node.range) return lineCounter.linePos(node.range[0]).line;
      }
      return null;
    },
  };
}

export async function readParsed(path: string): Promise<ParsedFile> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : (e as Error).message}`);
  }
  return parseText(text, path);
}

/** tasks[2].checks[0], as a person reads a path. */
export function showPath(path: Array<string | number>): string {
  let out = "";
  for (const part of path) out += typeof part === "number" ? `[${part}]` : out ? `.${part}` : part;
  return out || "(the file)";
}

export function describeIssues(file: ParsedFile, issues: ZodIssue[]): string[] {
  return issues.map((issue) => {
    const line = file.lineOf(issue.path);
    return `${showPath(issue.path)}${line ? ` (line ${line})` : ""}: ${issue.message}`;
  });
}

export function problemsOf(file: ParsedFile, error: ZodError): FileProblems {
  return new FileProblems(file.path, describeIssues(file, error.issues));
}
