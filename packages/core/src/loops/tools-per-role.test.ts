// Each built-in topology gives each role only the tools its job needs: Do
// changes the workspace, Plan and Check only read it, so neither can write
// what Check verifies. Measured from the tools offered on every recorded call.

import { describe, it, expect } from "vitest";
import { AgentSession } from "../engine/agent-session.js";
import { listRecipes, getRecipe } from "./recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";
import { WRITE_TOOLS } from "./tool-policies.js";
import type { Skill } from "../skills/types.js";
import type { LoopCategory, Recipe } from "../types/pipeline.js";

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["e"], corrections: ["c"], confidence: 0.5 });

/** One failing round, so every role of every topology gets a turn. */
const script = (c: ScriptedCall) => (c.role === "check" && c.turn === 1 ? FAIL : undefined);

/** The tools offered to each role, by category, over a whole run. */
async function toolsOffered(topology: string | Recipe, skills: Skill[] = []) {
  const run = await new AgentSession({
    provider: scriptedProvider(script),
    tools: createDefaultToolkit(),
    topology,
    workingDir: "/tmp",
    delayMs: 0,
    skills,
    manualSkills: skills.map((s) => s.name),
  }).run("the task");
  const byRole = new Map<string, { category: LoopCategory; tools: Set<string>; calls: number; system: string }>();
  for (const step of run.steps) {
    const entry = byRole.get(step.role) ?? { category: step.category, tools: new Set<string>(), calls: 0, system: "" };
    for (const call of step.calls) {
      entry.calls++;
      entry.system ||= call.messages.find((m) => m.role === "system")?.content ?? "";
      for (const t of call.tools) entry.tools.add(t);
    }
    byRole.set(step.role, entry);
  }
  return byRole;
}

describe("tools per role", () => {
  for (const recipe of listRecipes()) {
    it(`${recipe.name}: Do writes; Plan and Check only read; the others get no tools`, async () => {
      const roles = await toolsOffered(recipe.id);
      for (const [id, { category, tools, calls }] of roles) {
        if (calls === 0) continue;
        const offered = [...tools].sort();
        if (category === "execution") {
          expect(offered, id).toEqual(["file_read", "file_write", "git", "glob", "grep", "shell"]);
        } else if (category === "planning" || category === "evaluation") {
          expect(offered, id).toEqual(["file_read", "glob", "grep"]);
        } else {
          expect(offered, id).toEqual([]);
        }
      }
    });
  }

  it("Plan in Deep Reasoning is offered no tool that writes", async () => {
    const roles = await toolsOffered("deep-reasoning");
    const plan = roles.get("plan")!;
    expect(plan.calls).toBeGreaterThan(0);
    for (const t of WRITE_TOOLS) expect(plan.tools.has(t), t).toBe(false);
  });

  it("a skill that grants writing tools cannot give them to Check", async () => {
    const writer: Skill = {
      name: "writer",
      description: "writes files",
      version: "1.0.0",
      instructions: "MARK-SKILL Write what you must.",
      allowedTools: ["file_write", "shell"],
      activation: "manual",
    };
    const roles = await toolsOffered("exec-eval", [writer]);
    // The skill reached Check (its instructions are in Check's system prompt), its tools did not.
    expect(roles.get("eval")!.system).toContain("MARK-SKILL");
    expect([...roles.get("eval")!.tools].sort()).toEqual(["file_read", "glob", "grep"]);
    expect(roles.get("exec")!.tools.has("file_write")).toBe(true);
  });

  it("a definition can still give a role other tools on purpose", async () => {
    const base = getRecipe("exec-eval")!;
    const recipe: Recipe = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "eval" ? { ...n, config: { ...n.config, toolPolicy: { allow: ["file_read", "shell"] } } } : n)),
    };
    const roles = await toolsOffered(recipe);
    expect([...roles.get("eval")!.tools].sort()).toEqual(["file_read", "shell"]);
  });
});
