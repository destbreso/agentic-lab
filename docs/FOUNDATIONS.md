# Foundations of Jig

Jig is an instrument for exploring multi-agent topologies on your own tasks. A topology has two dimensions here, and the lab treats both as things you change and measure. Its shape is who hands work to whom, in what order, and for how many rounds. Its information is what each role sees, and whether what it sees was measured by the system or written by another model.

This document states what the lab is built on as hypotheses, each with the evidence for it and the experiment in the lab that tests it. It revises the first version of this document, written in February 2026, which presented the same ideas as principles. That version is kept, unchanged, in [FOUNDATIONS-v1.md](FOUNDATIONS-v1.md).

## Where it started

The first premise was a real problem, and it still stands. When the model that does the work is also the one that judges it, you are trusting the same model that may have invented the solution to tell you whether it is real. Adding more agents that read the same context does not fix that. Three people reading the same newspaper are not three independent opinions.

From there, the first version drew a principle it called epistemic asymmetry: a system of several loops works only if the loops know different things and trust different things. It gave each of six loops a role defined by what it may see. The Evaluation loop checks the world instead of reading the Executor's account. The Critic sees only metadata, so it cannot be persuaded. The Planner runs on a slower clock. The roles talk through typed signals instead of conversation.

## What the research supports

Since then, the evidence on these questions has grown. This is what it says, with the sources.

