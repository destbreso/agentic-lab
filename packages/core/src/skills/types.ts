// ============================================
// Skills — Type System
// ============================================
// A Skill is a packaged, reusable unit of capability: instructions (a
// system-prompt fragment), the tools it grants/needs, optional resources
// loaded on demand, and an activation policy. Skills are authored as
// SKILL.md packages (YAML frontmatter + Markdown body) and attached to
// loop nodes, which they specialize without any code changes.
//
// Progressive disclosure: only `name` + `description` are always visible;
// the (potentially long) `instructions` are injected when the skill
// activates, and `resources` are loaded only when explicitly requested.

/** How a skill enters a node's context. */
export type SkillActivation =
  | "always" // always active on nodes it is attached to
  | "auto" // activated by relevance to the current task
  | "manual"; // only when explicitly attached/requested

/** A resource bundled with a skill, loaded on demand (not in the prompt). */
export interface SkillResource {
  /** Logical name used to request the resource. */
  name: string;
  /** File path relative to the skill directory. */
  path?: string;
  /** Inline content (alternative to a file path). */
  content?: string;
  /** What the resource is for. */
  description?: string;
}

/** A parameter a skill may declare. */
export interface SkillParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
}

/** A reusable capability package. */
export interface Skill {
  /** Unique skill name. */
  name: string;
  /** When to use this skill — drives auto-activation and discovery. */
  description: string;
  /** Semver-ish version. */
  version: string;
  /** System-prompt fragment injected when the skill is active. */
  instructions: string;
  /** Tools this skill grants/needs (added to the node's available tools). */
  allowedTools?: string[];
  /** Resources loadable on demand. */
  resources?: SkillResource[];
  /** Activation policy. Default: "manual". */
  activation: SkillActivation;
  /** Declared parameters. */
  parameters?: SkillParameter[];
  /** Explicit keywords to aid heuristic activation (in addition to description). */
  keywords?: string[];
  /** Arbitrary metadata from frontmatter. */
  metadata?: Record<string, unknown>;
  /** Directory the skill was loaded from (for resolving resource paths). */
  dir?: string;
}

/** A skill selected for activation, with the reason and (for auto) a score. */
export interface ActiveSkill {
  skill: Skill;
  reason: SkillActivation;
  /** Relevance score in [0,1] for auto-activated skills. */
  score?: number;
}
