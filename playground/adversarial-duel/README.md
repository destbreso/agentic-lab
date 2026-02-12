# Adversarial Duel — Order-2 Competitive Pipeline

> Two agents. One task. Only the best solution survives.

## Architecture

```
              ┌───────────┐
     ┌───────▶│  Agent α  │───────┐
     │        │(Challenger)│       │
  ┌──┴─────┐  └───────────┘  ┌────▼─────┐
  │  Arena  │                 │  Arbiter  │
  │(Planning)│◀───────────────│  (Judge)  │
  └──┬─────┘  ┌───────────┐  └────▲─────┘
     │        │  Agent β  │       │
     └───────▶│(Challenger)│───────┘
              └───────────┘
```

## Cognitive Roles

| Node        | Type       | Role                                                                 |
|-------------|------------|----------------------------------------------------------------------|
| **Arena**   | Planning   | Sets challenges, tracks scores, adjusts difficulty between rounds    |
| **Agent α** | Execution  | Challenger 1 — implements a solution independently                   |
| **Agent β** | Execution  | Challenger 2 — implements a competing solution to the same task      |
| **Arbiter** | Evaluation | Impartial judge — compares both solutions side-by-side, picks winner |

## Signal Flow

```
Round N:
  1. Arena reads task + previous verdicts → emits challenge to both agents
  2. Agent α works on solution → submits to Arbiter
  3. Agent β works on solution → submits to Arbiter
  4. Arbiter compares both → emits:
     • verdict → Arena (who won, scores, rationale)
     • feedback_α → Agent α (what to improve)
     • feedback_β → Agent β (what to improve)
  5. Arena updates scoreboard → starts Round N+1
```

## Why Adversarial?

The key insight is **relative comparison vs absolute verification**:

| Approach             | Question Asked                   | Pressure        |
|----------------------|----------------------------------|-----------------|
| Exec-Eval            | "Is this good enough?"           | Threshold-based |
| Supervised Coder     | "Does this match the spec?"      | Conformance     |
| **Adversarial Duel** | "Is this BETTER than the rival?" | Competitive     |

An agent can't coast — even a "correct" solution loses if the rival's is cleaner,
faster, or more elegant. This creates **evolutionary pressure** that pushes toward
quality beyond mere correctness.

## Use Cases

- **Cross-model tournaments**: Pit GPT-4o vs Claude vs Llama against each other
- **Strategy comparison**: Same model, different prompting strategies
- **Code quality competitions**: Two agents refactor the same code — who writes cleaner code?
- **Red team / Blue team**: One agent attacks, one defends (security auditing)

## Running

```bash
# From agentic-lab root
alab recipes --run adversarial-duel \
  --param provider=openai \
  --param tools=file_read,file_write,shell,grep \
  --param workingDir=./playground/adversarial-duel/project \
  --param rounds=3

# Cross-model tournament
alab recipes --run adversarial-duel \
  --param provider=openrouter \
  --param modelAlpha=anthropic/claude-sonnet-4-20250514 \
  --param modelBeta=openai/gpt-4o \
  --param tools=file_read,file_write,shell,grep \
  --param workingDir=./playground/adversarial-duel/project
```

## Files

```
adversarial-duel/
├── README.md         ← You are here
├── PROMPT.md         ← Instructions for all roles
├── PLAN.md           ← The challenge / task definition
├── specs/
│   └── SPEC.md       ← Evaluation criteria and rules
└── project/
    └── src/
        ├── sort.ts       ← Sorting module to optimize
        └── sort.test.ts  ← Benchmark tests
```

## Example: Sorting Algorithm Duel

The bundled example challenges both agents to implement a sorting module.
The task is deliberately open-ended — "implement the best sorting solution" —
because the Arbiter evaluates on multiple axes: correctness, performance,
code clarity, and edge case handling. Both agents start from the same stub
and compete across 3 rounds.
