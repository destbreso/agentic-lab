// ============================================
// Refinement Loop — Convergence Gate
// ============================================
// The iterative decision-maker. Analyzes evaluation results
// and critic feedback to decide whether the pipeline should:
//
//   1. CONVERGE — output is good enough, stop iterating
//   2. REFINE   — keep the approach, fix specific issues
//   3. BACKTRACK — the approach is fundamentally wrong, re-plan from scratch
//
// This loop enables Opus-class deep reasoning by adding
// a self-correcting feedback mechanism to the pipeline.
// Instead of one-shot plan→exec→eval, the pipeline can
// iterate through multiple rounds until convergence.
//
// Epistemic Role:
//   The Refinement Loop has a unique epistemic position: it
//   sees BOTH evaluation verdicts AND critic structural analysis.
//   No other loop has this combined view. It synthesizes:
//   - "Is the output correct?" (from Evaluation)
//   - "Is the process healthy?" (from Critic)
//   Into a single actionable decision.
//
// Input signals:
//   - evaluation: verdicts from evaluation loop (pass/fail per criterion)
//   - eval_metrics: quantitative scores
//   - critic_feedback: structural observations from critic
//   - execution_result: the output being evaluated
//
// Output signals:
//   - refinement_decision: { action, reason, round, passRate }
//   - corrections: specific fixes to apply (sent to execution)
//   - replan_signal: request to re-plan (sent to planning)
//   - convergence: pipeline has converged, stop iterating

import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";

export interface RefinementLoopConfig {
  /** LLM provider for decision analysis */
  provider: LLMProvider;
  /** Pass rate threshold to consider converged (0-1, default 0.7) */
  convergenceThreshold?: number;
  /** Max refinement rounds before forced convergence (default 3) */
  maxRounds?: number;
  /** Custom system message */
  systemMessage?: string;
}

export type RefinementAction = "converge" | "refine" | "backtrack";

export interface RefinementDecision {
  action: RefinementAction;
  reason: string;
  round: number;
  passRate: number;
  failedCriteria: string[];
  criticFindings: string[];
}

export class RefinementLoop extends BaseLoopNode {
  private llmProvider: LLMProvider;
  private convergenceThreshold: number;
  private maxRounds: number;
  private systemMessage: string;

  // Internal state: refinement history across rounds
  private refinementHistory: RefinementDecision[] = [];
  private currentRound = 0;

  constructor(
    config: RefinementLoopConfig,
    overrides?: {
      id?: string;
      name?: string;
      config?: Partial<import("../types/pipeline.js").NodeRunConfig>;
    },
  ) {
    super({
      id: overrides?.id,
      name: overrides?.name || "Refinement Loop",
      category: "refinement",
      description:
        "Convergence gate for iterative refinement. Analyzes evaluation " +
        "verdicts and critic feedback to decide: converge, refine, or " +
        "backtrack. Enables Opus-class deep reasoning through self-correction.",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false, // Must run after evaluation + critic
        frequency: {
          everyNIterations: 1, // Run every cycle (it's the gate)
          onSignals: ["evaluation", "eval_metrics"],
        },
        ...overrides?.config,
      },
      inputPorts: [
        {
          name: "evaluation",
          direction: "input",
          signalTypes: ["evaluation", "eval_metrics"],
          description: "Verdicts from evaluation loop",
          required: true,
        },
        {
          name: "critic_feedback",
          direction: "input",
          signalTypes: ["critic_feedback", "stagnation_alert"],
          description: "Structural analysis from critic",
          required: false,
        },
        {
          name: "execution_result",
          direction: "input",
          signalTypes: ["execution_result"],
          description: "The output being refined",
          required: false,
        },
      ],
      outputPorts: [
        {
          name: "refinement_decision",
          direction: "output",
          signalTypes: ["refinement_decision"],
          description: "The decision: converge, refine, or backtrack",
        },
        {
          name: "corrections",
          direction: "output",
          signalTypes: ["corrections"],
          description: "Specific fixes to apply (sent to execution)",
        },
        {
          name: "replan_signal",
          direction: "output",
          signalTypes: ["replan_signal"],
          description: "Request for full re-planning (on backtrack)",
        },
        {
          name: "convergence",
          direction: "output",
          signalTypes: ["convergence"],
          description: "Pipeline has converged — stop iterating",
        },
      ],
    });

    this.llmProvider = config.provider;
    this.convergenceThreshold = config.convergenceThreshold ?? 0.7;
    this.maxRounds = config.maxRounds ?? 3;
    this.systemMessage =
      config.systemMessage ||
      "You are the REFINEMENT DECISION engine of a deep reasoning agent.\n\n" +
        "You receive evaluation verdicts and critic feedback. Your job is to decide:\n\n" +
        "1. CONVERGE — The output meets quality criteria. Stop iterating.\n" +
        "2. REFINE — The approach is sound but has specific issues. Fix them.\n" +
        "3. BACKTRACK — The approach is fundamentally flawed. Start over.\n\n" +
        "Output format (strict):\n" +
        "DECISION: CONVERGE | REFINE | BACKTRACK\n" +
        "REASON: <one-sentence explanation>\n" +
        "CORRECTIONS: <if REFINE, list specific fixes needed>\n\n" +
        "Rules:\n" +
        "- If ≥70% of evaluation criteria pass → likely CONVERGE\n" +
        "- If <70% pass but the approach is correct → REFINE\n" +
        "- If the same issues recur across multiple rounds → BACKTRACK\n" +
        "- If critic detects circularity or stagnation → BACKTRACK\n" +
        "- Max rounds exceeded → forced CONVERGE";
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();

