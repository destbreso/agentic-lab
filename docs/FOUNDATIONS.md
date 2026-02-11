# Epistemic Foundations of Agentic Lab

> *"A multi-loop agentic engine works only if loops are epistemically asymmetric.*
> *Otherwise, you just parallelize hallucinations."*

---

## Why This Document Exists

This is not a tutorial. It's not an API reference. It's the **why** behind every architectural decision in Agentic Lab.

Most agentic frameworks are built by bolting together prompt chains and hoping the output is good. They work sometimes, but nobody can explain *why* they work when they do, or *why* they fail when they don't. The failures are non-obvious: the system produces output that *looks* correct, reads well, passes a cursory glance — and is wrong.

This project exists because that uncertainty is unacceptable if you want to *understand* what you're building. And the only way to understand is to build a lab where you can isolate variables, test hypotheses, and observe failures up close.

---

## The Core Thesis

### A single LLM loop has a fundamental problem

Consider the basic agentic loop (the "Ralph Loop"):

```
while tasks remain:
    read specs → pick task → work → update plan → end turn
```

This works surprisingly well. Each iteration is stateless — the agent gets fresh context, so there's no context dilution. The plan file serves as external memory. Progress is real because the agent uses tools (files, shell, git) that modify the actual world.

But there's a hidden assumption: **the agent that does the work is also the agent that evaluates the work.**

When the LLM writes code and then says "I've completed the task," you're trusting the same model that may have hallucinated the solution to also correctly assess whether the solution is real. This is epistemic circularity. The model has no access to ground truth; it has access to its own outputs and its own confidence — which are often the same thing.

This doesn't matter much for trivial tasks. It matters enormously for anything non-trivial.

### The naive multi-loop makes it worse

The instinctive fix is to add more loops: a "reviewer" loop, a "planner" loop, a "critic" loop. But if these loops all share the same epistemic basis — same context, same model, same information sources — you haven't solved the problem. You've *multiplied* it.

Imagine three people in a room, all reading the same newspaper, asked if a headline is true. You don't get three independent opinions. You get one opinion, amplified. That's what happens when you run parallel LLM loops on the same context: you parallelize hallucinations and call it "consensus."

### The principle: Epistemic Asymmetry

A multi-loop system works **if and only if** the loops have fundamentally different epistemic access:

- Different **information sources** (not just different prompts — actually different data)
- Different **verification methods** (at least one loop must check the *world*, not just the *output*)
- Different **reasoning modes** (one generates, another adversarially critiques)
- Different **temporal granularity** (one is fast/tactical, another is slow/strategic)

This is what we call **epistemic asymmetry**: the loops don't just do different things, they *know* different things and *trust* different things.

---

## The Five Loops and Their Epistemic Roles

Each loop in Agentic Lab exists because it occupies a unique position in the epistemic landscape. If any two loops could be collapsed into one without losing information access, the architecture is wrong.

### 1. Execution Loop — The Muscle

**What it knows:** The current task, the available tools, the system prompt.
**What it does:** Picks a task, calls the LLM, uses tools, produces output.
**What it doesn't know:** Whether its output is correct. Whether it's making progress. Whether the plan makes sense.

The Execution Loop is deliberately *stupid* about everything except the immediate task. It's fast, cheap, and stateless. It doesn't evaluate its own work. It doesn't second-guess the plan. It executes.

This is not a limitation — it's a design choice. The Execution Loop's epistemic narrowness is what makes it trustworthy at the one thing it does: converting a task description into tool calls and file changes.

**Epistemic function:** Production of artifacts through tool use.

### 2. Evaluation Loop — The Ground Truth Oracle

**What it knows:** The Execution Loop's claimed results, *and* the actual state of the world.
**What it does:** Runs automated checks (tests, builds, file existence, git diff). Optionally uses an LLM to interpret the results.
**What it doesn't know:** What the plan says. What the Execution Loop intended. What the original spec was.

This is the most important asymmetry in the system: **the Evaluation Loop never trusts the Execution Loop's output.** It doesn't read the LLM's response and judge it. It checks reality.

When the Execution Loop says "I wrote the function," the Evaluation Loop doesn't read the chat history to see if that's true. It runs the test. It checks if the file exists. It diffs the git state. It uses *tools that access ground truth*.

The LLM component in the Evaluation Loop is optional — and when present, it operates on the *tool outputs*, not on the Execution Loop's narrative. This is the critical distinction.

**Epistemic function:** Verification through external ground truth, independent of the production process.

### 3. Planning Loop — The Cartographer

**What it knows:** Aggregate evaluation results over time. Critic feedback. Compressed memory. The plan itself.
**What it does:** Decides whether to continue, pivot, stop, or escalate. Updates the plan. Generates the next task.
**What it doesn't know:** Execution-level details. Individual tool calls. The raw conversation history.

