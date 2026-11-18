// The builder runs its graph through AgentSession: a loaded recipe keeps its
// own ports, so Deep Reasoning runs from the canvas, and the run ends with
// its honest outcome.

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { listRecipes, registerProvider } from "@agentic-lab/core";
import { POST } from "./route";
import { scriptedProvider } from "../../../../../../core/src/test-support/scripted-provider";

registerProvider(
  "builder-mock",
  class {
    constructor() {
      return scriptedProvider();
    }
  } as never,
);

/** The canvas's payload for a built-in recipe, nodes with their own ports, laid out left to right. */
function canvasOf(id: string) {
  const recipe = listRecipes().find((r) => r.id === id)!;
  return {
    nodes: recipe.nodes.map((n, i) => ({ id: n.id, type: n.type, name: n.name, x: 100 + i * 200, y: 100, ports: n.ports })),
    wires: recipe.wires.map((w) => ({
      from: { nodeId: w.sourcePortId.split(":out:")[0], port: w.sourcePortId.split(":out:")[1] },
      to: { nodeId: w.targetPortId.split(":in:")[0], port: w.targetPortId.split(":in:")[1] },
    })),
  };
}

async function events(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest("http://localhost/api/pipelines/run", { method: "POST", body: JSON.stringify(body) }),
  );
  const text = await res.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((l) => l.startsWith("data: ")))
    .filter(Boolean)
    .map((l) => JSON.parse(l!.slice(6)) as Record<string, unknown>);
}

describe("builder run", () => {
  it("runs Deep Reasoning from the canvas through the session", async () => {
    const out = await events({ ...canvasOf("deep-reasoning"), provider: "builder-mock", model: "m", task: "add 2 and 2" });
    const started = out.filter((e) => e.event === "node:start").map((e) => e.nodeId);
    expect(started).toEqual(["plan", "exec", "eval", "critic", "refine"]);
    expect(out.some((e) => e.event === "engine" && e.type === "run:start")).toBe(true);
    expect(out.at(-1)).toMatchObject({ event: "complete", outcome: "passed", success: true, cycles: 1 });
  });

  it("reports an error, not a crash, for a wire the target cannot accept", async () => {
    const out = await events({
      nodes: [
        { id: "exec", type: "execution", name: "Do", x: 0, y: 0 },
        { id: "eval", type: "evaluation", name: "Check", x: 300, y: 0 },
      ],
      wires: [{ from: { nodeId: "exec", port: "result" }, to: { nodeId: "eval", port: "ground_truth" } }],
      provider: "builder-mock",
      model: "m",
    });
    expect(out.at(-1)).toMatchObject({ event: "error" });
    expect(String(out.at(-1)!.error)).toMatch(/Wire refused/);
  });
});
