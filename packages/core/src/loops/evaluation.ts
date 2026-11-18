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
import type { NodeContext, NodeResult } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";
import { parseStructured, jsonFormatInstruction } from "../utils/structured.js";
import { appendSkillPrompt } from "../skills/compose.js";

export interface EvaluationLoopConfig {
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

export class EvaluationLoop extends BaseLoopNode {
  /** Tool-call rounds allowed before a verdict is due. */
  static readonly MAX_TOOL_ROUNDS = 10;
  private llmProvider: LLMProvider;
  private tools: ToolRegistry;
  private checks: EvaluationCheck[];
  private systemMessage: string;

  constructor(
    config: EvaluationLoopConfig,
    overrides?: { id?: string; name?: string; config?: Partial<import("../types/pipeline.js").NodeRunConfig>; ports?: import("../types/pipeline.js").PortOverrides },
  ) {
    super({
      id: overrides?.id,
      ports: overrides?.ports,
      name: overrides?.name || "Evaluation Loop",
      category: "evaluation",
      description:
        "Verifies real-world changes against external signals. " +
        "Never trusts execution output alone — always checks ground truth.",
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
    this.systemMessage = appendSkillPrompt(
      config.systemMessage ||
        "You are an evaluation agent. Your job is to VERIFY real-world changes. " +
          "NEVER trust the executor's claims — always check the file system, " +
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
      // 1. Run automated checks first
      const checkResults = await this.runAutomatedChecks(context);

      // 2. Get execution result signals (what the executor claims)
      const execResults = this.getInputSignals(context, "execution_result");
      const claimedWork = execResults.map((s) => s.data).filter(Boolean);
      const task = context.shared?.get<string>("task");

      // 3. Build verification prompt
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        {
          role: "user",
          content: this.buildVerificationPrompt(claimedWork, checkResults, task),
        },
      ];

      // 4. Let LLM do deeper verification with tools
      let answered = false;
      let rounds = 0;

      while (!answered && rounds < EvaluationLoop.MAX_TOOL_ROUNDS) {
        rounds++;

        const llmResult = await this.llmProvider.chat({
          messages,
          tools: this.tools.getDefinitions(),
          temperature: 0.1, // Low temperature for factual verification
          maxTokens: this.config.maxTokens,
          ...this.callOptions(context),
        });

        result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
        result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
        result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

        if (llmResult.finishReason !== "tool_calls" || !llmResult.message.toolCalls?.length) {
          // Parse verdict from response — JSON + Zod, with the legacy regex
          // parser as a recovery fallback so we never regress on models that
          // ignore the JSON instruction.
          let recovered = false;
          const parsed = parseStructured(evaluationSchema, llmResult.message.content || "", {
            recover: (raw) => {
              const legacy = this.parseVerdictLegacy(raw);
              recovered = legacy !== null;
              return legacy;
            },
            fallback: { verdict: "inconclusive", evidence: [], corrections: [], confidence: 0.5 },
          });
          const verdictData = parsed.data as EvaluationData;
          // An answer no parser could read is no verdict at all: it never counts as passing.
          const verdictParsed = parsed.success || recovered;
          if (parsed.usedFallback) {
            context.log.debug(`evaluation parsing used fallback: ${parsed.error ?? "unknown"}`);
          }

          // Emit evaluation
          context.emit(
            "evaluation",
            "evaluation",
            {
              verdict: verdictData.verdict,
              parsed: verdictParsed,
              evidence: verdictData.evidence,
              automatedChecks: checkResults,
              iteration: context.iteration,
            },
            { verdict: "written" },
          );

          // A failing verdict always sends something back, so the way back to Do carries a reason.
          const failing =
            verdictParsed && (verdictData.verdict === "fail" || verdictData.verdict === "partial");
          if (failing) {
            const corrections =
              verdictData.corrections.length > 0
                ? verdictData.corrections
                : verdictData.evidence.length > 0
                  ? verdictData.evidence.map((e) => `Check observed: ${e}`)
                  : [`Check's verdict was "${verdictData.verdict}".`];
            context.emit(
              "corrections",
              "corrections",
              {
                corrections,
                verdict: verdictData.verdict,
                iteration: context.iteration,
              },
              { corrections: "written", verdict: "written" },
            );
          }

          // Emit metrics
          context.emit(
            "metrics",
            "eval_metrics",
            {
              verdict: verdictData.verdict,
              parsed: verdictParsed,
              checksTotal: checkResults.length,
              checksPassed: checkResults.filter((c) => c.passed).length,
              confidence: verdictData.confidence,
              iteration: context.iteration,
            },
            { verdict: "written" },
          );

          answered = true;
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
              this.toolContext(context, `eval:${toolCall.name}`),
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

      if (!answered) {
        errors.push(
          `hit the tool-call cap (${EvaluationLoop.MAX_TOOL_ROUNDS} rounds) without a verdict`,
        );
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

  private buildVerificationPrompt(
    claimedWork: Array<Record<string, unknown>>,
    checkResults: Array<{ name: string; passed: boolean; output: string }>,
    task?: string,
  ): string {
    let prompt = "## Verification Task\n\n";
    if (task) {
      prompt += "### What was asked:\n\n" + task + "\n\n";
    }
    prompt += "Verify the following claimed work against real-world signals.\n\n";

    if (claimedWork.length > 0) {
      prompt += "### What was claimed:\n\n";
      for (const work of claimedWork) {
        prompt += `- ${JSON.stringify(work)}\n`;
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
    prompt +=
      "1. Use tools (git diff, file_read, shell) to INDEPENDENTLY verify what happened.\n";
    prompt += "2. Do NOT trust the claimed results — check everything.\n";
    prompt += "3. When you have finished verifying, output your verdict.\n\n";
    prompt += jsonFormatInstruction(EVALUATION_SHAPE);

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
