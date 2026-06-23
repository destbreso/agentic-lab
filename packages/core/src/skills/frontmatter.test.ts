// ============================================
// Frontmatter + Skill parsing — Unit Tests
// ============================================

import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";
import { skillFromMarkdown, SkillRegistry } from "./registry.js";

const SKILL_MD = `---
name: code-reviewer
description: Review diffs for bugs and risky changes
version: 2.1.0
activation: auto
allowedTools: [file_read, grep, git]
keywords:
  - review
  - bugs
maxFindings: 10
enabled: true
---
# Code Reviewer

Inspect the diff and report concrete issues.
`;

describe("parseFrontmatter", () => {
  it("parses scalars, inline lists, block lists, numbers and booleans", () => {
    const { data, body } = parseFrontmatter(SKILL_MD);
    expect(data.name).toBe("code-reviewer");
    expect(data.version).toBe("2.1.0"); // version stays a string via quotes? here it's coerced
    expect(data.activation).toBe("auto");
    expect(data.allowedTools).toEqual(["file_read", "grep", "git"]);
    expect(data.keywords).toEqual(["review", "bugs"]);
    expect(data.maxFindings).toBe(10);
    expect(data.enabled).toBe(true);
    expect(body).toContain("# Code Reviewer");
  });

  it("returns empty data and full body when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("just a body, no frontmatter");
    expect(data).toEqual({});
    expect(body).toBe("just a body, no frontmatter");
  });

  it("strips quotes from quoted values", () => {
    const { data } = parseFrontmatter(`---\nname: "quoted name"\n---\nbody`);
    expect(data.name).toBe("quoted name");
  });
});

describe("skillFromMarkdown", () => {
  it("maps frontmatter + body into a Skill", () => {
    const skill = skillFromMarkdown(SKILL_MD, { dir: "/skills/code-reviewer" });
    expect(skill.name).toBe("code-reviewer");
    expect(skill.description).toContain("Review diffs");
    expect(skill.version).toBe("2.1.0");
    expect(skill.activation).toBe("auto");
    expect(skill.allowedTools).toEqual(["file_read", "grep", "git"]);
    expect(skill.keywords).toEqual(["review", "bugs"]);
    expect(skill.instructions).toContain("Inspect the diff");
    expect(skill.dir).toBe("/skills/code-reviewer");
    // unknown frontmatter keys go to metadata
    expect(skill.metadata).toMatchObject({ maxFindings: 10, enabled: true });
  });

  it("defaults version to 1.0.0 and activation to manual", () => {
    const skill = skillFromMarkdown(`---\nname: x\ndescription: y\n---\nbody`);
    expect(skill.version).toBe("1.0.0");
    expect(skill.activation).toBe("manual");
  });

  it("coerces an invalid activation to manual", () => {
    const skill = skillFromMarkdown(`---\nname: x\ndescription: y\nactivation: bogus\n---\n`);
    expect(skill.activation).toBe("manual");
  });

  it("throws when name or description is missing", () => {
    expect(() => skillFromMarkdown(`---\ndescription: y\n---\n`)).toThrow(/name/);
    expect(() => skillFromMarkdown(`---\nname: x\n---\n`)).toThrow(/description/);
  });
});

describe("SkillRegistry", () => {
  it("registers, gets, lists, resolves and removes", () => {
    const reg = new SkillRegistry();
    reg.registerFromMarkdown(SKILL_MD);
    reg.register({ name: "other", description: "d", version: "1.0.0", instructions: "i", activation: "always" });

    expect(reg.has("code-reviewer")).toBe(true);
    expect(reg.get("other")?.activation).toBe("always");
    expect(reg.list()).toHaveLength(2);
    expect(reg.resolve(["other", "nope"]).map((s) => s.name)).toEqual(["other"]);
    expect(reg.remove("other")).toBe(true);
    expect(reg.list()).toHaveLength(1);
    reg.clear();
    expect(reg.list()).toHaveLength(0);
  });
});
