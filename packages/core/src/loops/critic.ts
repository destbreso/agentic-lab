// ============================================
// Critic / Anti-Ralph Loop
// ============================================
// The adversarial watchdog. Looks for:
//   - Stagnation (same actions repeated)
//   - Circularity (looping back to previous states)
//   - Self-confirmation (agent only validates its own output)
//   - Cost runaway (burning tokens without progress)
//
// Can force: reset, tool change, human intervention.
//
// ⚠️ This loop must NOT share full context with the planner.
// It gets a SUMMARY of recent activity, not raw messages.
//
// Input signals:
//   - execution_result: what happened (summarized)
//   - eval_metrics: evaluation scores over time
//   - token_usage: cost tracking
//
// Output signals:
//   - critic_feedback: observations and warnings
//   - stagnation_alert: hard alert for stagnation
//   - intervention: request for forced action

import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";

export interface CriticLoopConfig {
  /** LLM provider — can be a different, independent model */
  provider: LLMProvider;
  /** How many recent cycles to analyze */
  windowSize?: number;
  /** Stagnation threshold: max cycles with no real progress */
  stagnationThreshold?: number;
  /** Token budget: max total tokens before raising an alert */
  tokenBudget?: number;
  /** Custom system message */
  systemMessage?: string;
}

export type InterventionType =
  | "reset_context"
  | "change_tools"
  | "change_model"
  | "force_replan"
  | "request_human"
  | "abort";

export class CriticLoop extends BaseLoopNode {
  private llmProvider: LLMProvider;
  private windowSize: number;
  private stagnationThreshold: number;
  private tokenBudget: number;
  private systemMessage: string;

  // Internal state: history buffer (not shared with planner)
  private activityLog: Array<{
    cycle: number;
    toolCalls: string[];
    verdict?: string;
    tokens: number;
    timestamp: string;
  }> = [];

  constructor(
    config: CriticLoopConfig,
    overrides?: {
      id?: string;
      name?: string;
      config?: Partial<import("../types/pipeline.js").NodeRunConfig>;
    },
  ) {
    super({
      id: overrides?.id,
      name: overrides?.name || "Critic Loop",
      category: "critic",
      description:
        "Adversarial watchdog. Detects stagnation, circularity, " +
        "self-confirmation, and cost runaway. Does NOT share full " +
        "context with the planner — operates on summaries only.",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: true, // Can run in parallel with execution
        frequency: {
          everyNIterations: 3, // Check every 3 execution cycles
        },
        ...overrides?.config,
      },
      inputPorts: [
        {
          name: "execution_result",
          direction: "input",
          signalTypes: ["execution_result", "tool_calls"],
          description: "Summarized execution activity",
        },
        {
          name: "eval_metrics",
          direction: "input",
          signalTypes: ["eval_metrics", "evaluation"],
          description: "Evaluation scores over time",
        },
        {
          name: "token_usage",
          direction: "input",
          signalTypes: ["token_usage"],
          description: "Cost tracking",
        },
      ],
      outputPorts: [
        {
          name: "critic_feedback",
          direction: "output",
          signalTypes: ["critic_feedback"],
          description: "Observations and warnings",
        },
        {
          name: "stagnation_alert",
          direction: "output",
          signalTypes: ["stagnation_alert"],
          description: "Hard stagnation alert",
        },
        {
          name: "intervention",
          direction: "output",
          signalTypes: ["intervention"],
          description: "Request for forced action",
        },
      ],
    });

