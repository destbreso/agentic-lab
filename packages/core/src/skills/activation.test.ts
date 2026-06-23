// ============================================
// Skill Activation + Composition — Unit Tests
// ============================================

import { describe, it, expect } from "vitest";
import {
  resolveActiveSkills,
  selectStaticSkills,
  cosineSimilarity,
  heuristicSharedTerms,
} from "./activation.js";
import { composeSkills, appendSkillPrompt } from "./compose.js";
import type { Skill } from "./types.js";

function skill(name: string, partial: Partial<Skill> = {}): Skill {
  return {
    name,
    description: partial.description ?? name,
    version: "1.0.0",
    instructions: partial.instructions ?? `do ${name}`,
    activation: partial.activation ?? "manual",
    allowedTools: partial.allowedTools,
    keywords: partial.keywords,
  };
}

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("is 0 for empty or mismatched vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});

describe("heuristicSharedTerms", () => {
  it("counts shared meaningful terms", () => {
    const s = skill("sorter", { description: "sort arrays quickly", keywords: ["sorting"] });
    expect(heuristicSharedTerms("please sort the array", s)).toBeGreaterThan(0);
    expect(heuristicSharedTerms("render a webpage", s)).toBe(0);
  });
});

describe("resolveActiveSkills", () => {
  const always = skill("logger", { activation: "always" });
  const manual = skill("deployer", { activation: "manual" });
  const autoSort = skill("sorter", { activation: "auto", description: "sort arrays", keywords: ["sort"] });
  const autoReview = skill("reviewer", { activation: "auto", description: "review code", keywords: ["review"] });
  const all = [always, manual, autoSort, autoReview];

  it("includes always skills unconditionally", async () => {
    const active = await resolveActiveSkills(all, { query: "anything" });
    expect(active.find((a) => a.skill.name === "logger")?.reason).toBe("always");
  });

  it("includes manually attached skills", async () => {
    const active = await resolveActiveSkills(all, { query: "x", manualSkills: ["deployer"] });
    expect(active.find((a) => a.skill.name === "deployer")?.reason).toBe("manual");
  });

  it("auto-activates relevant skills via heuristic", async () => {
    const active = await resolveActiveSkills(all, { query: "please sort this list" });
    const names = active.map((a) => a.skill.name);
    expect(names).toContain("sorter");
    expect(names).not.toContain("reviewer");
  });

  it("auto-activates via embeddings when an embed fn is provided", async () => {
    // Toy 3-dim embedding keyed on presence of domain terms.
    const embed = async (text: string) => {
      const t = text.toLowerCase();
      return [t.includes("sort") ? 1 : 0, t.includes("review") ? 1 : 0, t.includes("test") ? 1 : 0];
    };
    const active = await resolveActiveSkills(
      all,
      { query: "sort the array please" },
      { embed, threshold: 0.5 },
    );
    const names = active.map((a) => a.skill.name);
    expect(names).toContain("sorter");
    expect(names).not.toContain("reviewer");
  });

  it("caps the number of auto-activated skills", async () => {
    const autos = [
      skill("a", { activation: "auto", description: "data data", keywords: ["data"] }),
      skill("b", { activation: "auto", description: "data data", keywords: ["data"] }),
      skill("c", { activation: "auto", description: "data data", keywords: ["data"] }),
    ];
    const active = await resolveActiveSkills(autos, { query: "data" }, { maxAuto: 2 });
    expect(active.filter((a) => a.reason === "auto")).toHaveLength(2);
  });
});

describe("selectStaticSkills", () => {
  it("returns always + manual only (no query needed)", () => {
    const all = [
      skill("logger", { activation: "always" }),
      skill("deployer", { activation: "manual" }),
      skill("sorter", { activation: "auto" }),
    ];
    const active = selectStaticSkills(all, ["deployer"]);
    const names = active.map((a) => a.skill.name).sort();
    expect(names).toEqual(["deployer", "logger"]);
  });
});

describe("composeSkills", () => {
  it("builds a prompt section and unions tools", () => {
    const active = [
      { skill: skill("a", { instructions: "Do A", allowedTools: ["git"] }), reason: "manual" as const },
      { skill: skill("b", { instructions: "Do B", allowedTools: ["git", "grep"] }), reason: "always" as const },
    ];
    const composed = composeSkills(active);
    expect(composed.allowedTools.sort()).toEqual(["git", "grep"]);
    expect(composed.systemPrompt).toContain("Do A");
    expect(composed.systemPrompt).toContain("Do B");
    expect(composed.systemPrompt).toContain("# Active Skills");
  });

  it("returns empty for no active skills", () => {
    expect(composeSkills([])).toEqual({ systemPrompt: "", allowedTools: [], active: [] });
  });
});

describe("appendSkillPrompt", () => {
  it("appends to an existing base", () => {
    expect(appendSkillPrompt("BASE", "SKILL")).toBe("BASE\n\nSKILL");
  });
  it("handles missing base or skill prompt", () => {
    expect(appendSkillPrompt(undefined, "SKILL")).toBe("SKILL");
    expect(appendSkillPrompt("BASE", "")).toBe("BASE");
  });
});
