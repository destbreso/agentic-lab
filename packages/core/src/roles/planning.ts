// ============================================
// Planning Loop
// ============================================
// Slow, strategic, high-cost, high-impact.
//
// Reviews aggregated state from multiple cycles.
// Changes strategy if needed. Decides whether
// to continue, pivot, or stop.
//
// Runs at LOW frequency (e.g., every 5 execution cycles).
//
// Input signals:
//   - evaluation: verdicts from the evaluator
//   - execution_result: aggregated execution history
//   - critic_feedback: feedback from the critic loop
//
// Output signals:
//   - plan: updated plan with new/reprioritized tasks
//   - strategy: strategic decisions (continue, pivot, stop)
//   - task: specific task assignment for the executor

import type { LLMProvider, ChatMessage } from "../types/llm.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolRegistry } from "../types/tools.js";
import type { NodeContext, NodeResult } from "../types/pipeline.js";
import { BaseRoleEngine } from "./base.js";
import { appendSkillPrompt } from "../skills/compose.js";

export interface PlanningEngineConfig {
  /** LLM provider: use a strong model (GPT-4o, Claude Sonnet) */
  provider: LLMProvider;
  /** Tools: primarily file_read, file_write for plan management */
  tools: ToolRegistry;
  /** Path to the plan file */
  planFile?: string;
  /** Path to specs directory */
  specsDir?: string;
  /** Custom system message */
  systemMessage?: string;
  /** Composed instructions from attached skills, appended to the system message */
  skillPrompt?: string;
}

export type StrategyDecision = "continue" | "pivot" | "stop" | "escalate";

export class PlanningEngine extends BaseRoleEngine {
  private llmProvider: LLMProvider;
  private tools: ToolRegistry;
  private planFile: string;
  private specsDir?: string;
  private systemMessage: string;

  constructor(
    config: PlanningEngineConfig,
    overrides?: {
      id?: string;
      name?: string;
      config?: Partial<import("../types/pipeline.js").NodeRunConfig>;
      ports?: import("../types/pipeline.js").PortOverrides;
    },
  ) {
    super({
      id: overrides?.id,
      ports: overrides?.ports,
      name: overrides?.name || "Planning Loop",
      category: "planning",
      description:
        "Slow, strategic planner. Reviews aggregate state across cycles, " +
        "adjusts the plan, reprioritizes tasks, and makes directional decisions.",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
        frequency: {
          everyNIterations: 5, // Run every 5 execution cycles
        },
        ...overrides?.config,
      },
      inputPorts: [
        {
          name: "evaluation",
          direction: "input",
          signalTypes: ["evaluation", "eval_metrics"],
          description: "Verdicts from the evaluator",
        },
        {
          name: "task",
          direction: "input",
          signalTypes: ["task", "replan_signal"],
          description: "The task, or the reason to start over",
          required: false,
        },
        {
          name: "execution_result",
          direction: "input",
          signalTypes: ["execution_result", "token_usage"],
          description: "Aggregated execution history",
        },
        {
          name: "critic_feedback",
          direction: "input",
          signalTypes: ["critic_feedback", "stagnation_alert"],
          description: "Feedback from critic loop",
          required: false,
        },
        {
          name: "memory",
          direction: "input",
          signalTypes: ["memory", "compressed_context"],
          description: "Compressed context from memory loop",
          required: false,
        },
      ],
      outputPorts: [
        {
          name: "plan",
          direction: "output",
          signalTypes: ["plan"],
          description: "Updated plan",
        },
        {
          name: "strategy",
          direction: "output",
          signalTypes: ["strategy"],
          description: "Strategic decisions",
        },
        {
          name: "task",
          direction: "output",
          signalTypes: ["task"],
          description: "Next task for executor",
        },
      ],
    });

