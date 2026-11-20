// ============================================
// Evaluation / Grounding Loop
// ============================================
// Verifies real-world changes. Validates outputs
// against external signals. Can say "nothing happened".
//
// ⚠️ CRITICAL: Never consumes only the Execution Loop's
// output. Must check REAL-WORLD signals: file system,
// git diff, test results, build output, API responses.
//
// Input signals:
//   - execution_result: what the executor claims it did
//   - ground_truth: external signals to verify against
//
// Output signals:
//   - evaluation: verdict (pass/fail/partial + evidence)
//   - corrections: suggested corrections for the executor
//   - metrics: quantitative evaluation metrics

import { z } from "zod";
import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { ToolRegistry, ToolContext } from "../types/tools.js";
import type { NodeContext, NodeResult, Provenance } from "../types/pipeline.js";
import type { MeasuredCheckRun } from "../tasks/types.js";
import { BaseRoleEngine } from "./base.js";
import { parseStructured, jsonFormatInstruction } from "../utils/structured.js";
import { appendSkillPrompt } from "../skills/compose.js";

export interface EvaluationEngineConfig {
  /** LLM provider (can be different/cheaper than execution) */
  provider: LLMProvider;
  /** Tools for verification (file_read, shell, git, grep) */
  tools: ToolRegistry;
  /** What checks to run automatically */
  checks?: EvaluationCheck[];
  /** Custom system message */
  systemMessage?: string;
  /** Composed instructions from attached skills, appended to the system message */
  skillPrompt?: string;
  /** Skip the turn when the workspace did not change and there is no check: nothing to verify (jig turns it on). */
  skipUnverifiable?: boolean;
}

export interface EvaluationCheck {
  name: string;
  type: "shell" | "file_exists" | "file_contains" | "git_diff" | "custom";
  command?: string;
  path?: string;
  pattern?: string;
  description: string;
}

export type EvaluationVerdict = "pass" | "fail" | "partial" | "inconclusive";

/** Human-readable shape used in the prompt to request JSON output. */
const EVALUATION_SHAPE = `{
  "verdict": "pass" | "fail" | "partial" | "inconclusive",
  "evidence": string[],     // concrete observations supporting the verdict
  "corrections": string[],  // specific fixes the executor should apply (empty when verdict is "pass")
  "confidence": number      // 0.0 to 1.0
}`;

/** Zod schema validating the evaluation verdict emitted by the LLM. */
const evaluationSchema = z.object({
  verdict: z.enum(["pass", "fail", "partial", "inconclusive"]),
  evidence: z.array(z.string()).default([]),
  corrections: z.array(z.string()).default([]),
  confidence: z
    .preprocess((v) => {
      const n = typeof v === "string" ? parseFloat(v) : v;
      if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
      return Math.max(0, Math.min(1, n));
    }, z.number())
    .default(0.5),
});

type EvaluationData = z.infer<typeof evaluationSchema>;

export class EvaluationEngine extends BaseRoleEngine {
  /** Tool-call rounds allowed before a verdict is due. */
  static readonly MAX_TOOL_ROUNDS = 10;
  private skipUnverifiable: boolean;
  private llmProvider: LLMProvider;
  private tools: ToolRegistry;
  private checks: EvaluationCheck[];
  private systemMessage: string;

