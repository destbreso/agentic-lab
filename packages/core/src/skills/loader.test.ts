// ============================================
// Skill Loader — Unit Tests (filesystem)
// ============================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkillsFromDir, loadSkillResource } from "./loader.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-"));

  // Valid skill with a resource file.
  const good = path.join(root, "code-reviewer");
  await fs.mkdir(path.join(good, "resources"), { recursive: true });
  await fs.writeFile(
    path.join(good, "SKILL.md"),
    `---\nname: code-reviewer\ndescription: Review diffs\nactivation: auto\nallowedTools: [git]\n---\nReview the diff carefully.\n`,
  );
  await fs.writeFile(path.join(good, "resources", "checklist.md"), "1. nil checks\n");

  // Malformed skill (missing description) — should be reported, not throw.
  const bad = path.join(root, "broken");
  await fs.mkdir(bad, { recursive: true });
  await fs.writeFile(path.join(bad, "SKILL.md"), `---\nname: broken\n---\nno description\n`);

  // A non-skill directory (no SKILL.md) — silently ignored.
  await fs.mkdir(path.join(root, "notaskill"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("loadSkillsFromDir", () => {
  it("loads valid skills and reports malformed ones", async () => {
    const { skills, errors } = await loadSkillsFromDir(root);
    expect(skills.map((s) => s.name)).toEqual(["code-reviewer"]);
    expect(skills[0].dir).toBe(path.join(root, "code-reviewer"));
    expect(errors).toHaveLength(1);
    expect(errors[0].dir).toBe(path.join(root, "broken"));
  });

  it("returns empty for a missing directory (graceful)", async () => {
    const res = await loadSkillsFromDir(path.join(root, "does-not-exist"));
    expect(res.skills).toEqual([]);
    expect(res.errors).toEqual([]);
  });
});

describe("loadSkillResource", () => {
  it("reads a resource file relative to the skill dir", async () => {
    const { skills } = await loadSkillsFromDir(root);
    const skill = { ...skills[0], resources: [{ name: "checklist", path: "resources/checklist.md" }] };
    const content = await loadSkillResource(skill, "checklist");
    expect(content).toContain("nil checks");
  });

  it("prefers inline content", async () => {
    const skill = {
      name: "x",
      description: "d",
      version: "1.0.0",
      instructions: "i",
      activation: "manual" as const,
      resources: [{ name: "inline", content: "hello" }],
    };
    expect(await loadSkillResource(skill, "inline")).toBe("hello");
  });

  it("throws for an unknown resource", async () => {
    const skill = {
      name: "x",
      description: "d",
      version: "1.0.0",
      instructions: "i",
      activation: "manual" as const,
    };
    await expect(loadSkillResource(skill, "nope")).rejects.toThrow(/no resource/);
  });
});
