// ============================================
// Pipeline Orchestrator
// ============================================
// The engine that runs a graph of connected LoopNodes.
//
// Responsibilities:
//   - Manages a DAG of LoopNodes connected by Wires
//   - Routes Signals from output ports → wires → input ports
//   - Handles TriggerFrequency (which nodes run when)
//   - Manages pipeline lifecycle (start, stop, pause, resume)
//   - Emits PipelineEvents for observability
//   - Tracks PipelineState
//   - Supports concurrent node execution
//   - Handles node errors gracefully
//
// Design:
//   Each "cycle" of the pipeline:
//     1. Determine which nodes should run this cycle
//     2. Gather pending input signals for each node
//     3. Execute nodes (serial or concurrent depending on config)
//     4. Collect output signals → route through wires to target ports
//     5. Update state, emit events
//     6. Check termination conditions

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
  NodeRunConfig,
  NodeContext,
  NodeResult,
  PipelineConfig,
  PipelineState,
  PipelineStatus,
  PipelineResult,
  PipelineEventMap,
  TriggerFrequency,
} from "../types/pipeline.js";
import { createLogger, type Logger } from "../utils/logger.js";

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

// -----------------------------------------------------------
// PipelineOrchestrator
// -----------------------------------------------------------
export class PipelineOrchestrator extends EventEmitter<PipelineEventMap> {
  private config: PipelineConfig;
  private nodes = new Map<NodeId, NodeEntry>();
  private wires = new Map<WireId, Wire>();
  private state: PipelineState;
  private logger: Logger;
  private abortController: AbortController | null = null;
  private pausePromise: { resolve: () => void; promise: Promise<void> } | null =
    null;

