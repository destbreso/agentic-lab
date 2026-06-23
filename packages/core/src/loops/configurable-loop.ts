// ============================================
// Configurable Loop (declarative authoring)
// ============================================
// A generic LoopNode driven entirely by a LoopBlueprint — no TypeScript
// subclass required. It assembles a prompt from its input signals (plus
// optional contextual memory), calls the LLM with its granted tools, and emits
// the result (raw text or extracted JSON) on a configured output port.
//
// This covers the common case (summarizer, classifier, doc-writer, reviewer,
// transformer, ...). Power users who need bespoke logic still subclass
// BaseLoopNode directly.

import { z } from "zod";
import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { ToolRegistry, ToolContext } from "../types/tools.js";
import type {
  NodeContext,
  NodeResult,
  LoopCategory,
  NodeRunConfig,
  Port,
} from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";
import { pruneMessages } from "../utils/context-window.js";
import { appendSkillPrompt } from "../skills/compose.js";
import { parseStructured } from "../utils/structured.js";

/** A declarative description of a loop — the recipe for a ConfigurableLoop. */
export interface LoopBlueprint {
  /** Registry type key (e.g. "doc-writer"). */
  type: string;
  name: string;
  category: LoopCategory;
  description: string;
  version?: string;
  /** Base system prompt (skill instructions are appended at runtime). */
  systemPrompt: string;
  inputPorts?: Array<Omit<Port, "nodeId" | "id">>;
  outputPorts?: Array<Omit<Port, "nodeId" | "id">>;
  defaultConfig?: Partial<NodeRunConfig>;
  /** Text prepended to the user prompt assembled from input signals. */
  promptHeader?: string;
  /** Output port to emit on (default: "result"). */
  outputPort?: string;
  /** Signal type to emit (default: "result"). */
  outputSignalType?: string;
  /** Max tool-call rounds per cycle (default: 8). */
  maxToolRounds?: number;
  /** When true, extract a JSON object from the response and emit it as data. */
  emitJson?: boolean;
}

export interface ConfigurableLoopConfig {
  blueprint: LoopBlueprint;
  provider: LLMProvider;
  tools?: ToolRegistry;
  /** Composed instructions from attached skills, appended to systemPrompt. */
  skillPrompt?: string;
}

const jsonSchema = z.record(z.unknown());

export class ConfigurableLoop extends BaseLoopNode {
  private provider: LLMProvider;
  private tools?: ToolRegistry;
  private systemMessage: string;
  private blueprint: LoopBlueprint;
  private outputPort: string;
  private outputSignalType: string;
  private maxToolRounds: number;

  constructor(
    config: ConfigurableLoopConfig,
    overrides?: { id?: string; name?: string; config?: Partial<NodeRunConfig> },
  ) {
    const bp = config.blueprint;
    super({
      id: overrides?.id,
      name: overrides?.name || bp.name,
      category: bp.category,
      description: bp.description,
      version: bp.version,
      config: { maxIterations: 1, delayMs: 0, ...bp.defaultConfig, ...overrides?.config },
      inputPorts: bp.inputPorts ?? [],
      outputPorts:
        bp.outputPorts ?? [
          {
            name: bp.outputPort ?? "result",
            direction: "output",
            signalTypes: [bp.outputSignalType ?? "result"],
            description: "Result",
          },
        ],
    });

    this.blueprint = bp;
    this.provider = config.provider;
    this.tools = config.tools;
    this.systemMessage = appendSkillPrompt(bp.systemPrompt, config.skillPrompt ?? "");
    this.outputPort = bp.outputPort ?? bp.outputPorts?.[0]?.name ?? "result";
    this.outputSignalType =
      bp.outputSignalType ?? bp.outputPorts?.[0]?.signalTypes?.[0] ?? "result";
    this.maxToolRounds = bp.maxToolRounds ?? 8;
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`⚙️  ${this.name} cycle ${context.iteration}`);

    try {
      let messages = await this.buildMessages(context);
      const toolDefs = this.tools ? this.tools.getDefinitions() : undefined;

      let finalText = "";
      let rounds = 0;
      while (rounds < this.maxToolRounds) {
        rounds++;
        messages = pruneMessages(messages);

        const llm = await this.provider.chat({
          messages,
          tools: toolDefs,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });

        result.tokenUsage.inputTokens += llm.usage.inputTokens;
        result.tokenUsage.outputTokens += llm.usage.outputTokens;
        result.tokenUsage.totalTokens += llm.usage.totalTokens;

        if (llm.finishReason !== "tool_calls" || !llm.message.toolCalls?.length) {
          finalText = llm.message.content || "";
          break;
        }

        messages.push(llm.message);
        for (const toolCall of llm.message.toolCalls) {
          const tool = this.tools?.get(toolCall.name);
          if (!tool) {
            messages.push({ role: "tool", content: `Unknown tool: ${toolCall.name}`, toolCallId: toolCall.id });
            continue;
          }
          try {
            const toolCtx: ToolContext = {
              workingDir: context.workingDir,
              iteration: context.iteration,
              log: (msg) => context.log.debug(`[${toolCall.name}] ${msg}`),
              verbose: false,
            };
            const out = await tool.execute(toolCall.arguments, toolCtx);
            messages.push({ role: "tool", content: out, toolCallId: toolCall.id });
            result.toolCalls.push({ name: toolCall.name, arguments: toolCall.arguments, result: out.slice(0, 500), durationMs: 0 });
          } catch (error) {
            messages.push({ role: "tool", content: `Error: ${(error as Error).message}`, toolCallId: toolCall.id });
          }
        }
      }

      const data = this.blueprint.emitJson
        ? (parseStructured(jsonSchema, finalText, { fallback: { text: finalText } }).data as Record<string, unknown>)
        : { text: finalText };

      context.emit(this.outputPort, this.outputSignalType, {
        ...data,
        iteration: context.iteration,
      });
    } catch (error) {
      errors.push((error as Error).message);
      context.log.error(`❌ ${this.name} failed: ${(error as Error).message}`);
    }

    result.durationMs = Date.now() - startTime;
    result.errors = errors;
    result.success = errors.length === 0;
    return result;
  }

  private async buildMessages(context: NodeContext): Promise<ChatMessage[]> {
    let userContent = this.blueprint.promptHeader ? `${this.blueprint.promptHeader}\n\n` : "";

    for (const sig of context.inputSignals) {
      userContent += `### ${sig.type} (from ${sig.sourceNodeId})\n${JSON.stringify(sig.data)}\n\n`;
    }

    // Contextual memory recall when enabled by the node policy.
    const memory = context.runtime?.memory;
    if (memory?.contextual) {
      const query = userContent.trim() || this.blueprint.systemPrompt;
      try {
        const recalled = await memory.recall(query);
        if (recalled.length > 0) {
          const lines = recalled.map((r, i) => `${i + 1}. ${r.content}`).join("\n");
          userContent = `## Recalled Memory\n\n${lines}\n\n` + userContent;
        }
      } catch {
        /* best-effort recall */
      }
    }

    if (!userContent.trim()) {
      userContent = `Cycle ${context.iteration}. Produce your output.`;
    }

    return [
      { role: "system", content: this.systemMessage },
      { role: "user", content: userContent },
    ];
  }
}
