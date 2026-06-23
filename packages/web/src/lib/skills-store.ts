// ============================================
// Skills store (web)
// ============================================
// Provides the skills available to the agent: a small set of built-ins plus
// any SKILL.md packages found in the skills directory (graceful when absent).

import path from "node:path";
import { loadSkillsFromDir, type Skill } from "@agentic-lab/core";

const BUILTIN_SKILLS: Skill[] = [
  {
    name: "code-reviewer",
    description: "Review code diffs for bugs, edge cases and risky changes",
    version: "1.0.0",
    activation: "auto",
    keywords: ["review", "bug", "diff", "quality", "audit"],
    allowedTools: ["file_read", "grep", "git"],
    instructions:
      "Act as a meticulous code reviewer. Inspect the diff and flag concrete bugs, " +
      "missing edge cases, and risky changes. Prefer specific, actionable feedback " +
      "with file:line references over general comments.",
  },
  {
    name: "test-writer",
    description: "Write thorough unit tests for the changed code",
    version: "1.0.0",
    activation: "auto",
    keywords: ["test", "unit", "coverage", "vitest", "jest", "spec"],
    allowedTools: ["file_read", "file_write", "shell"],
    instructions:
      "Write focused unit tests covering happy paths, edge cases and error handling. " +
      "Match the project's existing test framework and style. Keep tests deterministic.",
  },
  {
    name: "refactorer",
    description: "Refactor code for clarity and reuse without changing behavior",
    version: "1.0.0",
    activation: "manual",
    keywords: ["refactor", "cleanup", "dry", "readability"],
    allowedTools: ["file_read", "file_write", "grep"],
    instructions:
      "Refactor for readability and reuse while preserving behavior exactly. Make " +
      "minimal, well-scoped changes and keep the public API stable.",
  },
  {
    name: "doc-writer",
    description: "Write clear documentation and docstrings for code",
    version: "1.0.0",
    activation: "auto",
    keywords: ["docs", "documentation", "readme", "docstring", "comment"],
    allowedTools: ["file_read", "file_write"],
    instructions:
      "Write concise, accurate documentation. Explain the why, not just the what. " +
      "Match the surrounding documentation style and keep examples runnable.",
  },
];

/** Resolve the available skills: built-ins overlaid with any from the FS. */
export async function getSkills(): Promise<Skill[]> {
  const dir =
    process.env.AGENTIC_SKILLS_DIR ||
    path.join(process.cwd(), ".agentic-lab", "skills");

  const byName = new Map<string, Skill>();
  for (const s of BUILTIN_SKILLS) byName.set(s.name, s);

  try {
    const { skills } = await loadSkillsFromDir(dir);
    for (const s of skills) byName.set(s.name, s); // filesystem overrides built-ins
  } catch {
    /* no skills dir — built-ins only */
  }

  return [...byName.values()];
}
