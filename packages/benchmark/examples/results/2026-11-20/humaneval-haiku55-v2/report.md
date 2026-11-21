# humaneval-5-seed7-haiku55-v2-all

> On five humaneval problems and anthropic/claude-haiku-5-5, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `humaneval-haiku55-v2.yaml`, hash `6f0d77643dc4f8cea7cc7d513a0cd749f23576027b5158104f6bc33d9bcaf2ed`, locked 2026-11-20T23:46:36.420Z before its first attempt.
- **Tasks:** humaneval-5-seed7 (`../tasks-v2/humaneval-5-seed7.yaml`), 5 tasks: HumanEval (OpenAI, MIT): Python functions to complete from their signature and docstring, each checked by the dataset's own hidden tests. 5 of the file's 164 problems, chosen with seed 7. Source: HumanEval, https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz, licence MIT (https://github.com/openai/human-eval/blob/master/LICENSE), file sha256 `b796127e635a67f93fb35c04f4cb03cf06f38c8072ee7cee8833d7bee06979ef`.
- **Model:** `anthropic/claude-haiku-5-5`, for every role of every arm.
- **Versions:** jig-core 0.1.9 for every attempt; locked by jig-benchmark 0.1.1, reported by jig-benchmark 0.1.1.
- **Arms:** the direct arm (the model asked once, with the task and its files, no tools), the baseline Ralph Loop, and Execute & Evaluate (`exec-eval`), Plan & Execute (`plan-execute`), Reflexion (`reflexion`), Supervised Coder (`supervised-coder`), Adversarial Duel (`adversarial-duel`), Advisor (`advisor`), Deep Reasoning (`deep-reasoning`), Full Agent Pipeline (`full-agent-pipeline`).
- **Repetitions:** 1 per task and arm.
- **Budget per attempt:** 60,000 tokens (a run stops after the model call that crosses it), and at most 3 rounds in every arm (the spec's limit replaces each topology's own).
- **Permissions:** edits inside the attempt's workspace run; allowed: `Shell(python3 *)`; anything else that would ask is denied, since nobody is there to ask.
- **Check's verdict:** the measured checks' result, with its model's verdict kept beside it (Jig's default).
- **Fallbacks:** an attempt where a role fell back to another model counts for nothing.
- **Rule, fixed before the first attempt:** per arm, k passed of n with a 95% Wilson interval. Against another arm: supports when the arm's interval lies wholly above the other's; against when it lies wholly below, or when the 95% Newcombe interval of the difference lies inside 15 points either way (no practical difference); inconclusive otherwise.

## The arms side by side

