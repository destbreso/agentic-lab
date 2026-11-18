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

import { z } from "zod";
import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";
import { parseStructured, jsonFormatInstruction } from "../utils/structured.js";
import { appendSkillPrompt } from "../skills/compose.js";

const pct = (rate: number | null) => (rate === null ? "none" : `${(rate * 100).toFixed(0)}%`);

export interface RefinementLoopConfig {
  /** LLM provider for decision analysis */
  provider: LLMProvider;
  /** Pass rate threshold to consider converged (0-1, default 0.7) */
  convergenceThreshold?: number;
  /** Max refinement rounds before forced convergence (default 3) */
  maxRounds?: number;
  /** Custom system message */
  systemMessage?: string;
  /** Composed instructions from attached skills, appended to the system message */
  skillPrompt?: string;
}

export type RefinementAction = "converge" | "refine" | "backtrack";

/** Human-readable shape used in the prompt to request JSON output. */
const REFINEMENT_SHAPE = `{
  "decision": "converge" | "refine" | "backtrack",
  "reason": string,            // one-sentence explanation
  "corrections": string[]      // if "refine", specific fixes (empty otherwise)
}`;

/**
 * Zod schema validating the refinement decision emitted by the LLM.
 * The enum is lowercase; uppercase variants (e.g. "CONVERGE") fall through to
 * the legacy regex recover path, which is case-insensitive.
 */
const refinementSchema = z.object({
  decision: z.enum(["converge", "refine", "backtrack"]),
  reason: z.string().default(""),
  corrections: z.array(z.string()).default([]),
});

export interface RefinementDecision {
  action: RefinementAction;
  reason: string;
  round: number;
  /** Null when the round had no verdict. */
  passRate: number | null;
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
  private ownTurns = 0;