    this.llmProvider = config.provider;
    this.windowSize = config.windowSize || 10;
    this.stagnationThreshold = config.stagnationThreshold || 5;
    this.tokenBudget = config.tokenBudget || 500_000;
    this.systemMessage =
      config.systemMessage ||
      "You are a CRITIC agent. Your job is to detect problems in an agentic system.\n\n" +
        "You look for:\n" +
        "1. STAGNATION: same tools called with same args, no new progress\n" +
        "2. CIRCULARITY: the agent is undoing its own work, going in circles\n" +
        "3. SELF-CONFIRMATION: the agent is only validating its own output, not checking reality\n" +
        "4. COST RUNAWAY: spending tokens without proportional progress\n\n" +
        "You must be ADVERSARIAL — assume things are going wrong unless proven otherwise.\n" +
        "You do NOT have the full execution context — only summaries. This is intentional.\n\n" +
        "Output format:\n" +
        "STATUS: ok|warning|critical\n" +
        "ISSUES: list of detected issues\n" +
        "INTERVENTION: none|reset_context|change_tools|change_model|force_replan|request_human|abort\n" +
        "REASONING: why";
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`🔎 Critic analysis cycle ${context.iteration}`);

    try {
      // 1. Update activity log from input signals
      this.updateActivityLog(context);

      // 2. Run heuristic checks (fast, no LLM needed)
      const heuristics = this.runHeuristicChecks(context);

      // 3. If heuristics are clean and we have few entries, skip LLM
      if (heuristics.status === "ok" && this.activityLog.length < 3) {
        context.log.info("  ✅ No issues detected (heuristic)");
        context.emit("critic_feedback", "critic_feedback", {
          feedback: "No issues detected",
          status: "ok",
          iteration: context.iteration,
        });
        result.durationMs = Date.now() - startTime;
        result.success = true;
        return result;
      }

      // 4. Use LLM for deeper analysis
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        {
          role: "user",
          content: this.buildAnalysisPrompt(heuristics),
        },
      ];

      const llmResult = await this.llmProvider.chat({
        messages,
        temperature: 0.2,
        maxTokens: 1024,
      });

      result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
      result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
      result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

      // 5. Parse critic output
      const analysis = this.parseAnalysis(llmResult.message.content || "");

      // 6. Emit signals based on severity
      context.emit("critic_feedback", "critic_feedback", {
        feedback: analysis.issues.join("; ") || "No issues",
        status: analysis.status,
        reasoning: analysis.reasoning,
        iteration: context.iteration,
      });

      if (analysis.status === "critical") {
        context.emit("stagnation_alert", "stagnation_alert", {
          reason: analysis.issues.join("; "),
          severity: "critical",
          iteration: context.iteration,
        });
      }

      if (analysis.intervention !== "none") {
        context.emit("intervention", "intervention", {
          type: analysis.intervention,
          reason: analysis.reasoning,
          iteration: context.iteration,
        });

        // Abort if needed
        if (analysis.intervention === "abort") {
          context.requestStop(`Critic forced abort: ${analysis.reasoning}`);
        }
      }

      result.metadata = {
        status: analysis.status,
        intervention: analysis.intervention,
        issueCount: analysis.issues.length,
      };
    } catch (error) {
      errors.push((error as Error).message);
      context.log.error(
        `❌ Critic analysis failed: ${(error as Error).message}`,
      );
    }

    result.durationMs = Date.now() - startTime;
    result.errors = errors;
    result.success = errors.length === 0;
    return result;
  }

  /** Update internal activity log from signals */
  private updateActivityLog(context: NodeContext): void {
    const execResults = this.getInputSignals(context, "execution_result");
    const toolCallSignals = this.getInputSignals(context, "tool_calls");
    const tokenSignals = this.getInputSignals(context, "token_usage");
    const evalSignals = this.getInputSignals(context, "evaluation");

    // Aggregate signals into activity entries
    for (const sig of execResults) {
      const tokenSig = tokenSignals.find(
        (t) => t.data.iteration === sig.data.iteration,
      );
      const evalSig = evalSignals.find(
        (e) => e.data.iteration === sig.data.iteration,
      );
      const toolSig = toolCallSignals.find(
        (t) => t.data.iteration === sig.data.iteration,
      );

      this.activityLog.push({
        cycle: sig.data.iteration as number,
        toolCalls: toolSig
          ? (toolSig.data.calls as Array<{ name: string }>).map((c) => c.name)
          : [],
        verdict: evalSig?.data.verdict as string | undefined,
        tokens: (tokenSig?.data.totalTokens as number) || 0,
        timestamp: sig.timestamp,
      });
    }

    // Keep only the window
    if (this.activityLog.length > this.windowSize) {
      this.activityLog = this.activityLog.slice(-this.windowSize);
    }
  }

  /** Fast heuristic checks (no LLM cost) */
  private runHeuristicChecks(context: NodeContext): {
    status: "ok" | "warning" | "critical";
    issues: string[];
  } {
    const issues: string[] = [];
    const log = this.activityLog;

    if (log.length < 2) return { status: "ok", issues };

    // Check 1: Stagnation — no tool calls for N cycles
    const recentNoTools = log.slice(-this.stagnationThreshold);
    if (
      recentNoTools.length >= this.stagnationThreshold &&
      recentNoTools.every((e) => e.toolCalls.length === 0)
    ) {
      issues.push(
        `No tool calls for ${this.stagnationThreshold} consecutive cycles`,
      );
    }

    // Check 2: Repeated tool patterns (circularity)
    if (log.length >= 3) {
      const patterns = log.slice(-3).map((e) => e.toolCalls.sort().join(","));
      if (patterns[0] && patterns.every((p) => p === patterns[0])) {
        issues.push(`Same tool pattern repeated 3 times: [${patterns[0]}]`);
      }
    }

    // Check 3: Evaluation failures streak
    const recentEvals = log.filter((e) => e.verdict).slice(-3);
    if (
      recentEvals.length >= 3 &&
      recentEvals.every((e) => e.verdict === "fail")
    ) {
      issues.push("3 consecutive evaluation failures");
    }

    // Check 4: Token budget
    const totalTokens = log.reduce((sum, e) => sum + e.tokens, 0);
    const pipelineTotal = context.pipelineState.totalTokens.totalTokens;
    if (pipelineTotal > this.tokenBudget) {
      issues.push(
        `Token budget exceeded: ${pipelineTotal.toLocaleString()} / ${this.tokenBudget.toLocaleString()}`,
      );
    }

    // Determine status
    let status: "ok" | "warning" | "critical" = "ok";
    if (issues.length >= 2) status = "critical";
    else if (issues.length >= 1) status = "warning";

    return { status, issues };
  }

  private buildAnalysisPrompt(heuristics: {
    status: string;
    issues: string[];
  }): string {
    let prompt = "## Critic Analysis\n\n";

    prompt += `### Activity Log (last ${this.activityLog.length} cycles)\n\n`;
    for (const entry of this.activityLog) {
      prompt += `- Cycle ${entry.cycle}: tools=[${entry.toolCalls.join(", ")}] verdict=${entry.verdict || "n/a"} tokens=${entry.tokens}\n`;
    }

    prompt += "\n### Heuristic Results\n\n";
    prompt += `Status: ${heuristics.status}\n`;
    if (heuristics.issues.length > 0) {
      prompt += "Issues detected:\n";
      for (const issue of heuristics.issues) {
        prompt += `- ⚠️ ${issue}\n`;
      }
    } else {
      prompt += "No heuristic issues.\n";
    }

    prompt += "\n### Pipeline State\n\n";
    prompt += `Total tokens used: ${this.activityLog.reduce((s, e) => s + e.tokens, 0).toLocaleString()}\n`;
    prompt += `Budget: ${this.tokenBudget.toLocaleString()}\n`;

    prompt +=
      "\nAnalyze the above and respond with STATUS, ISSUES, INTERVENTION, and REASONING.";

    return prompt;
  }

  private parseAnalysis(response: string): {
    status: "ok" | "warning" | "critical";
    issues: string[];
    intervention: InterventionType | "none";
    reasoning: string;
  } {
    const statusMatch = response.match(/STATUS:\s*(ok|warning|critical)/i);
    const status =
      (statusMatch?.[1]?.toLowerCase() as "ok" | "warning" | "critical") ||
      "ok";

    const issuesMatch = response.match(/ISSUES:([\s\S]*?)(?=INTERVENTION:|$)/i);
    const issues = issuesMatch
      ? issuesMatch[1]
          .split("\n")
          .filter((l) => l.trim().startsWith("-"))
          .map((l) => l.trim().slice(2))
      : [];

    const interventionMatch = response.match(
      /INTERVENTION:\s*(none|reset_context|change_tools|change_model|force_replan|request_human|abort)/i,
    );
    const intervention =
      (interventionMatch?.[1]?.toLowerCase() as InterventionType | "none") ||
      "none";

    const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)$/i);
    const reasoning = reasoningMatch?.[1]?.trim() || response.slice(0, 200);

    return { status, issues, intervention, reasoning };
  }
}
