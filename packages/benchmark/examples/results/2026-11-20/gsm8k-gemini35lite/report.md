# gsm8k-5-seed7-gemini35lite-all

> On five gsm8k problems and gemini/gemini-3.5-flash-lite, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `gsm8k-gemini35lite.yaml`, hash `03a9578511d857fcb4499bdc75cc4d943f1947b51413be7449ae4591585d6283`, locked 2026-11-20T23:33:55.477Z before its first attempt.
- **Tasks:** gsm8k-5-seed7 (`../tasks-v2/gsm8k-5-seed7.yaml`), 5 tasks: GSM8K (OpenAI, MIT): grade-school math word problems, each with one numeric answer, checked exactly against the dataset's answer, which no role sees. 5 of the file's 1319 problems, chosen with seed 7. Source: GSM8K, https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl, licence MIT (https://github.com/openai/grade-school-math/blob/master/LICENSE), file sha256 `3730d312f6e3440559ace48831e51066acaca737f6eabec99bccb9e4b3c39d14`.
- **Model:** `gemini/gemini-3.5-flash-lite`, for every role of every arm.
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
| Direct | direct | 4 of 5 | 38% to 96% | 409 | 1.2 s | - |
| Ralph Loop | baseline | 4 of 5 | 38% to 96% | 4,927 | 3.0 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 8,876 | 5.9 s | - |
| Plan & Execute | arm | 4 of 5 | 38% to 96% | 7,809 | 5.0 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 9,783 | 6.9 s | - |
| Supervised Coder | arm | 4 of 5 | 38% to 96% | 12,022 | 8.0 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 17,282 | 9.6 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 4,632 | 2.9 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 9,942 | 7.0 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 11,890 | 8.5 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-82` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-689` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-922` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-1288` | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 4 of 5 (38% to 96%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 4 of 5 (38% to 96%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Direct 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 4 of 5 (38% to 96%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

## What this does not show

- **One model.** Every role of every arm ran on `gemini/gemini-3.5-flash-lite`. Another model, or different models in different roles, may order the arms differently.
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
| `gsm8k-15` | Direct | 1 | passed | 1 of 1 | 413 | 1.2 s | - | `direct.gsm8k-15.1.mwpm88vn` |
| `gsm8k-15` | Ralph Loop | 1 | passed | 1 of 1 | 4,096 | 2.5 s | 1 | `ralph-loop.gsm8k-15.1.mwpm88xa` |
| `gsm8k-15` | Execute & Evaluate | 1 | passed | 1 of 1 | 8,876 | 5.5 s | 1 | `exec-eval.gsm8k-15.1.mwpm88wp` |
| `gsm8k-15` | Plan & Execute | 1 | passed | 1 of 1 | 7,809 | 4.7 s | 1 | `plan-execute.gsm8k-15.1.mwpm89vc` |
| `gsm8k-15` | Reflexion | 1 | passed | 1 of 1 | 9,426 | 6.1 s | 1 | `reflexion.gsm8k-15.1.mwpm8axn` |
| `gsm8k-15` | Supervised Coder | 1 | passed | 1 of 1 | 12,022 | 8.2 s | 1 | `supervised-coder.gsm8k-15.1.mwpm8d8r` |
| `gsm8k-15` | Adversarial Duel | 1 | passed | 1 of 1 | 18,361 | 9.6 s | 1 | `adversarial-duel.gsm8k-15.1.mwpm8dj1` |
| `gsm8k-15` | Advisor | 1 | passed | 1 of 1 | 4,242 | 2.3 s | 1 | `advisor.gsm8k-15.1.mwpm8fow` |
| `gsm8k-15` | Deep Reasoning | 1 | passed | 1 of 1 | 10,485 | 7.0 s | 1 | `deep-reasoning.gsm8k-15.1.mwpm8hj7` |
| `gsm8k-15` | Full Agent Pipeline | 1 | passed | 1 of 1 | 11,128 | 7.7 s | 1 | `full-agent-pipeline.gsm8k-15.1.mwpm8jo1` |
| `gsm8k-82` | Direct | 1 | passed | 1 of 1 | 297 | 1.1 s | - | `direct.gsm8k-82.1.mwpm8l1e` |
| `gsm8k-82` | Ralph Loop | 1 | passed | 1 of 1 | 4,927 | 3.0 s | 1 | `ralph-loop.gsm8k-82.1.mwpm8lwx` |
| `gsm8k-82` | Execute & Evaluate | 1 | passed | 1 of 1 | 7,901 | 5.2 s | 1 | `exec-eval.gsm8k-82.1.mwpm8n17` |
| `gsm8k-82` | Plan & Execute | 1 | passed | 1 of 1 | 6,099 | 3.9 s | 1 | `plan-execute.gsm8k-82.1.mwpm8o9x` |
| `gsm8k-82` | Reflexion | 1 | passed | 1 of 1 | 16,863 | 12.3 s | 2 | `reflexion.gsm8k-82.1.mwpm8pne` |
| `gsm8k-82` | Supervised Coder | 1 | passed | 1 of 1 | 10,962 | 7.6 s | 1 | `supervised-coder.gsm8k-82.1.mwpm8r25` |
| `gsm8k-82` | Adversarial Duel | 1 | passed | 1 of 1 | 14,377 | 8.5 s | 1 | `adversarial-duel.gsm8k-82.1.mwpm8rby` |
| `gsm8k-82` | Advisor | 1 | passed | 1 of 1 | 5,178 | 2.9 s | 1 | `advisor.gsm8k-82.1.mwpm8x0q` |
| `gsm8k-82` | Deep Reasoning | 1 | passed | 1 of 1 | 9,940 | 7.0 s | 1 | `deep-reasoning.gsm8k-82.1.mwpm8xys` |
| `gsm8k-82` | Full Agent Pipeline | 1 | passed | 1 of 1 | 9,622 | 7.1 s | 1 | `full-agent-pipeline.gsm8k-82.1.mwpm8z6u` |
| `gsm8k-689` | Direct | 1 | passed | 1 of 1 | 409 | 1.5 s | - | `direct.gsm8k-689.1.mwpm8zc8` |
| `gsm8k-689` | Ralph Loop | 1 | passed | 1 of 1 | 8,390 | 5.0 s | 1 | `ralph-loop.gsm8k-689.1.mwpm90ky` |
| `gsm8k-689` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,328 | 5.9 s | 1 | `exec-eval.gsm8k-689.1.mwpm93gc` |
| `gsm8k-689` | Plan & Execute | 1 | passed | 1 of 1 | 10,626 | 6.8 s | 1 | `plan-execute.gsm8k-689.1.mwpm94im` |
| `gsm8k-689` | Reflexion | 1 | passed | 1 of 1 | 9,783 | 6.9 s | 1 | `reflexion.gsm8k-689.1.mwpm94qp` |
| `gsm8k-689` | Supervised Coder | 1 | passed | 1 of 1 | 12,612 | 8.0 s | 1 | `supervised-coder.gsm8k-689.1.mwpm983g` |
| `gsm8k-689` | Adversarial Duel | 1 | passed | 1 of 1 | 17,282 | 9.1 s | 1 | `adversarial-duel.gsm8k-689.1.mwpm99v1` |
| `gsm8k-689` | Advisor | 1 | passed | 1 of 1 | 4,632 | 2.9 s | 1 | `advisor.gsm8k-689.1.mwpm9a5c` |
| `gsm8k-689` | Deep Reasoning | 1 | passed | 1 of 1 | 9,888 | 6.8 s | 1 | `deep-reasoning.gsm8k-689.1.mwpm9cgn` |
| `gsm8k-689` | Full Agent Pipeline | 1 | passed | 1 of 1 | 11,890 | 8.5 s | 1 | `full-agent-pipeline.gsm8k-689.1.mwpm9ec3` |
| `gsm8k-922` | Direct | 1 | passed | 1 of 1 | 308 | 1.0 s | - | `direct.gsm8k-922.1.mwpm9gxx` |
| `gsm8k-922` | Ralph Loop | 1 | passed | 1 of 1 | 3,797 | 2.7 s | 1 | `ralph-loop.gsm8k-922.1.mwpm9hqh` |
| `gsm8k-922` | Execute & Evaluate | 1 | passed | 1 of 1 | 8,356 | 6.6 s | 1 | `exec-eval.gsm8k-922.1.mwpm9huf` |
| `gsm8k-922` | Plan & Execute | 1 | passed | 1 of 1 | 7,065 | 5.0 s | 1 | `plan-execute.gsm8k-922.1.mwpm9jv5` |
| `gsm8k-922` | Reflexion | 1 | passed | 1 of 1 | 7,319 | 6.3 s | 1 | `reflexion.gsm8k-922.1.mwpm9kzc` |
| `gsm8k-922` | Supervised Coder | 1 | passed | 1 of 1 | 9,407 | 6.8 s | 1 | `supervised-coder.gsm8k-922.1.mwpm9n0e` |
| `gsm8k-922` | Adversarial Duel | 1 | passed | 1 of 1 | 16,475 | 10.3 s | 1 | `adversarial-duel.gsm8k-922.1.mwpm9nrl` |
| `gsm8k-922` | Advisor | 1 | passed | 1 of 1 | 3,946 | 2.4 s | 1 | `advisor.gsm8k-922.1.mwpm9pwv` |
| `gsm8k-922` | Deep Reasoning | 1 | passed | 1 of 1 | 9,942 | 7.3 s | 1 | `deep-reasoning.gsm8k-922.1.mwpm9rtb` |
| `gsm8k-922` | Full Agent Pipeline | 1 | passed | 1 of 1 | 12,698 | 8.6 s | 1 | `full-agent-pipeline.gsm8k-922.1.mwpm9sc2` |
| `gsm8k-1288` | Direct | 1 | failed | 0 of 1 | 511 | 1.7 s | - | `direct.gsm8k-1288.1.mwpm9vsk` |
| `gsm8k-1288` | Ralph Loop | 1 | failed | 0 of 1 | 5,830 | 3.5 s | 1 | `ralph-loop.gsm8k-1288.1.mwpm9x6h` |
| `gsm8k-1288` | Execute & Evaluate | 1 | passed | 1 of 1 | 22,525 | 13.2 s | 2 | `exec-eval.gsm8k-1288.1.mwpm9xhd` |
| `gsm8k-1288` | Plan & Execute | 1 | failed | 0 of 1 | 9,205 | 6.5 s | 1 | `plan-execute.gsm8k-1288.1.mwpm9z0s` |
| `gsm8k-1288` | Reflexion | 1 | passed | 1 of 1 | 43,351 | 22.2 s | 2 | `reflexion.gsm8k-1288.1.mwpm9zy7` |
| `gsm8k-1288` | Supervised Coder | 1 | failed | 0 of 1 | 60,179 | 34.4 s | 3 | `supervised-coder.gsm8k-1288.1.mwpma43g` |
| `gsm8k-1288` | Adversarial Duel | 1 | passed | 1 of 1 | 60,126 | 24.7 s | 2 | `adversarial-duel.gsm8k-1288.1.mwpma7pm` |
| `gsm8k-1288` | Advisor | 1 | passed | 1 of 1 | 6,124 | 4.0 s | 1 | `advisor.gsm8k-1288.1.mwpmah5f` |
| `gsm8k-1288` | Deep Reasoning | 1 | passed | 1 of 1 | 29,861 | 17.6 s | 2 | `deep-reasoning.gsm8k-1288.1.mwpmakbg` |
| `gsm8k-1288` | Full Agent Pipeline | 1 | passed | 1 of 1 | 22,075 | 12.3 s | 1 | `full-agent-pipeline.gsm8k-1288.1.mwpmaquo` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:36:04.501Z from 50 recorded attempts.
