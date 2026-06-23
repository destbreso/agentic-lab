// ============================================
// Execution Loop
// ============================================
// Fast, cheap, stateless-ish, high frequency.
//
// Does work: picks a task, calls LLM, uses tools.
// Does NOT decide objectives or evaluate success.
// This is the "muscle" — the workhorse.
//
// Input signals:
//   - task: a specific task to work on
//   - plan: the current plan (optional, reads from file if not provided)
//   - context: additional context from other loops
//
// Output signals:
//   - result: what was done (code changes, file writes, etc.)
//   - tool_calls: which tools were invoked and their results
//   - tokens: token usage for this cycle

import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { ToolRegistry, ToolContext } from "../types/tools.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";
import { pruneMessages } from "../utils/context-window.js";

export interface ExecutionLoopConfig {
  /** LLM provider */
  provider: LLMProvider;
  /** Tools available to the executor */
  tools: ToolRegistry;
  /** Path to prompt file */
  promptFile?: string;
  /** Path to plan file */
  planFile?: string;
  /** Max tool-call rounds per cycle (safety limit) */
  maxToolRounds?: number;
  /** System message override */
  systemMessage?: string;
}

export class ExecutionLoop extends BaseLoopNode {
  private llmProvider: LLMProvider;
  private tools: ToolRegistry;
  private promptFile: string;
  private planFile: string;
  private maxToolRounds: number;
  private systemMessage: string;

  constructor(
    config: ExecutionLoopConfig,
    overrides?: { id?: string; name?: string; config?: Partial<import("../types/pipeline.js").NodeRunConfig> },
  ) {
    super({
      id: overrides?.id,
      name: overrides?.name || "Execution Loop",
      category: "execution",
      description:
        "Fast, stateless executor. Picks a task, calls LLM with tools, does work. " +
        "Does not decide objectives or evaluate final success.",
      config: {
        maxIterations: 20,
        delayMs: 500,
        concurrent: false,
        ...overrides?.config,
      },
      inputPorts: [
        { name: "task", direction: "input", signalTypes: ["task", "plan"], description: "Task or plan to execute" },
        { name: "context", direction: "input", signalTypes: ["context", "memory"], description: "Additional context from other loops", required: false },
      ],
      outputPorts: [
        { name: "result", direction: "output", signalTypes: ["execution_result"], description: "What was done this cycle" },
        { name: "tool_calls", direction: "output", signalTypes: ["tool_calls"], description: "Tool calls made and their results" },
        { name: "tokens", direction: "output", signalTypes: ["token_usage"], description: "Token usage for this cycle" },
      ],
    });

    this.llmProvider = config.provider;
    this.tools = config.tools;
    this.promptFile = config.promptFile || "PROMPT.md";
    this.planFile = config.planFile || "PLAN.md";
    this.maxToolRounds = config.maxToolRounds || 20;
    this.systemMessage =
      config.systemMessage ||
      "You are an autonomous AI agent in an execution loop. " +
        "Pick ONE task from the plan, complete it using the provided tools, " +
        "update the plan, and end your turn. Be precise and focused.";
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`⚡ Execution cycle ${context.iteration}`);

    try {
      // Build messages from input signals + files
      let messages = await this.buildMessages(context);

      // Tool loop — keep calling LLM until no more tool calls
      let continueLoop = true;
      let rounds = 0;

      while (continueLoop && rounds < this.maxToolRounds) {
        rounds++;

        // Keep the conversation within the context budget across tool rounds.
        messages = pruneMessages(messages);

        const llmResult = await this.llmProvider.chat({
          messages,
          tools: this.tools.getDefinitions(),
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });

        // Track tokens
        result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
        result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
        result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

        // No tool calls → done
        if (llmResult.finishReason !== "tool_calls" || !llmResult.message.toolCalls?.length) {
          // Emit result
          context.emit("result", "execution_result", {
            responseText: llmResult.message.content || "",
            iteration: context.iteration,
            toolCallCount: result.toolCalls.length,
          });
          continueLoop = false;
          break;
        }

        // Add assistant message
        messages.push(llmResult.message);

        // Execute tools
        for (const toolCall of llmResult.message.toolCalls) {
          const toolStart = Date.now();
          const tool = this.tools.get(toolCall.name);

          if (!tool) {
            messages.push({
              role: "tool",
              content: `Unknown tool: ${toolCall.name}`,
              toolCallId: toolCall.id,
            });
            continue;
          }

          try {
            const toolCtx: ToolContext = {
              workingDir: context.workingDir,
              iteration: context.iteration,
              log: (msg) => context.log.debug(`[${toolCall.name}] ${msg}`),
              verbose: false,
            };

            const toolResult = await tool.execute(toolCall.arguments, toolCtx);
            const durationMs = Date.now() - toolStart;

            messages.push({
              role: "tool",
              content: toolResult,
              toolCallId: toolCall.id,
            });

            result.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: toolResult.slice(0, 500),
              durationMs,
            });

            context.log.debug(`  ✅ ${toolCall.name} (${durationMs}ms)`);
          } catch (error) {
            const durationMs = Date.now() - toolStart;
            const errorMsg = (error as Error).message;

            messages.push({
              role: "tool",
              content: `Error: ${errorMsg}`,
              toolCallId: toolCall.id,
            });

            result.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: `Error: ${errorMsg}`,
              durationMs,
            });

            errors.push(`Tool ${toolCall.name}: ${errorMsg}`);
          }
        }
      }

      // Emit tool calls signal
      if (result.toolCalls.length > 0) {
        context.emit("tool_calls", "tool_calls", {
          calls: result.toolCalls,
          iteration: context.iteration,
        });
      }

      // Emit token usage
      context.emit("tokens", "token_usage", {
        ...result.tokenUsage,
        iteration: context.iteration,
      });
    } catch (error) {
      errors.push((error as Error).message);
      context.log.error(`❌ Execution failed: ${(error as Error).message}`);
    }

    result.durationMs = Date.now() - startTime;
    result.errors = errors;
    result.success = errors.length === 0;
    return result;
  }

  private async buildMessages(context: NodeContext): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.systemMessage },
    ];

    // Check for task signals from connected nodes
    const taskSignals = this.getInputSignals(context, "task");
    const contextSignals = this.getInputSignals(context, "context");
    const memorySignals = this.getInputSignals(context, "memory");
    const planSignals = this.getInputSignals(context, "plan");

    // Build user message
    let userContent = "";

    // Add plan context (from signal or file)
    if (planSignals.length > 0) {
      const latest = planSignals[planSignals.length - 1];
      userContent += `## Current Plan\n\n${latest.data.plan}\n\n`;
    }

    // Add specific task if provided
    if (taskSignals.length > 0) {
      const latest = taskSignals[taskSignals.length - 1];
      userContent += `## Task\n\n${latest.data.task}\n\n`;
    }

    // Add memory context
    if (memorySignals.length > 0) {
      const memories = memorySignals.map((s) => s.data.summary || s.data.content).join("\n\n");
      userContent += `## Relevant Context\n\n${memories}\n\n`;
    }

    // Add additional context
    if (contextSignals.length > 0) {
      for (const sig of contextSignals) {
        userContent += `## Context: ${sig.data.label || "Additional"}\n\n${sig.data.content}\n\n`;
      }
    }

    // Fallback: if no signals, add a generic instruction
    if (!userContent) {
      userContent =
        `Iteration ${context.iteration}. Read the plan file and pick ONE task to work on. ` +
        `Complete it, update the plan, and end your turn.`;
    }

    messages.push({ role: "user", content: userContent });
    return messages;
  }
}
