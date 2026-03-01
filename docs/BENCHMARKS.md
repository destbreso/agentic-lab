# Benchmark System

> Compare architectures head-to-head: baseline chat vs. agentic recipes on curated reasoning problems.

---

## Overview

The benchmark system lets you evaluate how different approaches (direct LLM call vs. multi-step agentic recipes) handle tricky problems. Each benchmark suite runs a set of curated problems through multiple contenders, scores the answers with an LLM-as-judge evaluator, and presents the results side by side.

Key capabilities:

- **13 curated problems** across 6 categories, each with a known cognitive trap.
- **Head-to-head comparison** — Baseline (direct chat) vs. one or more agentic recipes.
- **LLM-as-judge scoring** — Automated 0–100 quality evaluation with notes.
- **Persistent storage** — Suites survive server restarts (stored in DB via `MemoryStore`).
- **Memory integration** — Optionally attach a memory bank for context-aware evaluation.
- **Real-time progress** — Auto-refreshing UI during execution.

---

## Architecture

```
┌────────────────────┐
│   Benchmarks UI    │
│  (3 tabs: suites,  │
│   problems, new)   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐     ┌────────────────────────────────────────────┐
│  /api/benchmarks/  │     │             Runner (background)            │
│  suites (POST)     │────▶│  For each run × each contender:           │
│                    │     │    1. executeContender() → /api/chat/send  │
│  suites (GET)      │◀───│       (baseline) or /api/chat/agent        │
│  suites/[id] (GET) │     │       (recipe)                            │
│  suites (DELETE)   │     │    2. scoreAnswer() → /api/chat/send      │
│                    │     │       (LLM-as-judge)                      │
│  problems (GET)    │     │    3. flushSuite() → DB persist           │
└────────────────────┘     └────────────────────────────────────────────┘
                                              │
                                              ▼
                           ┌────────────────────────────────────────────┐
                           │            Benchmark Store                 │
                           │  globalThis cache + MemoryStore DB         │
                           │  namespace: ["benchmarks"]                 │
                           └────────────────────────────────────────────┘
```

---

## Problem bank

The system includes **13 curated problems** designed to expose common LLM failure modes. Each problem has:

- **`prompt`** — The question posed to the contender.
- **`trap`** — The cognitive pitfall the LLM might fall into.
- **`expectedInsight`** — What a correct answer should demonstrate.

### Categories

| Category | Icon | Problems |
|----------|------|----------|
| `common-sense` | ⚡ | Car wash, umbrella paradox |
| `logic` | 🎯 | Feathers vs. iron, surgeon riddle, two doors |
| `math` | 📊 | Bat and ball, fence-post error |
| `reasoning` | 🧠 | Monty Hall, birthday paradox, survivorship bias |
| `ambiguity` | ⚠️ | "Time flies like an arrow", modified trolley |
| `coding` | 💻 | FizzBuzz with a twist |

### Full problem list

| ID | Title | Category | Difficulty | Trap |
|----|-------|----------|------------|------|
| `cs-car-wash` | Going to the car wash | common-sense | easy | Suggests walking without considering the car needs washing |
| `cs-umbrella` | The umbrella and the bus | common-sense | easy | False dichotomy — options aren't mutually exclusive |
| `cs-heavy-feather` | Kilo of feathers vs iron | logic | easy | May claim iron weighs more |
| `logic-surgeon` | The surgeon and the son | logic | easy | Convoluted explanations instead of "the surgeon is the mother" |
| `logic-two-doors` | Two doors, two guardians | logic | hard | May not find the classic logical solution |
| `logic-bat-ball` | The bat and the ball | math | medium | Intuitive incorrect answer (€0.10 vs correct €0.05) |
| `reason-monty-hall` | Monty Hall problem | reasoning | hard | Intuition says 50/50, reality is 2/3 vs 1/3 |
| `reason-birthday-paradox` | Birthday paradox | reasoning | medium | Intuition says ~6%, reality is ~50% |
| `reason-survivorship` | Survivorship bias in planes | reasoning | hard | Reinforce where hits are vs where they're NOT |
| `ambig-time-flies` | Time flies like an arrow | ambiguity | medium | Fails to detect wordplay (flies/like change function) |
| `ambig-trolley` | Modified trolley dilemma | ambiguity | hard | Simple utilitarianism without considering medical complexity |
| `code-fizzbuzz-twist` | FizzBuzz with a twist | coding | medium | Doesn't handle rule combination correctly |
| `code-off-by-one` | Fence-post error | math | easy | Intuitive answer 10 vs correct 11 posts |

---

## Types

