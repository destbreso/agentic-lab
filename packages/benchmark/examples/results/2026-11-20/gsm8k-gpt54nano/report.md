# gsm8k-5-seed7-gpt54nano-all

> On five gsm8k problems and openai/gpt-5.4-nano, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `gsm8k-gpt54nano.yaml`, hash `11619cf3503bcd1a46db2266b5f3adb4ae751c3e014aafc49291471a300188b7`, locked 2026-11-20T23:35:21.612Z before its first attempt.
- **Tasks:** gsm8k-5-seed7 (`../tasks-v2/gsm8k-5-seed7.yaml`), 5 tasks: GSM8K (OpenAI, MIT): grade-school math word problems, each with one numeric answer, checked exactly against the dataset's answer, which no role sees. 5 of the file's 1319 problems, chosen with seed 7. Source: GSM8K, https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl, licence MIT (https://github.com/openai/grade-school-math/blob/master/LICENSE), file sha256 `3730d312f6e3440559ace48831e51066acaca737f6eabec99bccb9e4b3c39d14`.
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
| Direct | direct | 5 of 5 | 57% to 100% | 288 | 1.5 s | - |
| Ralph Loop | baseline | 1 of 5 | 4% to 62% | 2,067 | 2.1 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 12,546 | 12.4 s | - |
| Plan & Execute | arm | 2 of 5 | 12% to 77% | 6,649 | 6.3 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 17,127 | 17.3 s | - |
| Supervised Coder | arm | 4 of 5 | 38% to 96% | 26,124 | 24.1 s | - |
| Adversarial Duel | arm | 4 of 5 | 38% to 96% | 14,218 | 12.5 s | - |
| Advisor | arm | 0 of 5 | 0% to 43% | 2,174 | 2.1 s | - |
| Deep Reasoning | arm | 4 of 5 | 38% to 96% | 10,395 | 10.5 s | - |
| Full Agent Pipeline | arm | 4 of 5 | 38% to 96% | 8,177 | 10.8 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `gsm8k-82` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `gsm8k-689` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `gsm8k-922` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| `gsm8k-1288` | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 1 of 5 (4% to 62%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-80 points) would take about 5 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 2 of 5 (12% to 77%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** against: on these tasks and this model, Advisor passed less often than Direct. Advisor passed 0 of 5 (0% to 43%) and Direct 5 of 5 (57% to 100%), and Advisor's 95% interval lies wholly below Direct's.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+80 points) would take about 5 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 2 of 5 (12% to 77%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 82 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+80 points) would take about 5 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 4 of 5 (38% to 96%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 10 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 4 of 5 (38% to 96%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 10 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 0 of 5 (0% to 43%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 4 of 5 (38% to 96%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 10 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 4 of 5 (38% to 96%) and Ralph Loop 1 of 5 (4% to 62%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 10 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

## What this does not show

- **One model.** Every role of every arm ran on `openai/gpt-5.4-nano`. Another model, or different models in different roles, may order the arms differently.
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
| `gsm8k-15` | Direct | 1 | passed | 1 of 1 | 388 | 2.4 s | - | `direct.gsm8k-15.1.mwpma3je` |
| `gsm8k-15` | Ralph Loop | 1 | failed | 0 of 1 | 2,067 | 2.1 s | 1 | `ralph-loop.gsm8k-15.1.mwpma3kb` |
| `gsm8k-15` | Execute & Evaluate | 1 | passed | 1 of 1 | 15,631 | 14.8 s | 2 | `exec-eval.gsm8k-15.1.mwpma3p2` |
| `gsm8k-15` | Plan & Execute | 1 | passed | 1 of 1 | 10,624 | 8.5 s | 1 | `plan-execute.gsm8k-15.1.mwpma5ou` |
| `gsm8k-15` | Reflexion | 1 | passed | 1 of 1 | 28,192 | 29.1 s | 3 | `reflexion.gsm8k-15.1.mwpma5l1` |
| `gsm8k-15` | Supervised Coder | 1 | passed | 1 of 1 | 27,265 | 24.3 s | 2 | `supervised-coder.gsm8k-15.1.mwpmacnm` |
| `gsm8k-15` | Adversarial Duel | 1 | passed | 1 of 1 | 34,725 | 27.3 s | 2 | `adversarial-duel.gsm8k-15.1.mwpmafnk` |
| `gsm8k-15` | Advisor | 1 | failed | 0 of 1 | 2,189 | 1.7 s | 1 | `advisor.gsm8k-15.1.mwpmasjw` |
| `gsm8k-15` | Deep Reasoning | 1 | passed | 1 of 1 | 24,346 | 24.4 s | 2 | `deep-reasoning.gsm8k-15.1.mwpmau0i` |
| `gsm8k-15` | Full Agent Pipeline | 1 | passed | 1 of 1 | 9,175 | 10.8 s | 1 | `full-agent-pipeline.gsm8k-15.1.mwpmavkn` |
| `gsm8k-82` | Direct | 1 | passed | 1 of 1 | 191 | 1.1 s | - | `direct.gsm8k-82.1.mwpmb123` |
| `gsm8k-82` | Ralph Loop | 1 | failed | 0 of 1 | 1,938 | 1.6 s | 1 | `ralph-loop.gsm8k-82.1.mwpmb242` |
| `gsm8k-82` | Execute & Evaluate | 1 | passed | 1 of 1 | 11,002 | 11.1 s | 2 | `exec-eval.gsm8k-82.1.mwpmb3mq` |
| `gsm8k-82` | Plan & Execute | 1 | failed | 0 of 1 | 6,529 | 6.3 s | 1 | `plan-execute.gsm8k-82.1.mwpmb4co` |
| `gsm8k-82` | Reflexion | 1 | passed | 1 of 1 | 13,387 | 14.6 s | 2 | `reflexion.gsm8k-82.1.mwpmb9r5` |
| `gsm8k-82` | Supervised Coder | 1 | passed | 1 of 1 | 26,124 | 24.1 s | 2 | `supervised-coder.gsm8k-82.1.mwpmbco5` |
| `gsm8k-82` | Adversarial Duel | 1 | passed | 1 of 1 | 12,170 | 11.3 s | 1 | `adversarial-duel.gsm8k-82.1.mwpmbd8o` |
| `gsm8k-82` | Advisor | 1 | failed | 0 of 1 | 2,030 | 1.6 s | 1 | `advisor.gsm8k-82.1.mwpmblba` |
| `gsm8k-82` | Deep Reasoning | 1 | passed | 1 of 1 | 6,700 | 7.0 s | 1 | `deep-reasoning.gsm8k-82.1.mwpmbm70` |
| `gsm8k-82` | Full Agent Pipeline | 1 | passed | 1 of 1 | 7,606 | 9.6 s | 1 | `full-agent-pipeline.gsm8k-82.1.mwpmbmuw` |
| `gsm8k-689` | Direct | 1 | passed | 1 of 1 | 306 | 1.9 s | - | `direct.gsm8k-689.1.mwpmbs4e` |
| `gsm8k-689` | Ralph Loop | 1 | failed | 0 of 1 | 2,097 | 2.5 s | 1 | `ralph-loop.gsm8k-689.1.mwpmbu30` |
| `gsm8k-689` | Execute & Evaluate | 1 | passed | 1 of 1 | 14,150 | 13.0 s | 2 | `exec-eval.gsm8k-689.1.mwpmbusu` |
| `gsm8k-689` | Plan & Execute | 1 | failed | 0 of 1 | 7,469 | 7.1 s | 1 | `plan-execute.gsm8k-689.1.mwpmbvnf` |
| `gsm8k-689` | Reflexion | 1 | passed | 1 of 1 | 17,381 | 17.9 s | 2 | `reflexion.gsm8k-689.1.mwpmbw71` |
| `gsm8k-689` | Supervised Coder | 1 | passed | 1 of 1 | 10,282 | 10.6 s | 1 | `supervised-coder.gsm8k-689.1.mwpmc1ef` |
| `gsm8k-689` | Adversarial Duel | 1 | passed | 1 of 1 | 14,218 | 12.5 s | 1 | `adversarial-duel.gsm8k-689.1.mwpmc55w` |
| `gsm8k-689` | Advisor | 1 | failed | 0 of 1 | 2,174 | 2.3 s | 1 | `advisor.gsm8k-689.1.mwpmc9t6` |
| `gsm8k-689` | Deep Reasoning | 1 | passed | 1 of 1 | 7,444 | 8.9 s | 1 | `deep-reasoning.gsm8k-689.1.mwpmca71` |
| `gsm8k-689` | Full Agent Pipeline | 1 | passed | 1 of 1 | 8,177 | 11.2 s | 1 | `full-agent-pipeline.gsm8k-689.1.mwpmcbxk` |
| `gsm8k-922` | Direct | 1 | passed | 1 of 1 | 200 | 1.0 s | - | `direct.gsm8k-922.1.mwpmcf8c` |
| `gsm8k-922` | Ralph Loop | 1 | passed | 1 of 1 | 1,974 | 1.9 s | 1 | `ralph-loop.gsm8k-922.1.mwpmcg7i` |
| `gsm8k-922` | Execute & Evaluate | 1 | passed | 1 of 1 | 4,755 | 5.1 s | 1 | `exec-eval.gsm8k-922.1.mwpmchho` |
| `gsm8k-922` | Plan & Execute | 1 | passed | 1 of 1 | 5,062 | 5.4 s | 1 | `plan-execute.gsm8k-922.1.mwpmchxu` |
| `gsm8k-922` | Reflexion | 1 | passed | 1 of 1 | 5,465 | 6.6 s | 1 | `reflexion.gsm8k-922.1.mwpmckzq` |
| `gsm8k-922` | Supervised Coder | 1 | passed | 1 of 1 | 7,852 | 8.6 s | 1 | `supervised-coder.gsm8k-922.1.mwpmclmn` |
| `gsm8k-922` | Adversarial Duel | 1 | passed | 1 of 1 | 12,420 | 11.7 s | 1 | `adversarial-duel.gsm8k-922.1.mwpmcmjr` |
| `gsm8k-922` | Advisor | 1 | failed | 0 of 1 | 2,068 | 2.1 s | 1 | `advisor.gsm8k-922.1.mwpmcqe8` |
| `gsm8k-922` | Deep Reasoning | 1 | passed | 1 of 1 | 10,395 | 10.5 s | 1 | `deep-reasoning.gsm8k-922.1.mwpmcseb` |
| `gsm8k-922` | Full Agent Pipeline | 1 | passed | 1 of 1 | 7,699 | 9.6 s | 1 | `full-agent-pipeline.gsm8k-922.1.mwpmcsj4` |
| `gsm8k-1288` | Direct | 1 | passed | 1 of 1 | 288 | 1.5 s | - | `direct.gsm8k-1288.1.mwpmcvvf` |
| `gsm8k-1288` | Ralph Loop | 1 | failed | 0 of 1 | 2,189 | 2.5 s | 1 | `ralph-loop.gsm8k-1288.1.mwpmcx9k` |
| `gsm8k-1288` | Execute & Evaluate | 1 | passed | 1 of 1 | 12,546 | 12.4 s | 2 | `exec-eval.gsm8k-1288.1.mwpmczew` |
| `gsm8k-1288` | Plan & Execute | 1 | failed | 0 of 1 | 6,649 | 6.3 s | 1 | `plan-execute.gsm8k-1288.1.mwpmd0hi` |
| `gsm8k-1288` | Reflexion | 1 | passed | 1 of 1 | 17,127 | 17.3 s | 2 | `reflexion.gsm8k-1288.1.mwpmd0ri` |
| `gsm8k-1288` | Supervised Coder | 1 | failed | 0 of 1 | 40,050 | 39.0 s | 3 | `supervised-coder.gsm8k-1288.1.mwpmd5lq` |
| `gsm8k-1288` | Adversarial Duel | 1 | failed | 0 of 1 | 57,937 | 44.3 s | 3 | `adversarial-duel.gsm8k-1288.1.mwpmd97w` |
| `gsm8k-1288` | Advisor | 1 | failed | 0 of 1 | 3,275 | 3.2 s | 1 | `advisor.gsm8k-1288.1.mwpmdei0` |
| `gsm8k-1288` | Deep Reasoning | 1 | failed | 0 of 1 | 36,216 | 38.3 s | 3 | `deep-reasoning.gsm8k-1288.1.mwpmdh64` |
| `gsm8k-1288` | Full Agent Pipeline | 1 | failed | 0 of 1 | 39,066 | 39.5 s | 3 | `full-agent-pipeline.gsm8k-1288.1.mwpme027` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:39:03.566Z from 50 recorded attempts.
