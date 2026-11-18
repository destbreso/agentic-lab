// ============================================
// Pipeline Orchestrator
// ============================================
// The engine that runs a graph of connected LoopNodes.
//
// Responsibilities:
//   - Holds the nodes and the wires between their ports
//   - Routes Signals from output ports through wires to input ports,
//     delivering a signal only to a port that accepts its type
//   - Schedules nodes, in one of two ways:
//       rounds: the drawn order runs once per round; a way back taken by the
//               deciding role starts the next round at its target; "done"
//               ends the run
//       cycles: the legacy trigger-frequency scheduler
//   - Manages the lifecycle (start, stop, pause, resume) and passes an abort
//     signal to every node, so stopping a run stops the calls in flight
//   - Emits PipelineEvents for observability
//   - Reports how the run ended (outcome), never success without a verdict

import { EventEmitter } from "eventemitter3";
import { nanoid } from "nanoid";
import type {
  NodeId,
  PortId,
  WireId,
  Signal,
  Wire,
  LoopNode,
  NodeStatus,
  NodeContext,
  NodeResult,
  Port,
  Provenance,
  PipelineConfig,
  PipelineState,
  PipelineResult,
  PipelineEventMap,
  RunOutcome,
  TriggerFrequency,
  SharedStore,
  WireFeedback,
  RunInput,
  RunView,
  LoopCategory,
} from "../types/pipeline.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { InMemorySharedStore } from "./capability-resolver.js";
import { createMemoryGateway } from "./memory-gateway.js";
import { compileWireFeedback } from "./wire-feedback.js";
import { PlanManager } from "./plan-manager.js";
import { describeFields, pickFields, provenanceOfSignal } from "./provenance.js";
import type { RecordedCall, StepInput, StepRecord } from "../types/step.js";
import type { MemoryStore } from "../types/storage.js";

/** Combine two optional wire filters into one (AND). */
function combineFilters(
  a: Wire["filter"],
  b: Wire["filter"],
): Wire["filter"] {
  if (!a) return b;
  if (!b) return a;
  return (signal) => a(signal) && b(signal);
}

/** Compose two optional wire transforms (a then b); a null short-circuits. */
function combineTransforms(
  a: Wire["transform"],
  b: Wire["transform"],
): Wire["transform"] {
  if (!a) return b;
  if (!b) return a;
  return (signal) => {
    const first = a(signal);
    return first === null ? null : b(first);
  };
}

/** Port ids follow `{nodeId}:out:{name}` and `{nodeId}:in:{name}`. */
function nodeOfPort(portId: PortId): NodeId {
  const out = portId.indexOf(":out:");
  if (out >= 0) return portId.slice(0, out);
  const inp = portId.indexOf(":in:");
  if (inp >= 0) return portId.slice(0, inp);
  return portId.split(":")[0];
}

function accepts(port: Pick<Port, "signalTypes">, type: string): boolean {
  return port.signalTypes.includes("*") || port.signalTypes.includes(type);
}

/** Optional runtime dependencies for a pipeline (e.g. a memory store). */
export interface PipelineOptions {
  /** Memory store backing the per-node MemoryGateway (recall/remember). */
  memory?: MemoryStore;
  /** Initial entries to seed the shared blackboard with at each run start (read only by blackboard roles). */
  seedShared?: Record<string, unknown>;
  /** The task and the other run-level inputs; each role receives the ones its definition lists. */
  run?: { task?: string; inputs?: RunInput[] };
}

/** The run inputs a role reads when its definition does not say: Plan, Do and Check read everything. */
export const DEFAULT_RUN_INPUTS: Record<LoopCategory, string[]> = {
  planning: ["task", "*"],
  execution: ["task", "*"],
  evaluation: ["task", "*"],
  critic: [],
  refinement: [],
  memory: [],
  custom: [],
};

/** What a role receives of the run: only what its definition lists. */
export function runViewFor(
  category: LoopCategory,
  listed: string[] | undefined,
  run: { task?: string; inputs?: RunInput[] } | undefined,
): RunView {
  const reads = new Set(listed ?? DEFAULT_RUN_INPUTS[category] ?? []);
  const all = reads.has("*");
  return {
    ...(reads.has("task") && run?.task !== undefined ? { task: run.task } : {}),
    inputs: (run?.inputs ?? []).filter((i) => all || reads.has(i.name)),
  };
}

/** Default budget for one node's turn when neither the node nor the pipeline sets one. */
export const DEFAULT_NODE_TIMEOUT_MS = 600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------
// Internal bookkeeping per node
// -----------------------------------------------------------
interface NodeEntry {
  node: LoopNode;
  pendingSignals: Signal[];
  totalCycles: number;
  totalTokens: number;
  totalToolCalls: number;
  totalErrors: number;
  lastRunAt?: string;
  lastResult?: NodeResult;
  /** Cycle counter for frequency calculations */
  cyclesSinceLastRun: number;
  /** Total times this node has been triggered */
  totalTriggers: number;
}

/** A signal that crossed a wire during the current round. */
interface Delivery {
  wireId: WireId;
  from: NodeId;
  to: NodeId;
  type: string;
  back: boolean;
}

/** The order a topology runs in, and which wires are ways back. */
export interface RunOrder {
  /** Node ids in the drawn order. */
  order: NodeId[];
  /** Wires that point to an earlier node in the order (or to their own node). */
  wayBacks: WireId[];
}

// -----------------------------------------------------------
// PipelineOrchestrator
// -----------------------------------------------------------
export class PipelineOrchestrator extends EventEmitter<PipelineEventMap> {
  private config: PipelineConfig;
  private nodes = new Map<NodeId, NodeEntry>();
  private wires = new Map<WireId, Wire>();
  private state: PipelineState;
  private sharedStore: SharedStore;
  private memoryStore?: MemoryStore;
  private seedShared?: Record<string, unknown>;
  private runInputs?: { task?: string; inputs?: RunInput[] };
  private logger: Logger;
  private abortController: AbortController | null = null;
  private pausePromise: { resolve: () => void; promise: Promise<void> } | null =
    null;

