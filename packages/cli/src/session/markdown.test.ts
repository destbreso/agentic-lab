// Markdown in the conversation: headings, nested lists, bold, inline code, a
// fenced block and a table come out line by line, wrapped with a hanging
// indent, in the grid's Meanings; --plain keeps inline code's backticks and
// --ascii has a twin for every glyph. A role's preview keeps its lines and
// says how many more there are; the one-line log takes its first line.

import { describe, it, expect } from "vitest";
import { firstLine } from "jig-core";
import { markdownLines, previewLines } from "./markdown.js";
import { toAscii } from "./ascii.js";
import type { Line } from "./controller.js";

const FIXTURE = [
  "### Assessment of Task Progress",
  "#### Current State",
  "- **Task**: Resume",
  "- **Progress**: half done, with a long line that has to wrap past the width so the hanging indent shows",
  "  1. nested `parse()`",
  "  2. second",
  "",
  "Some text with **bold** and a [link](https://example.com).",
  "",
  "```python",
  "def is_palindrome(s):",
  "    return s == s[::-1]",
  "```",
  "",
  "| name | size |",
  "|------|------|",
  "| a    | 22   |",
].join("\n");

const text = (lines: Line[]) => lines.map((l) => l.map(([t]) => t).join(""));

describe("Markdown in the conversation", () => {
  it("renders the fixture line by line, wrapped, with a hanging indent", () => {
    const lines = markdownLines(FIXTURE, 60);
    expect(text(lines)).toEqual([
      "  Assessment of Task Progress",
      "  Current State",
      "  ‣ Task: Resume",
      "  ‣ Progress: half done, with a long line that has to wrap",
      "    past the width so the hanging indent shows",
      "    1. nested parse()",
      "    2. second",
      "",
      "  Some text with bold and a link (https://example.com).",
      "",
      "    python",
      "      def is_palindrome(s):",
      "          return s == s[::-1]",
      "",
      "  name  size",
      "  a     22",
    ]);
    // No raw marker survives.
    expect(text(lines).join("\n")).not.toMatch(/#{2,}|\*\*|```/);
  });

  it("draws headings and bold as bold, inline code dim, code and text as ink, and never a colour", () => {
    const lines = markdownLines(FIXTURE, 60);
    expect(lines[0].filter(([t]) => t.trim()).every(([, k]) => k === "b")).toBe(true);
    expect(lines[2]).toContainEqual(["Task", "b"]);
    expect(lines[5]).toContainEqual(["parse()", "dim"]);
    expect(lines.find((l) => l.some(([t]) => t.includes("def is_palindrome")))).toContainEqual(["    def is_palindrome(s):", "ink"]);
    const meanings = new Set(lines.flatMap((l) => l.map(([, k]) => k)));
    for (const k of meanings) expect(["", "ink", "dim", "faint", "b"]).toContain(k);
  });

  it("keeps inline code's backticks under --plain, and has an ASCII twin for every glyph", () => {
    expect(text(markdownLines("run `npm test` now", 40, "  ", { plain: true }))).toEqual(["  run `npm test` now"]);
    const all = text(markdownLines(`${FIXTURE}\n\n> quoted\n\n---\n\n- a\n  - b\n`, 60)).join("\n");
    expect([...toAscii(all)].every((ch) => ch.charCodeAt(0) < 128 && ch !== "?")).toBe(true);
    expect(toAscii(all)).toMatch(/^ {2}- Task: Resume$/m);
  });

  it("keeps a role's lines in its preview, and says how many more there were", () => {
    const { lines, more } = previewLines(FIXTURE, 60, "      ", 4);
    expect(text(lines)).toEqual(["      Assessment of Task Progress", "      Current State", "      ‣ Task: Resume", "      ‣ Progress: half done, with a long line that has to"]);
    expect(more).toBe(9);
  });

  it("takes a role's first line for the one-line log, never the lines glued together", () => {
    expect(firstLine(FIXTURE)).toBe("Assessment of Task Progress ⋯");
    expect(firstLine("- **Task**: Resume")).toBe("Task: Resume");
    expect(firstLine("```python\nprint(1)\n```")).toBe("print(1)");
  });
});
