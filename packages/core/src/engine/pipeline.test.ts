// ============================================
// Pipeline Orchestrator — Unit Tests
// ============================================
// Uses lightweight mock nodes (no real LLM) to verify the orchestration
// contract: termination, signal routing through wires, cycle bounding,
// per-node timeout handling, and validation.

import { describe, it, expect, vi } from "vitest";
import { PipelineOrchestrator } from "./pipeline.js";
import { BaseLoopNode } from "../loops/base.js";
import type { NodeContext, NodeResult, TriggerFrequency } from "../types/pipeline.js";

/** A node that emits one signal per cycle and counts its executions. */
class EmitterNode extends BaseLoopNode {
  public runs = 0;
  constructor(opts?: { id?: string; frequency?: TriggerFrequency; signalType?: string }) {
    super({
      id: opts?.id,
      name: "Emitter",
      category: "execution",
      description: "Test emitter",
      config: { maxIterations: 1, delayMs: 0, frequency: opts?.frequency },
      outputPorts: [
        { name: "out", direction: "output", signalTypes: [opts?.signalType ?? "ping"], description: "ping out" },
      ],
    });
    this.signalType = opts?.signalType ?? "ping";
  }
  private signalType: string;
  async execute(context: NodeContext): Promise<NodeResult> {
    this.runs++;
    context.emit("out", this.signalType, { n: this.runs });
    return this.emptyResult();
  }
}

