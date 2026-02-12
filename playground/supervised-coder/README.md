# Supervised Coder — Use Case

> **The Single-Agent Blind Spot**: A classic agentic loop has one agent that plans,
> implements, *and evaluates its own work*. This is like a student grading their own
> exam — the output is structurally biased. The Supervised Coder recipe fixes this by
> separating cognitive roles into a pipeline where each node checks the others.

## Architecture

```
     ┌──────────────────────────────────────────────┐
     │            Supervised Coder Pipeline          │
     │                                               │
     │  ┌──────────┐   task   ┌──────────┐          │
     │  │ Planner  │ ───────→ │  Coder   │          │
     │  │(TechLead)│          │(Developer)│          │
     │  └────▲─────┘          └────┬──────┘          │
     │       │                     │ result          │
     │       │  verdict            ▼                 │
     │       │           ┌─────────────┐             │
     │       └────────── │  Reviewer   │             │
     │    corrections    │(CodeReview) │             │
     │         └───────→ └─────────────┘             │
     │         (also                                 │
     │          to Coder)                            │
     └──────────────────────────────────────────────┘
```

### Three Cognitive Roles

| Role | Node Type | Cognitive Function |
|------|-----------|-------------------|
| **Tech Lead** (Planner) | `planning` | Reads specs + plan, selects ONE task, decomposes into steps |
| **Developer** (Coder) | `execution` | Writes code, runs commands, commits. Reports what was done (not if it was good) |
| **Code Reviewer** (Reviewer) | `evaluation` | Independently verifies: runs tests, reads diffs, checks specs. Never trusts claims |

### Signal Flow

1. **Planner** reads `PLAN.md` + `specs/`, decides next task → sends `task` signal to Coder
2. **Coder** implements the task with tools (file read/write, shell, git) → sends `result` to Reviewer
3. **Reviewer** independently verifies (runs tests, reads files) → sends `verdict` back to Planner
4. If failed: Reviewer sends `corrections` to both Coder and Planner
5. Planner updates plan, selects next task, cycle repeats

### Key Differentiators from a Flat Loop

| Flat Loop (reference) | Supervised Coder (ours) |
|---|---|
| One agent does everything | Three specialized roles |
| Agent evaluates its own work | Independent reviewer verifies |
| Fixed iteration count | Convergence-driven (reviewer decides "done") |
| PLAN.md updated by the same agent | Planner exclusively manages plan state |
| No separation of concerns | Cognitive role isolation |

## The Example Project

The `project/` directory contains a **deliberately buggy TypeScript utility library** (`string-utils.ts`).
There are tests (`string-utils.test.ts`) that the agent should make pass, and specs describing
the expected behavior.

### Bugs to Find

The codebase has intentional bugs similar to what the reference repo uses (accumulator errors,
off-by-one, missing edge cases) — but the agent discovers them through the pipeline workflow,
not because we tell it.

## Running

```bash
# From the agentic-lab root:

# 1. See the recipe details
alab recipes --info supervised-coder

# 2. Run with default provider (Ollama)
alab pipeline --recipe supervised-coder --dir playground/supervised-coder

# 3. Run with a specific provider
alab pipeline --recipe supervised-coder \
  --provider anthropic --model claude-sonnet-4-20250514 \
  --dir playground/supervised-coder

# 4. Or use the recipes command
alab recipes --run supervised-coder \
  --param workingDir=playground/supervised-coder/project
```

## Writing About This

This use case explores the **"Cognitive Role Separation"** principle:

1. **Why it matters**: LLMs are unreliable self-evaluators. When the same context
   window that wrote the code also "checks" it, confirmation bias is structural —
   the model has already committed to its approach.

2. **The fix**: Separate the planning, execution, and evaluation into different
   inference sessions with different system prompts and different context. The Reviewer
   sees the *output* but not the *reasoning* that produced it.

3. **Trade-off**: This uses ~3x more tokens than a flat loop. The hypothesis is that
   the catch-rate for bugs is higher. Worth measuring.

4. **Analogy**: This is how real engineering teams work. The developer writes code,
   the tech lead decides priorities, the reviewer catches what the developer missed.
   We're replicating organizational structure at the inference level.
