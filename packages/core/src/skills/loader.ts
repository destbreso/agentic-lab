// ============================================
// Skill Loader (filesystem)
// ============================================
// Loads SKILL.md packages from a skills directory:
//
//   <dir>/<skill-name>/
//     SKILL.md        # frontmatter + instructions
//     resources/...    # loaded on demand
//
// Degrades gracefully: a missing directory yields an empty list, and a
// malformed SKILL.md is skipped (with a collected warning) rather than
// failing the whole load.

import { promises as fs } from "node:fs";
import path from "node:path";
import { skillFromMarkdown } from "./registry.js";
import type { Skill, SkillResource } from "./types.js";

export interface LoadSkillsResult {
  skills: Skill[];
  /** Per-directory parse errors (skill dir → message). */
  errors: Array<{ dir: string; error: string }>;
}

/**
 * Load all skills under `dir`. Each immediate subdirectory containing a
 * SKILL.md is parsed into a Skill (with `dir` set for resource resolution).
 */
export async function loadSkillsFromDir(dir: string): Promise<LoadSkillsResult> {
  const result: LoadSkillsResult = { skills: [], errors: [] };

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result; // directory absent → no skills (graceful)
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    try {
      const md = await fs.readFile(skillFile, "utf8");
      result.skills.push(skillFromMarkdown(md, { dir: skillDir }));
    } catch (error) {
      // Missing SKILL.md is not an error; a malformed one is reported.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        result.errors.push({ dir: skillDir, error: (error as Error).message });
      }
    }
  }

  return result;
}

/**
 * Load a named resource's content for a skill. Prefers inline `content`,
 * otherwise reads the file at `<skill.dir>/<resource.path>`.
 */
export async function loadSkillResource(
  skill: Skill,
  resourceName: string,
): Promise<string> {
  const resource: SkillResource | undefined = skill.resources?.find(
    (r) => r.name === resourceName,
  );
  if (!resource) {
    throw new Error(`Skill "${skill.name}" has no resource "${resourceName}"`);
  }
  if (resource.content !== undefined) return resource.content;
  if (resource.path && skill.dir) {
    return fs.readFile(path.join(skill.dir, resource.path), "utf8");
  }
  throw new Error(
    `Resource "${resourceName}" of skill "${skill.name}" has no content or resolvable path`,
  );
}
