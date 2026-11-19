// ============================================
// A role's tools, each run reported as it starts and as it ends
// ============================================
// The engine learns which tools a model asked for when its call ends; this
// says when each one starts running and when it is done, so a screen can
// show a tool at work while it works.

import type { AgentTool, ToolContext, ToolRegistry } from "../types/tools.js";

export interface ToolRun {
  phase: "start" | "end";
  /** 1-based order of the tool runs in the role's turn. */
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  ok?: boolean;
  durationMs?: number;
  /** A correction the lab made to what the model sent, as the tool said it. */
  note?: string;
}

/** The same registry, its tools reporting each run to `sink`. */
export function reportingTools(registry: ToolRegistry, sink: (run: ToolRun) => void): ToolRegistry {
  let seq = 0;
  const wrap = (tool: AgentTool): AgentTool => ({
    get definition() {
      return tool.definition;
    },
    ...(tool.validate ? { validate: (args: Record<string, unknown>) => tool.validate!(args) } : {}),
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const n = ++seq;
      const started = Date.now();
      sink({ phase: "start", seq: n, tool: tool.definition.name, args });
      try {
        const out = await tool.execute(args, context);
        const note = /\(the lab ([^)]*)\)/.exec(out)?.[1];
        sink({ phase: "end", seq: n, tool: tool.definition.name, args, ok: true, durationMs: Date.now() - started, ...(note ? { note: `the lab ${note}` } : {}) });
        return out;
      } catch (error) {
        sink({ phase: "end", seq: n, tool: tool.definition.name, args, ok: false, durationMs: Date.now() - started });
        throw error;
      }
    },
  });
  return {
    register: (tool) => registry.register(tool),
    get: (name) => {
      const tool = registry.get(name);
      return tool ? wrap(tool) : undefined;
    },
    getAll: () => registry.getAll().map(wrap),
    getDefinitions: () => registry.getDefinitions(),
    has: (name) => registry.has(name),
    remove: (name) => registry.remove(name),
  };
}
