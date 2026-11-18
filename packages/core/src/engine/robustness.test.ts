// Robustness: stopping a run aborts the calls in flight, the tool cap and a
// failed node fail the run loudly, and no run whose roles failed reports success.

import { describe, it, expect } from "vitest";
import { instantiateRecipe } from "../loops/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider, untilAborted, type ScriptedCall, type ScriptedReply } from "../test-support/scripted-provider.js";

function exec(recipe: string, script: (c: ScriptedCall) => ScriptedReply | string | undefined | Promise<never>) {
  const provider = scriptedProvider(script);
  const pipeline = instantiateRecipe(
    recipe,
    { provider, tools: createDefaultToolkit(["file_read"]), workingDir: "/tmp", seedShared: { task: "t" } },
    { delayMs: 0 },
  );
  return { provider, pipeline };
}

describe("abort through NodeContext", () => {
  it("stopping the run aborts the model call in flight", async () => {
    const { provider, pipeline } = exec("exec-eval", (c) => untilAborted(c.signal));
    setTimeout(() => pipeline.stop("user pressed stop"), 50);
    const started = Date.now();
    const result = await pipeline.run();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(provider.calls[0].signal?.aborted).toBe(true);
    expect(result.outcome).toBe("stopped");
    expect(result.success).toBe(false);
    // Check never ran: the run ended where it was stopped.
    expect(provider.promptsOf("check")).toHaveLength(0);
  });

  it("a node's turn timeout aborts its calls and fails the run", async () => {
    const provider = scriptedProvider((c) => untilAborted(c.signal));
    const pipeline = instantiateRecipe(
      "exec-eval",
      { provider, tools: createDefaultToolkit([]), workingDir: "/tmp" },
      { delayMs: 0, timeoutMs: 80 },
    );
    const result = await pipeline.run();
    expect(provider.calls[0].signal?.aborted).toBe(true);
    expect(result.outcome).toBe("failed");
  });
});

describe("explicit failures", () => {
  it("Do hitting its tool-call cap fails the run and says so", async () => {
    const { provider, pipeline } = exec("exec-eval", (c) =>
      c.role === "do" ? { toolCalls: [{ name: "file_read", arguments: { path: "nothing-here.txt" } }] } : undefined,
    );
    const result = await pipeline.run();
    expect(provider.promptsOf("do").length).toBe(20);
    expect(result.outcome).toBe("failed");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Executor failed: hit the tool-call cap \(20 rounds\)/);
    expect(provider.promptsOf("check")).toHaveLength(0);
  });

  it("a role whose model call fails ends the run as failed, and the roles after it do not run", async () => {
    const { provider, pipeline } = exec("deep-reasoning", (c) => {
      if (c.role === "do") throw new Error("model unreachable");
      return undefined;
    });
    const result = await pipeline.run();
    expect(result.outcome).toBe("failed");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Executor failed: model unreachable/);
    expect(provider.promptsOf("check")).toHaveLength(0);
  });

  it("a tool error is the model's feedback, not the role's failure", async () => {
    const { pipeline } = exec("exec-eval", (c) => {
      if (c.role !== "do") return undefined;
      return c.options.messages.at(-1)!.role === "tool"
        ? "the file is missing"
        : { toolCalls: [{ name: "file_read", arguments: { path: "nothing-here.txt" } }] };
    });
    const result = await pipeline.run();
    expect(result.outcome).toBe("passed");
  });
});
