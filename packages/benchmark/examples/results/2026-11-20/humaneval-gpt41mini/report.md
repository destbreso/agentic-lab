# humaneval-5-seed7-gpt41mini-all

> On five humaneval problems and openai/gpt-4.1-mini, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `humaneval-gpt41mini.yaml`, hash `d9757fcc67e2385b85731baadd3a54a4f2d6b56796c122bf939d8dfd38edba1f`, locked 2026-11-20T23:46:36.877Z before its first attempt.
- **Tasks:** humaneval-5-seed7 (`../tasks-v2/humaneval-5-seed7.yaml`), 5 tasks: HumanEval (OpenAI, MIT): Python functions to complete from their signature and docstring, each checked by the dataset's own hidden tests. 5 of the file's 164 problems, chosen with seed 7. Source: HumanEval, https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz, licence MIT (https://github.com/openai/human-eval/blob/master/LICENSE), file sha256 `b796127e635a67f93fb35c04f4cb03cf06f38c8072ee7cee8833d7bee06979ef`.
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
| Direct | direct | 5 of 5 | 57% to 100% | 1,172 | 6.0 s | - |
| Ralph Loop | baseline | 4 of 5 | 38% to 96% | 4,086 | 6.2 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 7,373 | 9.8 s | - |
| Plan & Execute | arm | 4 of 5 | 38% to 96% | 10,838 | 11.5 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 10,036 | 12.7 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 9,386 | 13.6 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 19,694 | 18.3 s | - |
| Advisor | arm | 4 of 5 | 38% to 96% | 4,208 | 6.2 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 9,108 | 14.3 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 10,551 | 14.3 s | - |

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `humaneval-1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-11` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-87` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-115` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `humaneval-160` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Advisor** inconclusive: Advisor passed 4 of 5 (38% to 96%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (-20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Direct 5 of 5 (57% to 100%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Plan & Execute** inconclusive: Plan & Execute passed 4 of 5 (38% to 96%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Supervised Coder** inconclusive: Supervised Coder passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Adversarial Duel** inconclusive: Adversarial Duel passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Advisor** inconclusive: Advisor passed 4 of 5 (38% to 96%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Deep Reasoning** inconclusive: Deep Reasoning passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.
- **Full Agent Pipeline** inconclusive: Full Agent Pipeline passed 5 of 5 (57% to 100%) and Ralph Loop 4 of 5 (38% to 96%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+20 points) would take about 35 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

## What this does not show

- **One model.** Every role of every arm ran on `openai/gpt-4.1-mini`. Another model, or different models in different roles, may order the arms differently.
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
| `humaneval-1` | Direct | 1 | passed | 1 of 1 | 684 | 3.9 s | - | `direct.humaneval-1.1.mwpmokqk` |
| `humaneval-1` | Ralph Loop | 1 | passed | 1 of 1 | 7,336 | 8.9 s | 1 | `ralph-loop.humaneval-1.1.mwpmokkd` |
| `humaneval-1` | Execute & Evaluate | 1 | passed | 1 of 1 | 6,984 | 9.8 s | 1 | `exec-eval.humaneval-1.1.mwpmokup` |
| `humaneval-1` | Plan & Execute | 1 | passed | 1 of 1 | 6,749 | 8.8 s | 1 | `plan-execute.humaneval-1.1.mwpmooev` |
| `humaneval-1` | Reflexion | 1 | passed | 1 of 1 | 9,087 | 11.8 s | 1 | `reflexion.humaneval-1.1.mwpmorng` |
| `humaneval-1` | Supervised Coder | 1 | passed | 1 of 1 | 10,133 | 13.6 s | 1 | `supervised-coder.humaneval-1.1.mwpmosyy` |
| `humaneval-1` | Adversarial Duel | 1 | passed | 1 of 1 | 19,694 | 17.8 s | 1 | `adversarial-duel.humaneval-1.1.mwpmovk0` |
| `humaneval-1` | Advisor | 1 | passed | 1 of 1 | 3,768 | 5.6 s | 1 | `advisor.humaneval-1.1.mwpmp1bl` |
| `humaneval-1` | Deep Reasoning | 1 | passed | 1 of 1 | 9,083 | 36.3 s | 1 | `deep-reasoning.humaneval-1.1.mwpmp3q7` |
| `humaneval-1` | Full Agent Pipeline | 1 | passed | 1 of 1 | 16,885 | 18.8 s | 1 | `full-agent-pipeline.humaneval-1.1.mwpmp60o` |
| `humaneval-11` | Direct | 1 | passed | 1 of 1 | 494 | 2.7 s | - | `direct.humaneval-11.1.mwpmp9rj` |
| `humaneval-11` | Ralph Loop | 1 | passed | 1 of 1 | 3,191 | 4.9 s | 1 | `ralph-loop.humaneval-11.1.mwpmpc5l` |
| `humaneval-11` | Execute & Evaluate | 1 | passed | 1 of 1 | 6,199 | 8.7 s | 1 | `exec-eval.humaneval-11.1.mwpmpg64` |
| `humaneval-11` | Plan & Execute | 1 | passed | 1 of 1 | 4,758 | 7.9 s | 1 | `plan-execute.humaneval-11.1.mwpmpkst` |
| `humaneval-11` | Reflexion | 1 | passed | 1 of 1 | 6,811 | 10.1 s | 1 | `reflexion.humaneval-11.1.mwpmpn3e` |
| `humaneval-11` | Supervised Coder | 1 | passed | 1 of 1 | 7,444 | 10.0 s | 1 | `supervised-coder.humaneval-11.1.mwpmprfq` |
| `humaneval-11` | Adversarial Duel | 1 | passed | 1 of 1 | 10,292 | 11.9 s | 1 | `adversarial-duel.humaneval-11.1.mwpmpv4t` |
| `humaneval-11` | Advisor | 1 | passed | 1 of 1 | 3,367 | 4.6 s | 1 | `advisor.humaneval-11.1.mwpmpw0d` |
| `humaneval-11` | Deep Reasoning | 1 | passed | 1 of 1 | 7,762 | 9.6 s | 1 | `deep-reasoning.humaneval-11.1.mwpmpzdw` |
| `humaneval-11` | Full Agent Pipeline | 1 | passed | 1 of 1 | 8,542 | 11.5 s | 1 | `full-agent-pipeline.humaneval-11.1.mwpmpzur` |
| `humaneval-87` | Direct | 1 | passed | 1 of 1 | 1,374 | 7.4 s | - | `direct.humaneval-87.1.mwpmq4kp` |
| `humaneval-87` | Ralph Loop | 1 | passed | 1 of 1 | 4,086 | 5.8 s | 1 | `ralph-loop.humaneval-87.1.mwpmq70u` |
| `humaneval-87` | Execute & Evaluate | 1 | passed | 1 of 1 | 7,373 | 9.6 s | 1 | `exec-eval.humaneval-87.1.mwpmq92v` |
| `humaneval-87` | Plan & Execute | 1 | passed | 1 of 1 | 13,314 | 13.2 s | 1 | `plan-execute.humaneval-87.1.mwpmqaqx` |
| `humaneval-87` | Reflexion | 1 | passed | 1 of 1 | 10,036 | 12.7 s | 1 | `reflexion.humaneval-87.1.mwpmqbp3` |
| `humaneval-87` | Supervised Coder | 1 | passed | 1 of 1 | 9,386 | 11.1 s | 1 | `supervised-coder.humaneval-87.1.mwpmqgpu` |
| `humaneval-87` | Adversarial Duel | 1 | passed | 1 of 1 | 28,388 | 22.4 s | 1 | `adversarial-duel.humaneval-87.1.mwpmql6z` |
| `humaneval-87` | Advisor | 1 | passed | 1 of 1 | 4,230 | 6.2 s | 1 | `advisor.humaneval-87.1.mwpmqlo6` |
| `humaneval-87` | Deep Reasoning | 1 | passed | 1 of 1 | 15,503 | 14.3 s | 1 | `deep-reasoning.humaneval-87.1.mwpmqpke` |
| `humaneval-87` | Full Agent Pipeline | 1 | passed | 1 of 1 | 16,781 | 20.3 s | 1 | `full-agent-pipeline.humaneval-87.1.mwpmqqnb` |
| `humaneval-115` | Direct | 1 | passed | 1 of 1 | 1,172 | 6.0 s | - | `direct.humaneval-115.1.mwpmr0ug` |
| `humaneval-115` | Ralph Loop | 1 | failed | 0 of 1 | 4,163 | 6.6 s | 1 | `ralph-loop.humaneval-115.1.mwpmr2qs` |
| `humaneval-115` | Execute & Evaluate | 1 | passed | 1 of 1 | 13,291 | 14.7 s | 1 | `exec-eval.humaneval-115.1.mwpmr5rb` |
| `humaneval-115` | Plan & Execute | 1 | failed | 0 of 1 | 12,429 | 11.5 s | 1 | `plan-execute.humaneval-115.1.mwpmr6qk` |
| `humaneval-115` | Reflexion | 1 | passed | 1 of 1 | 40,431 | 50.3 s | 2 | `reflexion.humaneval-115.1.mwpmr81k` |
| `humaneval-115` | Supervised Coder | 1 | passed | 1 of 1 | 24,817 | 28.6 s | 2 | `supervised-coder.humaneval-115.1.mwpmrg1o` |
| `humaneval-115` | Adversarial Duel | 1 | passed | 1 of 1 | 18,493 | 18.3 s | 1 | `adversarial-duel.humaneval-115.1.mwpmrhbc` |
| `humaneval-115` | Advisor | 1 | passed | 1 of 1 | 4,377 | 6.8 s | 1 | `advisor.humaneval-115.1.mwpmrvze` |
| `humaneval-115` | Deep Reasoning | 1 | passed | 1 of 1 | 9,108 | 13.4 s | 1 | `deep-reasoning.humaneval-115.1.mwpms1he` |
| `humaneval-115` | Full Agent Pipeline | 1 | passed | 1 of 1 | 10,551 | 14.3 s | 1 | `full-agent-pipeline.humaneval-115.1.mwpms2d6` |
| `humaneval-160` | Direct | 1 | passed | 1 of 1 | 1,330 | 7.1 s | - | `direct.humaneval-160.1.mwpmsb98` |
| `humaneval-160` | Ralph Loop | 1 | passed | 1 of 1 | 4,004 | 6.2 s | 1 | `ralph-loop.humaneval-160.1.mwpmsc30` |
| `humaneval-160` | Execute & Evaluate | 1 | passed | 1 of 1 | 26,558 | 24.7 s | 2 | `exec-eval.humaneval-160.1.mwpmsdnf` |
| `humaneval-160` | Plan & Execute | 1 | passed | 1 of 1 | 10,838 | 12.5 s | 1 | `plan-execute.humaneval-160.1.mwpmsh5y` |
| `humaneval-160` | Reflexion | 1 | passed | 1 of 1 | 26,530 | 26.6 s | 2 | `reflexion.humaneval-160.1.mwpmsh8w` |
| `humaneval-160` | Supervised Coder | 1 | passed | 1 of 1 | 8,877 | 13.8 s | 1 | `supervised-coder.humaneval-160.1.mwpmsr40` |
| `humaneval-160` | Adversarial Duel | 1 | passed | 1 of 1 | 38,178 | 34.0 s | 1 | `adversarial-duel.humaneval-160.1.mwpmswz8` |
| `humaneval-160` | Advisor | 1 | failed | 0 of 1 | 4,208 | 6.5 s | 1 | `advisor.humaneval-160.1.mwpmt20m` |
| `humaneval-160` | Deep Reasoning | 1 | passed | 1 of 1 | 33,934 | 31.1 s | 2 | `deep-reasoning.humaneval-160.1.mwpmt23f` |
| `humaneval-160` | Full Agent Pipeline | 1 | passed | 1 of 1 | 9,965 | 13.9 s | 1 | `full-agent-pipeline.humaneval-160.1.mwpmt7by` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:50:37.667Z from 50 recorded attempts.
