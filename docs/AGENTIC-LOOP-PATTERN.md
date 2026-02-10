# The Agentic Loop Pattern

> Based on ["The Human On the Loop: A Practical Guide to Agentic Engineering"](https://dotnetting.net/2026/02/the-human-on-the-loop-a-practical-guide-to-agentic-engineering/) by Lester Sanchez.

## Overview

The agentic loop (aka "Ralph Loop") is a technique for running AI agents autonomously in repeated iterations. The key insight is that **each iteration is stateless** — the agent gets fresh context every time and doesn't know it's in a loop.

## The 4 Pillars

### 1. Specs (What to Build)

- Detailed specifications of what you want the agent to accomplish
- Written collaboratively with a powerful LLM (e.g., Claude Opus, GPT-4)
- Should cover requirements, constraints, architecture, edge cases
- Iterate to find gaps before starting the loop

### 2. Plan (Living TODO)

- A structured task list derived from the specs
- The agent reads it, picks the next task, works on it, and updates it
- Uses status markers: `[ ]` pending, `[x]` done, `[~]` in progress, `[!]` failed
- Serves as the "memory" between iterations

### 3. Prompt (Static Instructions)

- Fixed instructions that tell the agent HOW to behave each turn
- Generic and reusable across projects
- Key instructions:
  - Read specs and plan
  - Pick the SINGLE most important task
  - Work on it
  - Update the plan
  - Commit changes
  - End your turn

### 4. Brain + Muscle (LLM + Tools)

- **Brain**: The LLM that reasons and makes decisions
- **Muscle**: Tools that execute actions (file I/O, shell, git, etc.)
- Use capable but cost-effective models for iteration (e.g., Sonnet, GPT-4o)
- Reserve powerful models (Opus, O1) for spec creation

## Why It Works

The magic is in the **stateless design**:

1. **No context dilution**: Each iteration starts fresh. The agent doesn't carry forward thousands of tokens of stale conversation.
2. **Plan as memory**: The plan file serves as persistent memory between iterations.
3. **Self-correcting**: If the agent makes a mistake, the next iteration sees the current state and can correct it.
4. **Scalable**: Works for small scripts to large multi-file projects.

## Practical Tips

1. **Use git for safety**: Auto-commit after each iteration so you can roll back
2. **Set iteration limits**: Start with 5-10 iterations, increase as confidence grows
3. **Monitor costs**: Track token usage across iterations
4. **Verify work**: The agent should run tests/builds as part of each iteration
5. **Drift recovery**: If the agent drifts, roll back via git and adjust the plan
6. **Git worktrees**: Use worktrees for parallel experiments on different branches

## Loop Pseudo-code

```
for iteration in 1..maxIterations:
    prompt = readFile("PROMPT.md")
    plan = readFile("PLAN.md")
    specs = readDir("specs/")

    response = llm.chat(
        system: "You are an autonomous AI agent...",
        user: prompt + plan + specs,
        tools: [file_read, file_write, shell, git, ...]
    )

    // Agent works autonomously:
    //   - Reads files
    //   - Edits code
    //   - Runs tests
    //   - Updates PLAN.md
    //   - Commits changes

    if allTasksComplete(plan):
        break

    sleep(delay)
```

## References

- [Original article](https://dotnetting.net/2026/02/the-human-on-the-loop-a-practical-guide-to-agentic-engineering/)
- [Reference implementation](https://github.com/lesandiz/agentic-loops)
- [Ralph Loop concept by Geoffrey Huntley](https://twitter.com/GeoffreyHuntley)