### `BenchmarkProblem`

```typescript
interface BenchmarkProblem {
  id: string;
  title: string;
  prompt: string;
  trap: string;
  expectedInsight: string;
  category: "reasoning" | "logic" | "common-sense" | "math" | "coding" | "ambiguity";
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}
```

### `BenchmarkContender`

```typescript
interface BenchmarkContender {
  id: string;
  type: "baseline" | "recipe";
  label: string;
  recipeId?: string;          // Required when type is "recipe"
}
```

### `ContenderResult`

```typescript
interface ContenderResult {
  contenderId: string;
  contenderLabel: string;
  contenderType: "baseline" | "recipe";
  answer: string;
  qualityScore: number;        // 0–100, scored by LLM evaluator
  qualityNotes: string;        // Evaluator's explanation
  durationMs: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  status: "pending" | "running" | "completed" | "error";
  error?: string;
}
```

### `BenchmarkRun`

One run = one problem evaluated by all contenders.

```typescript
interface BenchmarkRun {
  id: string;                  // "run-{problemId}-{timestamp}"
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
```

### `BenchmarkSuite`

Top-level container grouping runs.

```typescript
interface BenchmarkSuite {
  id: string;                  // "suite-{timestamp}-{random}"
  name: string;
  description: string;
  runs: BenchmarkRun[];
  model: string;
  provider: string;
  memoryNamespace?: string;    // Optional memory bank
  status: "pending" | "running" | "completed";
  createdAt: string;
  completedAt?: string;
}
```

---

## Execution flow

### 1. Suite creation

```bash
POST /api/benchmarks/suites
{
  "name": "GPT-4o vs Recipes",
  "description": "Testing reasoning on hard problems",
  "problemIds": ["reason-monty-hall", "logic-two-doors", "reason-survivorship"],
  "contenders": [
    { "id": "baseline", "type": "baseline", "label": "Direct Chat" },
    { "id": "recipe-cot", "type": "recipe", "label": "Chain of Thought", "recipeId": "cot-recipe-id" }
  ],
  "model": "gpt-4o",
  "provider": "openai",
  "memoryNamespace": "bank-1234567890-abcd"
}
```

**Validations:**
- `name` is required.
- At least 1 problem must be selected.
- At least 2 contenders (typically baseline + recipe).

The API responds immediately with `201` and the suite object. Execution runs in the background.

### 2. Background execution (`runBenchmarkSuite`)

For each run (problem), sequentially:

1. Mark run as `"running"` → persist.
2. For each contender, sequentially:
   a. Mark result as `"running"` → persist.
   b. **Execute**: Call the appropriate endpoint.
   c. **Score**: Call the LLM evaluator.
   d. Update result with answer, timing, score → persist.
3. Mark run as `"completed"` → persist.

After all runs complete, mark suite as `"completed"`.

### 3. Contender execution

**Baseline** (`type: "baseline"`):
- Calls `POST /api/chat/send` with the problem prompt.
- Reads SSE stream, collects `content` chunks and token counts.
- This is a raw LLM call — no tools, no planning, no iteration.

**Recipe** (`type: "recipe"`):
- Calls `POST /api/chat/agent` with `mode: "recipe"` and the recipe ID.
- Reads SSE stream, looks for `event: stream` (content) and `event: result` (final answer + tokens).
- The recipe can use tools, multi-step planning, reflection, etc.

### 4. Quality scoring (`scoreAnswer`)

An LLM evaluator scores each answer on a 0–100 scale:

- Constructs an evaluation prompt with the problem, its trap, expected insight, and the contender's answer.
- Asks the LLM to respond with `{"score": <0-100>, "notes": "explanation"}`.
- Parses the JSON from the response.
- Returns `{score: -1, notes: "..."}` on parsing failure.

---

## Persistent storage

### How it works

Benchmark suites are stored using a **dual-layer strategy**:

1. **In-memory cache** (`globalThis.__benchSuites`) — Hot reads during execution. Uses `globalThis` to survive Turbopack HMR reloads.
2. **Database** (`MemoryStore` with namespace `["benchmarks"]`) — Persistent across server restarts.

### Lifecycle

| Operation | Cache | DB |
|-----------|-------|----|
| `saveSuite(suite)` | Always updated | Persisted only when `status === "completed"` or `"error"` |
| `flushSuite(suite)` | Always updated | Always persisted (called after each step) |
| `getAllSuites()` | Hydrates from DB on first call, then returns cache | Read on first hydration |
| `getSuite(id)` | Hydrates from DB on first call, then returns cache | Read on first hydration |
| `deleteSuite(id)` | Removed | Deleted |

