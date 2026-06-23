// ============================================
// Blueprint Registration
// ============================================
// Turns a declarative LoopBlueprint into a first-class node type, so it can be
// referenced from recipes by its `type` key exactly like the built-in loops.

import type { LLMProvider } from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import { registerNodeType } from "./registry.js";
import { ConfigurableLoop, type LoopBlueprint } from "./configurable-loop.js";

/**
 * Register a blueprint as a node type. After this, `createNode(blueprint.type,
 * ...)` and recipes referencing `type: blueprint.type` produce a
 * ConfigurableLoop driven by the blueprint. Idempotent (re-registering
 * overwrites).
 */
export function registerBlueprint(blueprint: LoopBlueprint): void {
  const outputs = blueprint.outputPorts ?? [
    {
      name: blueprint.outputPort ?? "result",
      direction: "output" as const,
      signalTypes: [blueprint.outputSignalType ?? "result"],
      description: "Result",
    },
  ];

  registerNodeType({
    type: blueprint.type,
    name: blueprint.name,
    category: blueprint.category,
    description: blueprint.description,
    version: blueprint.version ?? "1.0.0",
    defaultPorts: {
      inputs: blueprint.inputPorts ?? [],
      outputs,
    },
    defaultConfig: { maxIterations: 1, delayMs: 0, ...blueprint.defaultConfig },
    factory: (id, config, metadata) =>
      new ConfigurableLoop(
        {
          blueprint,
          provider: metadata?.provider as LLMProvider,
          tools: metadata?.tools as ToolRegistry | undefined,
          skillPrompt: metadata?.skillPrompt as string | undefined,
        },
        { id, config },
      ),
  });
}