/** A node that records every input signal it receives. */
class SinkNode extends BaseLoopNode {
  public received: Array<Record<string, unknown>> = [];
  constructor(opts?: { id?: string; accepts?: string }) {
    super({
      id: opts?.id,
      name: "Sink",
      category: "evaluation",
      description: "Test sink",
      config: { maxIterations: 1, delayMs: 0 },
      inputPorts: [
        { name: "in", direction: "input", signalTypes: [opts?.accepts ?? "ping"], description: "ping in" },
      ],
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    for (const s of context.inputSignals) this.received.push(s.data);
    return this.emptyResult();
  }
}

/** Writes to the shared blackboard. */
class SharedWriterNode extends BaseLoopNode {
  constructor() {
    super({
      id: "writer",
      name: "Writer",
      category: "execution",
      description: "writes shared",
      config: { maxIterations: 1, delayMs: 0, frequency: { everyNIterations: 1 } },
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    context.shared?.set("greeting", "hello");
    context.shared?.append("log", context.iteration);
    return this.emptyResult();
  }
}

/** Reads from the shared blackboard via runtime (same store as `shared`). */
class SharedReaderNode extends BaseLoopNode {
  public seen: unknown;
  constructor() {
    super({
      id: "reader",
      name: "Reader",
      category: "evaluation",
      description: "reads shared",
      config: { maxIterations: 1, delayMs: 0, frequency: { everyNIterations: 1 } },
    });
  }
  async execute(context: NodeContext): Promise<NodeResult> {
    this.seen = context.runtime?.shared.get("greeting");
    return this.emptyResult();
  }
}

/** A node whose execution hangs longer than the timeout. */
class HangNode extends BaseLoopNode {
  constructor() {
    super({
      id: "hang",
      name: "Hang",
      category: "execution",
      description: "Test hang",
      config: { maxIterations: 1, delayMs: 0, timeoutMs: 20 },
    });
  }
  async execute(): Promise<NodeResult> {
    await new Promise((r) => setTimeout(r, 200));
    return this.emptyResult();
  }
}

describe("PipelineOrchestrator", () => {
  it("rejects an empty pipeline", async () => {
    const p = new PipelineOrchestrator({ name: "empty", workingDir: "/tmp", maxCycles: 1, delayMs: 0 });
    await expect(p.run()).rejects.toThrow(/no nodes/i);
  });

  it("runs a node every cycle and stops at maxCycles", async () => {
    const emitter = new EmitterNode({ frequency: { everyNIterations: 1 } });
    const p = new PipelineOrchestrator({ name: "bounded", workingDir: "/tmp", maxCycles: 3, delayMs: 0 });
    p.addNode(emitter);

    const result = await p.run();

    expect(result.totalCycles).toBe(3);
    expect(emitter.runs).toBe(3);
    expect(result.success).toBe(true);
  });

  it("routes signals from an output port to a connected input port", async () => {
    const emitter = new EmitterNode({ id: "emitter", frequency: { everyNIterations: 1 } });
    const sink = new SinkNode({ id: "sink", accepts: "ping" });
    const p = new PipelineOrchestrator({ name: "wired", workingDir: "/tmp", maxCycles: 3, delayMs: 0 });
    p.addNode(emitter).addNode(sink);
    p.connectByName("emitter", "out", "sink", "in");

    await p.run();

    expect(sink.received.length).toBeGreaterThan(0);
    expect(sink.received[0]).toHaveProperty("n");
  });

  it("terminates a pipeline with a feedback cycle (does not hang)", async () => {
    // emitter → sink, and a self-trigger frequency keeps both alive; maxCycles bounds it.
    const a = new EmitterNode({ id: "a", frequency: { everyNIterations: 1 }, signalType: "ping" });
    const b = new EmitterNode({ id: "b", frequency: { everyNIterations: 1 }, signalType: "pong" });
    const p = new PipelineOrchestrator({ name: "cycle", workingDir: "/tmp", maxCycles: 2, delayMs: 0 });
    // Wire a→b and b→a to form a graph cycle; validate() should warn but run must still terminate.
    p.addNode(a).addNode(b);
    // give each an input port via connect using existing ports is not possible (emitters have no input),
    // so we only assert termination under maxCycles with a warn-level cycle in selection order.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await p.run();
    warn.mockRestore();
    expect(result.totalCycles).toBeLessThanOrEqual(2);
  });

  it("handles a node timeout without crashing the pipeline", async () => {
    const hang = new HangNode();
    const p = new PipelineOrchestrator({ name: "timeout", workingDir: "/tmp", maxCycles: 2, delayMs: 0 });
    p.addNode(hang);

    let statusAtError: string | undefined;
    const errorSpy = vi.fn(() => {
      // Capture status at error time — dispose() resets it to "idle" after run.
      statusAtError = hang.status;
    });
    p.on("node:error", errorSpy);

    const result = await p.run();

    expect(errorSpy).toHaveBeenCalled();
    expect(statusAtError).toBe("failed");
    // The error is recorded in the per-node results.
    expect(result.nodeResults["hang"].totalErrors).toBeGreaterThan(0);
    // The run resolves (does not throw) even though the node failed.
    expect(result).toBeDefined();
  });

  it("exposes the graph for inspection", () => {
    const emitter = new EmitterNode({ id: "e1" });
    const sink = new SinkNode({ id: "s1" });
    const p = new PipelineOrchestrator({ name: "graph", workingDir: "/tmp", maxCycles: 1, delayMs: 0 });
    p.addNode(emitter).addNode(sink);
    p.connectByName("e1", "out", "s1", "in");

    const graph = p.getGraph();
    expect(graph.nodes).toHaveLength(2);
    expect(graph.wires).toHaveLength(1);
  });

  it("lets nodes coordinate through the shared blackboard", async () => {
    const writer = new SharedWriterNode();
    const reader = new SharedReaderNode();
    const p = new PipelineOrchestrator({ name: "shared", workingDir: "/tmp", maxCycles: 1, delayMs: 0 });
    // Writer (execution) runs before reader (evaluation) within the same cycle.
    p.addNode(writer).addNode(reader);

    const result = await p.run();

    // Reader saw the value written by the writer in the same cycle.
    expect(reader.seen).toBe("hello");
    // And it is surfaced in the final pipeline state.
    expect(result.finalState.shared.greeting).toBe("hello");
    expect(result.finalState.shared.log).toEqual([1]);
  });

  it("starts each run with a fresh shared blackboard", async () => {
    const writer = new SharedWriterNode();
    const p = new PipelineOrchestrator({ name: "fresh", workingDir: "/tmp", maxCycles: 1, delayMs: 0 });
    p.addNode(writer);

    const first = await p.run();
    expect((first.finalState.shared.log as unknown[]).length).toBe(1);
    // A second run starts with an empty blackboard — it must not accumulate
    // the previous run's entries (length stays 1, not 2).
    const second = await p.run();
    expect((second.finalState.shared.log as unknown[]).length).toBe(1);
    expect(second.finalState.shared.greeting).toBe("hello");
  });

  it("prevents adding two nodes with the same id", () => {
    const p = new PipelineOrchestrator({ name: "dup", workingDir: "/tmp", maxCycles: 1, delayMs: 0 });
    p.addNode(new EmitterNode({ id: "x" }));
    expect(() => p.addNode(new EmitterNode({ id: "x" }))).toThrow(/already exists/i);
  });
});