  constructor(config: PipelineConfig) {
    super();
    this.config = {
      ...config,
      id: config.id || nanoid(12),
      signalBufferSize: config.signalBufferSize ?? 200,
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
    this.logger.info(`Added node: ${node.name} [${node.id}]`);
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
   * Connect two ports with a wire.
   */
  connect(
    sourcePortId: PortId,
    targetPortId: PortId,
    options?: {
      id?: WireId;
      transform?: Wire["transform"];
      filter?: Wire["filter"];
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

    const wire: Wire = {
      id: options?.id || nanoid(8),
      sourcePortId,
      targetPortId,
      transform: options?.transform,
      filter: options?.filter,
      enabled: true,
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
    this.state.startedAt = new Date().toISOString();
    this.state.totalTokens = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    this.state.recentSignals = [];

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
      // Main cycle loop
      while (
        this.state.status === "running" &&
        (this.config.maxCycles === 0 ||
          this.state.cycle < this.config.maxCycles) &&
        !this.abortController.signal.aborted
      ) {
        // Handle pause
        if (this.pausePromise) {
          this.state.status = "paused";
          this.emit("pipeline:pause", { cycle: this.state.cycle });
          await this.pausePromise.promise;
          this.state.status = "running";
          this.emit("pipeline:resume", { cycle: this.state.cycle });
        }

        // Check timeout
        if (
          this.config.timeoutMs &&
          Date.now() - startTime > this.config.timeoutMs
        ) {
          this.logger.warn("Pipeline timeout reached");
          this.state.status = "stopped";
          break;
        }

        await this.runCycle();

        // Check if all nodes have completed (no more work)
        if (this.isAllComplete()) {
          this.logger.info("All nodes completed — pipeline done");
          break;
        }

        // Delay between cycles
        if (this.config.delayMs > 0) {
          await sleep(this.config.delayMs);
        }
      }

      // Determine final status
      if (this.state.status === "running") {
        this.state.status = "completed";
      }
    } catch (error) {
      this.state.status = "failed";
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

    if (this.state.status === "completed" || this.state.status === "stopped") {
      this.emit("pipeline:complete", { result });
    }

    this.logger.info(
      `Pipeline finished: ${this.state.status} after ${result.totalCycles} cycles (${result.totalDurationMs}ms)`,
    );

    return result;
  }

  /**
   * Stop the pipeline gracefully.
   */
  stop(reason: string = "manual stop"): void {
    this.logger.info(`Stopping pipeline: ${reason}`);
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

  // =======================================================
  // Internal: Cycle execution
  // =======================================================

  private async runCycle(): Promise<void> {
    this.state.cycle++;
    const cycleStart = Date.now();
    this.emit("pipeline:cycle:start", { cycle: this.state.cycle });

    // Increment all nodes' cycle counters
    for (const entry of this.nodes.values()) {
      entry.cyclesSinceLastRun++;
    }

    // Determine which nodes should run this cycle
    const { concurrent, sequential } = this.selectNodes();

    // Run sequential nodes first (in topological-ish order)
    for (const nodeId of sequential) {
      if (this.abortController?.signal.aborted) break;
      await this.executeNode(nodeId);
    }

    // Run concurrent nodes in parallel
    if (concurrent.length > 0 && !this.abortController?.signal.aborted) {
      await Promise.allSettled(
        concurrent.map((nodeId) => this.executeNode(nodeId)),
      );
    }

    const cycleDuration = Date.now() - cycleStart;
    this.emit("pipeline:cycle:end", {
      cycle: this.state.cycle,
      durationMs: cycleDuration,
    });
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
      entry.pendingSignals.some((s) =>
        port.signalTypes.some((st) => st === s.type || st === "*"),
      ),
    );
  }

  /**
   * Execute a single node.
   */
  private async executeNode(nodeId: NodeId): Promise<void> {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;

    const { node } = entry;
    this.emit("node:start", { nodeId, cycle: this.state.cycle });

    // Build the NodeContext
    const context = this.buildNodeContext(nodeId, entry);

    // Collect output signals
    const outputSignals: Signal[] = [];
    const originalEmit = context.emit;
    context.emit = (
      portName: string,
      type: string,
      data: Record<string, unknown>,
    ) => {
      const signal: Signal = {
        sourceNodeId: nodeId,
        type,
        data,
        timestamp: new Date().toISOString(),
        traceId: context.traceId,
      };
      outputSignals.push(signal);
      this.addToSignalBuffer(signal);
      this.emit("signal:sent", {
        signal,
        portId: `${nodeId}:out:${portName}`,
      });
    };

    let stopRequested = false;
    let stopReason = "";
    context.requestStop = (reason: string) => {
      stopRequested = true;
      stopReason = reason;
    };

    try {
      // Execute with optional timeout (using AbortController to cancel the timer)
      const timeoutMs =
        node.config.timeoutMs || this.config.timeoutMs || 300_000; // 5min default
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Node ${node.name} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      let result: import("../types/pipeline.js").NodeResult;
      try {
        result = await Promise.race([node.execute(context), timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
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

      // Clear consumed signals
      entry.pendingSignals = [];

      // Update pipeline token totals
      this.state.totalTokens.inputTokens += result.tokenUsage.inputTokens;
      this.state.totalTokens.outputTokens += result.tokenUsage.outputTokens;
      this.state.totalTokens.totalTokens += result.tokenUsage.totalTokens;

      // Update node status in state
      this.state.nodeStatuses[nodeId] = {
        status: node.status,
        lastRunAt: entry.lastRunAt,
        totalCycles: entry.totalCycles,
        totalErrors: entry.totalErrors,
      };

      // Route output signals to connected nodes
      for (const signal of result.outputSignals) {
        this.routeSignalFromNode(nodeId, signal);
      }

      this.emit("node:end", {
        nodeId,
        cycle: this.state.cycle,
        result,
      });

      // Handle stop request from node
      if (stopRequested) {
        this.stop(stopReason);
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

      this.emit("node:error", {
        nodeId,
        cycle: this.state.cycle,
        error: error as Error,
      });

      this.logger.error(
        `Node ${node.name} [${nodeId}] error: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Build the NodeContext for a node execution.
   */
  private buildNodeContext(nodeId: NodeId, entry: NodeEntry): NodeContext {
    const traceId = `${this.config.id}:${this.state.cycle}:${nodeId}`;

    return {
      nodeId,
      traceId,
      iteration: entry.totalCycles + 1,
      workingDir: this.config.workingDir,
      inputSignals: [...entry.pendingSignals],
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
      pipelineState: { ...this.state },
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
      if (
        sourcePort &&
        !sourcePort.signalTypes.includes("*") &&
        !sourcePort.signalTypes.includes(signal.type)
      ) {
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

      // Find target node
      const targetPortId = wire.targetPortId;
      // Port IDs follow pattern: {nodeId}:in:{portName}
      const targetNodeId = targetPortId.split(":in:")[0];
      const targetEntry = this.nodes.get(targetNodeId);

      if (!targetEntry) {
        this.logger.warn(
          `Wire ${wire.id}: target node ${targetNodeId} not found`,
        );
        continue;
      }

      // Deliver signal to target node's pending queue
      targetEntry.pendingSignals.push(routedSignal);
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
  private findPort(
    portId: PortId,
  ): import("../types/pipeline.js").Port | undefined {
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
          this.logger.warn(
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

    // Check for cycles in the wire graph (warn, since some recipes use intentional feedback)
    const adjacency = new Map<string, Set<string>>();
    for (const wire of this.wires.values()) {
      // Extract nodeId from portId format: "{nodeId}:in:{portName}" / "{nodeId}:out:{portName}"
      const sourceNode = wire.sourcePortId.split(":")[0];
      const targetNode = wire.targetPortId.split(":")[0];
      if (!adjacency.has(sourceNode)) adjacency.set(sourceNode, new Set());
      adjacency.get(sourceNode)!.add(targetNode);
    }
    if (this.detectCycles(adjacency)) {
      this.logger.warn(
        "Pipeline contains cycles in wire graph. Ensure convergence logic prevents infinite loops.",
      );
    }
  }

  /**
   * Detect cycles using DFS with color-marking.
   */
  private detectCycles(adjacency: Map<string, Set<string>>): boolean {
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();
    for (const node of this.nodes.keys()) color.set(node, WHITE);

    const dfs = (node: string): boolean => {
      color.set(node, GRAY);
      for (const neighbor of adjacency.get(node) || []) {
        const c = color.get(neighbor) ?? WHITE;
        if (c === GRAY) return true; // back edge = cycle
        if (c === WHITE && dfs(neighbor)) return true;
      }
      color.set(node, BLACK);
      return false;
    };

    for (const node of this.nodes.keys()) {
      if (color.get(node) === WHITE && dfs(node)) return true;
    }
    return false;
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

    return {
      pipelineId: this.config.id!,
      success: this.state.status === "completed",
      totalCycles: this.state.cycle,
      totalDurationMs,
      nodeResults,
      finalState: { ...this.state },
      summary: this.buildSummary(nodeResults, totalDurationMs),
    };
  }

  /**
   * Build a human-readable summary of the pipeline run.
   */
  private buildSummary(
    nodeResults: PipelineResult["nodeResults"],
    durationMs: number,
  ): string {
    const lines: string[] = [];
    lines.push(`Pipeline: ${this.config.name}`);
    lines.push(`Status: ${this.state.status}`);
    lines.push(`Cycles: ${this.state.cycle}`);
    lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    lines.push(
      `Tokens: ${this.state.totalTokens.totalTokens.toLocaleString()} (in: ${this.state.totalTokens.inputTokens.toLocaleString()}, out: ${this.state.totalTokens.outputTokens.toLocaleString()})`,
    );

    lines.push("\nNodes:");
    for (const [nodeId, result] of Object.entries(nodeResults)) {
      const entry = this.nodes.get(nodeId);
      const name = entry?.node.name ?? nodeId;
      lines.push(
        `  ${name}: ${result.totalCycles} cycles, ${result.totalTokens} tokens, ${result.totalToolCalls} tool calls, ${result.totalErrors} errors`,
      );
    }

    return lines.join("\n");
  }
}
