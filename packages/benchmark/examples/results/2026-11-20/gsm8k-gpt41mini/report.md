# gsm8k-5-seed7-gpt41mini-all

> On five gsm8k problems and openai/gpt-4.1-mini, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `gsm8k-gpt41mini.yaml`, hash `9dd06296dfdad5bc936af2ccf8735843ff79e5628e13b8b1edd1477ecbb49111`, locked 2026-11-20T23:50:38.904Z before its first attempt.
- **Tasks:** gsm8k-5-seed7 (`../tasks-v2/gsm8k-5-seed7.yaml`), 5 tasks: GSM8K (OpenAI, MIT): grade-school math word problems, each with one numeric answer, checked exactly against the dataset's answer, which no role sees. 5 of the file's 1319 problems, chosen with seed 7. Source: GSM8K, https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl, licence MIT (https://github.com/openai/grade-school-math/blob/master/LICENSE), file sha256 `3730d312f6e3440559ace48831e51066acaca737f6eabec99bccb9e4b3c39d14`.
- **Model:** `openai/gpt-4.1-mini`, for every role of every arm.
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
| Direct | direct | 5 of 5 | 57% to 100% | 365 | 2.2 s | - |
| Ralph Loop | baseline | 2 of 5 | 12% to 77% | 1,940 | 2.8 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 4,895 | 7.0 s | - |
| Plan & Execute | arm | 4 of 5 | 38% to 96% | 3,031 | 5.5 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 5,569 | 9.1 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 6,636 | 12.1 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 8,331 | 11.9 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 2,342 | 3.2 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 6,310 | 11.2 s | - |
| Full Agent Pipeline | arm | 4 of 5 | 38% to 96% | 6,507 | 12.8 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-82` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-689` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-922` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `gsm8k-1288` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 2 of 5 (12% to 77%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 23 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 5 of 5 (57% to 100%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+60 points) would take about 8 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 4 of 5 (38% to 96%) and Ralph Loop 2 of 5 (12% to 77%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+40 points) would take about 23 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

## What this does not show

- **One model.** Every role of every arm ran on `openai/gpt-4.1-mini`. Another model, or different models in different roles, may order the arms differently.
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
| `gsm8k-15` | Direct | 1 | passed | 1 of 1 | 365 | 2.4 s | - | `direct.gsm8k-15.1.mwpmtrh7` |
| `gsm8k-15` | Ralph Loop | 1 | failed | 0 of 1 | 1,098 | 2.8 s | 1 | `ralph-loop.gsm8k-15.1.mwpmtrgx` |
| `gsm8k-15` | Execute & Evaluate | 1 | passed | 1 of 1 | 4,895 | 7.0 s | 1 | `exec-eval.gsm8k-15.1.mwpmtrag` |
| `gsm8k-15` | Plan & Execute | 1 | passed | 1 of 1 | 3,031 | 4.5 s | 1 | `plan-execute.gsm8k-15.1.mwpmttme` |
| `gsm8k-15` | Reflexion | 1 | passed | 1 of 1 | 5,569 | 9.1 s | 1 | `reflexion.gsm8k-15.1.mwpmtu61` |
| `gsm8k-15` | Supervised Coder | 1 | passed | 1 of 1 | 6,636 | 11.1 s | 1 | `supervised-coder.gsm8k-15.1.mwpmtwx9` |
| `gsm8k-15` | Adversarial Duel | 1 | passed | 1 of 1 | 8,251 | 10.6 s | 1 | `adversarial-duel.gsm8k-15.1.mwpmtxch` |
| `gsm8k-15` | Advisor | 1 | passed | 1 of 1 | 2,424 | 3.3 s | 1 | `advisor.gsm8k-15.1.mwpmu1mw` |
| `gsm8k-15` | Deep Reasoning | 1 | passed | 1 of 1 | 6,165 | 8.7 s | 1 | `deep-reasoning.gsm8k-15.1.mwpmu4nw` |
| `gsm8k-15` | Full Agent Pipeline | 1 | passed | 1 of 1 | 6,210 | 9.4 s | 1 | `full-agent-pipeline.gsm8k-15.1.mwpmu5ny` |
| `gsm8k-82` | Direct | 1 | passed | 1 of 1 | 199 | 1.1 s | - | `direct.gsm8k-82.1.mwpmu5x2` |
| `gsm8k-82` | Ralph Loop | 1 | passed | 1 of 1 | 1,940 | 2.7 s | 1 | `ralph-loop.gsm8k-82.1.mwpmu73n` |
| `gsm8k-82` | Execute & Evaluate | 1 | passed | 1 of 1 | 4,402 | 5.8 s | 1 | `exec-eval.gsm8k-82.1.mwpmu9f2` |
| `gsm8k-82` | Plan & Execute | 1 | passed | 1 of 1 | 2,842 | 5.0 s | 1 | `plan-execute.gsm8k-82.1.mwpmubjt` |
| `gsm8k-82` | Reflexion | 1 | passed | 1 of 1 | 4,947 | 7.6 s | 1 | `reflexion.gsm8k-82.1.mwpmud5a` |
| `gsm8k-82` | Supervised Coder | 1 | passed | 1 of 1 | 5,220 | 8.1 s | 1 | `supervised-coder.gsm8k-82.1.mwpmue5i` |
| `gsm8k-82` | Adversarial Duel | 1 | passed | 1 of 1 | 8,331 | 11.9 s | 1 | `adversarial-duel.gsm8k-82.1.mwpmufmd` |
| `gsm8k-82` | Advisor | 1 | passed | 1 of 1 | 2,084 | 3.1 s | 1 | `advisor.gsm8k-82.1.mwpmujcc` |
| `gsm8k-82` | Deep Reasoning | 1 | passed | 1 of 1 | 5,526 | 7.9 s | 1 | `deep-reasoning.gsm8k-82.1.mwpmuknr` |
| `gsm8k-82` | Full Agent Pipeline | 1 | passed | 1 of 1 | 6,042 | 9.8 s | 1 | `full-agent-pipeline.gsm8k-82.1.mwpmum8a` |
| `gsm8k-689` | Direct | 1 | passed | 1 of 1 | 373 | 2.2 s | - | `direct.gsm8k-689.1.mwpmup18` |
| `gsm8k-689` | Ralph Loop | 1 | failed | 0 of 1 | 1,178 | 4.4 s | 1 | `ralph-loop.gsm8k-689.1.mwpmuqyk` |
| `gsm8k-689` | Execute & Evaluate | 1 | passed | 1 of 1 | 4,927 | 7.8 s | 1 | `exec-eval.gsm8k-689.1.mwpmur0n` |
| `gsm8k-689` | Plan & Execute | 1 | passed | 1 of 1 | 3,520 | 6.1 s | 1 | `plan-execute.gsm8k-689.1.mwpmutze` |
| `gsm8k-689` | Reflexion | 1 | passed | 1 of 1 | 5,717 | 9.9 s | 1 | `reflexion.gsm8k-689.1.mwpmuujk` |
| `gsm8k-689` | Supervised Coder | 1 | passed | 1 of 1 | 10,607 | 15.0 s | 1 | `supervised-coder.gsm8k-689.1.mwpmuxa0` |
| `gsm8k-689` | Adversarial Duel | 1 | passed | 1 of 1 | 10,467 | 17.9 s | 1 | `adversarial-duel.gsm8k-689.1.mwpmuyz9` |
| `gsm8k-689` | Advisor | 1 | passed | 1 of 1 | 2,365 | 3.5 s | 1 | `advisor.gsm8k-689.1.mwpmv2p3` |
| `gsm8k-689` | Deep Reasoning | 1 | passed | 1 of 1 | 6,310 | 11.3 s | 1 | `deep-reasoning.gsm8k-689.1.mwpmv5ku` |
| `gsm8k-689` | Full Agent Pipeline | 1 | passed | 1 of 1 | 8,092 | 16.4 s | 1 | `full-agent-pipeline.gsm8k-689.1.mwpmv97v` |
| `gsm8k-922` | Direct | 1 | passed | 1 of 1 | 241 | 1.3 s | - | `direct.gsm8k-922.1.mwpmvdb3` |
| `gsm8k-922` | Ralph Loop | 1 | passed | 1 of 1 | 2,011 | 2.6 s | 1 | `ralph-loop.gsm8k-922.1.mwpmveor` |
| `gsm8k-922` | Execute & Evaluate | 1 | passed | 1 of 1 | 4,341 | 6.0 s | 1 | `exec-eval.gsm8k-922.1.mwpmvejo` |
| `gsm8k-922` | Plan & Execute | 1 | passed | 1 of 1 | 2,943 | 5.5 s | 1 | `plan-execute.gsm8k-922.1.mwpmvgyt` |
| `gsm8k-922` | Reflexion | 1 | passed | 1 of 1 | 5,012 | 8.0 s | 1 | `reflexion.gsm8k-922.1.mwpmvjnn` |
| `gsm8k-922` | Supervised Coder | 1 | passed | 1 of 1 | 6,536 | 12.1 s | 1 | `supervised-coder.gsm8k-922.1.mwpmvlgq` |
| `gsm8k-922` | Adversarial Duel | 1 | passed | 1 of 1 | 8,238 | 10.9 s | 1 | `adversarial-duel.gsm8k-922.1.mwpmvm1j` |
| `gsm8k-922` | Advisor | 1 | passed | 1 of 1 | 2,143 | 3.0 s | 1 | `advisor.gsm8k-922.1.mwpmvq1z` |
| `gsm8k-922` | Deep Reasoning | 1 | passed | 1 of 1 | 6,585 | 11.2 s | 1 | `deep-reasoning.gsm8k-922.1.mwpmvsyk` |
| `gsm8k-922` | Full Agent Pipeline | 1 | passed | 1 of 1 | 6,507 | 12.8 s | 1 | `full-agent-pipeline.gsm8k-922.1.mwpmvuog` |
| `gsm8k-1288` | Direct | 1 | passed | 1 of 1 | 426 | 2.5 s | - | `direct.gsm8k-1288.1.mwpmvv8z` |
| `gsm8k-1288` | Ralph Loop | 1 | failed | 0 of 1 | 2,209 | 3.6 s | 1 | `ralph-loop.gsm8k-1288.1.mwpmvxec` |
| `gsm8k-1288` | Execute & Evaluate | 1 | passed | 1 of 1 | 11,323 | 18.6 s | 2 | `exec-eval.gsm8k-1288.1.mwpmw0d3` |
| `gsm8k-1288` | Plan & Execute | 1 | failed | 0 of 1 | 3,351 | 6.2 s | 1 | `plan-execute.gsm8k-1288.1.mwpmw1tl` |
| `gsm8k-1288` | Reflexion | 1 | passed | 1 of 1 | 12,211 | 21.6 s | 2 | `reflexion.gsm8k-1288.1.mwpmw54b` |
| `gsm8k-1288` | Supervised Coder | 1 | passed | 1 of 1 | 13,013 | 20.8 s | 2 | `supervised-coder.gsm8k-1288.1.mwpmw6un` |
| `gsm8k-1288` | Adversarial Duel | 1 | passed | 1 of 1 | 26,543 | 38.3 s | 2 | `adversarial-duel.gsm8k-1288.1.mwpmwexg` |
| `gsm8k-1288` | Advisor | 1 | passed | 1 of 1 | 2,342 | 3.2 s | 1 | `advisor.gsm8k-1288.1.mwpmwm11` |
| `gsm8k-1288` | Deep Reasoning | 1 | passed | 1 of 1 | 14,015 | 24.7 s | 2 | `deep-reasoning.gsm8k-1288.1.mwpmwn2r` |
| `gsm8k-1288` | Full Agent Pipeline | 1 | failed | 0 of 1 | 27,395 | 48.3 s | 3 | `full-agent-pipeline.gsm8k-1288.1.mwpmwoy9` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:53:44.495Z from 50 recorded attempts.