| Arm | Kind | Passed | 95% interval | Median tokens | Median time | Not counted |
|---|---|---|---|---|---|---|
| Direct | direct | 5 of 5 | 57% to 100% | 1,387 | 4.4 s | - |
| Ralph Loop | baseline | 5 of 5 | 57% to 100% | 8,291 | 4.3 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 15,128 | 10.8 s | - |
| Plan & Execute | arm | 5 of 5 | 57% to 100% | 13,480 | 10.2 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 16,633 | 12.4 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 20,528 | 17.4 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 31,629 | 24.3 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 9,990 | 5.2 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 22,659 | 18.4 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 21,190 | 18.4 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `humaneval-1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-11` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-87` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-115` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-160` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.

## What this does not show

- **One model.** Every role of every arm ran on `anthropic/claude-haiku-5-5`. Another model, or different models in different roles, may order the arms differently.
- **Few runs.** 1 repetition of 5 tasks: 5 attempts per topology arm. Intervals this wide tell apart only large differences. Inconclusive means these counts cannot tell the arms apart, not that they are equal.
- **A sample of a dataset.** 5 tasks of HumanEval (5 of the file's 164 problems, chosen with seed 7). What holds on them may not hold on the rest of the dataset, or on your own work.
- **A public task set.** HumanEval is published, so the model may have seen these problems in training. That can raise every arm's count, the direct arm's above all, since it answers from what the model remembers.
- **Attempts are not independent draws.** Each interval treats every attempt as one independent try. Attempts on the same task share its difficulty, so the real uncertainty is larger than the intervals show.
- **The direct arm gets one call and no tools, by design.** It measures the model asked plainly, so the other arms show what a harness adds. Writing its answer into the task's file is the lab's doing, not the model's: the last line of its reply, or its last code block, is written where the task says, and nothing else is done to it.
- **Who hears the checks.** In the arms with a Check role, Check's verdict is the lab's measured check, so on a way back Do learns whether the checks passed and what they printed (never the checks themselves). The direct arm and the Ralph Loop get no such signal. This compares the topologies as Jig runs them by default, not the roles' reasoning alone.
- **No best-of-N baseline yet.** Best-of-N at the same budget (independent single-loop attempts until the budget is spent, kept if any passes the checks) is planned and not built.
- **Tokens and time, not money.** No prices are applied. Time is wall-clock on one machine and depends on whatever else it was running.

## Runs

<details><summary>Every attempt with its run id</summary>

| Task | Arm | # | Outcome | Checks | Tokens | Time | Rounds | Run id |
|---|---|---|---|---|---|---|---|---|
| `humaneval-1` | Direct | 1 | passed | 1 of 1 | 857 | 2.9 s | - | `direct.humaneval-1.1.mwpmok3e` |
| `humaneval-1` | Ralph Loop | 1 | passed | 1 of 1 | 6,835 | 3.9 s | 1 | `ralph-loop.humaneval-1.1.mwpmok42` |
| `humaneval-1` | Execute & Evaluate | 1 | passed | 1 of 1 | 13,699 | 9.3 s | 1 | `exec-eval.humaneval-1.1.mwpmok42` |
| `humaneval-1` | Plan & Execute | 1 | passed | 1 of 1 | 13,355 | 10.2 s | 1 | `plan-execute.humaneval-1.1.mwpmomga` |
| `humaneval-1` | Reflexion | 1 | passed | 1 of 1 | 14,865 | 10.6 s | 1 | `reflexion.humaneval-1.1.mwpmon9q` |
| `humaneval-1` | Supervised Coder | 1 | passed | 1 of 1 | 20,528 | 16.2 s | 1 | `supervised-coder.humaneval-1.1.mwpmorfl` |
| `humaneval-1` | Adversarial Duel | 1 | passed | 1 of 1 | 31,695 | 23.7 s | 1 | `adversarial-duel.humaneval-1.1.mwpmougk` |
| `humaneval-1` | Advisor | 1 | passed | 1 of 1 | 9,051 | 4.1 s | 1 | `advisor.humaneval-1.1.mwpmovja` |
| `humaneval-1` | Deep Reasoning | 1 | passed | 1 of 1 | 19,114 | 14.5 s | 1 | `deep-reasoning.humaneval-1.1.mwpmoyvj` |
| `humaneval-1` | Full Agent Pipeline | 1 | passed | 1 of 1 | 20,970 | 17.9 s | 1 | `full-agent-pipeline.humaneval-1.1.mwpmp42m` |
| `humaneval-11` | Direct | 1 | passed | 1 of 1 | 780 | 2.5 s | - | `direct.humaneval-11.1.mwpmpa9a` |
| `humaneval-11` | Ralph Loop | 1 | passed | 1 of 1 | 9,580 | 4.3 s | 1 | `ralph-loop.humaneval-11.1.mwpmpcbc` |
| `humaneval-11` | Execute & Evaluate | 1 | passed | 1 of 1 | 15,128 | 9.2 s | 1 | `exec-eval.humaneval-11.1.mwpmpcxr` |
| `humaneval-11` | Plan & Execute | 1 | passed | 1 of 1 | 12,132 | 9.4 s | 1 | `plan-execute.humaneval-11.1.mwpmpfse` |
| `humaneval-11` | Reflexion | 1 | passed | 1 of 1 | 15,869 | 11.3 s | 1 | `reflexion.humaneval-11.1.mwpmpi1j` |
| `humaneval-11` | Supervised Coder | 1 | passed | 1 of 1 | 17,421 | 12.7 s | 1 | `supervised-coder.humaneval-11.1.mwpmpk6f` |
| `humaneval-11` | Adversarial Duel | 1 | passed | 1 of 1 | 27,235 | 19.5 s | 1 | `adversarial-duel.humaneval-11.1.mwpmpn4o` |
| `humaneval-11` | Advisor | 1 | passed | 1 of 1 | 8,567 | 3.2 s | 1 | `advisor.humaneval-11.1.mwpmpqx2` |
| `humaneval-11` | Deep Reasoning | 1 | passed | 1 of 1 | 17,991 | 13.3 s | 1 | `deep-reasoning.humaneval-11.1.mwpmptl5` |
| `humaneval-11` | Full Agent Pipeline | 1 | passed | 1 of 1 | 18,996 | 14.9 s | 1 | `full-agent-pipeline.humaneval-11.1.mwpmpu3x` |
| `humaneval-87` | Direct | 1 | passed | 1 of 1 | 1,387 | 4.4 s | - | `direct.humaneval-87.1.mwpmq2dg` |
| `humaneval-87` | Ralph Loop | 1 | passed | 1 of 1 | 7,569 | 4.0 s | 1 | `ralph-loop.humaneval-87.1.mwpmq41k` |
| `humaneval-87` | Execute & Evaluate | 1 | passed | 1 of 1 | 14,957 | 10.8 s | 1 | `exec-eval.humaneval-87.1.mwpmq5qv` |
| `humaneval-87` | Plan & Execute | 1 | passed | 1 of 1 | 13,480 | 9.4 s | 1 | `plan-execute.humaneval-87.1.mwpmq5xi` |
| `humaneval-87` | Reflexion | 1 | passed | 1 of 1 | 18,896 | 12.4 s | 1 | `reflexion.humaneval-87.1.mwpmq79w` |
| `humaneval-87` | Supervised Coder | 1 | passed | 1 of 1 | 20,489 | 17.4 s | 1 | `supervised-coder.humaneval-87.1.mwpmqdbm` |
| `humaneval-87` | Adversarial Duel | 1 | passed | 1 of 1 | 34,265 | 24.3 s | 1 | `adversarial-duel.humaneval-87.1.mwpmqeak` |
| `humaneval-87` | Advisor | 1 | passed | 1 of 1 | 9,990 | 5.2 s | 1 | `advisor.humaneval-87.1.mwpmqgz6` |
| `humaneval-87` | Deep Reasoning | 1 | passed | 1 of 1 | 27,381 | 18.4 s | 1 | `deep-reasoning.humaneval-87.1.mwpmql5c` |
| `humaneval-87` | Full Agent Pipeline | 1 | passed | 1 of 1 | 27,479 | 20.2 s | 1 | `full-agent-pipeline.humaneval-87.1.mwpmqqwh` |
| `humaneval-115` | Direct | 1 | passed | 1 of 1 | 1,722 | 5.3 s | - | `direct.humaneval-115.1.mwpmqx7d` |
| `humaneval-115` | Ralph Loop | 1 | passed | 1 of 1 | 8,291 | 5.4 s | 1 | `ralph-loop.humaneval-115.1.mwpmqzfy` |
| `humaneval-115` | Execute & Evaluate | 1 | passed | 1 of 1 | 15,364 | 11.0 s | 1 | `exec-eval.humaneval-115.1.mwpmr1ek` |
| `humaneval-115` | Plan & Execute | 1 | passed | 1 of 1 | 14,354 | 10.6 s | 1 | `plan-execute.humaneval-115.1.mwpmr3rn` |
| `humaneval-115` | Reflexion | 1 | passed | 1 of 1 | 16,633 | 13.4 s | 1 | `reflexion.humaneval-115.1.mwpmr6nk` |
| `humaneval-115` | Supervised Coder | 1 | passed | 1 of 1 | 22,221 | 18.3 s | 1 | `supervised-coder.humaneval-115.1.mwpmra3y` |
| `humaneval-115` | Adversarial Duel | 1 | passed | 1 of 1 | 31,595 | 25.1 s | 1 | `adversarial-duel.humaneval-115.1.mwpmrc1b` |
| `humaneval-115` | Advisor | 1 | passed | 1 of 1 | 10,497 | 5.6 s | 1 | `advisor.humaneval-115.1.mwpmrh4y` |
| `humaneval-115` | Deep Reasoning | 1 | passed | 1 of 1 | 22,659 | 18.7 s | 1 | `deep-reasoning.humaneval-115.1.mwpmrlm8` |
| `humaneval-115` | Full Agent Pipeline | 1 | passed | 1 of 1 | 24,167 | 20.6 s | 1 | `full-agent-pipeline.humaneval-115.1.mwpmrocv` |
| `humaneval-160` | Direct | 1 | passed | 1 of 1 | 1,970 | 8.5 s | - | `direct.humaneval-160.1.mwpmrvlc` |
| `humaneval-160` | Ralph Loop | 1 | passed | 1 of 1 | 9,300 | 8.9 s | 1 | `ralph-loop.humaneval-160.1.mwpms08w` |
| `humaneval-160` | Execute & Evaluate | 1 | passed | 1 of 1 | 21,150 | 15.1 s | 1 | `exec-eval.humaneval-160.1.mwpms28k` |
| `humaneval-160` | Plan & Execute | 1 | passed | 1 of 1 | 16,332 | 16.0 s | 1 | `plan-execute.humaneval-160.1.mwpms4dx` |
| `humaneval-160` | Reflexion | 1 | passed | 1 of 1 | 18,509 | 16.4 s | 1 | `reflexion.humaneval-160.1.mwpms78b` |
| `humaneval-160` | Supervised Coder | 1 | passed | 1 of 1 | 25,398 | 23.4 s | 1 | `supervised-coder.humaneval-160.1.mwpmse1l` |
| `humaneval-160` | Adversarial Duel | 1 | passed | 1 of 1 | 31,629 | 24.8 s | 1 | `adversarial-duel.humaneval-160.1.mwpmsgup` |
| `humaneval-160` | Advisor | 1 | passed | 1 of 1 | 13,809 | 6.3 s | 1 | `advisor.humaneval-160.1.mwpmsk0c` |
| `humaneval-160` | Deep Reasoning | 1 | passed | 1 of 1 | 25,511 | 24.2 s | 1 | `deep-reasoning.humaneval-160.1.mwpmsozm` |
| `humaneval-160` | Full Agent Pipeline | 1 | passed | 1 of 1 | 21,190 | 18.4 s | 1 | `full-agent-pipeline.humaneval-160.1.mwpmswah` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:50:17.412Z from 50 recorded attempts.
