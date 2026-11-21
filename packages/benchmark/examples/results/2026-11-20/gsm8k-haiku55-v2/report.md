# gsm8k-5-seed7-haiku55-v2-all

> On five gsm8k problems and anthropic/claude-haiku-5-5, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `gsm8k-haiku55-v2.yaml`, hash `23bd579ee1b32aa3e4982e922939133c9e0d76fdef9a40c62ccf5d87c11d78f9`, locked 2026-11-20T23:50:18.395Z before its first attempt.
- **Tasks:** gsm8k-5-seed7 (`../tasks-v2/gsm8k-5-seed7.yaml`), 5 tasks: GSM8K (OpenAI, MIT): grade-school math word problems, each with one numeric answer, checked exactly against the dataset's answer, which no role sees. 5 of the file's 1319 problems, chosen with seed 7. Source: GSM8K, https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl, licence MIT (https://github.com/openai/grade-school-math/blob/master/LICENSE), file sha256 `3730d312f6e3440559ace48831e51066acaca737f6eabec99bccb9e4b3c39d14`.
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
| Direct | direct | 5 of 5 | 57% to 100% | 557 | 2.0 s | - |
| Ralph Loop | baseline | 5 of 5 | 57% to 100% | 4,321 | 2.3 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 9,784 | 6.9 s | - |
| Plan & Execute | arm | 5 of 5 | 57% to 100% | 7,138 | 5.9 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 10,798 | 8.8 s | - |
| Supervised Coder | arm | 4 of 5 | 38% to 96% | 12,175 | 11.0 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 22,487 | 15.9 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 5,654 | 2.4 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 12,592 | 10.4 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 14,328 | 13.3 s | - |

Attempts that ended without a result from the checks (stopped, or the checks could not run) count as not passed: Supervised Coder 1.

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | ✓ | ✓ | ✓ | ✓ | ✓ | ? | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-82` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-689` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-922` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-1288` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 4 of 5 (38% to 96%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Ralph Loop 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.

## What this does not show

- **One model.** Every role of every arm ran on `anthropic/claude-haiku-5-5`. Another model, or different models in different roles, may order the arms differently.
- **Few runs.** 1 repetition of 5 tasks: 5 attempts per topology arm. Intervals this wide tell apart only large differences. Inconclusive means these counts cannot tell the arms apart, not that they are equal.
- **A sample of a dataset.** 5 tasks of GSM8K (5 of the file's 1319 problems, chosen with seed 7). What holds on them may not hold on the rest of the dataset, or on your own work.
- **A public task set.** GSM8K is published, so the model may have seen these problems in training. That can raise every arm's count, the direct arm's above all, since it answers from what the model remembers.
- **Attempts are not independent draws.** Each interval treats every attempt as one independent try. Attempts on the same task share its difficulty, so the real uncertainty is larger than the intervals show.
- **The direct arm gets one call and no tools, by design.** It measures the model asked plainly, so the other arms show what a harness adds. Writing its answer into the task's file is the lab's doing, not the model's: the last line of its reply, or its last code block, is written where the task says, and nothing else is done to it.
- **Who hears the checks.** In the arms with a Check role, Check's verdict is the lab's measured check, so on a way back Do learns whether the checks passed and what they printed (never the checks themselves). The direct arm and the Ralph Loop get no such signal. This compares the topologies as Jig runs them by default, not the roles' reasoning alone.
- **No best-of-N baseline yet.** Best-of-N at the same budget (independent single-loop attempts until the budget is spent, kept if any passes the checks) is planned and not built.
- **Tokens and time, not money.** No prices are applied. Time is wall-clock on one machine and depends on whatever else it was running.

## Runs

<details><summary>Every attempt with its run id</summary>

| Task | Arm | # | Outcome | Checks | Tokens | Time | Rounds | Run id |
|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | Direct | 1 | passed | 1 of 1 | 582 | 2.1 s | - | `direct.gsm8k-15.1.mwpmtbcv` |
| `gsm8k-15` | Ralph Loop | 1 | passed | 1 of 1 | 4,321 | 2.4 s | 1 | `ralph-loop.gsm8k-15.1.mwpmtbdt` |
| `gsm8k-15` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,784 | 6.5 s | 1 | `exec-eval.gsm8k-15.1.mwpmtbeg` |
| `gsm8k-15` | Plan & Execute | 1 | passed | 1 of 1 | 7,138 | 5.9 s | 1 | `plan-execute.gsm8k-15.1.mwpmtd6k` |
| `gsm8k-15` | Reflexion | 1 | passed | 1 of 1 | 10,960 | 8.1 s | 1 | `reflexion.gsm8k-15.1.mwpmtdcd` |
| `gsm8k-15` | Supervised Coder | 1 | stopped | 0 of 1 | 2,115 | 3.7 s | 1 | `supervised-coder.gsm8k-15.1.mwpmtgni` |
| `gsm8k-15` | Adversarial Duel | 1 | passed | 1 of 1 | 24,901 | 17.4 s | 1 | `adversarial-duel.gsm8k-15.1.mwpmthvu` |
| `gsm8k-15` | Advisor | 1 | passed | 1 of 1 | 5,666 | 2.1 s | 1 | `advisor.gsm8k-15.1.mwpmtjlf` |
| `gsm8k-15` | Deep Reasoning | 1 | passed | 1 of 1 | 12,471 | 9.6 s | 1 | `deep-reasoning.gsm8k-15.1.mwpmtjqp` |
| `gsm8k-15` | Full Agent Pipeline | 1 | passed | 1 of 1 | 14,328 | 13.3 s | 1 | `full-agent-pipeline.gsm8k-15.1.mwpmtlee` |
| `gsm8k-82` | Direct | 1 | passed | 1 of 1 | 286 | 1.1 s | - | `direct.gsm8k-82.1.mwpmtrcu` |
| `gsm8k-82` | Ralph Loop | 1 | passed | 1 of 1 | 4,002 | 1.8 s | 1 | `ralph-loop.gsm8k-82.1.mwpmtsaa` |
| `gsm8k-82` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,248 | 6.5 s | 1 | `exec-eval.gsm8k-82.1.mwpmtts2` |
| `gsm8k-82` | Plan & Execute | 1 | passed | 1 of 1 | 6,476 | 4.8 s | 1 | `plan-execute.gsm8k-82.1.mwpmtvfq` |
| `gsm8k-82` | Reflexion | 1 | passed | 1 of 1 | 10,463 | 8.9 s | 1 | `reflexion.gsm8k-82.1.mwpmtvt8` |
| `gsm8k-82` | Supervised Coder | 1 | passed | 1 of 1 | 12,263 | 9.3 s | 1 | `supervised-coder.gsm8k-82.1.mwpmtyvd` |
| `gsm8k-82` | Adversarial Duel | 1 | passed | 1 of 1 | 19,721 | 13.6 s | 1 | `adversarial-duel.gsm8k-82.1.mwpmtz9k` |
| `gsm8k-82` | Advisor | 1 | passed | 1 of 1 | 5,409 | 1.8 s | 1 | `advisor.gsm8k-82.1.mwpmu2u2` |
| `gsm8k-82` | Deep Reasoning | 1 | passed | 1 of 1 | 12,592 | 9.8 s | 1 | `deep-reasoning.gsm8k-82.1.mwpmu4at` |
| `gsm8k-82` | Full Agent Pipeline | 1 | passed | 1 of 1 | 13,300 | 11.4 s | 1 | `full-agent-pipeline.gsm8k-82.1.mwpmu672` |
| `gsm8k-689` | Direct | 1 | passed | 1 of 1 | 557 | 2.0 s | - | `direct.gsm8k-689.1.mwpmu9xh` |
| `gsm8k-689` | Ralph Loop | 1 | passed | 1 of 1 | 6,678 | 3.5 s | 1 | `ralph-loop.gsm8k-689.1.mwpmubk5` |
| `gsm8k-689` | Execute & Evaluate | 1 | passed | 1 of 1 | 10,122 | 6.9 s | 1 | `exec-eval.gsm8k-689.1.mwpmubz0` |
| `gsm8k-689` | Plan & Execute | 1 | passed | 1 of 1 | 7,140 | 6.8 s | 1 | `plan-execute.gsm8k-689.1.mwpmuecf` |
| `gsm8k-689` | Reflexion | 1 | passed | 1 of 1 | 10,798 | 8.8 s | 1 | `reflexion.gsm8k-689.1.mwpmuf54` |
| `gsm8k-689` | Supervised Coder | 1 | passed | 1 of 1 | 12,175 | 11.1 s | 1 | `supervised-coder.gsm8k-689.1.mwpmuhfm` |
| `gsm8k-689` | Adversarial Duel | 1 | passed | 1 of 1 | 23,512 | 15.9 s | 1 | `adversarial-duel.gsm8k-689.1.mwpmujpu` |
| `gsm8k-689` | Advisor | 1 | passed | 1 of 1 | 5,624 | 2.4 s | 1 | `advisor.gsm8k-689.1.mwpmum28` |
| `gsm8k-689` | Deep Reasoning | 1 | passed | 1 of 1 | 12,794 | 10.4 s | 1 | `deep-reasoning.gsm8k-689.1.mwpmuo2c` |
| `gsm8k-689` | Full Agent Pipeline | 1 | passed | 1 of 1 | 13,683 | 13.3 s | 1 | `full-agent-pipeline.gsm8k-689.1.mwpmuq48` |
| `gsm8k-922` | Direct | 1 | passed | 1 of 1 | 504 | 2.4 s | - | `direct.gsm8k-922.1.mwpmuw5y` |
| `gsm8k-922` | Ralph Loop | 1 | passed | 1 of 1 | 4,116 | 2.0 s | 1 | `ralph-loop.gsm8k-922.1.mwpmuw9w` |
| `gsm8k-922` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,558 | 7.0 s | 1 | `exec-eval.gsm8k-922.1.mwpmuxz0` |
| `gsm8k-922` | Plan & Execute | 1 | passed | 1 of 1 | 6,547 | 5.1 s | 1 | `plan-execute.gsm8k-922.1.mwpmuy4b` |
| `gsm8k-922` | Reflexion | 1 | passed | 1 of 1 | 10,371 | 8.2 s | 1 | `reflexion.gsm8k-922.1.mwpmv0hq` |
| `gsm8k-922` | Supervised Coder | 1 | passed | 1 of 1 | 11,923 | 11.0 s | 1 | `supervised-coder.gsm8k-922.1.mwpmv26f` |
| `gsm8k-922` | Adversarial Duel | 1 | passed | 1 of 1 | 19,498 | 15.5 s | 1 | `adversarial-duel.gsm8k-922.1.mwpmv3h7` |
| `gsm8k-922` | Advisor | 1 | passed | 1 of 1 | 5,654 | 2.4 s | 1 | `advisor.gsm8k-922.1.mwpmv6zk` |
| `gsm8k-922` | Deep Reasoning | 1 | passed | 1 of 1 | 12,503 | 11.8 s | 1 | `deep-reasoning.gsm8k-922.1.mwpmv8yf` |
| `gsm8k-922` | Full Agent Pipeline | 1 | passed | 1 of 1 | 14,677 | 15.2 s | 1 | `full-agent-pipeline.gsm8k-922.1.mwpmvat7` |
| `gsm8k-1288` | Direct | 1 | passed | 1 of 1 | 605 | 2.0 s | - | `direct.gsm8k-1288.1.mwpmvfms` |
| `gsm8k-1288` | Ralph Loop | 1 | passed | 1 of 1 | 4,372 | 2.3 s | 1 | `ralph-loop.gsm8k-1288.1.mwpmvhcw` |
| `gsm8k-1288` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,798 | 7.1 s | 1 | `exec-eval.gsm8k-1288.1.mwpmvi8x` |
| `gsm8k-1288` | Plan & Execute | 1 | passed | 1 of 1 | 7,526 | 7.5 s | 1 | `plan-execute.gsm8k-1288.1.mwpmvjac` |
| `gsm8k-1288` | Reflexion | 1 | passed | 1 of 1 | 11,258 | 9.2 s | 1 | `reflexion.gsm8k-1288.1.mwpmvmow` |
| `gsm8k-1288` | Supervised Coder | 1 | passed | 1 of 1 | 13,508 | 12.1 s | 1 | `supervised-coder.gsm8k-1288.1.mwpmvnun` |
| `gsm8k-1288` | Adversarial Duel | 1 | passed | 1 of 1 | 22,487 | 20.6 s | 1 | `adversarial-duel.gsm8k-1288.1.mwpmvp6n` |
| `gsm8k-1288` | Advisor | 1 | passed | 1 of 1 | 5,774 | 2.5 s | 1 | `advisor.gsm8k-1288.1.mwpmvty7` |
| `gsm8k-1288` | Deep Reasoning | 1 | passed | 1 of 1 | 13,679 | 12.9 s | 1 | `deep-reasoning.gsm8k-1288.1.mwpmvvyt` |
| `gsm8k-1288` | Full Agent Pipeline | 1 | passed | 1 of 1 | 14,842 | 14.7 s | 1 | `full-agent-pipeline.gsm8k-1288.1.mwpmvxax` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:52:34.971Z from 50 recorded attempts.
