// ============================================
// Markdown in the conversation, as lines of Meanings
// ============================================
// A role's answer is Markdown more often than not. It is read with marked's
// lexer (an established parser, no renderer of its own and no colours) and
// each token becomes a line or a segment with one of the grid's Meanings, so
// the palette rule holds and --plain and --ascii follow from the one style
// table. Headings are bold, list items one to a line with a hanging indent,
// fenced code an indented block under its language, and every paragraph is
// wrapped to the width.

import { marked, type Token, type Tokens } from "marked";
import type { Meaning } from "jig-core";
import type { Line } from "./controller.js";
import { wrapLine } from "./lines.js";

type Seg = [string, Meaning];

export interface MarkdownOptions {
  /** No styles: inline code keeps its backticks, since dim would not show. */
  plain?: boolean;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const unescape = (t: string) => t.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);

/** Inline tokens as segments, in the given Meaning unless a token says otherwise. */
function inline(tokens: Token[] | undefined, base: Meaning, o: MarkdownOptions): Seg[] {
  const out: Seg[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inline((t as Tokens.Strong).tokens, "b", o));
        break;
      case "em":
        out.push(...inline((t as Tokens.Em).tokens, base, o));
        break;
      case "del":
        out.push(...inline((t as Tokens.Del).tokens, "faint", o));
        break;
      case "codespan": {
        const code = unescape((t as Tokens.Codespan).text);
        out.push(o.plain ? [`\`${code}\``, base] : [code, base === "b" ? "b" : "dim"]);
        break;
      }
      case "link": {
        const l = t as Tokens.Link;
        out.push(...inline(l.tokens, base, o));
        if (l.href && l.href !== l.text) out.push([` (${l.href})`, "faint"]);
        break;
      }
      case "image":
        out.push([`[image: ${(t as Tokens.Image).text || (t as Tokens.Image).href}]`, "faint"]);
        break;
      case "br":
        out.push(["\n", base]);
        break;
      case "text": {
        const x = t as Tokens.Text;
        out.push(...(x.tokens?.length ? inline(x.tokens, base, o) : ([[unescape(x.text), base]] as Seg[])));
        break;
      }
      default:
        out.push([unescape("text" in t && typeof t.text === "string" ? t.text : t.raw), base]);
    }
  }
  return out;
}

/** Segments wrapped to the width, each line led by `lead` (the first) or `indent` (the rest), and split at hard breaks. */
function wrapped(segs: Seg[], width: number, lead: string, indent: string): Line[] {
  const room = Math.max(10, width - indent.length);
  const out: Line[] = [];
  let cur: Seg[] = [];
  const flush = () => {
    const body: Line = cur.length ? cur : [["", "ink"]];
    for (const l of wrapLine(body, room)) {
      // A wrapped line ends at a word, not at the space after it.
      const last = l[l.length - 1];
      if (last) l[l.length - 1] = [last[0].replace(/\s+$/, ""), last[1]];
      out.push([[out.length ? indent : lead, ""], ...l]);
    }
    cur = [];
  };
  for (const [text, k] of segs) {
    const parts = text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) flush();
      if (p) cur.push([p.replace(/\s+/g, " "), k]);
    });
  }
  if (cur.length || !out.length) flush();
  return out;
}

const BULLETS = ["‣", "◦"];

function blocks(tokens: Token[], width: number, indent: string, depth: number, o: MarkdownOptions): Line[] {
  const out: Line[] = [];
  // One blank line between blocks, never two, and none at the top.
  const gap = () => {
    if (out.length && out[out.length - 1].length) out.push([]);
  };
  let prev = "";
  for (const t of tokens) {
    switch (t.type) {
      case "space":
        break;
      case "heading": {
        if (prev !== "heading") gap();
        const segs = inline((t as Tokens.Heading).tokens, "b", o).map(([x]): Seg => [x, "b"]);
        out.push(...wrapped(segs, width, indent, indent));
        break;
      }
      case "paragraph":
        // A list or a paragraph right under a heading stays with it.
        if (prev !== "heading") gap();
        out.push(...wrapped(inline((t as Tokens.Paragraph).tokens, "ink", o), width, indent, indent));
        break;
      case "text": {
        const x = t as Tokens.Text;
        out.push(...wrapped(x.tokens?.length ? inline(x.tokens, "ink", o) : [[unescape(x.text), "ink"]], width, indent, indent));
        break;
      }
      case "list": {
        const list = t as Tokens.List;
        if (prev !== "heading" && depth === 0) gap();
        list.items.forEach((item, i) => {
          const marker = list.ordered ? `${(Number(list.start) || 1) + i}. ` : item.task ? (item.checked ? "[x] " : "[ ] ") : `${BULLETS[depth % BULLETS.length]} `;
          const hang = indent + " ".repeat(marker.length);
          const inner = blocks(item.tokens.filter((x) => x.type !== "checkbox"), width, hang, depth + 1, o).filter((l, j, all) => l.length || (j > 0 && j < all.length - 1));
          if (!inner.length) inner.push([[hang, ""]]);
          // The item's first line carries its marker; the rest hang under its text.
          inner[0] = [[indent, ""], [marker, list.ordered ? "b" : "dim"], ...inner[0].slice(1)];
          out.push(...inner);
        });
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        gap();
        if (c.lang) out.push([[indent, ""], [`  ${c.lang}`, "faint"]]);
        for (const l of c.text.replace(/\n+$/, "").split("\n")) out.push([[indent, ""], [`    ${l}`, "ink"]]);
        break;
      }
      case "blockquote": {
        gap();
        for (const l of blocks((t as Tokens.Blockquote).tokens, width - 2, "", depth, o)) out.push([[indent, ""], ["│ ", "faint"], ...l.slice(1).map(([x, k]): Seg => [x, k === "ink" ? "dim" : k])]);
        break;
      }
      case "hr":
        gap();
        out.push([[indent, ""], ["─".repeat(Math.max(3, Math.min(40, width - indent.length))), "faint"]]);
        break;
      case "table": {
        const tb = t as Tokens.Table;
        const text = (cell: Tokens.TableCell) => inline(cell.tokens, "ink", o).map(([x]) => x).join("");
        const rows = [tb.header.map(text), ...tb.rows.map((r) => r.map(text))];
        const widths = rows[0].map((_, j) => Math.max(...rows.map((r) => [...(r[j] ?? "")].length)));
        gap();
        rows.forEach((r, i) => out.push([[indent, ""], [r.map((cell, j) => cell.padEnd(widths[j])).join("  ").trimEnd(), i === 0 ? "b" : "ink"]]));
        break;
      }
      case "html":
        if ((t as Tokens.HTML).text.trim()) out.push(...wrapped([[(t as Tokens.HTML).text.trim(), "ink"]], width, indent, indent));
        break;
      default:
        if (t.raw.trim()) out.push(...wrapped([[t.raw.trim(), "ink"]], width, indent, indent));
    }
    if (t.type !== "space") prev = t.type;
  }
  return out;
}

/** A Markdown text as lines for the conversation, each led by `indent`, wrapped to `width`. */
export function markdownLines(text: string, width: number, indent = "  ", o: MarkdownOptions = {}): Line[] {
  const lines = blocks(marked.lexer(text.replace(/\r\n/g, "\n")), width, indent, 0, o);
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

/** At most `max` lines of a role's text, as Markdown, and how many more there were. */
export function previewLines(text: string, width: number, indent: string, max: number, o: MarkdownOptions = {}): { lines: Line[]; more: number } {
  const all = markdownLines(text, width, indent, o).filter((l) => l.length);
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}