    this.currentRound++;
    context.log.info(
      `🔄 Refinement analysis — Round ${this.currentRound}/${this.maxRounds}`,
    );

    try {
      // 1. Gather evaluation signals
      const evalSignals = this.getInputSignals(context, "evaluation").concat(
        this.getInputSignals(context, "eval_metrics"),
      );

      // 2. Gather critic signals
      const criticSignals = this.getInputSignals(
        context,
        "critic_feedback",
      ).concat(this.getInputSignals(context, "stagnation_alert"));

      // 3. Compute pass rate from evaluation signals
      const { passRate, failedCriteria } = this.computePassRate(evalSignals);

      // 4. Check for forced convergence (max rounds)
      if (this.currentRound >= this.maxRounds) {
        context.log.warn(
          `  ⚠️ Max rounds (${this.maxRounds}) reached — forcing convergence`,
        );
        const decision: RefinementDecision = {
          action: "converge",
          reason: `Max refinement rounds (${this.maxRounds}) reached`,
          round: this.currentRound,
          passRate,
          failedCriteria,
          criticFindings: this.extractCriticFindings(criticSignals),
        };
        this.refinementHistory.push(decision);

        context.emit("convergence", "convergence", {
          decision,
          history: this.refinementHistory,
        });
        context.emit("refinement_decision", "refinement_decision", decision as unknown as Record<string, unknown>);

        result.success = true;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // 5. Quick heuristic check: high pass rate = converge
      if (passRate >= this.convergenceThreshold && criticSignals.length === 0) {
        context.log.info(
          `  ✅ Pass rate ${(passRate * 100).toFixed(0)}% ≥ ${(this.convergenceThreshold * 100).toFixed(0)}% — converging`,
        );
        const decision: RefinementDecision = {
          action: "converge",
          reason: `Pass rate ${(passRate * 100).toFixed(0)}% exceeds threshold`,
          round: this.currentRound,
          passRate,
          failedCriteria,
          criticFindings: [],
        };
        this.refinementHistory.push(decision);

        context.emit("convergence", "convergence", {
          decision,
          history: this.refinementHistory,
        });
        context.emit("refinement_decision", "refinement_decision", decision as unknown as Record<string, unknown>);

        result.success = true;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // 6. Detect recurring patterns (backtrack trigger)
      const shouldBacktrack = this.detectRecurrence(failedCriteria);

      // 7. Use LLM for nuanced decision
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        {
          role: "user",
          content: this.buildDecisionPrompt(
            passRate,
            failedCriteria,
            criticSignals,
            shouldBacktrack,
          ),
        },
      ];

      const llmResult = await this.llmProvider.chat({
        messages,
        temperature: 0.2,
        maxTokens: 512,
      });

      result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
      result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
      result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

      // 8. Parse decision
      const llmContent = llmResult.message.content ?? "";
      const action = this.parseAction(llmContent, shouldBacktrack);
      const reason = this.parseReason(llmContent);
      const corrections = this.parseCorrections(llmContent);

      const decision: RefinementDecision = {
        action,
        reason,
        round: this.currentRound,
        passRate,
        failedCriteria,
        criticFindings: this.extractCriticFindings(criticSignals),
      };
      this.refinementHistory.push(decision);

      // 9. Emit appropriate signals based on decision
      context.emit("refinement_decision", "refinement_decision", decision as unknown as Record<string, unknown>);

      switch (action) {
        case "converge":
          context.log.info(`  ✅ CONVERGE: ${reason}`);
          context.emit("convergence", "convergence", {
            decision,
            history: this.refinementHistory,
          });
          break;

        case "refine":
          context.log.info(`  🔧 REFINE: ${reason}`);
          context.emit("corrections", "corrections", {
            corrections,
            failedCriteria,
            round: this.currentRound,
          });
          break;

        case "backtrack":
          context.log.info(`  🔄 BACKTRACK: ${reason}`);
          context.emit("replan_signal", "replan_signal", {
            reason,
            failedCriteria,
            round: this.currentRound,
            history: this.refinementHistory,
          });
          break;
      }

      result.success = true;
      result.durationMs = Date.now() - startTime;
      result.metadata = { decision };
    } catch (err) {
      const msg = (err as Error).message;
      context.log.error(`  ❌ Refinement error: ${msg}`);
      result.errors.push(msg);
      result.durationMs = Date.now() - startTime;
    }

    return result;
  }

