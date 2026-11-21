# gsm8k-5-seed7-gpt54nano-v2-all

> On five gsm8k problems and openai/gpt-5.4-nano, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `gsm8k-gpt54nano-v2.yaml`, hash `278214052370debd841cbf691a6a0606ec61b4e6e882a2455eb512d52d7a96ea`, locked 2026-11-20T23:52:16.980Z before its first attempt.
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
| Direct | direct | 5 of 5 | 57% to 100% | 354 | 2.0 s | - |
| Ralph Loop | baseline | 3 of 5 | 23% to 88% | 1,900 | 2.6 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 11,456 | 11.2 s | - |
| Plan & Execute | arm | 4 of 5 | 38% to 96% | 3,507 | 5.0 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 8,090 | 10.2 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 8,238 | 10.3 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 15,242 | 14.8 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 2,177 | 2.4 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 7,764 | 10.3 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 7,743 | 12.1 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-82` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-689` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-922` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-1288` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 3 of 5 (23% to 88%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 82 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Ralph Loop 3 of 5 (23% to 88%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 15 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

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
| `gsm8k-15` | Direct | 1 | passed | 1 of 1 | 354 | 2.0 s | - | `direct.gsm8k-15.1.mwpmvuyf` |
| `gsm8k-15` | Ralph Loop | 1 | passed | 1 of 1 | 2,055 | 2.9 s | 1 | `ralph-loop.gsm8k-15.1.mwpmvuyx` |
| `gsm8k-15` | Execute & Evaluate | 1 | passed | 1 of 1 | 5,160 | 8.1 s | 1 | `exec-eval.gsm8k-15.1.mwpmvva0` |
| `gsm8k-15` | Plan & Execute | 1 | passed | 1 of 1 | 3,337 | 4.3 s | 1 | `plan-execute.gsm8k-15.1.mwpmvwt3` |
| `gsm8k-15` | Reflexion | 1 | passed | 1 of 1 | 6,104 | 8.3 s | 1 | `reflexion.gsm8k-15.1.mwpmvxfo` |
| `gsm8k-15` | Supervised Coder | 1 | passed | 1 of 1 | 7,638 | 10.0 s | 1 | `supervised-coder.gsm8k-15.1.mwpmw0gf` |
| `gsm8k-15` | Adversarial Duel | 1 | passed | 1 of 1 | 11,693 | 12.3 s | 1 | `adversarial-duel.gsm8k-15.1.mwpmw1q1` |
| `gsm8k-15` | Advisor | 1 | passed | 1 of 1 | 2,118 | 2.1 s | 1 | `advisor.gsm8k-15.1.mwpmw41f` |
| `gsm8k-15` | Deep Reasoning | 1 | passed | 1 of 1 | 8,839 | 10.5 s | 1 | `deep-reasoning.gsm8k-15.1.mwpmw5v3` |
| `gsm8k-15` | Full Agent Pipeline | 1 | passed | 1 of 1 | 8,244 | 12.3 s | 1 | `full-agent-pipeline.gsm8k-15.1.mwpmw8cx` |
| `gsm8k-82` | Direct | 1 | passed | 1 of 1 | 254 | 1.8 s | - | `direct.gsm8k-82.1.mwpmwbfd` |
| `gsm8k-82` | Ralph Loop | 1 | passed | 1 of 1 | 1,900 | 2.3 s | 1 | `ralph-loop.gsm8k-82.1.mwpmwd0i` |
| `gsm8k-82` | Execute & Evaluate | 1 | passed | 1 of 1 | 6,755 | 8.1 s | 1 | `exec-eval.gsm8k-82.1.mwpmwe7o` |
| `gsm8k-82` | Plan & Execute | 1 | passed | 1 of 1 | 3,079 | 3.8 s | 1 | `plan-execute.gsm8k-82.1.mwpmwf9v` |
| `gsm8k-82` | Reflexion | 1 | passed | 1 of 1 | 8,803 | 10.2 s | 1 | `reflexion.gsm8k-82.1.mwpmwi22` |
| `gsm8k-82` | Supervised Coder | 1 | passed | 1 of 1 | 7,627 | 9.6 s | 1 | `supervised-coder.gsm8k-82.1.mwpmwif8` |
| `gsm8k-82` | Adversarial Duel | 1 | passed | 1 of 1 | 15,680 | 14.8 s | 1 | `adversarial-duel.gsm8k-82.1.mwpmwkoz` |
| `gsm8k-82` | Advisor | 1 | passed | 1 of 1 | 1,945 | 1.9 s | 1 | `advisor.gsm8k-82.1.mwpmwq3b` |
| `gsm8k-82` | Deep Reasoning | 1 | passed | 1 of 1 | 7,664 | 9.1 s | 1 | `deep-reasoning.gsm8k-82.1.mwpmwqbh` |
| `gsm8k-82` | Full Agent Pipeline | 1 | passed | 1 of 1 | 8,561 | 11.4 s | 1 | `full-agent-pipeline.gsm8k-82.1.mwpmwrwk` |
| `gsm8k-689` | Direct | 1 | passed | 1 of 1 | 404 | 2.1 s | - | `direct.gsm8k-689.1.mwpmwwla` |
| `gsm8k-689` | Ralph Loop | 1 | passed | 1 of 1 | 2,047 | 3.3 s | 1 | `ralph-loop.gsm8k-689.1.mwpmwxnp` |
| `gsm8k-689` | Execute & Evaluate | 1 | passed | 1 of 1 | 14,417 | 12.8 s | 1 | `exec-eval.gsm8k-689.1.mwpmwygo` |
| `gsm8k-689` | Plan & Execute | 1 | passed | 1 of 1 | 3,542 | 5.0 s | 1 | `plan-execute.gsm8k-689.1.mwpmx0gc` |
| `gsm8k-689` | Reflexion | 1 | passed | 1 of 1 | 9,001 | 10.6 s | 1 | `reflexion.gsm8k-689.1.mwpmx0y8` |
| `gsm8k-689` | Supervised Coder | 1 | passed | 1 of 1 | 8,770 | 11.3 s | 1 | `supervised-coder.gsm8k-689.1.mwpmx4q2` |
| `gsm8k-689` | Adversarial Duel | 1 | passed | 1 of 1 | 15,242 | 15.5 s | 1 | `adversarial-duel.gsm8k-689.1.mwpmx8mh` |
| `gsm8k-689` | Advisor | 1 | passed | 1 of 1 | 2,212 | 2.9 s | 1 | `advisor.gsm8k-689.1.mwpmx9d5` |
| `gsm8k-689` | Deep Reasoning | 1 | passed | 1 of 1 | 8,694 | 12.0 s | 1 | `deep-reasoning.gsm8k-689.1.mwpmxbt9` |
| `gsm8k-689` | Full Agent Pipeline | 1 | passed | 1 of 1 | 7,743 | 12.9 s | 1 | `full-agent-pipeline.gsm8k-689.1.mwpmxdnv` |
| `gsm8k-922` | Direct | 1 | passed | 1 of 1 | 305 | 1.7 s | - | `direct.gsm8k-922.1.mwpmxkue` |
| `gsm8k-922` | Ralph Loop | 1 | failed | 0 of 1 | 914 | 1.5 s | 1 | `ralph-loop.gsm8k-922.1.mwpmxlai` |
| `gsm8k-922` | Execute & Evaluate | 1 | passed | 1 of 1 | 11,456 | 11.2 s | 1 | `exec-eval.gsm8k-922.1.mwpmxme3` |
| `gsm8k-922` | Plan & Execute | 1 | passed | 1 of 1 | 3,507 | 5.2 s | 1 | `plan-execute.gsm8k-922.1.mwpmxmx1` |
| `gsm8k-922` | Reflexion | 1 | passed | 1 of 1 | 5,747 | 8.0 s | 1 | `reflexion.gsm8k-922.1.mwpmxnu4` |
| `gsm8k-922` | Supervised Coder | 1 | passed | 1 of 1 | 8,238 | 10.3 s | 1 | `supervised-coder.gsm8k-922.1.mwpmxr9s` |
| `gsm8k-922` | Adversarial Duel | 1 | passed | 1 of 1 | 11,993 | 12.8 s | 1 | `adversarial-duel.gsm8k-922.1.mwpmxugd` |
| `gsm8k-922` | Advisor | 1 | passed | 1 of 1 | 2,177 | 2.4 s | 1 | `advisor.gsm8k-922.1.mwpmxvdf` |
| `gsm8k-922` | Deep Reasoning | 1 | passed | 1 of 1 | 7,764 | 10.3 s | 1 | `deep-reasoning.gsm8k-922.1.mwpmxxny` |
| `gsm8k-922` | Full Agent Pipeline | 1 | passed | 1 of 1 | 7,701 | 11.4 s | 1 | `full-agent-pipeline.gsm8k-922.1.mwpmxzfa` |
| `gsm8k-1288` | Direct | 1 | passed | 1 of 1 | 482 | 2.6 s | - | `direct.gsm8k-1288.1.mwpmy4lq` |
| `gsm8k-1288` | Ralph Loop | 1 | failed | 0 of 1 | 1,175 | 2.6 s | 1 | `ralph-loop.gsm8k-1288.1.mwpmy5yw` |
| `gsm8k-1288` | Execute & Evaluate | 1 | passed | 1 of 1 | 14,304 | 17.1 s | 2 | `exec-eval.gsm8k-1288.1.mwpmy6vv` |
| `gsm8k-1288` | Plan & Execute | 1 | failed | 0 of 1 | 3,691 | 6.1 s | 1 | `plan-execute.gsm8k-1288.1.mwpmy8ex` |
| `gsm8k-1288` | Reflexion | 1 | passed | 1 of 1 | 8,090 | 10.5 s | 1 | `reflexion.gsm8k-1288.1.mwpmy8nw` |
| `gsm8k-1288` | Supervised Coder | 1 | passed | 1 of 1 | 15,463 | 23.2 s | 2 | `supervised-coder.gsm8k-1288.1.mwpmydrm` |
| `gsm8k-1288` | Adversarial Duel | 1 | passed | 1 of 1 | 31,453 | 33.2 s | 2 | `adversarial-duel.gsm8k-1288.1.mwpmyh0m` |
| `gsm8k-1288` | Advisor | 1 | passed | 1 of 1 | 2,179 | 2.7 s | 1 | `advisor.gsm8k-1288.1.mwpmykcs` |
| `gsm8k-1288` | Deep Reasoning | 1 | passed | 1 of 1 | 7,480 | 9.7 s | 1 | `deep-reasoning.gsm8k-1288.1.mwpmymou` |
| `gsm8k-1288` | Full Agent Pipeline | 1 | passed | 1 of 1 | 7,470 | 12.1 s | 1 | `full-agent-pipeline.gsm8k-1288.1.mwpmyun7` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:54:52.386Z from 50 recorded attempts.