  constructor(
    config: RefinementLoopConfig,
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
    this.systemMessage = appendSkillPrompt(
      config.systemMessage ||
      "You are the REFINEMENT DECISION engine of a deep reasoning agent.\n\n" +
        "You receive evaluation verdicts and critic feedback. Your job is to decide:\n\n" +
        "1. CONVERGE — The output meets quality criteria. Stop iterating.\n" +
        "2. REFINE — The approach is sound but has specific issues. Fix them.\n" +
        "3. BACKTRACK — The approach is fundamentally flawed. Start over.\n\n" +
        "Respond with a SINGLE JSON object (no prose, no code fences) of this shape:\n" +
        REFINEMENT_SHAPE +
        "\n\nRules:\n" +
        "- If ≥70% of evaluation criteria pass → likely CONVERGE\n" +
        "- If <70% pass but the approach is correct → REFINE\n" +
        "- If the same issues recur across multiple rounds → BACKTRACK\n" +
        "- If critic detects circularity or stagnation → BACKTRACK\n" +
        "- Max rounds exceeded → forced CONVERGE",
      config.skillPrompt ?? "",
    );
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();

    // The round is the run's when it has one; Decide counts rounds taken, not its own turns.
    this.ownTurns++;
    this.currentRound = context.round ?? this.ownTurns;
    context.log.info(
      `🔄 Refinement analysis — Round ${this.currentRound}/${this.maxRounds}`,
    );

    try {
      const evalSignals = this.getInputSignals(context, "evaluation").concat(
        this.getInputSignals(context, "eval_metrics"),
      );
      const criticSignals = this.getInputSignals(
        context,
        "critic_feedback",
      ).concat(this.getInputSignals(context, "stagnation_alert"));

      const { passRate, failedCriteria } = this.computePassRate(evalSignals);
      const criticFindings = this.extractCriticFindings(criticSignals);
      const passing = passRate !== null && passRate >= this.convergenceThreshold;

      const converge = (reason: string) => {
        const decision = this.record("converge", reason, passRate, failedCriteria, criticFindings);
        context.emit("refinement_decision", "refinement_decision", decision as unknown as Record<string, unknown>);
        context.emit("convergence", "convergence", { decision, history: this.refinementHistory });
        context.done?.(reason);
        result.metadata = { decision };
      };

      // 1. A passing round with no critic finding converges without a model call.
      if (passing && criticFindings.length === 0) {
        context.log.info(`  ✅ Pass rate ${pct(passRate)} ≥ ${pct(this.convergenceThreshold)}: converging`);
        converge(`pass rate ${pct(passRate)} meets the threshold of ${pct(this.convergenceThreshold)}`);
        result.success = true;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // 2. The last round allowed: nothing can be sent back, so the run ends here.
      if (this.currentRound >= this.maxRounds) {
        const reason = passing
          ? `round limit (${this.maxRounds}) reached; the last round passed`
          : `round limit (${this.maxRounds}) reached without a passing verdict`;
        context.log.warn(`  ⚠️ ${reason}`);
        converge(reason);
        result.success = true;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // 3. Ask the model: converge, refine or backtrack.
      const shouldBacktrack = this.detectRecurrence(failedCriteria);
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        {
          role: "user",
          content: this.buildDecisionPrompt(passRate, failedCriteria, criticFindings, shouldBacktrack),
        },
      ];

      const llmResult = await this.llmProvider.chat({
        messages,
        temperature: 0.2,
        maxTokens: 512,
        ...this.callOptions(context),
      });

      result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
      result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
      result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

      // Parse decision: JSON + Zod, with the legacy regex parsers as a
      // recovery fallback (never regress on non-JSON models).
      const llmContent = llmResult.message.content ?? "";
      const legacy = this.parseDecisionLegacy(llmContent, shouldBacktrack);
      const parsed = parseStructured(refinementSchema, llmContent, {
        recover: () => legacy,
        fallback: legacy,
      });
      const decisionData = parsed.data ?? legacy;
      const action = decisionData.decision;
      const reason = decisionData.reason || "Continuing refinement process";
      if (parsed.usedFallback) {
        context.log.debug(`refinement parsing used fallback: ${parsed.error ?? "unknown"}`);
      }

      switch (action) {
        case "converge":
          context.log.info(`  ✅ CONVERGE: ${reason}`);
          converge(reason);
          break;

        case "refine": {
          context.log.info(`  🔧 REFINE: ${reason}`);
          const decision = this.record("refine", reason, passRate, failedCriteria, criticFindings);
          context.emit("refinement_decision", "refinement_decision", decision as unknown as Record<string, unknown>);
          context.emit("corrections", "corrections", {
            corrections:
              decisionData.corrections && decisionData.corrections.length > 0
                ? decisionData.corrections
                : [`Decide sent the work back: ${reason}`],
            failedCriteria,
            round: this.currentRound,
          });
          result.metadata = { decision };
          break;
        }

        case "backtrack": {
          context.log.info(`  🔄 BACKTRACK: ${reason}`);
          const decision = this.record("backtrack", reason, passRate, failedCriteria, criticFindings);
          context.emit("refinement_decision", "refinement_decision", decision as unknown as Record<string, unknown>);
          context.emit("replan_signal", "replan_signal", {
            reason,
            failedCriteria,
            round: this.currentRound,
            history: this.refinementHistory,
          });
          result.metadata = { decision };
          break;
        }
      }

      result.success = true;
      result.durationMs = Date.now() - startTime;
    } catch (err) {
      const msg = (err as Error).message;
      context.log.error(`  ❌ Refinement error: ${msg}`);
      result.errors.push(msg);
      result.success = false;
      result.durationMs = Date.now() - startTime;
    }

    return result;
  }

  private record(
    action: RefinementAction,
    reason: string,
    passRate: number | null,
    failedCriteria: string[],
    criticFindings: string[],
  ): RefinementDecision {
    const decision: RefinementDecision = {
      action,
      reason,
      round: this.currentRound,
      passRate,
      failedCriteria,
      criticFindings,
    };
    this.refinementHistory.push(decision);
    return decision;
  }

  // -----------------------------------------------------------
  // Analysis helpers
  // -----------------------------------------------------------

  /**
   * The share of passing verdicts. A verdict is counted once per Check role
   * and turn (its `evaluation` and `eval_metrics` signals carry the same one);
   * partial, inconclusive and unparsed verdicts count as not passing; with no
   * verdict at all the pass rate is null: the round is inconclusive.
   */
  private computePassRate(evalSignals: Signal[]): {
    passRate: number | null;
    failedCriteria: string[];
  } {
    const criteria: Array<{ name: string; pass: boolean }> = [];
    const counted = new Set<string>();

    // evaluation before eval_metrics, so the richer signal is the one kept
    const ordered = [...evalSignals].sort(
      (a, b) => Number(a.type !== "evaluation") - Number(b.type !== "evaluation"),
    );

    for (const signal of ordered) {
      const data = signal.data;

      if (Array.isArray(data.criteria)) {
        for (const c of data.criteria as Array<{ name: string; pass: boolean }>) {
          criteria.push({ name: c.name, pass: c.pass === true });
        }
        continue;
      }

      if (typeof data.verdict === "string") {
        const key = `${signal.sourceNodeId}:${String(data.iteration ?? "")}`;
        if (counted.has(key)) continue;
        counted.add(key);
        const pass = data.verdict === "pass" && data.parsed !== false;
        criteria.push({
          name: (data.criterion as string) || (pass ? "verdict" : `verdict: ${data.parsed === false ? "unparsed" : data.verdict}`),
          pass,
        });
        continue;
      }

      if (typeof data.score === "number") {
        criteria.push({
          name: (data.criterion as string) || "score",
          pass: (data.score as number) >= 0.7,
        });
      }
    }

    if (criteria.length === 0) {
      return { passRate: null, failedCriteria: [] };
    }

    const passed = criteria.filter((c) => c.pass).length;
    const failedCriteria = criteria.filter((c) => !c.pass).map((c) => c.name);

    return {
      passRate: passed / criteria.length,
      failedCriteria,
    };
  }

  /** Critic findings: warnings, critical issues and stagnation alerts. An "ok" is not a finding. */
  private extractCriticFindings(signals: Signal[]): string[] {
    const findings: string[] = [];
    for (const signal of signals) {
      if (signal.type === "stagnation_alert") {
        findings.push(`[STAGNATION] ${String(signal.data.reason ?? "stagnation detected")}`);
        continue;
      }
      const status = String(signal.data.status ?? "ok");
      if (status === "warning" || status === "critical") {
        findings.push(
          `[${status.toUpperCase()}] ${String(signal.data.feedback || signal.data.issue || "unknown")}`,
        );
      }
    }
    return findings;
  }

  private detectRecurrence(failedCriteria: string[]): boolean {
    // This round and the one before: one earlier decision is enough to compare.
    if (this.refinementHistory.length < 1 || failedCriteria.length === 0) return false;

    // Check if the same criteria failed in the last 2 rounds
    const prev = this.refinementHistory[this.refinementHistory.length - 1];
    const overlap = failedCriteria.filter((c) =>
      prev.failedCriteria.includes(c),
    );

    // If >50% of failures are recurring, suggest backtrack
    return overlap.length > failedCriteria.length * 0.5;
  }

  private buildDecisionPrompt(
    passRate: number | null,
    failedCriteria: string[],
    criticFindings: string[],
    suggestBacktrack: boolean,
  ): string {
    const parts = [
      `ROUND: ${this.currentRound}/${this.maxRounds}`,
      passRate === null
        ? `PASS RATE: none, no verdict was given this round (inconclusive, not a pass)`
        : `PASS RATE: ${pct(passRate)} (threshold: ${pct(this.convergenceThreshold)})`,
    ];

    if (failedCriteria.length > 0) {
      parts.push(`FAILED CRITERIA: ${failedCriteria.join(", ")}`);
    }

    if (criticFindings.length > 0) {
      parts.push(`CRITIC FINDINGS: ${criticFindings.join("; ")}`);
    }

    if (this.refinementHistory.length > 0) {
      const historyStr = this.refinementHistory
        .map(
          (h) =>
            `  Round ${h.round}: ${h.action} (${h.passRate === null ? "no verdict" : `${pct(h.passRate)} pass`}): ${h.reason}`,
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

  /**
   * Legacy regex parser combining action/reason/corrections, kept as a
   * recovery fallback for models that ignore the JSON output instruction.
   */
  private parseDecisionLegacy(
    content: string,
    suggestBacktrack: boolean,
  ): { decision: RefinementAction; reason: string; corrections: string[] } {
    return {
      decision: this.parseAction(content, suggestBacktrack),
      reason: this.parseReason(content),
      corrections: this.parseCorrections(content),
    };
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