  // Per-run bookkeeping
  private backWires = new Set<WireId>();
  private roundDeliveries: Delivery[] = [];
  private ranThisRound: NodeId[] = [];
  private roundVerdicts = new Map<NodeId, { verdict: string; parsed: boolean }>();
  private lastVerdict: string | null = null;
  private doneReason: string | null = null;
  private nodeStopReason: string | null = null;
  private userStopReason: string | null = null;
  /** Tokens spent so far, counted per model call so a budget can stop a turn mid-way. */
  private liveTokens = 0;
  private budgetReason: string | null = null;
  private failures: string[] = [];
  private endReason = "";
  private planState: "complete" | "incomplete" | "absent" | null = null;
  /** Each role's step while its turn runs; the recorder adds the model calls to it. */
  private openSteps = new Map<NodeId, StepRecord>();
  private stepSeq = 0;

  constructor(config: PipelineConfig, options?: PipelineOptions) {
    super();
    this.config = {
      ...config,
      id: config.id || nanoid(12),
      signalBufferSize: config.signalBufferSize ?? 200,
    };
    this.memoryStore = options?.memory;
    this.seedShared = options?.seedShared;
    // The task seeded on the blackboard is the run's task when no other is given.
    const seededTask = typeof options?.seedShared?.task === "string" ? options.seedShared.task : undefined;
    this.runInputs = {
      task: options?.run?.task ?? seededTask,
      inputs: options?.run?.inputs ?? [],
    };

    this.logger = createLogger({
      level: "info",
      prefix: `pipeline:${this.config.id!.slice(0, 6)}`,
    });

    this.state = {
      pipelineId: this.config.id!,
      status: "idle",
      cycle: 0,
      totalTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      startedAt: undefined,
      recentSignals: [],
      nodeStatuses: {},
      shared: {},
    };
    // Shared blackboard backed by state.shared (surfaces in results).
    this.sharedStore = new InMemorySharedStore(this.state.shared);
  }

  // =======================================================
  // Graph construction
  // =======================================================