The Planning Loop is *slow*. It runs every 5 cycles, not every cycle. This temporal asymmetry is epistemic: the Planning Loop makes decisions based on *trends*, not individual data points.

A single evaluation failure is noise. Five consecutive evaluation failures is a signal. The Planning Loop can only see this pattern because it doesn't run every cycle. If it ran every cycle, it would overreact to noise — the same way a day-trader makes worse decisions than a long-term investor looking at the same market.

**Epistemic function:** Strategic reasoning over aggregated signals, at a different timescale than production.

### 4. Critic Loop — The Adversary

**What it knows:** Summaries of execution activity. Evaluation metrics. Token consumption.
**What it critically *does not* know:** The full context of what the Execution Loop was thinking.

This is the most deliberately asymmetric loop. The Critic Loop is specifically *denied* full context access. It receives compressed summaries, not raw histories.

Why? Because if the Critic reads the full execution transcript, it will be *persuaded* by the LLM's reasoning. LLMs are extraordinarily good at making their outputs sound plausible. If you feed an LLM's output to another LLM as "evidence," the second LLM will almost always agree — not because the output is correct, but because the output is *coherent*.

The Critic Loop avoids this by operating on *metadata*, not *content*:
- "The agent called the same tool 5 times in a row" (stagnation pattern)
- "Evaluation scores have been declining for 3 cycles" (regression signal)
- "Token budget is 80% consumed with 30% of tasks remaining" (cost alert)
- "The agent hasn't made a tool call in 2 cycles" (spin detection)

These are signals that can be checked without reading the LLM's "reasoning." They're structural observations about behavior, not semantic judgments about content. This makes the Critic Loop resistant to the coherence trap that undermines naive reviewer patterns.

When the Critic *does* use an LLM (for deeper analysis), it feeds it the *structural anomalies*, not the execution narrative. The LLM reasons about the patterns, not about whether the code looks correct.

**Epistemic function:** Adversarial monitoring through structural analysis, with deliberate information restriction.

### 5. Memory Loop — The Archivist

**What it knows:** Raw signals from Execution, Evaluation, and Planning.
**What it does:** Compresses, summarizes, denoises. Identifies milestones. Freezes canonical state.
**What it doesn't do:** Interpret, evaluate, or decide.

The Memory Loop's asymmetry is functional, not informational. It sees a lot of raw data, but its job is purely *reductive*: turn verbose, noisy signal streams into compact, reliable summaries.

This matters because without compression, the other loops eventually drown in their own history. A Planning Loop that receives 50 raw evaluation results per cycle will waste its context window on data rather than reasoning. The Memory Loop acts as a noise filter, a curator of signal.

The key constraint: the Memory Loop must not *editorialize*. It summarizes; it does not interpret. If it starts adding opinions ("I think the agent is struggling"), it contaminates the information it provides to other loops with yet another epistemic source. Summaries should be factual: what happened, what succeeded, what failed, how much it cost.

**Epistemic function:** Lossless-as-possible information compression, separating signal from noise without adding interpretation.

### 6. Refinement Loop — The Convergence Gate

**What it knows:** Evaluation verdicts and metrics. Critic findings. The execution output that was evaluated. Its own history of past rounds.
**What it does:** Decides whether the pipeline should stop (converge), send corrections back to Execution (refine), or discard the current approach and ask Planning to re-plan from scratch (backtrack).
**What it doesn't know:** The raw execution process. The agent's reasoning. What the plan says.

The Refinement Loop exists because evaluation alone cannot decide *what to do next*. The Evaluation Loop says "this output fails 3 of 5 criteria." The Critic Loop says "the agent has been looping over the same error." But neither of them can synthesize these two signals into an action.

That synthesis — "the pass rate is 40% and the same failure keeps recurring, so we should backtrack rather than try again" — requires a different epistemic operation. It requires *decision theory applied to meta-signals*. The Refinement Loop operates on signals *about* the process, not on the artifacts of the process itself.

Three key mechanisms make the Refinement Loop epistemically distinct:

1. **Convergence threshold.** A quantitative gate: if the evaluation pass rate exceeds the threshold (default 70%) and the Critic has no findings, the pipeline stops. This is not a judgment call — it's a measurable criterion.

2. **Recurrence detection.** The Refinement Loop tracks which failures it has seen before. If the same failure appears in consecutive rounds, it recommends backtracking instead of refining — because refinement has already failed at this specific problem. This temporal memory is unique to this loop.

3. **LLM-assisted nuanced analysis.** For ambiguous cases (moderate pass rate, some critic findings, no recurrence), the Refinement Loop uses an LLM to reason about the evaluation data. But critically, it feeds the LLM *structured metrics* (pass rate, failing criteria, critic findings), not raw execution output. This is the same information-restriction principle that makes the Critic Loop reliable.

