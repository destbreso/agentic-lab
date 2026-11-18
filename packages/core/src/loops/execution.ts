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
import type { ToolRegistry } from "../types/tools.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pruneMessages } from "../utils/context-window.js";
import { appendSkillPrompt } from "../skills/compose.js";

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
  /** Composed instructions from attached skills, appended to the system message */
  skillPrompt?: string;
}

export class ExecutionLoop extends BaseLoopNode {
  private llmProvider: LLMProvider;
  private tools: ToolRegistry;
  private promptFile: string;
  private planFile: string;
  private maxToolRounds: number;
  private systemMessage: string;
  /** The last plan received; it stays in force for later rounds. */
  private lastPlan = "";
  /** This node's own last answer, shown back to it with corrections. */
  private lastResponse = "";

  constructor(
    config: ExecutionLoopConfig,
    overrides?: { id?: string; name?: string; config?: Partial<import("../types/pipeline.js").NodeRunConfig>; ports?: import("../types/pipeline.js").PortOverrides },
  ) {
    super({
      id: overrides?.id,
      ports: overrides?.ports,
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
        { name: "task", direction: "input", signalTypes: ["task", "plan", "corrections"], description: "Task, plan, or corrections sent back" },
        { name: "context", direction: "input", signalTypes: ["context", "memory", "compressed_context"], description: "Additional context from other loops", required: false },
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
    this.systemMessage = appendSkillPrompt(
      config.systemMessage ||
        "You are an autonomous AI agent in an execution loop. " +
          "Do the task you are given, using the provided tools when the work needs them. " +
          "Be precise and focused. End your turn with a short answer: what you did and the result.",
      config.skillPrompt ?? "",
    );
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`⚡ Execution cycle ${context.iteration}`);

    try {
      // Build messages from input signals + files
      let messages = await this.buildMessages(context);

      // Tool loop: keep calling the model until it answers without tool calls
      let answered = false;
      let rounds = 0;

      while (!answered && rounds < this.maxToolRounds) {
        rounds++;

        // Keep the conversation within the context budget across tool rounds.
        messages = pruneMessages(messages);

        const llmResult = await this.llmProvider.chat({
          messages,
          tools: this.tools.getDefinitions(),
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          ...this.callOptions(context),
        });

        // Track tokens
        result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
        result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
        result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

        // No tool calls → done
        if (llmResult.finishReason !== "tool_calls" || !llmResult.message.toolCalls?.length) {
          const responseText = llmResult.message.content || "";
          this.lastResponse = responseText;
          context.emit("result", "execution_result", {
            responseText,
            iteration: context.iteration,
            toolCallCount: result.toolCalls.length,
            truncated: llmResult.finishReason === "length",
          });
          answered = true;
          break;
        }

        // Add assistant message
        messages.push(llmResult.message);

        // Execute tools. A tool error is the model's feedback, not the loop's failure.
        for (const toolCall of llmResult.message.toolCalls) {
          const toolStart = Date.now();
          const tool = this.tools.get(toolCall.name);

          if (!tool) {
            messages.push({
              role: "tool",
              content: `Unknown tool: ${toolCall.name}`,
              toolCallId: toolCall.id,
            });
            result.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: `Error: unknown tool ${toolCall.name}`,
              durationMs: 0,
            });
            continue;
          }

          try {
            const toolResult = await tool.execute(
              toolCall.arguments,
              this.toolContext(context, toolCall.name),
            );
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
            if (context.signal?.aborted) throw error;
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
          }
        }
      }

      if (!answered) {
        errors.push(
          `hit the tool-call cap (${this.maxToolRounds} rounds) without a final answer`,
        );
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

    const taskSignals = this.getInputSignals(context, "task");
    const contextSignals = this.getInputSignals(context, "context");
    const memorySignals = this.getInputSignals(context, "memory").concat(
      this.getInputSignals(context, "compressed_context"),
    );
    const planSignals = this.getInputSignals(context, "plan");
    const correctionSignals = this.getInputSignals(context, "corrections");

    // A plan stays in force until a new one arrives (ways back start later rounds without one).
    if (planSignals.length > 0) {
      this.lastPlan = String(planSignals[planSignals.length - 1].data.plan ?? "");
    }

    let userContent = "";

    if (this.lastPlan) {
      userContent += `## Current Plan\n\n${this.lastPlan}\n\n`;
    }

    // The task: from a signal, or the request as the run hands it to this role.
    let task = "";
    if (taskSignals.length > 0) {
      task = String(taskSignals[taskSignals.length - 1].data.task ?? "");
    }
    const request = this.taskText(context);
    if (!task && request) task = request;
    if (task) userContent += `## Task\n\n${task}\n\n`;
    if (request && task && task !== request) {
      userContent += `## The original request\n\n${request}\n\n`;
    }

    // The plan file, when the workspace has one (the Ralph Loop works through it).
    const planFile = await this.readPlanFile(context.workingDir);
    if (planFile) {
      userContent +=
        `## ${this.planFile}\n\n${planFile}\n\n` +
        `Work through ${this.planFile}: pick ONE unchecked item, complete it with your tools, ` +
        `mark it done as [x] in ${this.planFile}, and end your turn.\n\n`;
    }

    // Corrections sent back by Check or Decide: what this turn must fix.
    const corrections = correctionSignals.flatMap((s) => {
      const list = s.data.corrections;
      return Array.isArray(list) ? list.map(String) : [];
    });
    if (correctionSignals.length > 0) {
      if (this.lastResponse) {
        userContent += `## Your previous answer\n\n${this.lastResponse}\n\n`;
      }
      userContent += `## Corrections to apply\n\n`;
      userContent += corrections.length > 0
        ? corrections.map((c) => `- ${c}`).join("\n")
        : "- The last check did not pass. Fix the work and try again.";
      userContent += "\n\n";

      // What the lab's own check printed, beside corrections a model may have written.
      const failed = new Map<string, string>();
      for (const s of correctionSignals) {
        const list = Array.isArray(s.data.failedChecks) ? (s.data.failedChecks as Array<{ name?: unknown; output?: unknown }>) : [];
        for (const f of list) failed.set(String(f.name), String(f.output ?? "").slice(0, 1000));
      }
      const alreadyShown = corrections.some((c) => c.startsWith("The measured check "));
      if (failed.size > 0 && !alreadyShown) {
        userContent += `## Measured checks that failed\n\n`;
        userContent += [...failed].map(([name, output]) => `- ${name}: ${output}`).join("\n") + "\n\n";
      }
    }

    // Add memory context
    if (memorySignals.length > 0) {
      const memories = memorySignals.map((s) => s.data.summary || s.data.content).join("\n\n");
      userContent += `## Relevant Context\n\n${memories}\n\n`;
    }

    // Add additional context (an operator's note arrives here)
    for (const sig of contextSignals) {
      if (sig.data.content === undefined) continue;
      const label = sig.data.label === "operator"
        ? `A note from the operator${sig.data.priority ? ` (${sig.data.priority})` : ""}`
        : `Context: ${sig.data.label || "Additional"}`;
      userContent += `## ${label}\n\n${sig.data.content}\n\n`;
    }

    // Contextual memory recall — when the node's policy enables it, prepend
    // the most relevant prior knowledge so the executor reasons with memory.
    const memory = context.runtime?.memory;
    if (memory?.contextual) {
      const query = task || this.lastPlan || userContent;
      if (query.trim()) {
        try {
          const recalled = await memory.recall(query);
          if (recalled.length > 0) {
            const lines = recalled.map((r, i) => `${i + 1}. ${r.content}`).join("\n");
            userContent =
              `## Recalled Memory (relevant prior knowledge)\n\n${lines}\n\n` + userContent;
          }
        } catch {
          /* best-effort recall */
        }
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

  /** The plan file's text, when it exists and has checklist items. */
  private async readPlanFile(workingDir: string): Promise<string | null> {
    try {
      const text = await readFile(join(workingDir, this.planFile), "utf-8");
      if (!/^\s*[-*]\s+\[[ xX~!B-]\]/m.test(text)) return null;
      return text.length > 8000 ? text.slice(0, 8000) + "\n[...]" : text;
    } catch {
      return null;
    }
  }
}
