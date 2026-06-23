// ============================================
// Frontmatter Parser (YAML subset)
// ============================================
// Parses the leading `---` YAML frontmatter block of a SKILL.md file into a
// plain object, plus the Markdown body. Intentionally a small, dependency-free
// subset (scalars, inline lists, block lists) — enough for skill metadata —
// rather than a full YAML engine.

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

/** Coerce a scalar string token into string | number | boolean. */
function coerceScalar(raw: string): string | number | boolean {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

/** Parse an inline list `[a, b, c]` into an array of coerced scalars. */
function parseInlineList(raw: string): unknown[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === "") return [];
  return inner.split(",").map((item) => coerceScalar(item));
}

/**
 * Split a document into its frontmatter object and Markdown body.
 * If there is no frontmatter block, `data` is empty and `body` is the input.
 */
export function parseFrontmatter(md: string): ParsedFrontmatter {
  const text = md.replace(/^﻿/, ""); // strip BOM
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/);
  if (!match) {
    return { data: {}, body: text };
  }

  const rawFront = match[1];
  const body = (match[2] ?? "").replace(/^\n/, "");
  const data: Record<string, unknown> = {};

  const lines = rawFront.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;

    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim();
    const valuePart = line.slice(colon + 1).trim();

    if (valuePart === "") {
      // Could be a block list: collect following `- item` lines.
      const items: unknown[] = [];
      while (i < lines.length) {
        const next = lines[i];
        const nextTrim = next.trim();
        if (nextTrim.startsWith("- ")) {
          items.push(coerceScalar(nextTrim.slice(2)));
          i++;
        } else if (nextTrim === "") {
          i++;
        } else {
          break;
        }
      }
      data[key] = items;
    } else if (valuePart.startsWith("[") && valuePart.endsWith("]")) {
      data[key] = parseInlineList(valuePart);
    } else {
      data[key] = coerceScalar(valuePart);
    }
  }

  return { data, body };
}