  constructor(
    config: EvaluationEngineConfig,
    overrides?: { id?: string; name?: string; config?: Partial<import("../types/pipeline.js").NodeRunConfig>; ports?: import("../types/pipeline.js").PortOverrides },
  ) {
    super({
      id: overrides?.id,
      ports: overrides?.ports,
      name: overrides?.name || "Evaluation Loop",
      category: "evaluation",
      description:
        "Verifies real-world changes against external signals. " +
        "Never trusts execution output alone: always checks ground truth.",
      config: {
        maxIterations: 1,   // Usually one-shot per cycle
        delayMs: 0,
        concurrent: false,
        ...overrides?.config,
      },
      inputPorts: [
        { name: "execution_result", direction: "input", signalTypes: ["execution_result"], description: "What the executor claims it did" },
        { name: "ground_truth", direction: "input", signalTypes: ["ground_truth", "test_results", "build_output"], description: "External verification signals", required: false },
      ],
      outputPorts: [
        { name: "evaluation", direction: "output", signalTypes: ["evaluation"], description: "Verdict: pass/fail/partial with evidence" },
        { name: "corrections", direction: "output", signalTypes: ["corrections"], description: "Suggested corrections for the executor" },
        { name: "metrics", direction: "output", signalTypes: ["eval_metrics"], description: "Quantitative evaluation metrics" },
      ],
    });

    this.llmProvider = config.provider;
    this.tools = config.tools;
    this.checks = config.checks || [];
    this.skipUnverifiable = config.skipUnverifiable === true;
    this.systemMessage = appendSkillPrompt(
      config.systemMessage ||
        "You are an evaluation agent. Your job is to VERIFY real-world changes. " +
          "NEVER trust the executor's claims: always check the file system, " +
          "git diff, test results, and build output. Be rigorous and honest. " +
          "Report exactly what you observe, not what was claimed.",
      config.skillPrompt ?? "",
    );
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`🔍 Evaluation cycle ${context.iteration}`);

    try {
      // 1. The task's measured checks, run by the lab where no role can write;
      //    then the loop's own configured checks (legacy, in the workspace).
      const measured = context.checks ? await context.checks.measure() : undefined;
      const follow = context.checks?.verdictFrom === "measured" && measured !== undefined;
      const checkResults = await this.runAutomatedChecks(context);

      // 2. Get execution result signals (what the executor claims)
      const execResults = this.getInputSignals(context, "execution_result");
      const claimedWork = execResults.map((s) => s.data).filter(Boolean);
      const task = this.taskText(context) || undefined;

      // 3. Nothing to verify: no file changed (measured) and no check of any kind. A verifier
      //    with no evidence adds nothing, so the lab skips Check and says why.
      const latest = claimedWork.at(-1) as Record<string, unknown> | undefined;
      const nothingChanged = Array.isArray(latest?.filesChanged) && (latest!.filesChanged as unknown[]).length === 0;
      if (this.skipUnverifiable && nothingChanged && !measured && checkResults.length === 0) {
        result.skipped = "nothing changed and no checks";
        context.log.info("  ⏭ Check skipped: nothing changed and no checks");
        result.durationMs = Date.now() - startTime;
        result.success = true;
        return result;
      }

      // 4. Verify first, with the tools this role really has, in a loop; then the verdict, in a turn of its own.
      //    Asked for both at once, a small model obeys "JSON and nothing else" and never looks.
      const tools = this.tools.getDefinitions();
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        {
          role: "user",
          content: this.buildVerificationPrompt(claimedWork, checkResults, task, measured, tools.map((t) => t.name)),
        },
      ];
      let model: { data: EvaluationData; parsed: boolean } | null = null;
      let rounds = 0;
      let findings: string | null = null;
      const parse = (raw: string, fallback: boolean) => {
        let recovered = false;
        const parsed = parseStructured(evaluationSchema, raw, {
          recover: (text) => {
            const legacy = this.parseVerdictLegacy(text);
            recovered = legacy !== null;
            return legacy;
          },
          ...(fallback ? { fallback: { verdict: "inconclusive" as const, evidence: [], corrections: [], confidence: 0.5 } } : {}),
        });
        if (parsed.usedFallback) context.log.debug(`evaluation parsing used fallback: ${parsed.error ?? "unknown"}`);
        // An answer no parser could read is no verdict at all: it never counts as passing.
        return parsed.data ? { data: parsed.data as EvaluationData, parsed: parsed.success || recovered } : null;
      };
      const tally = (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
        result.tokenUsage.inputTokens += usage.inputTokens;
        result.tokenUsage.outputTokens += usage.outputTokens;
        result.tokenUsage.totalTokens += usage.totalTokens;
      };

