import { describe, it, expect } from "vitest";
import {
  compileWireFeedback,
  evaluatePredicate,
  getByPath,
} from "./wire-feedback.js";
import { PipelineOrchestrator } from "./pipeline.js";
import { BaseLoopNode } from "../loops/base.js";
import type {
  NodeContext,
  NodeResult,
  Signal,
  WireFeedback,
} from "../types/pipeline.js";

function sig(type: string, data: Record<string, unknown> = {}): Signal {
  return { sourceNodeId: "n", type, data, timestamp: new Date().toISOString() };
}

describe("getByPath", () => {
  it("reads a top-level field", () => {
    expect(getByPath({ a: 1 }, "a")).toBe(1);
  });
  it("reads a nested dot-path", () => {
    expect(getByPath({ metrics: { score: 0.9 } }, "metrics.score")).toBe(0.9);
  });
  it("returns undefined for missing path", () => {
    expect(getByPath({ a: {} }, "a.b.c")).toBeUndefined();
  });
  it("returns undefined for empty path", () => {
    expect(getByPath({ a: 1 }, "")).toBeUndefined();
  });
});

describe("evaluatePredicate", () => {
  const data = { decision: "refine", score: 0.4, tags: ["x", "y"], note: "hello" };
  it("eq / ne", () => {
    expect(evaluatePredicate({ field: "decision", op: "eq", value: "refine" }, data)).toBe(true);
    expect(evaluatePredicate({ field: "decision", op: "ne", value: "refine" }, data)).toBe(false);
  });
  it("numeric comparisons", () => {
    expect(evaluatePredicate({ field: "score", op: "lt", value: 0.7 }, data)).toBe(true);
    expect(evaluatePredicate({ field: "score", op: "gte", value: 0.4 }, data)).toBe(true);
    expect(evaluatePredicate({ field: "score", op: "gt", value: 0.4 }, data)).toBe(false);
  });
  it("exists / truthy / falsy", () => {
    expect(evaluatePredicate({ field: "decision", op: "exists" }, data)).toBe(true);
    expect(evaluatePredicate({ field: "missing", op: "exists" }, data)).toBe(false);
    expect(evaluatePredicate({ field: "score", op: "truthy" }, data)).toBe(true);
    expect(evaluatePredicate({ field: "missing", op: "falsy" }, data)).toBe(true);
  });
  it("contains on arrays and strings", () => {
    expect(evaluatePredicate({ field: "tags", op: "contains", value: "x" }, data)).toBe(true);
    expect(evaluatePredicate({ field: "note", op: "contains", value: "ell" }, data)).toBe(true);
    expect(evaluatePredicate({ field: "tags", op: "contains", value: "z" }, data)).toBe(false);
  });
});

describe("compileWireFeedback", () => {
  it("returns no filter/transform for an empty spec (plain wire)", () => {
    const c = compileWireFeedback({});
    expect(c.filter).toBeUndefined();
    expect(c.transform).toBeUndefined();
  });

  it("whenSignal filters by signal type", () => {
    const { filter } = compileWireFeedback({ whenSignal: "evaluation" });
    expect(filter!(sig("evaluation"))).toBe(true);
    expect(filter!(sig("other"))).toBe(false);
  });

  it("where predicates gate routing (AND)", () => {
    const fb: WireFeedback = {
      where: [
        { field: "decision", op: "eq", value: "refine" },
        { field: "score", op: "lt", value: 0.7 },
      ],
    };
    const { filter } = compileWireFeedback(fb);
    expect(filter!(sig("x", { decision: "refine", score: 0.4 }))).toBe(true);
    expect(filter!(sig("x", { decision: "refine", score: 0.9 }))).toBe(false);
    expect(filter!(sig("x", { decision: "converge", score: 0.4 }))).toBe(false);
  });

  it("maxFires caps how many signals route", () => {
    const { filter } = compileWireFeedback({ maxFires: 2 });
    expect(filter!(sig("x"))).toBe(true);
    expect(filter!(sig("x"))).toBe(true);
    expect(filter!(sig("x"))).toBe(false);
  });

  it("does not count fires when where rejects", () => {
    const { filter } = compileWireFeedback({
      maxFires: 1,
      where: [{ field: "ok", op: "truthy" }],
    });
    expect(filter!(sig("x", { ok: false }))).toBe(false); // rejected, no fire spent
    expect(filter!(sig("x", { ok: true }))).toBe(true); // first real fire
    expect(filter!(sig("x", { ok: true }))).toBe(false); // cap reached
  });

  it("asSignal re-types the routed signal", () => {
    const { transform } = compileWireFeedback({ asSignal: "corrections" });
    const out = transform!(sig("evaluation", { a: 1 }));
    expect(out?.type).toBe("corrections");
    expect(out?.data).toEqual({ a: 1 });
  });

  it("set merges static fields into the data", () => {
    const { transform } = compileWireFeedback({ set: { priority: "high" } });
    const out = transform!(sig("x", { a: 1 }));
    expect(out?.data).toEqual({ a: 1, priority: "high" });
  });
});