**Epistemic function:** Decision synthesis over meta-signals, with convergence detection and temporal recurrence analysis.

---

## Why These Six and Not Three, or Nine

The six loops are not arbitrary. Each one exists because removing it collapses an epistemic dimension:

| If you remove... | You lose...               | Failure mode                                            |
|------------------|---------------------------|---------------------------------------------------------|
| Execution        | The ability to do work    | Nothing happens                                         |
| Evaluation       | Ground truth verification | Hallucinations go undetected                            |
| Planning         | Strategic adjustment      | The agent pursues stale plans forever                   |
| Refinement       | Convergence control       | No way to decide when to stop, refine, or start over    |
| Critic           | Stagnation detection      | The agent spins in circles without anyone noticing      |
| Memory           | Context compression       | Other loops drown in noise or run out of context window |

Could you add more loops? Yes. But only if the new loop has *unique epistemic access* — information or a verification method that no existing loop has. Adding a "Code Review Loop" that reads the same code the Execution Loop wrote and judges it with the same LLM adds nothing. Adding a "Test Runner Loop" that independently executes test suites *does* add something, because it accesses ground truth that no other loop touches.

The Refinement Loop earned its place by occupying a dimension no other loop covers: **decision synthesis over meta-signals with temporal recurrence awareness**. The Evaluation Loop produces verdicts but can't decide what to do next. The Critic spots patterns but doesn't act on them. The Refinement Loop is the only node that can look at both sets of signals and make a reasoned converge/refine/backtrack decision.

The test for whether a loop should exist: **can this loop ever disagree with the others based on evidence they don't have?** If yes, it belongs. If not, it's redundant.

---

## Signals, Not Conversations

Traditional multi-agent frameworks have agents "talk" to each other in natural language. Agent A writes a message, Agent B reads and responds. This is fragile and epistemically flat — both agents operate on the same unstructured text, and the information loss/distortion in natural language translation is enormous.

Agentic Lab uses **typed signals** instead. Loops communicate through structured data flowing through ports and wires:

```
Signal {
    sourceNodeId: "executor"
    type: "execution_result"
    data: {
        taskId: "implement-auth"
        toolCalls: 7
        filesModified: ["src/auth.ts", "src/middleware.ts"]
        testsRun: true
        testsPassed: 3
        testsFailed: 1
    }
    timestamp: "2026-02-10T..."
}
```

This is not a design aesthetic — it's an epistemic choice. Structured signals:

1. **Cannot be persuasive.** A signal carries data, not arguments. The Evaluation Loop can't be "talked into" accepting a bad result.
2. **Can be filtered.** The Critic Loop receives only metadata signals (token counts, tool call patterns), not content. This filtering is what enforces its epistemic asymmetry.
3. **Can be transformed.** Wires between loops can include transforms that strip, reshape, or aggregate data — controlling exactly what epistemic access each loop has.
4. **Are auditable.** Every signal has a timestamp, source, and type. You can reconstruct exactly what each loop knew at every decision point.

---

## The Recipes Model

If the loop architecture is the theory, recipes are the experimental apparatus. A recipe is a specific configuration of loops, wires, and parameters that constitutes a testable hypothesis.

### Ralph Loop (Baseline)
```
[Execution] → (no verification)
```
The simplest recipe. One loop, no verification. This is the control group. It works for trivial tasks. It fails silently for non-trivial ones.

**Hypothesis it tests:** "Is a single loop sufficient for this task?"

### Execute & Evaluate
```
[Execution] → [Evaluation] → corrections → [Execution]
```
Two loops with ground truth verification. The Evaluation Loop checks real-world state and feeds corrections back.

**Hypothesis it tests:** "Does adding ground truth verification improve outcomes?"

### Deep Reasoning
```
[Planning] → [Execution] → [Evaluation] → [Refinement]
                  ↑               ↓                │
                  │          [Critic] ─────────────┘
                  │               ▲
                  └── corrections / replan ──┘
```
Four loops in a closed feedback architecture with the Refinement gate controlling convergence. The Critic feeds structural analysis into Refinement. Refinement can send corrections back to Execution (refine), ask Planning to re-plan (backtrack), or stop the pipeline (converge).

**Hypothesis it tests:** "Does an explicit convergence gate with recurrence detection produce better outcomes than unbounded correction loops?"

### Full Pipeline
```
[Planning] → [Execution] → [Evaluation] → [Refinement] → [Planning]
                  ↓               ↓               ↓
               [Critic]         [Memory] → [Execution] + [Planning]
```
All six loops, fully connected. The maximum epistemic coverage.

**Hypothesis it tests:** "Do the specialized loops, with their specific epistemic roles, produce better outcomes than simpler configurations?"