      while (findings === null && rounds < EvaluationEngine.MAX_TOOL_ROUNDS) {
        rounds++;
        const llmResult = await this.llmProvider.chat({
          messages,
          ...(tools.length ? { tools } : {}),
          temperature: 0.1, // Low temperature for factual verification
          maxTokens: this.config.maxTokens,
          ...this.callOptions(context),
        });
        tally(llmResult.usage);
        if (llmResult.finishReason !== "tool_calls" || !llmResult.message.toolCalls?.length) {
          findings = llmResult.message.content || "";
          messages.push({ role: "assistant", content: findings });
          break;
        }

        // Execute tools for verification
        messages.push(llmResult.message);
        for (const toolCall of llmResult.message.toolCalls) {
          const tool = this.tools.get(toolCall.name);
          if (!tool) {
            messages.push({ role: "tool", content: `Unknown tool: ${toolCall.name}`, toolCallId: toolCall.id });
            continue;
          }

          const toolStart = Date.now();
          try {
            const toolResult = await tool.execute(
              toolCall.arguments,
              this.toolContext(context, `eval:${toolCall.name}`, () => messages),
            );
            messages.push({ role: "tool", content: toolResult, toolCallId: toolCall.id });
            result.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: toolResult.slice(0, 500),
              durationMs: Date.now() - toolStart,
            });
          } catch (error) {
            if (context.signal?.aborted) throw error;
            messages.push({ role: "tool", content: `Error: ${(error as Error).message}`, toolCallId: toolCall.id });
            result.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: `Error: ${(error as Error).message}`,
              durationMs: Date.now() - toolStart,
            });
          }
        }
      }

      // A model that already answered with a verdict needs no second turn.
      model = findings !== null ? parse(findings, false) : null;
      if (!model?.parsed) {
        messages.push({ role: "user", content: `Now give your verdict on what you verified.\n\n${jsonFormatInstruction(EVALUATION_SHAPE)}` });
        const verdict = await this.llmProvider.chat({ messages, temperature: 0.1, maxTokens: this.config.maxTokens, ...this.callOptions(context) });
        tally(verdict.usage);
        // Verification that hit the cap and a verdict turn no parser can read are no verdict at all.
        model = findings === null && !verdict.message.content?.trim() ? null : parse(verdict.message.content || "", true);
      }

      const capped = `hit the tool-call cap (${EvaluationEngine.MAX_TOOL_ROUNDS} rounds) without a verdict`;
      if (!model && !follow) {
        errors.push(capped);
      } else {
        // With a measured check to follow, a model that never gave a verdict
        // does not stop the round: the verdict is the check's, the miss is noted.
        this.emitVerdict(context, model, measured, follow, checkResults, model ? undefined : capped);
      }
    } catch (error) {
      errors.push((error as Error).message);
      context.log.error(`❌ Evaluation failed: ${(error as Error).message}`);
    }

    result.durationMs = Date.now() - startTime;
    result.errors = errors;
    result.success = errors.length === 0;
    return result;
  }

  /** Run predefined automated checks */
  private async runAutomatedChecks(
    context: NodeContext,
  ): Promise<Array<{ name: string; passed: boolean; output: string }>> {
    const results: Array<{ name: string; passed: boolean; output: string }> = [];

    for (const check of this.checks) {
      try {
        let output = "";
        let passed = false;

        switch (check.type) {
          case "shell": {
            const shellTool = this.tools.get("shell");
            if (shellTool && check.command) {
              const toolCtx: ToolContext = {
                workingDir: context.workingDir,
                iteration: context.iteration,
                log: () => {},
                verbose: false,
                signal: context.signal,
              };
              output = await shellTool.execute({ command: check.command }, toolCtx);
              passed = true; // If shell didn't throw, it passed
            }
            break;
          }
          case "file_exists": {
            const readTool = this.tools.get("file_read");
            if (readTool && check.path) {
              try {
                const toolCtx: ToolContext = {
                  workingDir: context.workingDir,
                  iteration: context.iteration,
                  log: () => {},
                  verbose: false,
                  signal: context.signal,
                };
                await readTool.execute({ path: check.path, lines: 1 }, toolCtx);
                passed = true;
                output = "File exists";
              } catch {
                passed = false;
                output = "File not found";
              }
            }
            break;
          }
          case "git_diff": {
            const gitTool = this.tools.get("git");
            if (gitTool) {
              const toolCtx: ToolContext = {
                workingDir: context.workingDir,
                iteration: context.iteration,
                log: () => {},
                verbose: false,
                signal: context.signal,
              };
              output = await gitTool.execute({ command: "diff --stat" }, toolCtx);
              passed = output.trim().length > 0; // Changes exist
            }
            break;
          }
          default:
            output = `Unknown check type: ${check.type}`;
        }

        results.push({ name: check.name, passed, output: output.slice(0, 500) });
      } catch (error) {
        results.push({
          name: check.name,
          passed: false,
          output: `Error: ${(error as Error).message}`,
        });
      }
    }

    return results;
  }

  /**
   * Emit the verdict. Following the measured check, the verdict is its result
   * (measured) and the model's verdict rides beside it (written); otherwise
   * the verdict is the model's. A failing verdict always sends corrections
   * back: the model's when it wrote some, else the failed checks' output.
   */
  private emitVerdict(
    context: NodeContext,
    model: { data: EvaluationData; parsed: boolean } | null,
    measured: MeasuredCheckRun | undefined,
    follow: boolean,
    checkResults: Array<{ name: string; passed: boolean; output: string }>,
    modelError?: string,
  ): void {
    const modelVerdict = model?.parsed ? model.data.verdict : null;
    const verdict: EvaluationVerdict = follow
      ? measured!.passed
        ? "pass"
        : "fail"
      : (model?.data.verdict ?? "inconclusive");
    const verdictKind: Provenance = follow ? "measured" : "written";
    const valid = follow || (model?.parsed ?? false);
    const failedChecks = (measured?.results ?? []).filter((r) => !r.passed);

    context.emit(
      "evaluation",
      "evaluation",
      {
        verdict,
        verdictSource: follow ? "measured" : "model",
        modelVerdict,
        ...(modelError ? { modelError } : {}),
        parsed: model?.parsed ?? false,
        evidence: model?.data.evidence ?? [],
        measuredChecks: measured?.results ?? [],
        automatedChecks: checkResults,
        iteration: context.iteration,
      },
      { verdict: verdictKind },
    );

    if (valid && (verdict === "fail" || verdict === "partial")) {
      const written = model?.parsed ? model.data.corrections : [];
      let corrections: string[];
      let correctionsKind: Provenance;
      if (written.length > 0) {
        corrections = written;
        correctionsKind = "written";
      } else if (failedChecks.length > 0) {
        corrections = failedChecks.map((r) => `The measured check "${r.name}" failed: ${r.output.slice(0, 500)}`);
        correctionsKind = "measured";
      } else if (model?.parsed && model.data.evidence.length > 0) {
        corrections = model.data.evidence.map((e) => `Check observed: ${e}`);
        correctionsKind = "written";
      } else {
        corrections = [`Check's verdict was "${verdict}".`];
        correctionsKind = verdictKind;
      }
      context.emit(
        "corrections",
        "corrections",
        {
          corrections,
          ...(failedChecks.length > 0 ? { failedChecks } : {}),
          verdict,
          iteration: context.iteration,
        },
        { corrections: correctionsKind, verdict: verdictKind },
      );
    }

    const counted = measured?.results ?? checkResults;
    context.emit(
      "metrics",
      "eval_metrics",
      {
        verdict,
        verdictSource: follow ? "measured" : "model",
        parsed: model?.parsed ?? false,
        checksTotal: counted.length,
        checksPassed: counted.filter((c) => c.passed).length,
        confidence: model?.data.confidence ?? 0,
        iteration: context.iteration,
      },
      { verdict: verdictKind },
    );
  }

  private buildVerificationPrompt(
    claimedWork: Array<Record<string, unknown>>,
    checkResults: Array<{ name: string; passed: boolean; output: string }>,
    task?: string,
    measured?: MeasuredCheckRun,
    tools: string[] = [],
  ): string {
    let prompt = "## Verification Task\n\n";
    if (task) {
      prompt += "### What was asked:\n\n" + task + "\n\n";
    }
    prompt += "Verify the following claimed work against real-world signals.\n\n";

    if (claimedWork.length > 0) {
      // What the executor wrote is a claim; what the lab saw change in the workspace is measured.
      prompt += "### What was claimed (written by the executor's model):\n\n";
      for (const work of claimedWork) {
        const { filesChanged: _f, diff: _d, personSaid: _p, ...claim } = work;
        prompt += `- ${JSON.stringify(claim)}\n`;
      }
      prompt += "\n";
      const last = claimedWork[claimedWork.length - 1];
      // The person's words outrank the task where they differ: never send the work back to what they refused.
      const said = claimedWork.flatMap((w) => (Array.isArray(w.personSaid) ? (w.personSaid as import("../types/tools.js").PersonSaid[]) : []));
      if (said.length) {
        prompt += "### What the person said while the work was done (given by the person; where it differs from the task, it is what they want now):\n\n";
        for (const s of said) prompt += `- They said ${s.answer} to ${s.tool === "Write" ? "writing" : s.tool === "Read" ? "reading" : "running"} ${s.target}, and added: "${s.words}"\n`;
        prompt += "\nJudge the work against the task as the person amended it. Do not ask for what they refused.\n\n";
      }
      if (Array.isArray(last.filesChanged)) {
        prompt += "### What changed in the workspace (measured by the lab, from the file system):\n\n";
        prompt += last.filesChanged.length ? `${(last.filesChanged as string[]).map((f) => `- ${f}`).join("\n")}\n\n` : "- nothing\n\n";
        if (typeof last.diff === "string" && last.diff) prompt += "```diff\n" + last.diff + "\n```\n\n";
      }
    }

    if (measured && measured.results.length > 0) {
      prompt += "### Measured checks (run by the lab, in a copy of the workspace no role can write):\n\n";
      for (const r of measured.results) {
        prompt += `- **${r.name}**: ${r.passed ? "✅ PASSED" : "❌ FAILED"}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}\n`;
        prompt += `  Output: ${r.output.slice(0, 1000)}\n`;
      }
      prompt += "\n";
    }

    if (checkResults.length > 0) {
      prompt += "### Automated check results:\n\n";
      for (const check of checkResults) {
        prompt += `- **${check.name}**: ${check.passed ? "✅ PASSED" : "❌ FAILED"}\n`;
        prompt += `  Output: ${check.output}\n`;
      }
      prompt += "\n";
    }

    prompt += "### Instructions:\n\n";
    prompt += tools.length
      ? `1. Verify what happened yourself, with your tools: ${tools.join(", ")}. Read the files that changed.\n`
      : "1. You have no tools: judge from the measured evidence above.\n";
    prompt += "2. Do not trust the claim: check it against what you see.\n";
    prompt += "3. When you have finished, say in a few sentences what you found. The verdict comes after, when you are asked for it.\n";

    return prompt;
  }

  /**
   * Legacy regex parser, kept as a recovery fallback for models that ignore
   * the JSON output instruction. Primary parsing now uses {@link parseStructured}.
   */
  private parseVerdictLegacy(response: string): {
    verdict: EvaluationVerdict;
    evidence: string[];
    corrections: string[];
    confidence: number;
  } | null {
    // Parse loosely-structured output from LLM
    const verdictMatch = response.match(/VERDICT:\s*(pass|fail|partial|inconclusive)/i);
    if (!verdictMatch) return null;
    const verdict: EvaluationVerdict = (verdictMatch?.[1]?.toLowerCase() as EvaluationVerdict) || "inconclusive";

    const evidenceMatch = response.match(/EVIDENCE:([\s\S]*?)(?=CORRECTIONS:|CONFIDENCE:|$)/i);
    const evidence = evidenceMatch
      ? evidenceMatch[1].split("\n").filter((l) => l.trim().startsWith("-")).map((l) => l.trim().slice(2))
      : [];

    const correctionsMatch = response.match(/CORRECTIONS:([\s\S]*?)(?=CONFIDENCE:|$)/i);
    const corrections = correctionsMatch
      ? correctionsMatch[1].split("\n").filter((l) => l.trim().startsWith("-")).map((l) => l.trim().slice(2))
      : [];

    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

    return { verdict, evidence, corrections, confidence };
  }
}