### Hydration

On the first call to `getAllSuites()` or `getSuite()`, the store calls `hydrateOnce()`:

1. Loads all items from `storage.memory.search(["benchmarks"], { limit: 500 })`.
2. Populates the in-memory cache with items not already present.
3. Sets a flag so hydration only runs once per process lifetime.

This means suites survive server restarts — they're loaded from the database on the first request.

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/benchmarks/problems` | List all problems with categories and difficulties |
| `GET` | `/api/benchmarks/suites` | List all suites |
| `POST` | `/api/benchmarks/suites` | Create and start a suite (background execution) |
| `DELETE` | `/api/benchmarks/suites?id=..` | Delete a suite |
| `GET` | `/api/benchmarks/suites/:id` | Get suite detail with aggregated stats |

### Suite detail response

The `GET /api/benchmarks/suites/:id` endpoint returns computed statistics:

```typescript
{
  suite: BenchmarkSuite,
  stats: {
    totalRuns: number,
    completedRuns: number,
    contenderSummary: Array<{
      contenderId: string,
      label: string,
      type: "baseline" | "recipe",
      avgScore: number,         // Rounded to 1 decimal
      avgDurationMs: number,    // Rounded to integer
      totalTokens: number,
      completedRuns: number,
    }>
  }
}
```

---

## UI guide

The Benchmarks page (`/benchmarks`) has three tabs:

### Suites tab

Lists all benchmark suites. Each suite card shows:
- Name, model, status badge, completion time.
- **Contender summary bar** with average scores, average duration, total tokens.
- **Winner indicator** (🏆) on the contender with the highest average score.
- Expandable to show individual runs, each expandable to show result cards.

Running suites auto-refresh every 3 seconds. Expanded running suites refresh every 2 seconds.

### Problems tab

Browse the problem bank with:
- Search by text.
- Filter by category.
- Each card shows title, category icon, difficulty badge, prompt.
- Expandable to reveal the trap and expected insight.

### New Benchmark tab

Form to create a benchmark suite:

| Field | Type | Default |
|-------|------|---------|
| Name | text | — |
| Description | text | — |
| Model | select | `llama3.1:8b` |
| Provider | select | `ollama` |
| Memory bank | select | Per session (none) |
| Include baseline | toggle | ✅ |
| Recipes | multi-select | — |
| Problems | multi-select | — |

Available model options: `llama3.1:8b`, `qwen2.5-coder:7b`, `gpt-4o-mini`, `gpt-4o`, `claude-3.5-sonnet`.  
Available provider options: `ollama`, `openai`, `anthropic`, `openrouter`.

---

## Memory integration

When creating a suite, you can optionally select a **memory bank**. The `memoryNamespace` is passed through the entire execution chain:

1. **Suite creation** → `memoryNamespace` stored on the suite object.
2. **Runner** → passes `memoryNamespace` to `executeContender()`.
3. **Baseline execution** → `/api/chat/send` body includes `memoryNamespace`.
4. **Recipe execution** → `/api/chat/agent` body includes `memoryNamespace`.

This means both contenders have access to the same accumulated knowledge bank, letting you test how memory affects answer quality.

---

## Adding new problems

Problems are defined in `packages/web/src/lib/benchmarks/problems.ts` as a `PROBLEM_BANK` array. To add a new problem:

```typescript
{
  id: "unique-id",
  title: "Human-readable title",
  prompt: "The question asked to contenders",
  trap: "The cognitive pitfall to watch for",
  expectedInsight: "What a correct answer should include",
  category: "reasoning",      // One of the 6 categories
  difficulty: "medium",       // easy | medium | hard
  tags: ["tag1", "tag2"],
}
```

The problem will automatically appear in the UI and be available for selection in new benchmarks.

---

## Interpreting results

### Score ranges

| Range | Meaning | Color |
|-------|---------|-------|
| 80–100 | Excellent — avoided the trap, demonstrated insight | 🟢 Emerald |
| 50–79 | Partial — some awareness but incomplete reasoning | 🟡 Amber |
| 0–49 | Poor — fell into the trap | 🔴 Red |
| -1 | Scoring failed (evaluator parse error) | ⚪ Zinc |

### What to look for

- **Baseline vs. recipe gap**: How much does multi-step reasoning improve quality?
- **Category weaknesses**: Which problem types does the model struggle with?
- **Token efficiency**: Does the recipe use significantly more tokens for marginal quality gains?
- **Duration trade-off**: Is the extra execution time justified by the score improvement?
- **Memory effect**: Does attaching a knowledge bank improve performance on related problems?
