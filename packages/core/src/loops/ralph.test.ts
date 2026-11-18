// The Ralph Loop recipe loops: one turn per round, again while PLAN.md has
// unchecked items, 20 turns at most.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instantiateRecipe, getRecipe } from "./recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, type ScriptedCall } from "../test-support/scripted-provider.js";

const PLAN = "# Plan\n\n- [ ] one\n- [ ] two\n- [ ] three\n";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ralph-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A Do that checks off the first open item each turn, through the real file tool. */
function checkOneItemPerTurn() {
  return async (c: ScriptedCall) => {
    if (c.role !== "do") return undefined;
    const lastMessage = c.options.messages.at(-1)!;
    if (lastMessage.role === "tool") return `checked an item (turn ${c.turn})`;
    const plan = await readFile(join(dir, "PLAN.md"), "utf-8");
    return {
      toolCalls: [{ name: "file_write", arguments: { path: "PLAN.md", content: plan.replace("- [ ]", "- [x]") } }],
    };
  };
}

function ralph(script: (c: ScriptedCall) => unknown, overrides: { maxCycles?: number } = {}) {
  const provider = scriptedProvider(script as never);
  const pipeline = instantiateRecipe(
    "ralph-loop",
    { provider, tools: createDefaultToolkit(["file_read", "file_write"]), workingDir: dir },
    { delayMs: 0, ...overrides },
  );
  return { provider, pipeline };
}

describe("Ralph Loop", () => {
  it("is capped at 20 turns", () => {
    expect(getRecipe("ralph-loop")!.defaults.maxCycles).toBe(20);
  });

  it("runs more than one turn while the plan is incomplete, and stops when it is done", async () => {
    await writeFile(join(dir, "PLAN.md"), PLAN);
    const { provider, pipeline } = ralph(checkOneItemPerTurn());
    const turns: number[] = [];
    pipeline.on("node:start", ({ cycle }) => turns.push(cycle));
    const result = await pipeline.run();

    expect(turns).toEqual([1, 2, 3]);
    expect(await readFile(join(dir, "PLAN.md"), "utf-8")).not.toContain("- [ ]");
    expect(result.outcome).toBe("passed");
    expect(result.reason).toMatch(/plan is done/);
    // Each turn showed Do the plan file as it stood.
    expect(provider.promptsOf("do")[0]).toContain("- [ ] one");
  });

  it("stops at its turn limit with the plan unfinished, and that is a failure", async () => {
    await writeFile(join(dir, "PLAN.md"), PLAN);
    const { pipeline } = ralph(() => "I did nothing", { maxCycles: 4 });
    const result = await pipeline.run();
    expect(result.totalCycles).toBe(4);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/round limit \(4\)/);
  });

  it("takes one turn when there is no plan file, and claims nothing", async () => {
    const { pipeline } = ralph(() => "answered");
    const result = await pipeline.run();
    expect(result.totalCycles).toBe(1);
    expect(result.outcome).toBe("inconclusive");
    expect(result.success).toBe(false);
  });
});
