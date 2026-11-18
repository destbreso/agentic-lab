# Changelog

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
