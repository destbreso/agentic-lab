// ============================================
// Skill Registry
// ============================================
// Holds the available skills and parses SKILL.md packages into Skill objects.

import { parseFrontmatter } from "./frontmatter.js";
import type { Skill, SkillActivation } from "./types.js";

const VALID_ACTIVATIONS: SkillActivation[] = ["always", "auto", "manual"];

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return undefined;
}

/**
 * Build a Skill from SKILL.md content (frontmatter + Markdown body).
 * Throws if the required `name` or `description` is missing.
 */
export function skillFromMarkdown(md: string, opts?: { dir?: string }): Skill {
  const { data, body } = parseFrontmatter(md);

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!name) throw new Error("SKILL.md is missing required field: name");
  if (!description)
    throw new Error(`Skill "${name}" is missing required field: description`);

  const activationRaw = String(data.activation ?? "manual") as SkillActivation;
  const activation = VALID_ACTIVATIONS.includes(activationRaw)
    ? activationRaw
    : "manual";

  // Anything not mapped to a known field goes into metadata.
  const known = new Set([
    "name",
    "description",
    "version",
    "activation",
    "allowedTools",
    "keywords",
  ]);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!known.has(k)) metadata[k] = v;
  }

  return {
    name,
    description,
    version: data.version ? String(data.version) : "1.0.0",
    instructions: body.trim(),
    allowedTools: asStringArray(data.allowedTools),
    keywords: asStringArray(data.keywords),
    activation,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    dir: opts?.dir,
  };
}

/** In-memory registry of skills, keyed by name. */
export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** Register (or overwrite) a skill. */
  register(skill: Skill): this {
    this.skills.set(skill.name, skill);
    return this;
  }

  /** Parse a SKILL.md and register the resulting skill. */
  registerFromMarkdown(md: string, opts?: { dir?: string }): Skill {
    const skill = skillFromMarkdown(md, opts);
    this.register(skill);
    return skill;
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** Resolve a set of skill names to skills (silently skips unknown names). */
  resolve(names: string[]): Skill[] {
    const out: Skill[] = [];
    for (const n of names) {
      const s = this.skills.get(n);
      if (s) out.push(s);
    }
    return out;
  }

  remove(name: string): boolean {
    return this.skills.delete(name);
  }

  clear(): void {
    this.skills.clear();
  }
}