- **A model judging its own work does not correct it.** Without an external signal, models often fail to fix their answers, and a self-correction pass can make them worse (Huang et al., [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798), ICLR 2024). Correction works when the feedback is reliable and comes from outside the model: tests, tools, the world (Kamoi et al., [When Can LLMs Actually Correct Their Own Mistakes?](https://arxiv.org/abs/2406.01297), TACL 2024).
- **More agents on the same information add little.** Multi-agent debate does not reliably beat a single agent with chain of thought or self-consistency, even with more compute, and mixing different models helps it ([Stop Overvaluing Multi-Agent Debate](https://arxiv.org/abs/2502.08788), 2025; its first version was titled "If Multi-Agent Debate is the Answer, What is the Question?"). Multi-agent systems often gain little over a single agent or over best-of-N sampling, and their failures are structural: the specification and the system's design, misalignment between agents, and verification and termination ([Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657), the MAST taxonomy). Results should be weighed against simple baselines and their cost (Kapoor et al., [AI Agents That Matter](https://arxiv.org/abs/2407.01502), 2024).
- **A persuasive critique can undo a correct answer.** Agents switch correct answers after one round of plausible but flawed feedback ([Helpful Agent Meets Deceptive Judge](https://arxiv.org/abs/2506.03332), 2025).
- **What flows between agents matters more than how many there are.** In one 2026 preprint, good orchestration depended less on the number of agents than on preserving information across dependent tasks ([OrchBench](https://arxiv.org/abs/2607.25656), a preprint).
- **Who coordinates matters, and the answer depends on the task.** A controlled comparison of 180 configurations of five architectures (one agent; independent agents in parallel; centralized, an orchestrator that delegates and puts the results together; decentralized, peers in rounds of debate; and a hybrid) found that centralized coordination gained most on tasks that split into parallel parts, that decentralized coordination did better on web navigation, and that independent agents amplified errors 17.2 times, against 4.4 times under an orchestrator, which caught errors before they spread (Kim et al., [Towards a Science of Scaling Agent Systems](https://arxiv.org/abs/2512.08296), 2025; the authors present these as principles to test further). Anthropic's research system is an orchestrator with subagents working in parallel, and its authors say this shape does not fit tasks where every agent needs the same context or the parts depend on each other, as in most coding, and that it spends about 15 times the tokens of a chat ([How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), 2025). Cognition argued that agents who cannot see each other's work make conflicting decisions ([Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents), 2025), and later that several agents do work when they contribute intelligence and only one writes ([Multi-agents working](https://cognition.ai/blog/multi-agents-working), 2026).
- **The shape of a team can be searched.** Methods that search for agent topologies and prompts automatically exist and compete on benchmarks: ADAS ([Hu et al., 2024](https://arxiv.org/abs/2408.08435)), AFlow ([Zhang et al., 2024](https://arxiv.org/abs/2410.10762)), and MASS ([Optimizing Agents with Better Prompts and Topologies](https://arxiv.org/abs/2502.02533), ICLR 2026). They search the shape of the graph. What flows along each edge, and where it comes from, is not one of their variables.

## The hypotheses

Each hypothesis says what the first version claimed, where it stands, and how the lab tests it. "Supported" means the research above backs it; "revised" means the first claim went further than the evidence; "open" means nobody has shown it either way, and the lab is where you find out for your task.

### H1. A verifying role adds information only when it has evidence the producer lacks

- **First version:** "A multi-loop system works if and only if the loops have fundamentally different epistemic access."
- **Status:** revised. The asymmetry is necessary for verification to add anything, but it is not sufficient, and "if and only if" is too strong. Several agents can also help by keeping their contexts apart and by working in parallel. Sometimes nothing beats one agent with good tools.
- **How the lab tests it:** the same task with a verifying role given different evidence from the producer, against the same role given the producer's own account.

### H2. Measured evidence corrects; model-written text persuades

- **First version:** "Structured signals cannot be persuasive."
- **Status:** revised. A typed signal limits persuasion only as far as its fields are facts the system measured: tests run and passed, files changed, tool calls, tokens. A field that carries a summary, a critique or a list of "corrections" written by a model is prose inside a structure, and prose can persuade.
- **What follows:** every value a role sees carries its provenance, measured or written by a model, and the interface shows it. A role whose decisions rest on model-written fields is a role that can be talked into a wrong answer.

### H3. The metadata Critic watches the process, not the result

- **First version:** the Critic sees metadata, not content, so it "cannot be persuaded".
- **Status:** revised. It is true that it cannot be persuaded, and also that it cannot see work that is coherent and wrong. What it can see is stagnation, repetition and spending. It is a monitor of the process. The first version already asked whether it needs a model at all.
- **How the lab tests it:** the Critic as a heuristic monitor with no model, against the Critic as a model call, and against a Critic given the content.

### H4. The world is the strongest evidence, if the producer cannot touch it

- **First version:** the Evaluation loop "checks reality", and it does not know the plan or the specification.
- **Status:** supported, with a condition the first version missed. Checking tests, builds and diffs is the best-backed idea here. But if the Executor can write or edit the tests the Evaluation loop then trusts, its ground truth is contaminated. And a check that ignores the specification can confirm that something passes without confirming that it is what was asked for.
- **What follows:** the checks the Evaluation loop trusts are ones the Executor cannot change, and the specification informs what is checked.

### H5. A team must beat the simple baselines on the same task

- **First version:** six loops, each one needed, because "removing it collapses an epistemic dimension".
- **Status:** open, and the evidence leans against assuming it. The first version itself asked for the minimum viable pipeline per task type.
- **How the lab tests it:** every jig-benchmark experiment includes the model asked directly, with no harness and no tools (always), and the single loop (the Ralph Loop recipe, unless the spec removes it), and shows pass rates beside tokens and time. Best-of-N with the same budget is planned and not built yet. A role earns its place by beating them on the task in front of you.

### H6. Timescales and thresholds are parameters, not principles

- **First version:** the Planner runs every five cycles, because "temporal asymmetry is epistemic", and the Refinement gate converges at 70%.
- **Status:** open. They are reasonable defaults with no evidence behind the numbers.
- **How the lab tests it:** they are variables of a topology, varied and compared like any other.

### H7. Different information or different models

- **First version:** listed as its first open question: is the asymmetry of information enough, or do different models add something of their own?
- **Status:** open, with a lead. Mixing different models improves debate in the study above.
- **How the lab tests it:** the same topology with one model in every role, against the same topology with different models in the verifying roles.

### H8. A role that delegates during a run beats a fixed flow only when the task splits into independent parts

- **First version:** not in it; its loops were wired by hand. The question is the author's (2026-11-19): is it better for each role to know how to talk to the others, or for one role to orchestrate and delegate what each part needs?
- **Status:** open, with a lead. The comparison of coordination above favors an orchestrator on work that splits into parallel parts, where it also contains errors, and a single thread where the steps depend on each other. Peers talking freely add coordination failures (the MAST taxonomy) and cost.
- **Where Jig is:** every built-in topology's flow is fixed in its file, and only Do writes (see "How a topology coordinates" below). No role delegates subtasks during a run yet; the Advisor topology's consultation is the nearest thing.
- **How the lab tests it:** an orchestrator-workers topology, once a role can create subtasks for others during a run, against a fixed flow and the single loop, on tasks that split into independent parts and on tasks whose steps depend on each other, with how far errors spread and the cost beside the quality.

## How a topology coordinates

Jig describes a topology first by what each role sees: the walls of H1 to H4, which `jig show --sight` measures. Coordination is a second axis, apart from the first: who decides what happens next, and who talks to whom.

- **Fixed:** the flow is written in the file and the engine runs it. A role may choose only among the ways the file declares, as Decide chooses between converging, refining and starting over. Every built-in topology is fixed today: the Ralph Loop (one role), Plan & Execute (a plan and its execution, with no verifier), Execute & Evaluate and Supervised Coder (a producer and its verifiers in a chain), Reflexion (the same chain, with Memory's summary of each attempt fed back to Do), Deep Reasoning and the Full Agent Pipeline (a chain with a gate), and Adversarial Duel (two producers working apart in parallel, and an arbiter that picks one).
- **Orchestrated:** a role decides during the run what to delegate, to whom, and puts the results together. The Advisor topology holds its seed, since Do decides when to consult its Advisor, up to three times a turn. No built-in topology delegates subtasks yet.
- **Between peers:** the roles decide among themselves whom to talk to, as in a debate. No built-in topology works this way.

Beside both axes, one property is worth recording for any topology: who writes. In every built-in topology only Do changes the workspace. Plan and Check only read it, and Critique, Decide and Memory have no tools, which is the shape the research above finds safest when the steps depend on each other.

## Principles

- **The definition is data; the views are drawn from it.** A topology is written as data or code that can be diffed and versioned, and the interface draws it. A canvas is never the only place a system lives.
- **Every value carries its provenance.** What each role saw, and whether it was measured or written by a model, is recorded with every run, so you can reconstruct what each role knew at each decision.
- **Baselines are always in the comparison.** A result without the single loop and best-of-N beside it is not a result.
- **No hidden state, and failures are loud.** These carry over from the first version unchanged.
- **The lab claims only what it measures.** The interface, the README and this document state as fact only what the code does and a test or a run shows. Everything else is a hypothesis, and says so.
