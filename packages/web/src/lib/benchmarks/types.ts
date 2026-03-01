/* ═══════════════════════════════════════════════════
   Benchmark module — shared types
   ═══════════════════════════════════════════════════ */

/** A problem from the bank — a curated prompt with expected behaviour */
export interface BenchmarkProblem {
  id: string;
  title: string;
  prompt: string;
  /** The "catch" — what makes this problem tricky */
  trap: string;
  /** What a good answer should include / acknowledge */
  expectedInsight: string;
  category:
    | "reasoning"
    | "logic"
    | "common-sense"
    | "math"
    | "coding"
    | "ambiguity";
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}

/** A single contender in a benchmark run — either a recipe or "baseline" */
export interface BenchmarkContender {
  id: string;
  /** "baseline" = raw LLM via /api/chat/send, otherwise a recipe id */
  type: "baseline" | "recipe";
  label: string;
  recipeId?: string;
}

/** Result of executing one contender on one problem */
export interface ContenderResult {
  contenderId: string;
  contenderLabel: string;
  contenderType: "baseline" | "recipe";

  /** LLM response */
  answer: string;
  /** Did the response acknowledge the trap / show the expected insight? */
  qualityScore: number; // 0-100
  qualityNotes: string;

  /** Timing & cost */
  durationMs: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;

  /** Status */
  status: "pending" | "running" | "completed" | "error";
  error?: string;
}

/** A benchmark run — one problem evaluated across N contenders */
export interface BenchmarkRun {
  id: string;
  problemId: string;
  problemTitle: string;
  prompt: string;

  model: string;
  provider: string;

  contenders: BenchmarkContender[];
  results: ContenderResult[];

  status: "pending" | "running" | "completed" | "error";
  createdAt: string;
  completedAt?: string;
}

/** Full benchmark suite — groups multiple problems */
export interface BenchmarkSuite {
  id: string;
  name: string;
  description: string;
  runs: BenchmarkRun[];
  model: string;
  provider: string;
  /** Optional memory bank ID — if set, all contenders use this semantic memory */
  memoryNamespace?: string;
  status: "pending" | "running" | "completed";
  createdAt: string;
  completedAt?: string;
}
