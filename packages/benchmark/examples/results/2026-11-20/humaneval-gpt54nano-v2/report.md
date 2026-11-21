# humaneval-5-seed7-gpt54nano-v2-all

> On five humaneval problems and openai/gpt-5.4-nano, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `humaneval-gpt54nano-v2.yaml`, hash `64fa3ae245b16c29cf7bfb0be83bc47159c6356347c5bbe7e767ccdce67e7dcf`, locked 2026-11-20T23:46:36.969Z before its first attempt.
- **Tasks:** humaneval-5-seed7 (`../tasks-v2/humaneval-5-seed7.yaml`), 5 tasks: HumanEval (OpenAI, MIT): Python functions to complete from their signature and docstring, each checked by the dataset's own hidden tests. 5 of the file's 164 problems, chosen with seed 7. Source: HumanEval, https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz, licence MIT (https://github.com/openai/human-eval/blob/master/LICENSE), file sha256 `b796127e635a67f93fb35c04f4cb03cf06f38c8072ee7cee8833d7bee06979ef`.
- **Model:** `openai/gpt-5.4-nano`, for every role of every arm.
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
| Direct | direct | 4 of 5 | 38% to 96% | 776 | 4.1 s | - |
| Ralph Loop | baseline | 3 of 5 | 23% to 88% | 6,902 | 8.4 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 12,706 | 16.8 s | - |
| Plan & Execute | arm | 5 of 5 | 57% to 100% | 9,674 | 13.1 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 22,334 | 27.3 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 16,356 | 18.8 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 24,237 | 24.1 s | - |
| Advisor | arm | 4 of 5 | 38% to 96% | 7,198 | 7.6 s | - |
| Deep Reasoning | arm | 4 of 5 | 38% to 96% | 19,689 | 19.8 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 20,328 | 22.0 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `humaneval-1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-11` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-87` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-115` | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `humaneval-160` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 3 of 5 (23% to 88%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 82 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 4 of 5 (38% to 96%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 4 of 5 (38% to 96%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 4 of 5 (38% to 96%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 82 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 4 of 5 (38% to 96%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 82 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

## What this does not show

- **One model.** Every role of every arm ran on `openai/gpt-5.4-nano`. Another model, or different models in different roles, may order the arms differently.
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
| `humaneval-1` | Direct | 1 | passed | 1 of 1 | 628 | 4.1 s | - | `direct.humaneval-1.1.mwpmoktj` |
| `humaneval-1` | Ralph Loop | 1 | passed | 1 of 1 | 6,272 | 8.4 s | 1 | `ralph-loop.humaneval-1.1.mwpmoksa` |
| `humaneval-1` | Execute & Evaluate | 1 | passed | 1 of 1 | 11,678 | 16.8 s | 1 | `exec-eval.humaneval-1.1.mwpmoktz` |
| `humaneval-1` | Plan & Execute | 1 | passed | 1 of 1 | 9,434 | 13.1 s | 1 | `plan-execute.humaneval-1.1.mwpmoog5` |
| `humaneval-1` | Reflexion | 1 | passed | 1 of 1 | 22,334 | 27.7 s | 2 | `reflexion.humaneval-1.1.mwpmorgd` |
| `humaneval-1` | Supervised Coder | 1 | passed | 1 of 1 | 16,098 | 19.5 s | 1 | `supervised-coder.humaneval-1.1.mwpmoyfr` |
| `humaneval-1` | Adversarial Duel | 1 | passed | 1 of 1 | 21,808 | 24.4 s | 1 | `adversarial-duel.humaneval-1.1.mwpmoz1k` |
| `humaneval-1` | Advisor | 1 | passed | 1 of 1 | 6,837 | 7.6 s | 1 | `advisor.humaneval-1.1.mwpmpdcb` |
| `humaneval-1` | Deep Reasoning | 1 | passed | 1 of 1 | 16,434 | 19.8 s | 1 | `deep-reasoning.humaneval-1.1.mwpmpdon` |
| `humaneval-1` | Full Agent Pipeline | 1 | passed | 1 of 1 | 17,673 | 21.6 s | 1 | `full-agent-pipeline.humaneval-1.1.mwpmpi7q` |
| `humaneval-11` | Direct | 1 | passed | 1 of 1 | 381 | 2.0 s | - | `direct.humaneval-11.1.mwpmpjfm` |
| `humaneval-11` | Ralph Loop | 1 | failed | 0 of 1 | 2,824 | 3.2 s | 1 | `ralph-loop.humaneval-11.1.mwpmplfk` |
| `humaneval-11` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,609 | 11.0 s | 1 | `exec-eval.humaneval-11.1.mwpmpo5p` |
| `humaneval-11` | Plan & Execute | 1 | passed | 1 of 1 | 7,008 | 10.3 s | 1 | `plan-execute.humaneval-11.1.mwpmpt7i` |
| `humaneval-11` | Reflexion | 1 | passed | 1 of 1 | 23,515 | 27.3 s | 2 | `reflexion.humaneval-11.1.mwpmpwx2` |
| `humaneval-11` | Supervised Coder | 1 | passed | 1 of 1 | 16,356 | 19.1 s | 1 | `supervised-coder.humaneval-11.1.mwpmpz3c` |
| `humaneval-11` | Adversarial Duel | 1 | passed | 1 of 1 | 27,760 | 24.1 s | 1 | `adversarial-duel.humaneval-11.1.mwpmq1ki` |
| `humaneval-11` | Advisor | 1 | passed | 1 of 1 | 5,958 | 6.4 s | 1 | `advisor.humaneval-11.1.mwpmqe8s` |
| `humaneval-11` | Deep Reasoning | 1 | passed | 1 of 1 | 19,689 | 19.6 s | 1 | `deep-reasoning.humaneval-11.1.mwpmqi78` |
| `humaneval-11` | Full Agent Pipeline | 1 | passed | 1 of 1 | 19,858 | 22.0 s | 1 | `full-agent-pipeline.humaneval-11.1.mwpmqjhl` |
| `humaneval-87` | Direct | 1 | passed | 1 of 1 | 776 | 2.7 s | - | `direct.humaneval-87.1.mwpmqkkv` |
| `humaneval-87` | Ralph Loop | 1 | passed | 1 of 1 | 6,902 | 7.6 s | 1 | `ralph-loop.humaneval-87.1.mwpmqn8b` |
| `humaneval-87` | Execute & Evaluate | 1 | passed | 1 of 1 | 12,706 | 15.0 s | 1 | `exec-eval.humaneval-87.1.mwpmqtj0` |
| `humaneval-87` | Plan & Execute | 1 | passed | 1 of 1 | 9,674 | 12.5 s | 1 | `plan-execute.humaneval-87.1.mwpmqxmj` |
| `humaneval-87` | Reflexion | 1 | passed | 1 of 1 | 16,276 | 18.0 s | 1 | `reflexion.humaneval-87.1.mwpmr0rk` |
| `humaneval-87` | Supervised Coder | 1 | passed | 1 of 1 | 15,108 | 17.9 s | 1 | `supervised-coder.humaneval-87.1.mwpmr5eu` |
| `humaneval-87` | Adversarial Duel | 1 | passed | 1 of 1 | 24,237 | 21.3 s | 1 | `adversarial-duel.humaneval-87.1.mwpmr7u0` |
| `humaneval-87` | Advisor | 1 | passed | 1 of 1 | 7,198 | 6.4 s | 1 | `advisor.humaneval-87.1.mwpmrf20` |
| `humaneval-87` | Deep Reasoning | 1 | passed | 1 of 1 | 14,842 | 17.6 s | 1 | `deep-reasoning.humaneval-87.1.mwpmrk00` |
| `humaneval-87` | Full Agent Pipeline | 1 | passed | 1 of 1 | 20,328 | 20.5 s | 1 | `full-agent-pipeline.humaneval-87.1.mwpmrk8k` |
| `humaneval-115` | Direct | 1 | failed | 0 of 1 | 1,108 | 5.0 s | - | `direct.humaneval-115.1.mwpmrol4` |
| `humaneval-115` | Ralph Loop | 1 | passed | 1 of 1 | 7,876 | 8.4 s | 1 | `ralph-loop.humaneval-115.1.mwpmrsor` |
| `humaneval-115` | Execute & Evaluate | 1 | passed | 1 of 1 | 22,279 | 17.7 s | 1 | `exec-eval.humaneval-115.1.mwpmrxts` |
| `humaneval-115` | Plan & Execute | 1 | passed | 1 of 1 | 11,516 | 13.1 s | 1 | `plan-execute.humaneval-115.1.mwpmrzk7` |
| `humaneval-115` | Reflexion | 1 | passed | 1 of 1 | 33,365 | 36.6 s | 2 | `reflexion.humaneval-115.1.mwpms08r` |
| `humaneval-115` | Supervised Coder | 1 | passed | 1 of 1 | 17,560 | 17.4 s | 1 | `supervised-coder.humaneval-115.1.mwpmsa62` |
| `humaneval-115` | Adversarial Duel | 1 | passed | 1 of 1 | 21,402 | 22.3 s | 1 | `adversarial-duel.humaneval-115.1.mwpmsboq` |
| `humaneval-115` | Advisor | 1 | failed | 0 of 1 | 7,624 | 8.6 s | 1 | `advisor.humaneval-115.1.mwpmso41` |
| `humaneval-115` | Deep Reasoning | 1 | passed | 1 of 1 | 40,373 | 48.0 s | 2 | `deep-reasoning.humaneval-115.1.mwpmssrl` |
| `humaneval-115` | Full Agent Pipeline | 1 | passed | 1 of 1 | 42,906 | 53.0 s | 2 | `full-agent-pipeline.humaneval-115.1.mwpmst38` |
| `humaneval-160` | Direct | 1 | passed | 1 of 1 | 1,200 | 5.7 s | - | `direct.humaneval-160.1.mwpmsv70` |
| `humaneval-160` | Ralph Loop | 1 | failed | 0 of 1 | 8,268 | 11.0 s | 1 | `ralph-loop.humaneval-160.1.mwpmszxs` |
| `humaneval-160` | Execute & Evaluate | 1 | passed | 1 of 1 | 38,718 | 42.5 s | 2 | `exec-eval.humaneval-160.1.mwpmt8ny` |
| `humaneval-160` | Plan & Execute | 1 | passed | 1 of 1 | 13,630 | 16.5 s | 1 | `plan-execute.humaneval-160.1.mwpmtubi` |
| `humaneval-160` | Reflexion | 1 | passed | 1 of 1 | 18,002 | 16.9 s | 1 | `reflexion.humaneval-160.1.mwpmty92` |
| `humaneval-160` | Supervised Coder | 1 | passed | 1 of 1 | 17,790 | 18.8 s | 1 | `supervised-coder.humaneval-160.1.mwpmu61u` |
| `humaneval-160` | Adversarial Duel | 1 | passed | 1 of 1 | 34,229 | 30.8 s | 1 | `adversarial-duel.humaneval-160.1.mwpmu7c8` |
| `humaneval-160` | Advisor | 1 | passed | 1 of 1 | 8,202 | 8.7 s | 1 | `advisor.humaneval-160.1.mwpmubqw` |
| `humaneval-160` | Deep Reasoning | 1 | failed | 0 of 1 | 60,351 | 61.1 s | 3 | `deep-reasoning.humaneval-160.1.mwpmuiqh` |
| `humaneval-160` | Full Agent Pipeline | 1 | passed | 1 of 1 | 28,737 | 24.9 s | 1 | `full-agent-pipeline.humaneval-160.1.mwpmukrp` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:52:15.868Z from 50 recorded attempts.
