// ============================================
// Jig's own documentation, for the roles to answer questions about Jig
// ============================================
// Every role gets a short "about Jig" block in its environment and a
// read-only tool, jig_help, that searches Jig's documentation: the file
// shipped in the package (docs/jig-help.md) plus what is read from the code
// when it runs, so it never drifts: every slash command from the command
// table, the built-in topologies with their roles and brains, the versions.
// The tool never asks for permission (it reads nothing of the person's), and
// what it returns is written documentation, not something measured.

import { readFileSync } from "node:fs";
import { coreVersion, listRecipes, type AgentTool, type ToolDefinition, type Topology } from "jig-core";
import { COMMANDS } from "../session/commands.js";

export const JIG_HELP = "jig_help";

const pkg = (url: URL): string => {
  try {
    return (JSON.parse(readFileSync(url, "utf-8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
};

/** The versions of the two packages, as installed. */
export function versions(): { console: string; core: string } {
  return { console: pkg(new URL("../../package.json", import.meta.url)), core: coreVersion() };
}

export interface HelpSection {
  title: string;
  body: string;
}

/** The documentation as sections: the shipped file, then what the code says now. */
export function helpSections(): HelpSection[] {
  let text = "";
  try {
    text = readFileSync(new URL("../../docs/jig-help.md", import.meta.url), "utf-8");
  } catch {
    text = "## What Jig is\n\nJig is a Joint Inference Graph: a topology of roles, each on a model, run from the jig terminal session.";
  }
  const sections: HelpSection[] = [];
  for (const part of text.split(/^## /m).slice(1)) {
    const [title, ...rest] = part.split("\n");
    sections.push({ title: title.trim(), body: rest.join("\n").trim() });
  }
  sections.push({
    title: "Slash commands",
    body: COMMANDS.map((c) => `- \`${c.usage}\`: ${c.summary}.`).join("\n"),
  });
  sections.push({
    title: "Built-in topologies, their roles and brains, what each is meant for and the research behind it",
    body: listRecipes()
      .map((r) => {
        const t = r as Topology;
        const roles = t.nodes.map((n) => `${t.faces?.[n.id]?.label ?? n.id} (id ${n.id}, ${n.config.brain?.brain ? `brain ${n.config.brain.brain}` : "the session's default model"})`);
        const advisors = (t.consults ?? []).map((c) => `${c.role.face.label} (id ${c.role.id}, consulted by ${c.from}${c.role.brain?.brain ? `, brain ${c.role.brain.brain}` : ""})`);
        const uses = t.recommendedFor?.length ? ` Meant for: ${t.recommendedFor.join("; ")}.` : "";
        const refs = t.references?.length ? ` Research: ${t.references.map((r) => `${r.title}${r.authors ? ` (${r.authors}${r.year ? `, ${r.year}` : ""})` : ""} ${r.url}`).join("; ")}.` : "";
        return `- \`${t.id}\`, ${t.name}: ${[...roles, ...advisors].join(", ")}.${uses}${refs}`;
      })
      .join("\n"),
  });
  const v = versions();
  sections.push({ title: "Version", body: `jig-console ${v.console}, jig-core ${v.core}. \`jig --version\` prints it.` });
  return sections;
}

// A question in Spanish is common: its key words are read as their English twins.
const TWINS: Record<string, string> = {
  que: "what", es: "is", cambiar: "change", cambio: "change", modelo: "model", modelos: "model", topologia: "topology", topologias: "topology",
  permiso: "permission", permisos: "permission", comando: "command", comandos: "command", proveedor: "provider", proveedores: "provider", clave: "key",
  claves: "key", archivo: "file", archivos: "file", donde: "where", version: "version", cerebro: "brain", cerebros: "brain", rol: "role", roles: "role",
  modo: "mode", modos: "mode", teclas: "keys", sesion: "session", ayuda: "help", comprobar: "check", verificar: "check",
  limpiar: "clean", limpia: "clean", limpieza: "clean", basura: "trash", papelera: "trash", borrar: "delete", borra: "delete", disco: "disk",
  restaurar: "restore", recuperar: "restore",
};
const STOP = new Set(["the", "a", "an", "of", "to", "do", "does", "are", "i", "in", "for", "and", "or", "how", "can", "my", "on", "with", "de", "la", "el", "en", "como", "un", "una", "los", "las", "del", "se", "y", "o", "mi", "por", "para"]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
    .map((w) => TWINS[w] ?? w);
const stem = (w: string) => w.replace(/(ing|es|ed|s)$/, "") || w;

/** The sections that answer a question best, best first: each word weighted by how few sections use it, more in a title. */
export function searchHelp(query: string, sections = helpSections()): HelpSection[] {
  const terms = [...new Set(words(query).filter((w) => !STOP.has(w)).map(stem))];
  if (!terms.length) return [];
  const docs = sections.map((s) => ({ head: words(s.title).map(stem), body: words(s.body).map(stem) }));
  const has = (d: { head: string[]; body: string[] }, t: string) => d.head.includes(t) || d.body.some((w) => w === t || (t.length >= 5 && w.startsWith(t)));
  const weight = (t: string) => Math.log(1 + sections.length / Math.max(1, docs.filter((d) => has(d, t)).length));
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const t of terms) {
      const w = weight(t);
      if (d.head.includes(t)) score += 3 * w;
      score += Math.min(3, d.body.filter((x) => x === t || (t.length >= 5 && x.startsWith(t))).length) * w;
    }
    return { s: sections[i], score, i };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}

const DEFINITION: ToolDefinition = {
  name: JIG_HELP,
  description:
    "Search Jig's own documentation: what Jig is, the session and its keys, every slash command, permissions and modes, the built-in topologies with their roles and brains, what each is meant for and the research behind it, providers, keys and brains, where files live, what Jig cleans up and what it never deletes, and the version. Use it whenever you are asked about Jig itself, instead of guessing.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The question or the words to look for, such as 'what is jig' or 'switch topology'" },
    },
    required: ["query"],
  },
};

/** The tool: the best section whole, and the titles of the next ones. Read-only, and never asks. */
export class JigHelpTool implements AgentTool {
  definition = DEFINITION;

  async execute(args: Record<string, unknown>): Promise<string> {
    const sections = helpSections();
    const found = searchHelp(String(args.query ?? ""), sections);
    const v = versions();
    const mark = `❝ From Jig's own documentation (written, not measured), jig-console ${v.console}`;
    if (!found.length) return `${mark}. Nothing matched; its parts are: ${sections.map((s) => s.title).join("; ")}.`;
    const [best, ...more] = found;
    const body = best.body.length > 3500 ? `${best.body.slice(0, 3500)}⋯` : best.body;
    return `${mark}, "${best.title}":\n\n${body}${more.length ? `\n\nAlso about this: ${more.slice(0, 3).map((s) => s.title).join("; ")}.` : ""}`;
  }
}

/** The block every role's prompt ends with, after where it runs: what Jig is, and where to look for the rest. */
export function aboutJig(): string {
  const v = versions();
  return [
    "About Jig, the program running you:",
    `- You are one role in Jig (jig-console ${v.console}), a Joint Inference Graph: a topology of roles (Plan, Do, Check, Critique, Decide, an Advisor), each on a model, run from the person's terminal session (\`jig\`) or from \`jig run\`.`,
    "- The person types tasks and slash commands (/topology, /models, /permissions, /help) in that session; your tool calls are checked against their permissions before they run.",
    `- Asked about Jig itself (its commands, topologies, models, permissions, providers, files, version), call ${JIG_HELP} and answer from what it returns; never guess.`,
  ].join("\n");
}

/** A topology where every role may call jig_help, whatever its own tool list says. */
export function offerJigHelp(t: Topology): Topology {
  const copy = structuredClone(t);
  for (const n of copy.nodes) {
    const policy = n.config.toolPolicy;
    if (policy?.allow && !policy.allow.includes(JIG_HELP)) n.config = { ...n.config, toolPolicy: { ...policy, allow: [...policy.allow, JIG_HELP] } };
    else if (!policy && n.config.enabledTools?.length && !n.config.enabledTools.includes(JIG_HELP)) n.config = { ...n.config, enabledTools: [...n.config.enabledTools, JIG_HELP] };
  }
  return copy;
}
