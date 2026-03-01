import type {
  BenchmarkSuite,
  BenchmarkRun,
  BenchmarkContender,
  ContenderResult,
  BenchmarkProblem,
} from "./types";
import { saveSuite } from "./store";

/* ═══════════════════════════════════════════════════
   Benchmark Runner — executes contenders in parallel
   ═══════════════════════════════════════════════════
   For each problem × contender pair it calls:
   - Baseline → /api/chat/send  (raw LLM, no agentic)
   - Recipe   → /api/chat/agent (agentic architecture)

   Quality is scored by an LLM evaluator comparing the
   answer against the expected insight.
   ═══════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

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
    // ── Baseline: call /api/chat/send (raw LLM) ──
    const res = await fetch(`${BASE_URL}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        model,
        provider,
        memoryNamespace,
        context: [],
      }),
    });

    if (!res.ok) throw new Error(`Baseline HTTP ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No reader");

    const decoder = new TextDecoder();
    let fullContent = "";
    let totalOutputTokens = 0;
    let totalInputTokens = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) fullContent += data.content;
          if (data.eval_count) totalOutputTokens += data.eval_count;
          if (data.prompt_eval_count)
            totalInputTokens += data.prompt_eval_count;
        } catch {
          /* skip */
        }
      }
    }

    return {
      answer: fullContent,
      durationMs: Date.now() - start,
      tokens: totalOutputTokens + totalInputTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }

  // ── Recipe: call /api/chat/agent (agentic architecture) ──
  const res = await fetch(`${BASE_URL}/api/chat/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: prompt,
      mode: "recipe",
      recipe: contender.recipeId,
      model,
      provider,
      memoryNamespace,
      context: [],
    }),
  });

  if (!res.ok) throw new Error(`Agent HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No reader");

  const decoder = new TextDecoder();
  let fullContent = "";
  let totalTokens = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.event === "stream" && data.content) {
          fullContent += data.content;
        }
        if (data.event === "result") {
          if (data.finalAnswer) fullContent = data.finalAnswer;
          totalTokens = data.tokens || 0;
        }
      } catch {
        /* skip */
      }
    }
  }

  return {
    answer: fullContent,
    durationMs: Date.now() - start,
    tokens: totalTokens,
    inputTokens: 0,
    outputTokens: totalTokens,
  };
}

/** Use the LLM itself to score the quality of an answer */
async function scoreAnswer(
  problem: BenchmarkProblem,
  answer: string,
  model: string,
  provider: string,
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
    const res = await fetch(`${BASE_URL}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: evalPrompt,
        model,
        provider,
        context: [],
      }),
    });

    if (!res.ok) return { score: -1, notes: "Error al evaluar" };

    const reader = res.body?.getReader();
    if (!reader) return { score: -1, notes: "No reader" };

    const decoder = new TextDecoder();
    let fullContent = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) fullContent += data.content;
        } catch {
          /* skip */
        }
      }
    }

    // Parse JSON from response
    const jsonMatch = fullContent.match(/\{[\s\S]*"score"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(100, Math.max(0, Number(parsed.score) || 0)),
        notes: parsed.notes || "",
      };
    }
    return {
      score: -1,
      notes: `No se pudo parsear: ${fullContent.slice(0, 200)}`,
    };
  } catch (err) {
    return { score: -1, notes: `Error: ${(err as Error).message}` };
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

        // Score the answer
        const quality = await scoreAnswer(
          problem,
          exec.answer,
          suite.model,
          suite.provider,
        );

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
