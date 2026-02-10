// ============================================
// Default Toolkit — Register all built-in tools
// ============================================

import type { AgentTool, ToolRegistry } from "../types/tools.js";
import type { ToolDefinition } from "../types/llm.js";
import { FileReadTool } from "./file-read.js";
import { FileWriteTool } from "./file-write.js";
import { ShellTool } from "./shell.js";
import { GlobTool } from "./glob.js";
import { GrepTool } from "./grep.js";
import { GitTool } from "./git.js";

/**
 * Default tool registry implementation.
 */
class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }
}

/**
 * Create a tool registry with all built-in tools pre-registered.
 *
 * @param enabledTools - Optional list of tool names to enable.
 *                       If not specified, all built-in tools are enabled.
 */
export function createDefaultToolkit(enabledTools?: string[]): ToolRegistry {
  const registry = new DefaultToolRegistry();

  const allTools: AgentTool[] = [
    new FileReadTool(),
    new FileWriteTool(),
    new ShellTool(),
    new GlobTool(),
    new GrepTool(),
    new GitTool(),
  ];

  for (const tool of allTools) {
    if (!enabledTools || enabledTools.includes(tool.definition.name)) {
      registry.register(tool);
    }
  }

  return registry;
}
