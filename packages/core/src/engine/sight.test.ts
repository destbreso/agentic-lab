// What each role sees, measured: every built-in topology's sight matrix is
// pinned as a file snapshot (src/engine/__sight__), so a change that moves a
// wall fails CI. The snapshots double as the reference the viewer will draw.

import { describe, it, expect } from "vitest";
import { listRecipes } from "../loops/recipes.js";
import { measureSight, renderSight, type SightMatrix } from "./sight.js";

describe("measureSight", () => {
  for (const recipe of listRecipes()) {
    it(`pins what each role of ${recipe.name} sees`, async () => {
      const matrix = await measureSight(recipe.id);
      await expect(renderSight(matrix)).toMatchFileSnapshot(`./__sight__/${recipe.id}.txt`);
    });
  }

  it("in Deep Reasoning, Critique and Decide see the process, never the work", async () => {
    const m: SightMatrix = await measureSight("deep-reasoning");
    const content = ["task", "conversation", "memories", "note", "plan", "account", "world", "evidence"];
    for (const role of ["critic", "refine"]) {
      for (const row of content) expect(m.cells[row][role], `${row} → ${role}`).toBe("none");
    }
    // Do reads the corrections sent back, the plan and your task.
    expect(m.cells.corrections.exec).toBe("prompt");
    expect(m.cells.plan.exec).toBe("prompt");
    expect(m.cells.task.exec).toBe("prompt");
    // Plan never reads Do's account.
    expect(m.cells.account.plan).toBe("none");
  });
});
