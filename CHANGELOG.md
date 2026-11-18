# Changelog

## Unreleased: what each role saw, and checks no role can touch

Every run now keeps what each role saw and where each value came from. And when your task says how to check it, the lab checks it itself, somewhere no role can write, and the run's outcome is that check's.

### What you will notice

- **A task can carry its checks.** A command that must exit 0, a file that must hold an expected text, or an expected answer. In the CLI that's `--check "sh test.sh"`, `--check-file test.sh` and `--task-file task.json`. The chat and the builder take `checks` and `checkFiles` in the request.
- **The lab runs the checks, not a role.** It copies your workspace into a directory of its own, puts the check files back as they were when the run started, and runs the checks there. If a role edits your test script, nothing changes: the lab uses its own copy.
- **With checks, the outcome is the check's.** A run passes when the measured check passes, and fails when it fails, whatever the roles concluded. The topology's own outcome is still shown beside it, so you can see when they disagree.
- **Check's verdict follows the measured check.** When there are checks, Check runs them through the lab on its turn, and its verdict is their result. What its model said is kept beside it, marked as written by a model. A model that hides its verdict in a tool call, or never gives one, no longer decides the round. To compare the two, set `verdictFrom: "model"` (`--verdict-from model`): the model's verdict drives the run again, and the outcome is still the lab's check.
- **Plan and Check only read.** In every built-in topology, Do is the only role that can write files, run commands or use git. Plan and Check get `file_read`, `glob` and `grep`. Critique, Decide and Memory get no tools. A skill can't give Check a way to write. You can still give a role other tools in its definition, on purpose.
- **A role sees only what its wires give it.** Roles no longer get every recent signal and the shared blackboard. The wires to Critique and Decide carry counts and verdicts, never the text of the work. The task, the conversation and recalled memories reach Plan, Do and Check, as before, and nobody else.
- **Every value has a provenance.** Each field a role sees is marked as from you, measured by the lab, or written by a model. A pass rate counted from a model's verdicts is written; counted from the measured check, it's measured.
- **Every role's turn is recorded.** What it was given and where each value came from, the exact messages sent to its model and the replies, the tools offered, what it emitted, its tokens and time. They're in the `run_steps` table and in `GET /api/runs/<id>`. `run --verbose` prints what each role saw. A recorded run can be replayed and sends the same prompts.
- **What each role sees is measured.** `measureSight(topology)` runs a topology with a mock model and marked inputs and tells you, for each role, what reached its prompt, what reached it unread, and what never reached it. The built-in topologies' results are in `packages/core/src/engine/__sight__`, and a test fails when one moves.
- **A token budget.** `tokenBudget` (`--token-budget`) caps what one attempt may spend. When it's spent, the calls in flight stop and the run ends.

### Also changed

- **Memory stays with its task.** The chat recalls from the current conversation by default, not from every conversation. You can ask for runs of the same task, every conversation, or nothing (`memoryScope`). Benchmarks recall nothing unless you pick a memory bank.
- **Ollama gets a bigger context.** Each call asks for 16,384 tokens of context (`num_ctx`). Before, Ollama used its small default and quietly cut long tool loops from the start. Set `OLLAMA_NUM_CTX` to change it. The CLI prints the number it uses.
- **Benchmarks run in the lab's own process.** The baseline is one direct call with the question alone, and the judge is a model you can name apart from the contenders' (`judge`, or the field on the benchmarks page). Nothing goes over HTTP to another server anymore.

## Unreleased: one engine, and it does what the definitions say

The chat, the builder, the CLI and the benchmarks now run on one engine. Before, the chat had its own copy of every recipe, the builder ran the core engine, and the CLI ran an older loop. They did not agree, and half of what the recipes said did not happen. Now each surface is a thin adapter over `AgentSession`, and the same run gives the same events wherever you start it.

### What you will notice

- **Critique no longer reads Do's output in the chat.** In the chat, Critique used to get the last few messages, Do's answer included. That was the opposite of what the definition says. Now it follows the definition: it sees the process (verdicts, tool counts, tokens), not the work. If you relied on Critique commenting on the answer itself, it won't anymore.
- **Every built-in recipe runs.** Deep Reasoning, Supervised Coder and Adversarial Duel used to fail before their first step. A node now gets the ports its recipe declares, and a wire that can never deliver anything is refused when you build the pipeline.
- **Roles run in the order you see.** A run goes in rounds. Each round runs the roles in their drawn order: in Deep Reasoning that's Plan, Do, Check, Critique, Decide. When Decide sends the work back, the next round starts where it points: at Do to fix things, at Plan to start over. Critique runs every round.
- **Ways back carry something.** When Check or Decide sends the work back, Do now reads their corrections, along with its own previous answer. When Decide starts over, Plan reads the task and the reason.
- **"Done" means done.** When Decide converges, the run stops. The round limit counts the rounds you actually ran.
- **No verdict is not a pass.** A round without a verdict is inconclusive. A verdict counts once. Partial, inconclusive or unreadable verdicts never count as passing.
- **Success is honest.** A run ends as passed, failed, inconclusive or stopped. You only see success when it passed. A run where a role failed, or where nothing ever checked the work, is not a success. The chat, the builder, the stored run and the CLI's exit code all say the same.
- **The Ralph Loop really loops.** It takes one turn, then another, while `PLAN.md` still has unchecked items, up to 20 turns. With no plan file it takes one turn and claims nothing.
- **Steering goes to Do.** A nudge from the chat is now a note Do reads on its next turn. No other role sees it. Priority is shown as a label in the note; it doesn't change when the note arrives.
- **The chat shows a role's output when the role finishes.** It used to stream tokens as the old copy of the loops wrote them. Now each role's step fills in when that role's turn ends.
- **Limits are rounds now.** The built-in recipes stop after 5 rounds at most (the Adversarial Duel after 3, the Ralph Loop after 20 turns). Deep Reasoning's Decide still stops at its own 3.

### The CLI

- `agentic-lab run` runs a topology through the same engine. Without `--topology` it runs the Ralph Loop. The task is `--task "..."`, or your `PROMPT.md`.
- `recipes --run` and `pipeline --recipe` work again. They used to crash on `requires parameter "tools"`.
- `--json` prints every engine event as one JSON line.
- The exit code tells you how it went: 0 when the run passed, 1 when it didn't, 130 when you stopped it.
- Ctrl+C stops the run and the model call in flight. Press it twice to quit at once.
- `--auto-commit`, `--auto-push` and `--log` are gone. Only the old loop honoured them, and keeping them would mean ignoring them quietly.

### Robustness

- Every model call has an output limit (4096 tokens unless you set one) and a timeout (300 seconds unless you set one). A call can't hang for minutes anymore.
- Stopping a run aborts the calls in flight, in every provider.
- Hitting a tool-call cap, or a model call that fails, ends the run as failed and says why. A tool error is still just feedback to the model.

### Security, first step

- The dashboard listens on 127.0.0.1 by default. To reach it from another machine you have to say so (`npx next dev --hostname 0.0.0.0`), and the API still has no authentication, so think twice.
- Commands the agent runs through the shell and git tools no longer inherit the server's environment. Your API keys and database URLs stay out of them.
- Token authentication and sandboxed tools come later.
