// ============================================
// BaseLoopNode — Abstract base for all loops
// ============================================
// Provides common infrastructure so specialized
// loops only need to implement `execute()`.

import { nanoid } from "nanoid";
import type {
  LoopNode,
  LoopCategory,
  NodeId,
  NodeStatus,
  NodeRunConfig,
  NodeContext,
  NodeResult,
  Port,
  SerializedNode,
} from "../types/pipeline.js";

export abstract class BaseLoopNode implements LoopNode {
  readonly id: NodeId;
  readonly name: string;
  readonly category: LoopCategory;
  readonly description: string;
  readonly version: string;
  readonly inputPorts: Port[];
  readonly outputPorts: Port[];

  status: NodeStatus = "idle";
  config: NodeRunConfig;

  constructor(options: {
    id?: NodeId;
    name: string;
    category: LoopCategory;
    description: string;
    version?: string;
    config?: Partial<NodeRunConfig>;
    inputPorts?: Array<Omit<Port, "nodeId" | "id">>;
    outputPorts?: Array<Omit<Port, "nodeId" | "id">>;
  }) {
    this.id = options.id || nanoid(12);
    this.name = options.name;
    this.category = options.category;
    this.description = options.description;
    this.version = options.version || "1.0.0";

    // Default config
    this.config = {
      maxIterations: 10,
      delayMs: 1000,
      concurrent: false,
      ...options.config,
    };

    // Create ports with IDs and nodeId
    this.inputPorts = (options.inputPorts || []).map((p) => ({
      ...p,
      id: `${this.id}:in:${p.name}`,
      nodeId: this.id,
      direction: "input" as const,
    }));

    this.outputPorts = (options.outputPorts || []).map((p) => ({
      ...p,
      id: `${this.id}:out:${p.name}`,
      nodeId: this.id,
      direction: "output" as const,
    }));
  }

  async init(_context: NodeContext): Promise<void> {
    this.status = "idle";
  }

  abstract execute(context: NodeContext): Promise<NodeResult>;

  async dispose(): Promise<void> {
    this.status = "idle";
  }

  /** Helper: create an empty result */
  protected emptyResult(durationMs: number = 0): NodeResult {
    return {
      success: true,
      outputSignals: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      toolCalls: [],
      durationMs,
      errors: [],
    };
  }

  /** Helper: get signals of a specific type from inputs */
  protected getInputSignals(
    context: NodeContext,
    type: string,
  ): import("../types/pipeline.js").Signal[] {
    return context.inputSignals.filter((s) => s.type === type);
  }

  serialize(): SerializedNode {
    return {
      id: this.id,
      type: this.category,
      name: this.name,
      category: this.category,
      description: this.description,
      version: this.version,
      config: this.config,
      ports: {
        inputs: this.inputPorts.map(({ nodeId: _, id: __, ...rest }) => rest as Omit<import("../types/pipeline.js").Port, "nodeId" | "id">),
        outputs: this.outputPorts.map(({ nodeId: _, id: __, ...rest }) => rest as Omit<import("../types/pipeline.js").Port, "nodeId" | "id">),
      },
    };
  }
}