    this.llmProvider = config.provider;
    this.tools = config.tools;
    this.planFile = config.planFile || "PLAN.md";
    this.specsDir = config.specsDir;
    this.systemMessage = appendSkillPrompt(
      config.systemMessage ||
        "You are a strategic planning agent. Your role is to:\n" +
          "1. Review the aggregate progress across multiple execution cycles\n" +
          "2. Identify what's working and what's not\n" +
          "3. Update the plan: reprioritize, add new tasks, mark completed ones\n" +
          "4. Make strategic decisions: continue, pivot approach, or recommend stopping\n" +
          "5. Assign the next specific task for the executor\n\n" +
          "Be strategic. Think about the big picture. Don't micromanage execution details.",
      config.skillPrompt ?? "",
    );
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`🧠 Planning cycle ${context.iteration}`);

    try {
      // Gather all input signals
      const evaluations = this.getInputSignals(context, "evaluation");
      const execResults = this.getInputSignals(context, "execution_result");
      const criticFeedback = this.getInputSignals(context, "critic_feedback");
      const stagnationAlerts = this.getInputSignals(
        context,
        "stagnation_alert",
      );
      const memorySignals = this.getInputSignals(context, "compressed_context");
      const replans = this.getInputSignals(context, "replan_signal");
      const metrics = this.getInputSignals(context, "eval_metrics");
      const taskSignals = this.getInputSignals(context, "task");
      const task =
        (taskSignals.length > 0 ? String(taskSignals[taskSignals.length - 1].data.task ?? "") : "") ||
        this.taskText(context) ||
        "";

      // Build planning prompt
      const prompt = this.buildPlanningPrompt({
        task,
        replans,
        evaluations: evaluations.length > 0 ? evaluations : metrics,
        execResults,
        criticFeedback,
        stagnationAlerts,
        memorySignals,
        pipelineCycle: context.pipelineState.cycle,
        hasPlanFile: existsSync(join(context.workingDir, this.planFile)),
        hasSpecs: this.specsDir ? existsSync(join(context.workingDir, this.specsDir)) : false,
      });

      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        { role: "user", content: prompt },
      ];

      // Let the planner use tools (read/write plan, read specs)
      let answered = false;
      let rounds = 0;

      while (!answered && rounds < 10) {
        rounds++;

        const llmResult = await this.llmProvider.chat({
          messages,
          tools: this.tools.getDefinitions(),
          temperature: 0.3,
          maxTokens: this.config.maxTokens || 4096,
          ...this.callOptions(context),
        });

        result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
        result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
        result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

        if (
          llmResult.finishReason !== "tool_calls" ||
          !llmResult.message.toolCalls?.length
        ) {
          // Parse strategic output
          const decision = this.parseDecision(llmResult.message.content || "");

          // Emit plan update
          context.emit("plan", "plan", {
            plan: decision.plan,
            iteration: context.iteration,
          });

          // Emit strategy
          context.emit("strategy", "strategy", {
            decision: decision.strategy,
            reasoning: decision.reasoning,
            iteration: context.iteration,
          });

          // Always hand Do a task: the named next task, or the plan itself.
          context.emit("task", "task", {
            task: decision.nextTask || decision.plan,
            priority: decision.nextTaskPriority,
            iteration: context.iteration,
          });

          // If strategy is "stop", request pipeline stop
          if (decision.strategy === "stop") {
            context.requestStop(
              `Planner decided to stop: ${decision.reasoning}`,
            );
          }

          result.metadata = {
            decision: decision.strategy,
            reasoning: decision.reasoning,
          };
          answered = true;
          break;
        }

        // Execute tools
        messages.push(llmResult.message);
        for (const toolCall of llmResult.message.toolCalls) {
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
            const toolResult = await tool.execute(
              toolCall.arguments,
              this.toolContext(context, `plan:${toolCall.name}`, () => messages),
            );
            messages.push({
              role: "tool",
              content: toolResult,
              toolCallId: toolCall.id,
            });
            result.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: toolResult.slice(0, 500),
              durationMs: Date.now() - startTime,
            });
          } catch (error) {
            if (context.signal?.aborted) throw error;
            messages.push({
              role: "tool",
              content: `Error: ${(error as Error).message}`,
              toolCallId: toolCall.id,
            });
          }
        }
      }

      if (!answered) {
        errors.push("hit the tool-call cap (10 rounds) without a plan");
      }
    } catch (error) {
      errors.push((error as Error).message);
      context.log.error(`❌ Planning failed: ${(error as Error).message}`);
    }

    result.durationMs = Date.now() - startTime;
    result.errors = errors;
    result.success = errors.length === 0;
    return result;
  }

  private buildPlanningPrompt(data: {
    task: string;
    replans: import("../types/pipeline.js").Signal[];
    evaluations: import("../types/pipeline.js").Signal[];
    execResults: import("../types/pipeline.js").Signal[];
    criticFeedback: import("../types/pipeline.js").Signal[];
    stagnationAlerts: import("../types/pipeline.js").Signal[];
    memorySignals: import("../types/pipeline.js").Signal[];
    pipelineCycle: number;
    hasPlanFile: boolean;
    hasSpecs: boolean;
  }): string {
    let prompt = `## Strategic Planning Review (Pipeline Cycle ${data.pipelineCycle})\n\n`;

    if (data.task) {
      prompt += `### The task\n\n${data.task}\n\n`;
    }

    // A way back from Decide: why the last approach is being dropped.
    if (data.replans.length > 0) {
      prompt += "### Why we are starting over\n\n";
      for (const sig of data.replans) {
        const failed = Array.isArray(sig.data.failedCriteria) ? (sig.data.failedCriteria as unknown[]) : [];
        prompt += `- ${String(sig.data.reason ?? "the last approach did not work")}`;
        if (failed.length > 0) prompt += ` (failed: ${failed.map(String).join(", ")})`;
        prompt += "\n";
      }
      prompt += "\nPlan a different approach.\n\n";
    }

    const sources: string[] = [];
    if (data.hasPlanFile) sources.push(this.planFile);
    if (data.hasSpecs && this.specsDir) sources.push(`${this.specsDir}/`);
    if (sources.length > 0) {
      prompt += `Read ${sources.join(" and ")} to understand the current state.\n\n`;
    }

    // Evaluation history
    if (data.evaluations.length > 0) {
      prompt += "### Recent Evaluation Results\n\n";
      for (const sig of data.evaluations.slice(-5)) {
        const d = sig.data;
        const parts = [`Verdict: **${String(d.verdict ?? "none")}**`];
        if (typeof d.checksTotal === "number" && d.checksTotal > 0) {
          parts.push(`Checks: ${String(d.checksPassed ?? 0)}/${d.checksTotal}`);
        }
        if (typeof d.confidence === "number") parts.push(`Confidence: ${d.confidence}`);
        prompt += `- ${parts.join(" | ")}\n`;
      }
      prompt += "\n";
    }

    // Execution history
    if (data.execResults.length > 0) {
      prompt += "### Recent Execution Results\n\n";
      const successCount = data.execResults.filter(
        (s) => (s.data.toolCallCount as number) > 0,
      ).length;
      prompt += `- ${data.execResults.length} cycles, ${successCount} with tool activity\n`;
      prompt += "\n";
    }

    // Critic feedback
    if (data.criticFeedback.length > 0 || data.stagnationAlerts.length > 0) {
      prompt += "### ⚠️ Critic Feedback\n\n";
      for (const sig of data.criticFeedback) {
        prompt += `- ${sig.data.feedback}\n`;
      }
      for (const sig of data.stagnationAlerts) {
        prompt += `- 🔴 STAGNATION ALERT: ${sig.data.reason}\n`;
      }
      prompt += "\n";
    }

    // Compressed memory
    if (data.memorySignals.length > 0) {
      prompt += "### Context Summary\n\n";
      for (const sig of data.memorySignals.slice(-1)) {
        prompt += `${sig.data.summary}\n`;
      }
      prompt += "\n";
    }

    prompt += "### Your Task\n\n";
    let step = 1;
    if (data.hasPlanFile) {
      prompt += `${step++}. Read the current ${this.planFile}\n`;
    }
    prompt += `${step++}. Assess what the task needs and how far it has come\n`;
    if (data.hasPlanFile && this.tools.has("file_write")) {
      prompt += `${step++}. Update the plan if needed (rewrite ${this.planFile} with file_write)\n`;
    }
    prompt += `${step++}. State your STRATEGY: continue|pivot|stop|escalate\n`;
    prompt += `${step++}. State your REASONING\n`;
    prompt += `${step++}. State the NEXT_TASK for the executor\n`;

    return prompt;
  }

  private parseDecision(response: string): {
    strategy: StrategyDecision;
    reasoning: string;
    plan: string;
    nextTask: string;
    nextTaskPriority: number;
  } {
    const strategyMatch = response.match(
      /STRATEGY:\s*(continue|pivot|stop|escalate)/i,
    );
    const strategy =
      (strategyMatch?.[1]?.toLowerCase() as StrategyDecision) || "continue";

    const reasoningMatch = response.match(
      /REASONING:\s*([\s\S]*?)(?=NEXT_TASK:|PLAN:|$)/i,
    );
    const reasoning = reasoningMatch?.[1]?.trim() || response.slice(0, 200);

    const nextTaskMatch = response.match(
      /NEXT_TASK:\s*([\s\S]*?)(?=PRIORITY:|$)/i,
    );
    const nextTask = nextTaskMatch?.[1]?.trim() || "";

    const priorityMatch = response.match(/PRIORITY:\s*(\d+)/i);
    const nextTaskPriority = priorityMatch ? parseInt(priorityMatch[1]) : 1;

    return {
      strategy,
      reasoning,
      plan: response, // Full response as plan context
      nextTask,
      nextTaskPriority,
    };
  }
}