  /**
   * Add a LoopNode to the pipeline.
   */
  addNode(node: LoopNode): this {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists in the pipeline`);
    }
    this.nodes.set(node.id, {
      node,
      pendingSignals: [],
      totalCycles: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      cyclesSinceLastRun: 0,
      totalTriggers: 0,
    });
    this.state.nodeStatuses[node.id] = {
      status: "idle",
      totalCycles: 0,
      totalErrors: 0,
    };
    this.logger.debug(`Added node: ${node.name} [${node.id}]`);
    return this;
  }

  /**
   * Remove a node and all its wires from the pipeline.
   */
  removeNode(nodeId: NodeId): this {
    const entry = this.nodes.get(nodeId);
    if (!entry) return this;

    // Remove wires connected to this node's ports
    const portIds = new Set([
      ...entry.node.inputPorts.map((p) => p.id),
      ...entry.node.outputPorts.map((p) => p.id),
    ]);

    for (const [wireId, wire] of this.wires) {
      if (portIds.has(wire.sourcePortId) || portIds.has(wire.targetPortId)) {
        this.wires.delete(wireId);
        this.emit("wire:disconnected", { wireId });
      }
    }

    this.nodes.delete(nodeId);
    delete this.state.nodeStatuses[nodeId];
    this.logger.info(`Removed node: ${entry.node.name} [${nodeId}]`);
    return this;
  }

  /**
   * Connect two ports with a wire. A wire whose source can emit nothing the
   * target accepts is refused: it could never deliver a signal.
   */
  connect(
    sourcePortId: PortId,
    targetPortId: PortId,
    options?: {
      id?: WireId;
      transform?: Wire["transform"];
      filter?: Wire["filter"];
      /** Declarative feedback spec — compiled into filter + transform. */
      feedback?: WireFeedback;
      /** The fields the wire delivers; every other field is dropped. */
      fields?: string[];
    },
  ): Wire {
    // Validate ports exist
    const sourcePort = this.findPort(sourcePortId);
    const targetPort = this.findPort(targetPortId);

    if (!sourcePort) {
      throw new Error(`Source port not found: ${sourcePortId}`);
    }
    if (!targetPort) {
      throw new Error(`Target port not found: ${targetPortId}`);
    }
    if (sourcePort.direction !== "output") {
      throw new Error(`Source port ${sourcePortId} is not an output port`);
    }
    if (targetPort.direction !== "input") {
      throw new Error(`Target port ${targetPortId} is not an input port`);
    }

    // A custom transform may re-type anything, so only declared types are checked.
    if (!options?.transform) {
      const emitted = options?.feedback?.asSignal
        ? [options.feedback.asSignal]
        : sourcePort.signalTypes;
      const deliverable =
        emitted.includes("*") || emitted.some((t) => accepts(targetPort, t));
      if (!deliverable) {
        throw new Error(
          `Wire refused: ${sourcePortId} emits [${emitted.join(", ")}] but ${targetPortId} accepts [${targetPort.signalTypes.join(", ")}]`,
        );
      }
    }

    // Compile an optional declarative feedback spec into filter + transform,
    // composing with any explicitly-provided ones.
    let filter = options?.filter;
    let transform = options?.transform;
    if (options?.feedback) {
      const compiled = compileWireFeedback(options.feedback);
      filter = combineFilters(filter, compiled.filter);
      transform = combineTransforms(transform, compiled.transform);
    }

    const wire: Wire = {
      id: options?.id || nanoid(8),
      sourcePortId,
      targetPortId,
      transform,
      filter,
      enabled: true,
      feedback: options?.feedback,
      ...(options?.fields ? { fields: [...options.fields] } : {}),
    };

    this.wires.set(wire.id, wire);
    this.emit("wire:connected", { wire });
    this.logger.debug(`Wire: ${sourcePortId} → ${targetPortId} [${wire.id}]`);
    return wire;
  }

  /**
   * Convenience: connect two nodes by port names.
   * e.g., connectByName(executionNodeId, "result", evaluationNodeId, "execution_result")
   */
  connectByName(
    sourceNodeId: NodeId,
    sourcePortName: string,
    targetNodeId: NodeId,
    targetPortName: string,
    options?: {
      transform?: Wire["transform"];
      filter?: Wire["filter"];
      /** Declarative feedback spec — compiled into filter + transform. */
      feedback?: WireFeedback;
      /** The fields the wire delivers; every other field is dropped. */
      fields?: string[];
    },
  ): Wire {
    const sourcePortId = `${sourceNodeId}:out:${sourcePortName}`;
    const targetPortId = `${targetNodeId}:in:${targetPortName}`;
    return this.connect(sourcePortId, targetPortId, options);
  }

  /**
   * Disconnect a wire.
   */
  disconnect(wireId: WireId): this {
    this.wires.delete(wireId);
    this.emit("wire:disconnected", { wireId });
    return this;
  }

  /**
   * Get the current pipeline graph for visualization/serialization.
   */
  getGraph(): {
    nodes: Array<{
      id: NodeId;
      name: string;
      category: string;
      status: NodeStatus;
      inputPorts: LoopNode["inputPorts"];
      outputPorts: LoopNode["outputPorts"];
    }>;
    wires: Wire[];
  } {
    return {
      nodes: Array.from(this.nodes.values()).map((entry) => ({
        id: entry.node.id,
        name: entry.node.name,
        category: entry.node.category,
        status: entry.node.status,
        inputPorts: entry.node.inputPorts,
        outputPorts: entry.node.outputPorts,
      })),
      wires: Array.from(this.wires.values()),
    };
  }

  /** The pipeline's configuration (read-only copy). */
  getConfig(): Readonly<PipelineConfig> {
    return { ...this.config };
  }

  /**
   * Get the current pipeline state.
   */
  getState(): Readonly<PipelineState> {
    return { ...this.state };
  }

  /**
   * Get a node by ID.
   */
  getNode(nodeId: NodeId): LoopNode | undefined {
    return this.nodes.get(nodeId)?.node;
  }

  /**
   * The order the round schedule runs: the drawn order, which is the order
   * the definition lists its roles (left to right in the builder). A wire to
   * the same or an earlier role is a way back; every other wire points
   * forward, so the order is topological over the forward edges by
   * construction. A graph algorithm cannot recover the drawing: a minimum
   * set of back edges would put Deep Reasoning's Plan last.
   */
  getRunOrder(): RunOrder {
    const order = [...this.nodes.keys()];
    const rank = new Map(order.map((id, i) => [id, i]));
    const wayBacks: WireId[] = [];
    for (const wire of this.wires.values()) {
      if (!wire.enabled) continue;
      const from = rank.get(nodeOfPort(wire.sourcePortId));
      const to = rank.get(nodeOfPort(wire.targetPortId));
      if (from === undefined || to === undefined) continue;
      if (to <= from) wayBacks.push(wire.id);
    }
    return { order, wayBacks };
  }

  // =======================================================
  // Pipeline lifecycle
  // =======================================================

  /**
   * Run the pipeline.
   * This is the main execution entry point.
   */
  async run(initialSignals?: Signal[]): Promise<PipelineResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();

    // Validate pipeline
    this.validate();

    // Reset state
    this.state.status = "running";
    this.state.cycle = 0;
    this.state.round = undefined;
    this.state.startedAt = new Date().toISOString();
    this.state.totalTokens = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    this.state.recentSignals = [];
    // Fresh shared blackboard per run, pre-seeded with any provided entries.
    this.state.shared = { ...(this.seedShared ?? {}) };
    this.sharedStore = new InMemorySharedStore(this.state.shared);
    this.lastVerdict = null;
    this.doneReason = null;
    this.nodeStopReason = null;
    this.userStopReason = null;
    this.liveTokens = 0;
    this.budgetReason = null;
    this.failures = [];
    this.endReason = "";
    this.planState = null;
    this.openSteps = new Map();
    this.stepSeq = 0;

    this.emit("pipeline:start", {
      config: this.config,
      startedAt: this.state.startedAt,
    });
    this.logger.info(`Pipeline started: ${this.config.name}`);

    // Initialize all nodes
    await this.initializeNodes();

    // Inject initial signals
    if (initialSignals?.length) {
      for (const signal of initialSignals) {
        this.injectSignal(signal);
      }
    }

    try {
      if (this.config.schedule === "rounds") {
        await this.runRounds(startTime);
      } else {
        await this.runCycles(startTime);
      }

      // Determine final status
      if (this.state.status === "running") {
        this.state.status = this.failures.length > 0 ? "failed" : "completed";
      }
    } catch (error) {
      this.state.status = "failed";
      this.failures.push(`Pipeline error: ${(error as Error).message}`);
      this.emit("pipeline:error", {
        error: error as Error,
        cycle: this.state.cycle,
      });
      this.logger.error(`Pipeline failed: ${(error as Error).message}`);
    } finally {
      // Dispose all nodes
      await this.disposeNodes();
    }

    const result = this.buildResult(startTime);
    this.emit("pipeline:complete", { result });

    this.logger.info(
      `Pipeline finished: ${result.outcome} after ${result.totalCycles} ${this.config.schedule === "rounds" ? "rounds" : "cycles"} (${result.totalDurationMs}ms): ${result.reason}`,
    );

    return result;
  }

  /**
   * Stop the pipeline. Aborts the model and tool calls in flight.
   */
  stop(reason: string = "manual stop"): void {
    this.logger.info(`Stopping pipeline: ${reason}`);
    this.userStopReason ??= reason;
    this.abortController?.abort();
    this.state.status = "stopped";
    this.emit("pipeline:stop", { reason, state: { ...this.state } });

    // Unpause if paused
    if (this.pausePromise) {
      this.pausePromise.resolve();
      this.pausePromise = null;
    }
  }

  /**
   * Pause the pipeline.
   */
  pause(): void {
    if (this.state.status !== "running") return;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.pausePromise = { resolve, promise };
  }

  /**
   * Resume a paused pipeline.
   */
  resume(): void {
    if (!this.pausePromise) return;
    this.pausePromise.resolve();
    this.pausePromise = null;
  }

  /**
   * Inject a signal into the pipeline externally.
   * This routes the signal through wires to matching input ports.
   */
  injectSignal(signal: Signal): void {
    this.routeSignalFromNode(signal.sourceNodeId, signal);
  }

  /**
   * Deliver a signal straight to one node's input, on the first port that
   * accepts its type. Returns false when the node has no such port.
   */
  deliverSignal(nodeId: NodeId, signal: Signal): boolean {
    const entry = this.nodes.get(nodeId);
    if (!entry) return false;
    const port = entry.node.inputPorts.find((p) => accepts(p, signal.type));
    if (!port) return false;
    entry.pendingSignals.push(signal);
    this.emit("signal:received", { signal, portId: port.id, nodeId });
    return true;
  }

  /**
   * Add a model call to the step of the role making it. The recorder wrapped
   * around each role's provider calls this; a call that arrives after its
   * role's turn has ended (a turn that timed out) is dropped.
   */
  recordCall(nodeId: NodeId, call: Omit<RecordedCall, "seq">): void {
    const step = this.openSteps.get(nodeId);
    if (!step) return;
    step.calls.push({ ...call, seq: step.calls.length + 1 });
    this.liveTokens += call.usage.totalTokens;
    this.checkBudget();
  }

  /**
   * The per-attempt token budget: once spent, the calls in flight are aborted
   * and no further turn starts. A role stopped this way has not failed; the
   * run ends, like at a round limit, and its outcome follows what was checked.
   */
  private checkBudget(): void {
    const budget = this.config.tokenBudget;
    if (!budget || this.budgetReason || this.liveTokens < budget) return;
    this.budgetReason = `token budget (${budget}) spent: ${this.liveTokens} tokens`;
    this.logger.warn(this.budgetReason);
    this.abortController?.abort();
  }

  // =======================================================
  // Internal: the two schedules
  // =======================================================

  private shouldContinue(startTime: number): boolean {
    if (this.state.status !== "running") return false;
    if (this.abortController?.signal.aborted) return false;
    if (this.doneReason || this.nodeStopReason || this.failures.length > 0) return false;
    if (this.config.timeoutMs && Date.now() - startTime > this.config.timeoutMs) {
      this.logger.warn("Pipeline timeout reached");
      this.failures.push(`Run timed out after ${Math.round(this.config.timeoutMs / 1000)}s`);
      return false;
    }
    return true;
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.pausePromise) return;
    this.state.status = "paused";
    this.emit("pipeline:pause", { cycle: this.state.cycle });
    await this.pausePromise.promise;
    if (this.state.status === "paused") this.state.status = "running";
    this.emit("pipeline:resume", { cycle: this.state.cycle });
  }

  /** Legacy scheduler: trigger frequencies decide which nodes run each cycle. */
  private async runCycles(startTime: number): Promise<void> {
    const max = this.config.maxCycles;
    while (max === 0 || this.state.cycle < max) {
      await this.waitIfPaused();
      if (!this.shouldContinue(startTime)) break;

      this.state.cycle++;
      const cycleStart = Date.now();
      this.emit("pipeline:cycle:start", { cycle: this.state.cycle });

      for (const entry of this.nodes.values()) entry.cyclesSinceLastRun++;
      const { concurrent, sequential } = this.selectNodes();

      for (const nodeId of sequential) {
        if (!this.shouldContinue(startTime)) break;
        await this.executeNode(nodeId);
      }
      if (concurrent.length > 0 && this.shouldContinue(startTime)) {
        await Promise.allSettled(concurrent.map((id) => this.executeNode(id)));
      }

      this.emit("pipeline:cycle:end", {
        cycle: this.state.cycle,
        durationMs: Date.now() - cycleStart,
      });

      if (this.doneReason || this.nodeStopReason || this.failures.length > 0) break;
      if (this.isAllComplete()) {
        this.endReason = "no node has work left";
        break;
      }
      if (this.config.delayMs > 0) await sleep(this.config.delayMs);
    }
    if (!this.endReason && max > 0 && this.state.cycle >= max) {
      this.endReason = `cycle limit (${max}) reached`;
    }
  }

  /**
   * Round scheduler. Each round runs the drawn order from its start node to
   * the end. The deciding role is Decide (refinement) when it ran this round,
   * else the last Check (evaluation) that ran. A Check pass with no Decide
   * ends the run; a way back taken by the decider starts the next round at
   * its earliest target; no way back ends the run, unless the topology
   * repeats until its plan is done.
   */
  private async runRounds(startTime: number): Promise<void> {
    const { order, wayBacks } = this.getRunOrder();
    this.backWires = new Set(wayBacks);
    const position = new Map(order.map((id, i) => [id, i]));
    const hasIncoming = new Set(
      [...this.wires.values()].filter((w) => w.enabled).map((w) => nodeOfPort(w.targetPortId)),
    );
    const max = this.config.maxCycles;
    let startIdx = 0;

    while (max === 0 || this.state.cycle < max) {
      await this.waitIfPaused();
      if (!this.shouldContinue(startTime)) break;

      this.state.cycle++;
      const round = this.state.cycle;
      this.state.round = round;
      this.roundDeliveries = [];
      this.ranThisRound = [];
      this.roundVerdicts = new Map();
      const roundStart = Date.now();
      this.emit("pipeline:cycle:start", { cycle: round });
      this.emit("pipeline:round:start", { round, startAt: order[startIdx] });

      for (let i = startIdx; i < order.length; i++) {
        if (!this.shouldContinue(startTime)) break;
        const nodeId = order[i];
        const entry = this.nodes.get(nodeId)!;
        const runs = i === startIdx || !hasIncoming.has(nodeId) || entry.pendingSignals.length > 0;
        if (!runs) {
          this.emit("node:skip", { nodeId, cycle: round, reason: "nothing to read this round" });
          continue;
        }
        await this.executeNode(nodeId);
      }

      const verdict = this.currentRoundVerdict();
      if (verdict !== null) this.lastVerdict = verdict;
      const next = await this.nextRound(round, order, position, verdict, max);

      this.emit("pipeline:cycle:end", { cycle: round, durationMs: Date.now() - roundStart });
      this.emit("pipeline:round:end", {
        round,
        verdict,
        next: next.startAt === null ? null : order[next.startAt],
        reason: next.reason,
      });

      if (next.startAt === null) {
        this.endReason = next.reason;
        break;
      }
      startIdx = next.startAt;
      if (this.config.delayMs > 0) await sleep(this.config.delayMs);
    }
  }

  private async nextRound(
    round: number,
    order: NodeId[],
    position: Map<NodeId, number>,
    verdict: string | null,
    max: number,
  ): Promise<{ startAt: number | null; reason: string }> {
    if (this.budgetReason) return { startAt: null, reason: this.budgetReason };
    if (this.abortController?.signal.aborted || this.userStopReason) {
      return { startAt: null, reason: `stopped: ${this.userStopReason ?? "aborted"}` };
    }
    if (this.failures.length > 0) return { startAt: null, reason: this.failures[0] };
    if (this.doneReason) return { startAt: null, reason: `done: ${this.doneReason}` };
    if (this.nodeStopReason) return { startAt: null, reason: `stopped: ${this.nodeStopReason}` };

    const categoryOf = (id: NodeId) => this.nodes.get(id)!.node.category;
    const deciders = this.ranThisRound.filter((id) => categoryOf(id) === "refinement");
    const checkers = this.ranThisRound.filter((id) => categoryOf(id) === "evaluation");
    const decider = deciders.at(-1) ?? checkers.at(-1) ?? null;

    if (decider && categoryOf(decider) === "evaluation" && verdict === "pass") {
      return { startAt: null, reason: "Check passed" };
    }

    const taken = this.roundDeliveries.filter(
      (d) => d.back && (decider === null || d.from === decider) && position.has(d.to),
    );
    taken.sort((a, b) => position.get(a.to)! - position.get(b.to)!);
    const first = taken[0];

    let startAt: number | null = first ? position.get(first.to)! : null;
    let reason = first
      ? `${this.nodes.get(first.from)!.node.name} sent the work back to ${this.nodes.get(first.to)!.node.name}`
      : "no way back was taken";

    if (startAt === null && this.config.repeat?.until === "plan-done") {
      this.planState = await this.readPlanState();
      if (this.planState === "incomplete") {
        startAt = 0;
        reason = "the plan still has unchecked items";
      } else {
        reason = this.planState === "complete" ? "the plan is done" : "there is no plan file to work through";
      }
    }

    if (startAt !== null && max > 0 && round >= max) {
      return { startAt: null, reason: `round limit (${max}) reached` };
    }
    return { startAt, reason };
  }

  /** The verdict of the Check roles that ran this round, counted once per role. */
  private currentRoundVerdict(): string | null {
    if (this.roundVerdicts.size === 0) return null;
    const verdicts = [...this.roundVerdicts.values()].map((v) =>
      v.parsed ? v.verdict : "inconclusive",
    );
    if (verdicts.every((v) => v === "pass")) return "pass";
    if (verdicts.includes("fail")) return "fail";
    if (verdicts.includes("partial")) return "partial";
    return "inconclusive";
  }

  private async readPlanState(): Promise<"complete" | "incomplete" | "absent"> {
    const manager = new PlanManager(this.config.workingDir, this.config.repeat?.planFile ?? "PLAN.md");
    const items = await manager.read();
    if (items.length === 0) return "absent";
    const open = items.some((i) => i.status !== "completed" && i.status !== "skipped");
    return open ? "incomplete" : "complete";
  }

  /**
   * Select which nodes to run this cycle based on TriggerFrequency,
   * pending signals, and node status.
   */
  private selectNodes(): { sequential: NodeId[]; concurrent: NodeId[] } {
    const sequential: NodeId[] = [];
    const concurrent: NodeId[] = [];

    for (const [nodeId, entry] of this.nodes) {
      if (
        entry.node.status === "completed" ||
        entry.node.status === "failed" ||
        entry.node.status === "stopped"
      ) {
        continue; // Skip finished nodes
      }

      if (!this.shouldTrigger(entry)) {
        this.emit("node:skip", {
          nodeId,
          cycle: this.state.cycle,
          reason: "trigger frequency not met",
        });
        continue;
      }

      if (entry.node.config.concurrent) {
        concurrent.push(nodeId);
      } else {
        sequential.push(nodeId);
      }
    }

    // Sort sequential nodes: try a rough topological order
    // Nodes with no pending signals / inputs run first
    sequential.sort((a, b) => {
      const aEntry = this.nodes.get(a)!;
      const bEntry = this.nodes.get(b)!;

      // Nodes with fewer required input connections go first
      const aRequired = aEntry.node.inputPorts.filter(
        (p) => p.required !== false,
      ).length;
      const bRequired = bEntry.node.inputPorts.filter(
        (p) => p.required !== false,
      ).length;

      // Execution loops (producers) before evaluation (consumers)
      const categoryOrder: Record<string, number> = {
        planning: 0,
        execution: 1,
        evaluation: 2,
        refinement: 3,
        critic: 4,
        memory: 5,
        custom: 6,
      };

      const aOrder = categoryOrder[aEntry.node.category] ?? 5;
      const bOrder = categoryOrder[bEntry.node.category] ?? 5;

      if (aOrder !== bOrder) return aOrder - bOrder;
      return aRequired - bRequired;
    });

    return { sequential, concurrent };
  }

  /**
   * Check if a node should trigger this cycle.
   */
  private shouldTrigger(entry: NodeEntry): boolean {
    const freq: TriggerFrequency | undefined = entry.node.config.frequency;

    // If no frequency configured, run every cycle (if it has pending signals
    // on required ports, or if it's the first cycle)
    if (!freq) {
      return this.hasRequiredSignals(entry) || entry.totalCycles === 0;
    }

    // Check max triggers
    if (freq.maxTriggers && entry.totalTriggers >= freq.maxTriggers) {
      return false;
    }

    // Check everyNIterations
    if (
      freq.everyNIterations &&
      entry.cyclesSinceLastRun >= freq.everyNIterations
    ) {
      return true;
    }

    // Check onSignals — if any pending signal matches the configured types
    if (freq.onSignals && freq.onSignals.length > 0) {
      const hasMatchingSignal = entry.pendingSignals.some((s) =>
        freq.onSignals!.includes(s.type),
      );
      if (hasMatchingSignal) return true;
    }

    // Check afterMs
    if (freq.afterMs && entry.lastRunAt) {
      const elapsed = Date.now() - new Date(entry.lastRunAt).getTime();
      if (elapsed >= freq.afterMs) return true;
    }

    // First cycle — always trigger if it has signals or no frequency restrictions
    if (entry.totalCycles === 0 && this.hasRequiredSignals(entry)) {
      return true;
    }

    return false;
  }

  /**
   * Check if all required input ports have at least one signal.
   */
  private hasRequiredSignals(entry: NodeEntry): boolean {
    const requiredPorts = entry.node.inputPorts.filter(
      (p) => p.required !== false,
    );

    // If no required ports, always trigger
    if (requiredPorts.length === 0) return true;

    // Check if at least one required port has a matching signal
    return requiredPorts.some((port) =>
      entry.pendingSignals.some((s) => accepts(port, s.type)),
    );
  }

  /**
   * Execute a single node.
   */
  private async executeNode(nodeId: NodeId): Promise<void> {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;

    const { node } = entry;
    const cycle = this.state.cycle;
    // Take this turn's inputs now: anything delivered while the node runs
    // waits for its next turn instead of being cleared with these.
    const consumed = entry.pendingSignals;
    entry.pendingSignals = [];
    this.ranThisRound.push(nodeId);

    this.emit("node:start", { nodeId, cycle });
    this.emit("node:inputs", { nodeId, cycle, signals: consumed });

    // One signal per turn: aborted when the run stops or the turn times out,
    // so the node's model and tool calls stop with it.
    const timeoutMs = node.config.timeoutMs || this.config.timeoutMs || DEFAULT_NODE_TIMEOUT_MS;
    const turnTimeout = AbortSignal.timeout(timeoutMs);
    const runSignal = this.abortController?.signal;
    const signal = runSignal ? AbortSignal.any([runSignal, turnTimeout]) : turnTimeout;

    const context = this.buildNodeContext(nodeId, entry, consumed, signal);
    const step = this.openStep(nodeId, consumed, context);

    // Collect output signals
    const outputSignals: Signal[] = [];
    context.emit = (
      portName: string,
      type: string,
      data: Record<string, unknown>,
      provenance?: Record<string, Provenance>,
    ) => {
      const sig: Signal = {
        sourceNodeId: nodeId,
        type,
        data,
        timestamp: new Date().toISOString(),
        traceId: context.traceId,
        ...(provenance && Object.keys(provenance).length > 0 ? { provenance } : {}),
      };
      outputSignals.push(sig);
      this.addToSignalBuffer(sig);
      this.emit("signal:sent", {
        signal: sig,
        portId: `${nodeId}:out:${portName}`,
      });
    };

    let stopRequested = false;
    let stopReason = "";
    context.requestStop = (reason: string) => {
      stopRequested = true;
      stopReason = reason;
    };
    context.done = (reason: string) => {
      this.doneReason ??= reason;
    };

    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const took = timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`;
          reject(new Error(`Node ${node.name} timed out after ${took}`));
        }, timeoutMs);
      });
      let result: NodeResult;
      try {
        result = await Promise.race([node.execute(context), timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }

      // Add output signals collected via context.emit
      result.outputSignals = [...result.outputSignals, ...outputSignals];

      // Update entry stats
      entry.totalCycles++;
      entry.totalTokens += result.tokenUsage.totalTokens;
      entry.totalToolCalls += result.toolCalls.length;
      entry.totalErrors += result.errors.length;
      entry.lastRunAt = new Date().toISOString();
      entry.lastResult = result;
      entry.cyclesSinceLastRun = 0;
      entry.totalTriggers++;

      // Update pipeline token totals
      this.state.totalTokens.inputTokens += result.tokenUsage.inputTokens;
      this.state.totalTokens.outputTokens += result.tokenUsage.outputTokens;
      this.state.totalTokens.totalTokens += result.tokenUsage.totalTokens;
      // A role whose calls were not recorded still counts against the budget.
      this.liveTokens = Math.max(this.liveTokens, this.state.totalTokens.totalTokens);
      this.checkBudget();

      // Update node status in state
      this.state.nodeStatuses[nodeId] = {
        status: node.status,
        lastRunAt: entry.lastRunAt,
        totalCycles: entry.totalCycles,
        totalErrors: entry.totalErrors,
      };

      // A Check role's verdict, counted once per role per round.
      if (node.category === "evaluation") {
        for (const s of result.outputSignals) {
          if (s.type === "evaluation" && typeof s.data.verdict === "string") {
            this.roundVerdicts.set(nodeId, {
              verdict: s.data.verdict,
              parsed: s.data.parsed !== false,
            });
            if (this.config.schedule !== "rounds") {
              this.lastVerdict = s.data.parsed === false ? "inconclusive" : s.data.verdict;
            }
          }
        }
      }

      // Route output signals to connected nodes
      for (const sig of result.outputSignals) {
        this.routeSignalFromNode(nodeId, sig);
      }

      this.emit("node:end", {
        nodeId,
        cycle,
        result,
      });
      this.closeStep(step, result);

      if (!result.success && !this.abortController?.signal.aborted) {
        const why = result.errors.join("; ") || "no reason given";
        this.failures.push(`${node.name} failed: ${why}`);
      }

      // Handle stop request from node
      if (stopRequested) {
        this.nodeStopReason ??= stopReason;
      }
    } catch (error) {
      entry.totalErrors++;
      entry.totalCycles++;
      entry.cyclesSinceLastRun = 0;
      entry.totalTriggers++;
      node.status = "failed";

      this.state.nodeStatuses[nodeId] = {
        status: "failed",
        lastRunAt: new Date().toISOString(),
        totalCycles: entry.totalCycles,
        totalErrors: entry.totalErrors,
      };

      if (!this.abortController?.signal.aborted) {
        this.failures.push(`${node.name} failed: ${(error as Error).message}`);
      }

      this.emit("node:error", {
        nodeId,
        cycle,
        error: error as Error,
      });
      this.closeStep(step, null, error as Error);

      this.logger.error(
        `Node ${node.name} [${nodeId}] error: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Open a role's step: what it is given for this turn, each with its kind.
   * Memories it recalls during the turn are added as they arrive.
   */
  private openStep(nodeId: NodeId, consumed: Signal[], context: NodeContext): StepRecord {
    const { node } = this.nodes.get(nodeId)!;
    const inputs: StepInput[] = [];
    if (context.run?.task !== undefined) {
      inputs.push({ source: "run", name: "task", from: "you", provenance: "given", value: context.run.task });
    }
    for (const i of context.run?.inputs ?? []) {
      inputs.push({ source: "run", name: i.name, from: "run", provenance: i.provenance, value: i.content });
    }
    if (context.shared) {
      // A blackboard role can read anything any role wrote there.
      inputs.push({ source: "run", name: "blackboard", from: "blackboard", provenance: "written", value: context.shared.all() });
    }
    for (const s of consumed) {
      inputs.push({
        source: "signal",
        name: s.type,
        from: s.sourceNodeId,
        provenance: provenanceOfSignal(s),
        fields: describeFields(s),
      });
    }
    const step: StepRecord = {
      runId: this.config.id!,
      seq: ++this.stepSeq,
      round: this.config.schedule === "rounds" ? (this.state.round ?? null) : null,
      role: nodeId,
      roleName: node.name,
      category: node.category,
      inputs,
      calls: [],
      outputs: [],
      toolCalls: [],
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      success: false,
      errors: [],
      startedAt: new Date().toISOString(),
      endedAt: "",
      durationMs: 0,
    };
    this.openSteps.set(nodeId, step);

    const gateway = context.runtime?.memory;
    if (gateway && context.runtime) {
      context.runtime.memory = {
        contextual: gateway.contextual,
        recall: async (query, opts) => {
          const recalled = await gateway.recall(query, opts);
          step.inputs.push({ source: "memory", name: "recall", from: "memory", provenance: "written", value: { query, recalled } });
          return recalled;
        },
        remember: (content, opts) => gateway.remember(content, opts),
      };
    }
    return step;
  }

  /** Close a role's step with what it emitted and how its turn ended, and announce it. */
  private closeStep(step: StepRecord, result: NodeResult | null, error?: Error): void {
    if (this.openSteps.get(step.role) !== step) return;
    this.openSteps.delete(step.role);
    const ended = new Date();
    step.endedAt = ended.toISOString();
    step.durationMs = ended.getTime() - new Date(step.startedAt).getTime();
    if (result) {
      step.outputs = result.outputSignals.map((s) => ({ type: s.type, fields: describeFields(s) }));
      step.toolCalls = result.toolCalls.map((tc) => ({ ...tc }));
      step.tokens = { ...result.tokenUsage };
      step.success = result.success;
      step.errors = [...result.errors];
    } else {
      step.success = false;
      step.errors = [error?.message ?? "the role failed"];
      step.tokens = step.calls.reduce(
        (t, c) => ({
          inputTokens: t.inputTokens + c.usage.inputTokens,
          outputTokens: t.outputTokens + c.usage.outputTokens,
          totalTokens: t.totalTokens + c.usage.totalTokens,
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      );
    }
    this.emit("node:step", { step });
  }

  /**
   * Build the NodeContext for a node execution.
   */
  private buildNodeContext(
    nodeId: NodeId,
    entry: NodeEntry,
    inputSignals: Signal[] = entry.pendingSignals,
    signal?: AbortSignal,
  ): NodeContext {
    const traceId = `${this.config.id}:${this.state.cycle}:${nodeId}`;
    const { node } = entry;
    // A role sees other roles' output only through its wires: no recent
    // signals, and the blackboard only when its definition asks for it.
    const blackboard = node.config.blackboard === true ? this.sharedStore : undefined;

    return {
      nodeId,
      traceId,
      iteration: entry.totalCycles + 1,
      workingDir: this.config.workingDir,
      inputSignals: [...inputSignals],
      emit: (
        _portName: string,
        _type: string,
        _data: Record<string, unknown>,
      ) => {
        // Placeholder — overridden in executeNode
      },
      requestStop: (_reason: string) => {
        // Placeholder — overridden in executeNode
      },
      signal,
      round: this.state.round,
      pipelineState: {
        ...this.state,
        totalTokens: { ...this.state.totalTokens },
        nodeStatuses: { ...this.state.nodeStatuses },
        recentSignals: [],
        shared: {},
      },
      run: runViewFor(node.category, node.config.runInputs, this.runInputs),
      shared: blackboard,
      runtime: {
        shared: blackboard,
        // Per-node memory gateway, scoped to the node's memory policy.
        memory: createMemoryGateway(this.memoryStore, entry.node.config.memory),
      },
      log: {
        info: (msg) => this.logger.info(`[${entry.node.name}] ${msg}`),
        warn: (msg) => this.logger.warn(`[${entry.node.name}] ${msg}`),
        error: (msg) => this.logger.error(`[${entry.node.name}] ${msg}`),
        debug: (msg) => this.logger.debug(`[${entry.node.name}] ${msg}`),
      },
    };
  }

  /**
   * Route a signal from a node through connected wires to target nodes.
   */
  private routeSignalFromNode(sourceNodeId: NodeId, signal: Signal): void {
    const sourceEntry = this.nodes.get(sourceNodeId);
    if (!sourceEntry) return;

    // Find output ports for this node
    const outputPortIds = new Set(
      sourceEntry.node.outputPorts.map((p) => p.id),
    );

    // Find wires connected to these output ports
    for (const [_wireId, wire] of this.wires) {
      if (!wire.enabled) continue;
      if (!outputPortIds.has(wire.sourcePortId)) continue;

      // Check if source port accepts this signal type
      const sourcePort = sourceEntry.node.outputPorts.find(
        (p) => p.id === wire.sourcePortId,
      );
      if (sourcePort && !accepts(sourcePort, signal.type)) {
        continue;
      }

      // Apply wire filter
      if (wire.filter && !wire.filter(signal)) {
        this.emit("signal:dropped", {
          signal,
          wireId: wire.id,
          reason: "wire filter rejected",
        });
        continue;
      }

      // Apply wire transform
      let routedSignal = signal;
      if (wire.transform) {
        const transformed = wire.transform(signal);
        if (!transformed) {
          this.emit("signal:dropped", {
            signal,
            wireId: wire.id,
            reason: "wire transform returned null",
          });
          continue;
        }
        routedSignal = transformed;
      }

      // What the wire does not list never reaches the target.
      if (wire.fields) routedSignal = pickFields(routedSignal, wire.fields);

      const targetPortId = wire.targetPortId;
      const targetNodeId = nodeOfPort(targetPortId);
      const targetEntry = this.nodes.get(targetNodeId);

      if (!targetEntry) {
        this.logger.warn(
          `Wire ${wire.id}: target node ${targetNodeId} not found`,
        );
        continue;
      }

      // Deliver only what the target port accepts.
      const targetPort = targetEntry.node.inputPorts.find((p) => p.id === targetPortId);
      if (!targetPort || !accepts(targetPort, routedSignal.type)) {
        this.emit("signal:dropped", {
          signal: routedSignal,
          wireId: wire.id,
          reason: targetPort
            ? `target port accepts [${targetPort.signalTypes.join(", ")}], not "${routedSignal.type}"`
            : "target port not found",
        });
        continue;
      }

      // Deliver signal to target node's pending queue
      targetEntry.pendingSignals.push(routedSignal);
      this.roundDeliveries.push({
        wireId: wire.id,
        from: sourceNodeId,
        to: targetNodeId,
        type: routedSignal.type,
        back: this.backWires.has(wire.id),
      });
      this.emit("signal:received", {
        signal: routedSignal,
        portId: targetPortId,
        nodeId: targetNodeId,
      });
    }
  }

  // =======================================================
  // Internal: Helpers
  // =======================================================

  /**
   * Initialize all nodes in the pipeline.
   */
  private async initializeNodes(): Promise<void> {
    for (const [nodeId, entry] of this.nodes) {
      try {
        const ctx = this.buildNodeContext(nodeId, entry);
        await entry.node.init(ctx);
        entry.node.status = "idle";
      } catch (error) {
        this.logger.error(
          `Failed to initialize node ${entry.node.name}: ${(error as Error).message}`,
        );
        throw error;
      }
    }
  }

  /**
   * Dispose all nodes.
   */
  private async disposeNodes(): Promise<void> {
    for (const [_nodeId, entry] of this.nodes) {
      try {
        await entry.node.dispose();
      } catch (error) {
        this.logger.warn(
          `Error disposing node ${entry.node.name}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Check if all nodes have completed or there's no more work.
   */
  private isAllComplete(): boolean {
    let anyRunning = false;
    let anyPending = false;

    for (const [_nodeId, entry] of this.nodes) {
      const st = entry.node.status;
      if (st === "running" || st === "paused") {
        anyRunning = true;
      }
      // An idle node is only considered "running" if it has pending signals
      // or has a trigger frequency that could wake it up
      if (st === "idle") {
        const hasTrigger =
          entry.node.config.frequency != null ||
          entry.pendingSignals.length > 0;
        if (hasTrigger) {
          anyRunning = true;
        }
      }
      if (entry.pendingSignals.length > 0) {
        anyPending = true;
      }
    }

    // Pipeline is complete if no nodes can run and none have pending signals
    return !anyRunning && !anyPending;
  }

  /**
   * Find a port across all nodes.
   */
  private findPort(portId: PortId): Port | undefined {
    for (const entry of this.nodes.values()) {
      const port =
        entry.node.inputPorts.find((p) => p.id === portId) ||
        entry.node.outputPorts.find((p) => p.id === portId);
      if (port) return port;
    }
    return undefined;
  }

  /**
   * Add a signal to the recent signals buffer.
   */
  private addToSignalBuffer(signal: Signal): void {
    this.state.recentSignals.push(signal);
    const max = this.config.signalBufferSize ?? 200;
    if (this.state.recentSignals.length > max) {
      this.state.recentSignals = this.state.recentSignals.slice(-max);
    }
  }

  /**
   * Validate the pipeline before running.
   */
  private validate(): void {
    if (this.nodes.size === 0) {
      throw new Error("Pipeline has no nodes");
    }

    // Check that required ports have at least one wire (warning only)
    for (const entry of this.nodes.values()) {
      for (const port of entry.node.inputPorts) {
        if (port.required === false) continue;
        const hasWire = Array.from(this.wires.values()).some(
          (w) => w.targetPortId === port.id,
        );
        if (!hasWire) {
          this.logger.debug(
            `Required input port "${port.name}" on node "${entry.node.name}" has no incoming wire`,
          );
        }
      }
    }

    // Check for duplicate wires
    const wireKeys = new Set<string>();
    for (const wire of this.wires.values()) {
      const key = `${wire.sourcePortId}->${wire.targetPortId}`;
      if (wireKeys.has(key)) {
        this.logger.warn(`Duplicate wire: ${key}`);
      }
      wireKeys.add(key);
    }
  }

  /** How the run ended. Success needs a passing verdict (or a finished plan) and no failure. */
  private computeOutcome(): { outcome: RunOutcome; reason: string } {
    if (this.userStopReason) {
      return { outcome: "stopped", reason: `stopped: ${this.userStopReason}` };
    }
    if (this.failures.length > 0 || this.state.status === "failed") {
      return { outcome: "failed", reason: this.failures[0] ?? "the run failed" };
    }
    if (this.nodeStopReason) {
      return { outcome: "stopped", reason: `stopped: ${this.nodeStopReason}` };
    }
    const reason =
      this.budgetReason ?? (this.endReason || (this.doneReason ? `done: ${this.doneReason}` : "the run ended"));
    if (this.planState === "complete") return { outcome: "passed", reason };
    if (this.planState === "incomplete") return { outcome: "failed", reason };
    if (this.lastVerdict === "pass") return { outcome: "passed", reason };
    if (this.lastVerdict === null) {
      return { outcome: "inconclusive", reason: `${reason}; no Check gave a verdict` };
    }
    if (this.lastVerdict === "fail") return { outcome: "failed", reason };
    return { outcome: "inconclusive", reason: `${reason}; the last verdict was ${this.lastVerdict}` };
  }

  /**
   * Build the final PipelineResult.
   */
  private buildResult(startTime: number): PipelineResult {
    const nodeResults: PipelineResult["nodeResults"] = {};
    for (const [nodeId, entry] of this.nodes) {
      nodeResults[nodeId] = {
        totalCycles: entry.totalCycles,
        totalTokens: entry.totalTokens,
        totalToolCalls: entry.totalToolCalls,
        totalErrors: entry.totalErrors,
        lastResult: entry.lastResult,
      };
    }

    const totalDurationMs = Date.now() - startTime;
    const { outcome, reason } = this.computeOutcome();

    return {
      pipelineId: this.config.id!,
      success: outcome === "passed",
      outcome,
      reason,
      verdict: this.lastVerdict,
      errors: [...this.failures],
      totalCycles: this.state.cycle,
      totalDurationMs,
      nodeResults,
      finalState: { ...this.state },
      summary: this.buildSummary(nodeResults, totalDurationMs, outcome, reason),
    };
  }

  /**
   * Build a human-readable summary of the pipeline run.
   */
  private buildSummary(
    nodeResults: PipelineResult["nodeResults"],
    durationMs: number,
    outcome: RunOutcome,
    reason: string,
  ): string {
    const lines: string[] = [];
    lines.push(`Pipeline: ${this.config.name}`);
    lines.push(`Outcome: ${outcome} (${reason})`);
    lines.push(`Status: ${this.state.status}`);
    lines.push(`${this.config.schedule === "rounds" ? "Rounds" : "Cycles"}: ${this.state.cycle}`);
    lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    lines.push(
      `Tokens: ${this.state.totalTokens.totalTokens.toLocaleString()} (in: ${this.state.totalTokens.inputTokens.toLocaleString()}, out: ${this.state.totalTokens.outputTokens.toLocaleString()})`,
    );

    lines.push("\nNodes:");
    for (const [nodeId, result] of Object.entries(nodeResults)) {
      const entry = this.nodes.get(nodeId);
      const name = entry?.node.name ?? nodeId;
      lines.push(
        `  ${name}: ${result.totalCycles} turns, ${result.totalTokens} tokens, ${result.totalToolCalls} tool calls, ${result.totalErrors} errors`,
      );
    }

    return lines.join("\n");
  }
}
