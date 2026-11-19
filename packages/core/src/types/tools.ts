// ============================================
// Tool System Types
// ============================================

import type { ToolDefinition, ToolResult } from './llm.js';

/** Context provided to a tool when executed */
export interface ToolContext {
  /** Working directory for file operations */
  workingDir: string;

  /** Current iteration number */
  iteration: number;

  /** Logger instance */
  log: (message: string) => void;

  /** Whether verbose mode is on */
  verbose: boolean;

  /** Aborted when the run stops; long-running tools should honour it. */
  signal?: AbortSignal;

  /** The calling role's messages so far this turn, for a tool that shows them to another role (a consult). */
  transcript?: () => import("./llm.js").ChatMessage[];

  /**
   * The person's permissions already allowed this call (a permission guard
   * decided it): the tool skips its own containment and allow-list checks.
   */
  permitted?: boolean;
}

/**
 * An agent tool that can be called by the LLM.
 * Implement this interface to create custom tools.
 */
export interface AgentTool {
  /** Tool definition (name, description, parameters) */
  definition: ToolDefinition;

  /** Execute the tool with given arguments */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;

  /** Optional: validate arguments before execution */
  validate?(args: Record<string, unknown>): { valid: boolean; error?: string };
}

/**
 * Registry of available tools.
 * Tools can be registered and looked up by name.
 */
export interface ToolRegistry {
  /** Register a tool */
  register(tool: AgentTool): void;

  /** Get a tool by name */
  get(name: string): AgentTool | undefined;

  /** Get all registered tools */
  getAll(): AgentTool[];

  /** Get tool definitions for LLM */
  getDefinitions(): ToolDefinition[];

  /** Check if a tool is registered */
  has(name: string): boolean;

  /** Remove a tool by name */
  remove(name: string): boolean;
}