// ── Orchestrator integration: a wire's feedback gates + reshapes routing ──────

/** Emits a queue of (type, data) items, one per cycle, then stops. */
class ScriptedEmitter extends BaseLoopNode {
  private queue: Array<{ type: string; data: Record<string, unknown> }>;
  constructor(queue: Array<{ type: string; data: Record<string, unknown> }>) {
    super({
      id: "emitter",
      name: "Emitter",
      category: "execution",
      description: "scripted emitter",
      config: { maxIterations: 1, delayMs: 0, frequency: { everyNIterations: 1 } },
      outputPorts: [
        { name: "out", direction: "output", signalTypes: ["evaluation", "other"], description: "out" },
      ],
    });
    this.queue = queue;
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    const item = this.queue.shift();
    if (item) context.emit("out", item.type, item.data);
    return this.emptyResult();
  }
}

/** Records every signal (type + data) it receives. */
class RecordingSink extends BaseLoopNode {
  public received: Array<{ type: string; data: Record<string, unknown> }> = [];
  constructor() {
    super({
      id: "sink",
      name: "Sink",
      category: "evaluation",
      description: "recording sink",
      config: { maxIterations: 1, delayMs: 0 },
      inputPorts: [
        { name: "in", direction: "input", signalTypes: ["evaluation", "corrections", "other"], description: "in" },
      ],
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    for (const s of context.inputSignals) this.received.push({ type: s.type, data: s.data });
    return this.emptyResult();
  }
}

describe("wire feedback (orchestrator integration)", () => {
  async function runWith(
    queue: Array<{ type: string; data: Record<string, unknown> }>,
    feedback: WireFeedback,
  ) {
    const emitter = new ScriptedEmitter([...queue]);
    const sink = new RecordingSink();
    const p = new PipelineOrchestrator({
      name: "fb",
      workingDir: "/tmp",
      maxCycles: queue.length,
      delayMs: 0,
    });
    p.addNode(emitter).addNode(sink);
    p.connectByName("emitter", "out", "sink", "in", { feedback });
    await p.run();
    return sink;
  }

  it("filters routed signals by where predicate and re-types with asSignal", async () => {
    const sink = await runWith(
      [
        { type: "evaluation", data: { decision: "refine", score: 0.4 } },
        { type: "evaluation", data: { decision: "converge", score: 0.9 } },
      ],
      {
        whenSignal: "evaluation",
        where: [{ field: "decision", op: "eq", value: "refine" }],
        asSignal: "corrections",
        set: { source: "feedback" },
      },
    );

    // Only the "refine" signal passes; it is re-typed and gets the static field.
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0].type).toBe("corrections");
    expect(sink.received[0].data).toMatchObject({ decision: "refine", source: "feedback" });
  });

  it("maxFires caps routing across cycles", async () => {
    const sink = await runWith(
      [
        { type: "evaluation", data: { n: 1 } },
        { type: "evaluation", data: { n: 2 } },
        { type: "evaluation", data: { n: 3 } },
      ],
      { maxFires: 2 },
    );
    expect(sink.received).toHaveLength(2);
  });
});
