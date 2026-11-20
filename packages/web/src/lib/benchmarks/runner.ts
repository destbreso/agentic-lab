import type {
  BenchmarkSuite,
  BenchmarkRun,
  BenchmarkContender,
  ContenderResult,
  BenchmarkProblem,
} from "./types";
import { saveSuite } from "./store";
import { createStorage } from "jig-core";
import { recallMemories, startAgentRun } from "@/lib/agent-run";
import { createWebProvider } from "@/lib/pipeline-build";

/* Benchmark Runner
   For each problem and contender, in this process, never over HTTP:
   - Baseline: one call to the model, the question alone (the "one answer" baseline)
   - Recipe: TopologyRun, the engine the chat, the builder and the CLI run
   Quality is scored by a judge model, which the suite names apart from the
   contenders' model; it defaults to the same model, and the suite says so. */

/** Execute a single contender on a prompt */
async function executeContender(
  contender: BenchmarkContender,
  prompt: string,
  model: string,
  provider: string,
  memoryNamespace?: string,
): Promise<{
  answer: string;
  durationMs: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const start = Date.now();

  if (contender.type === "baseline") {
    const reply = await createWebProvider(provider, model).chat({
      messages: [{ role: "user", content: prompt }],
    });
    return {
      answer: reply.message.content ?? "",
      durationMs: Date.now() - start,
      tokens: reply.usage.totalTokens,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    };
  }

  // Recipe: the topology runs in this process, through the same engine as
  // the chat. Recall reads only a bank the suite names, never earlier tasks.
  const storage = memoryNamespace ? await createStorage().catch(() => null) : null;
  const { memories } = await recallMemories(storage, prompt, { bank: memoryNamespace, scope: "off" });
  await storage?.close().catch(() => {});
  const handle = await startAgentRun({
    task: prompt,
    topology: contender.recipeId ?? "ralph-loop",
    provider,
    model,
    memories,
    memoryScope: "off",
    tags: ["benchmark", contender.recipeId ?? "ralph-loop"],
    config: { source: "benchmark", memoryNamespace },
  });
  const run = await handle.done;
  const usage = run.result.finalState.totalTokens;
  if (run.result.errors.length > 0) {
    throw new Error(`${run.outcome}: ${run.result.errors.join("; ")}`);
  }

  return {
    answer: run.answer,
    durationMs: Date.now() - start,
    tokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

/** The judge's score of an answer, from a model the suite names apart from the contenders'. */
async function scoreAnswer(
  problem: BenchmarkProblem,
  answer: string,
  judge: { provider: string; model: string },
): Promise<{ score: number; notes: string }> {
  const evalPrompt = `You are an answer evaluator. Score the following answer on a scale of 0-100 based on accuracy, insight, and whether it avoids the known trap.

PROBLEM: ${problem.prompt}

KNOWN TRAP: ${problem.trap}

EXPECTED INSIGHT: ${problem.expectedInsight}

ANSWER TO EVALUATE:
${answer.slice(0, 2000)}

Respond with ONLY a JSON object (no markdown, no code blocks):
{"score": <0-100>, "notes": "<brief explanation in Spanish>"}`;

  try {
    const reply = await createWebProvider(judge.provider, judge.model).chat({
      messages: [{ role: "user", content: evalPrompt }],
      temperature: 0,
    });
    const fullContent = reply.message.content ?? "";

    // Parse JSON from response
    const jsonMatch = fullContent.match(/\{[\s\S]*"score"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(100, Math.max(0, Number(parsed.score) || 0)),
        notes: parsed.notes || "",
      };
    }
    return { score: -1, notes: `The judge's answer could not be read: ${fullContent.slice(0, 200)}` };
  } catch (err) {
    return { score: -1, notes: `The judge failed: ${(err as Error).message}` };
  }
}

/** Run a full benchmark suite */
export async function runBenchmarkSuite(
  suite: BenchmarkSuite,
  problems: BenchmarkProblem[],
  onUpdate?: (suite: BenchmarkSuite) => void,
): Promise<BenchmarkSuite> {
  suite.status = "running";
  saveSuite(suite);
  onUpdate?.(suite);

  for (const run of suite.runs) {
    run.status = "running";
    saveSuite(suite);
    onUpdate?.(suite);

    const problem = problems.find((p) => p.id === run.problemId);
    if (!problem) {
      run.status = "error";
      continue;
    }

    // Execute each contender sequentially to avoid overloading
    for (const contender of run.contenders) {
      const resultIdx = run.results.findIndex(
        (r) => r.contenderId === contender.id,
      );
      if (resultIdx < 0) continue;

      run.results[resultIdx].status = "running";
      saveSuite(suite);
      onUpdate?.(suite);

      try {
        const exec = await executeContender(
          contender,
          run.prompt,
          suite.model,
          suite.provider,
          suite.memoryNamespace,
        );

        // Score the answer with the suite's judge
        const quality = await scoreAnswer(problem, exec.answer, judgeOf(suite));

        run.results[resultIdx] = {
          ...run.results[resultIdx],
          answer: exec.answer,
          durationMs: exec.durationMs,
          tokens: exec.tokens,
          inputTokens: exec.inputTokens,
          outputTokens: exec.outputTokens,
          qualityScore: quality.score,
          qualityNotes: quality.notes,
          status: "completed",
        };
      } catch (err) {
        run.results[resultIdx] = {
          ...run.results[resultIdx],
          status: "error",
          error: (err as Error).message,
          answer: "",
          durationMs: 0,
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          qualityScore: 0,
          qualityNotes: `Error: ${(err as Error).message}`,
        };
      }

      saveSuite(suite);
      onUpdate?.(suite);
    }

    run.status = "completed";
    saveSuite(suite);
    onUpdate?.(suite);
  }

  suite.status = "completed";
  suite.completedAt = new Date().toISOString();
  saveSuite(suite);
  onUpdate?.(suite);

  return suite;
}

/** The suite's judge: its own model when it names one, else the contenders' model. */
export function judgeOf(suite: Pick<BenchmarkSuite, "judge" | "provider" | "model">): { provider: string; model: string } {
  return suite.judge ?? { provider: suite.provider, model: suite.model };
}

/** Build a BenchmarkRun for a problem with given contenders */
export function buildRun(
  problem: BenchmarkProblem,
  contenders: BenchmarkContender[],
  model: string,
  provider: string,
): BenchmarkRun {
  return {
    id: `run-${problem.id}-${Date.now()}`,
    problemId: problem.id,
    problemTitle: problem.title,
    prompt: problem.prompt,
    model,
    provider,
    contenders,
    results: contenders.map((c) => ({
      contenderId: c.id,
      contenderLabel: c.label,
      contenderType: c.type,
      answer: "",
      qualityScore: 0,
      qualityNotes: "",
      durationMs: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      status: "pending" as const,
    })),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}
