// ============================================
// Skill Composition
// ============================================
// Folds a set of active skills into the two things a node consumes: an
// addition to its system prompt (the skills' instructions) and a set of
// granted tools (the union of each skill's allowedTools).

import type { ActiveSkill } from "./types.js";

export interface ComposedSkills {
  /** System-prompt section with active skill instructions (empty if none). */
  systemPrompt: string;
  /** Union of allowedTools across the active skills. */
  allowedTools: string[];
  /** The active skills folded in. */
  active: ActiveSkill[];
}

/** Compose active skills into a prompt section + granted tool set. */
export function composeSkills(active: ActiveSkill[]): ComposedSkills {
  if (active.length === 0) {
    return { systemPrompt: "", allowedTools: [], active: [] };
  }

  const toolSet = new Set<string>();
  const sections: string[] = [];
  for (const { skill } of active) {
    for (const t of skill.allowedTools ?? []) toolSet.add(t);
    sections.push(`## Skill: ${skill.name}\n${skill.instructions}`.trim());
  }

  const systemPrompt =
    "# Active Skills\n" +
    "The following skills are active for this task — follow their instructions.\n\n" +
    sections.join("\n\n");

  return { systemPrompt, allowedTools: [...toolSet], active };
}

/** Append a composed skill prompt to an existing system message safely. */
export function appendSkillPrompt(
  base: string | undefined,
  skillPrompt: string,
): string {
  if (!skillPrompt) return base ?? "";
  if (!base) return skillPrompt;
  return `${base}\n\n${skillPrompt}`;
}