The point is not that the full pipeline is always better — it's that **you can measure when it is and when it isn't.** And those measurements are what produce understanding.

---

## What This Lab Is For

Agentic Lab is not a production framework. It's not meant to ship software. It's a laboratory — a place to run controlled experiments on agentic systems and develop intuitions that no amount of reading papers will give you.

### Questions We Can Now Answer Empirically

1. **Does ground truth verification (Evaluation Loop) actually reduce hallucination rates?**
   Run the same task suite with Ralph Loop vs. Execute & Evaluate. Count failures.

2. **Does the Critic Loop's information restriction actually help?**
   Run the full pipeline once with information restriction, once without. Compare stagnation rates.

3. **Is there a cost-performance frontier?**
   Plot task completion rate vs. total tokens consumed across different recipe configurations.

4. **When does the Planning Loop help vs. hurt?**
   Some tasks are simple enough that strategic planning adds latency without improving outcomes. At what complexity threshold does planning become valuable?

5. **Does the Memory Loop prevent context window overflow?**
   Run long tasks (50+ cycles) with and without compression. Measure when performance degrades.

6. **Do different LLMs perform differently in different loop positions?**
   Maybe a small model is fine for Execution but a larger model is needed for Planning. Maybe the Critic works better with a different model than the Executor. Map the landscape.

7. **What's the minimum viable pipeline for a given task type?**
   Not every task needs five loops. But which loops are essential for which task types?

These are not philosophical questions. They're empirical ones. And this lab exists to answer them.

---

## Design Principles

### 1. Backward Compatibility is Non-Negotiable

The original `AgenticLoop` (Ralph Loop) still exists and still works. The composable engine is an *addition*, not a replacement. You can always fall back to the simplest configuration.

### 2. No Hidden State

Every signal, every decision, every trigger is logged and traceable. If a loop made a bad decision, you can reconstruct exactly what it knew at the time.

### 3. Fail Loudly, Not Silently

The most dangerous failure mode in agentic systems is silent success — the agent produces output that looks correct but isn't. The Evaluation Loop exists specifically to catch this. If it can't verify a result, the verdict is "inconclusive," not "pass."

### 4. The Architecture Is the Experiment

The composable pipeline isn't just a way to run agents — it's the experimental apparatus. Recipes are hypotheses. Runs are experiments. Results are data. The system is designed for systematic exploration, not for one-off usage.

### 5. Epistemic Hygiene Above All

Every design decision must answer: "What does this loop *know*, and what does it *not know*?" If a loop has access to information it shouldn't, the architecture is compromised. If two loops have the same epistemic access, one of them is redundant.

---

## Open Questions

These are the questions that drove the creation of this lab. They're not answered yet — answering them *is* the research agenda.

1. **Is epistemic asymmetry sufficient, or do you also need model diversity?**
   Could you achieve the same benefit by using the same model with different information, or do different models contribute genuinely different epistemic perspectives?

2. **Where is the diminishing returns frontier?**
   At some point, adding more loops costs more than it saves. Where is that point, and does it depend on task type?

3. **Can the Critic Loop be made fully heuristic (no LLM)?**
   If the Critic only needs structural/statistical analysis, maybe it doesn't need an LLM at all — reducing costs significantly.

4. **What's the minimal ground truth the Evaluation Loop needs?**
   Does it need to run tests? Or is file existence + git diff sufficient for most tasks?

5. **Does the Memory Loop's compression actually preserve the right information?**
   Lossy compression is fine if you lose noise. It's catastrophic if you lose signal. How do you measure which one you're losing?

6. **Can recipes be automatically selected based on task analysis?**
   Given a task description, can the system predict which pipeline configuration is optimal?

7. **What happens when the loops disagree?**
   The Evaluation Loop says "fail," the Critic says "stagnation," the Planning Loop says "continue." Who wins? What's the resolution protocol?

8. **What is the optimal convergence threshold for the Refinement Loop?**
   The default is 70%, but does this vary by task type? Does a higher threshold produce diminishing returns, or does it catch real quality issues?

9. **Does the Refinement Loop's recurrence detection prevent genuine persistence?**
   Sometimes a failure recurs because the agent hasn't tried hard enough, not because it's stuck. When is "backtrack" the right decision vs. "keep refining"?

10. **Can the Refinement Loop operate without an LLM?**
    For cases where evaluation provides clear quantitative metrics, a purely heuristic convergence gate might suffice — and would be significantly cheaper.

---

## A Note on the Name

"Agentic Lab" — not "Agentic Framework" or "Agentic Engine."

A framework is something you build on. An engine is something you ship with. A lab is where you go to understand things you don't yet understand.

That's what this is.

---

*David Estévez, February 2026*