  // -----------------------------------------------------------
  // Analysis helpers
  // -----------------------------------------------------------

  private computePassRate(evalSignals: Signal[]): {
    passRate: number;
    failedCriteria: string[];
  } {
    const criteria: Array<{ name: string; pass: boolean }> = [];

    for (const signal of evalSignals) {
      const data = signal.data;

      // Handle structured verdict signals
      if (data.verdict === "pass" || data.verdict === "fail") {
        criteria.push({
          name: (data.criterion as string) || "unnamed",
          pass: data.verdict === "pass",
        });
      }

      // Handle eval_metrics with scores
      if (typeof data.score === "number") {
        criteria.push({
          name: (data.criterion as string) || "score",
          pass: (data.score as number) >= 0.7,
        });
      }

      // Handle bulk criteria array
      if (Array.isArray(data.criteria)) {
        for (const c of data.criteria as Array<{
          name: string;
          pass: boolean;
        }>) {
          criteria.push(c);
        }
      }
    }

    if (criteria.length === 0) {
      // No evaluation data — assume pass (no evidence of failure)
      return { passRate: 1, failedCriteria: [] };
    }

    const passed = criteria.filter((c) => c.pass).length;
    const failedCriteria = criteria.filter((c) => !c.pass).map((c) => c.name);

    return {
      passRate: passed / criteria.length,
      failedCriteria,
    };
  }

  private extractCriticFindings(signals: Signal[]): string[] {
    const findings: string[] = [];
    for (const signal of signals) {
      if (signal.data.feedback) {
        findings.push(String(signal.data.feedback));
      }
      if (
        signal.data.status === "warning" ||
        signal.data.status === "critical"
      ) {
        findings.push(
          `[${String(signal.data.status).toUpperCase()}] ${String(signal.data.feedback || signal.data.issue || "unknown")}`,
        );
      }
    }
    return findings;
  }

  private detectRecurrence(failedCriteria: string[]): boolean {
    if (this.refinementHistory.length < 2) return false;

    // Check if the same criteria failed in the last 2 rounds
    const prev = this.refinementHistory[this.refinementHistory.length - 1];
    const overlap = failedCriteria.filter((c) =>
      prev.failedCriteria.includes(c),
    );

    // If >50% of failures are recurring, suggest backtrack
    return overlap.length > failedCriteria.length * 0.5;
  }

  private buildDecisionPrompt(
    passRate: number,
    failedCriteria: string[],
    criticSignals: Signal[],
    suggestBacktrack: boolean,
  ): string {
    const parts = [
      `ROUND: ${this.currentRound}/${this.maxRounds}`,
      `PASS RATE: ${(passRate * 100).toFixed(0)}% (threshold: ${(this.convergenceThreshold * 100).toFixed(0)}%)`,
    ];

    if (failedCriteria.length > 0) {
      parts.push(`FAILED CRITERIA: ${failedCriteria.join(", ")}`);
    }

    if (criticSignals.length > 0) {
      const findings = this.extractCriticFindings(criticSignals);
      parts.push(`CRITIC FINDINGS: ${findings.join("; ")}`);
    }

    if (this.refinementHistory.length > 0) {
      const historyStr = this.refinementHistory
        .map(
          (h) =>
            `  Round ${h.round}: ${h.action} (${(h.passRate * 100).toFixed(0)}% pass) — ${h.reason}`,
        )
        .join("\n");
      parts.push(`HISTORY:\n${historyStr}`);
    }

    if (suggestBacktrack) {
      parts.push(
        "⚠️ WARNING: Same criteria failing across rounds — consider BACKTRACK",
      );
    }

    return parts.join("\n");
  }

  private parseAction(
    content: string,
    suggestBacktrack: boolean,
  ): RefinementAction {
    const lower = content.toLowerCase();

    if (lower.includes("backtrack")) return "backtrack";
    if (lower.includes("converge")) return "converge";
    if (lower.includes("refine")) return "refine";

    // Fallback: if recurrence detected, backtrack; otherwise refine
    return suggestBacktrack ? "backtrack" : "refine";
  }

  private parseReason(content: string): string {
    const match = content.match(/REASON:\s*(.*)/i);
    if (match) return match[1].trim();

    // Fallback: use first non-empty line that's not a keyword
    const lines = content.split("\n").filter((l) => l.trim());
    const meaningful = lines.find(
      (l) =>
        !l.startsWith("DECISION") &&
        !l.startsWith("CORRECTIONS") &&
        l.trim().length > 10,
    );
    return meaningful?.trim() || "Continuing refinement process";
  }

  private parseCorrections(content: string): string[] {
    const corrections: string[] = [];
    const section = content.match(
      /CORRECTIONS:\s*([\s\S]*?)(?=\n\n|DECISION|REASON|$)/i,
    );

    if (section) {
      const lines = section[1].split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const cleaned = line.replace(/^[-*•\d.)\s]+/, "").trim();
        if (cleaned.length > 3) {
          corrections.push(cleaned);
        }
      }
    }

    return corrections;
  }
}
