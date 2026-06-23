// ============================================
// @agentic-lab/core — Skills subsystem
// ============================================

export type {
  Skill,
  ActiveSkill,
  SkillActivation,
  SkillResource,
  SkillParameter,
} from "./types.js";

export { parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";
export { SkillRegistry, skillFromMarkdown } from "./registry.js";
export {
  loadSkillsFromDir,
  loadSkillResource,
  type LoadSkillsResult,
} from "./loader.js";
export {
  resolveActiveSkills,
  selectStaticSkills,
  cosineSimilarity,
  heuristicSharedTerms,
  type ActivationContext,
  type ActivateOptions,
} from "./activation.js";
export {
  composeSkills,
  appendSkillPrompt,
  type ComposedSkills,
} from "./compose.js";
