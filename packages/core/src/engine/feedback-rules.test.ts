// ============================================
// Feedback Rules — Unit Tests
// ============================================

import { describe, it, expect } from "vitest";
import { PipelineOrchestrator } from "./pipeline.js";
import { applyFeedbackRules } from "./feedback-rules.js";
import { BaseLoopNode } from "../loops/base.js";
import type { NodeContext, NodeResult } from "../types/pipeline.js";

/** Emits an "evaluation" signal with a configurable verdict every cycle. */
class EvalNode extends BaseLoopNode {
  constructor(private verdict: string) {
    super({
      id: "evaluator",
      name: "Evaluator",
      category: "evaluation",
      description: "emits evaluation",
      config: { maxIterations: 1, delayMs: 0, frequency: { everyNIterations: 1 } },
      outputPorts: [{ name: "out", direction: "output", signalTypes: ["evaluation"], description: "verdict" }],
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    context.emit("out", "evaluation", { verdict: this.verdict });
    return this.emptyResult();
  }
}

/** Records every signal it receives on its "fix" input port. */
class FixerNode extends BaseLoopNode {
  public received: Array<{ type: string; data: Record<string, unknown> }> = [];
  constructor() {
    super({
      id: "fixer",
      name: "Fixer",
      category: "execution",
      description: "consumes corrections",
      config: { maxIterations: 1, delayMs: 0 },
      inputPorts: [{ name: "fix", direction: "input", signalTypes: ["corrections"], description: "fixes" }],
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    for (const s of context.inputSignals) this.received.push({ type: s.type, data: s.data });
    return this.emptyResult();
  }
}

function pipelineWith(verdict: string, rule: Parameters<typeof applyFeedbackRules>[1][number], maxCycles = 3) {
  const evaluator = new EvalNode(verdict);
  const fixer = new FixerNode();
  const p = new PipelineOrchestrator({ name: "fb", workingDir: "/tmp", maxCycles, delayMs: 0 });
  p.addNode(evaluator).addNode(fixer);
  applyFeedbackRules(p, [rule]);
  return { p, fixer };
}

const baseRule = {
  from: "evaluator",
  fromPort: "out",
  to: "fixer",
  toPort: "fix",
  whenSignal: "evaluation",
  where: (d: Record<string, unknown>) => d.verdict === "fail",
  asSignal: "corrections",
};

describe("applyFeedbackRules", () => {
  it("routes a matching signal, re-typed, to the target port", async () => {
    const { p, fixer } = pipelineWith("fail", { ...baseRule, maxFires: 1 });
    await p.run();
    expect(fixer.received).toHaveLength(1);
    expect(fixer.received[0].type).toBe("corrections");
    expect(fixer.received[0].data.verdict).toBe("fail");
  });

  it("does not route when the `where` predicate fails", async () => {
    const { p, fixer } = pipelineWith("pass", { ...baseRule });
    await p.run();
    expect(fixer.received).toHaveLength(0);
  });

  it("respects maxFires (anti-loop)", async () => {
    // Evaluator emits every cycle for 3 cycles, but maxFires caps deliveries at 2.
    const { p, fixer } = pipelineWith("fail", { ...baseRule, maxFires: 2 }, 3);
    await p.run();
    expect(fixer.received).toHaveLength(2);
  });

  it("applies a data transform", async () => {
    const { p, fixer } = pipelineWith("fail", {
      ...baseRule,
      maxFires: 1,
      transform: (d) => ({ ...d, note: "please fix" }),
    });
    await p.run();
    expect(fixer.received[0].data.note).toBe("please fix");
  });
});
