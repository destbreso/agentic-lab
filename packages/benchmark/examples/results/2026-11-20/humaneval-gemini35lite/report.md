# humaneval-5-seed7-gemini35lite-all

> On five humaneval problems and gemini/gemini-3.5-flash-lite, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `humaneval-gemini35lite.yaml`, hash `36c92ccd7a5f4e6917376fc941a1fd3f2d60be2f4ad8208b98ed0d163a89d8f7`, locked 2026-11-20T23:31:11.683Z before its first attempt.
- **Tasks:** humaneval-5-seed7 (`../tasks-v2/humaneval-5-seed7.yaml`), 5 tasks: HumanEval (OpenAI, MIT): Python functions to complete from their signature and docstring, each checked by the dataset's own hidden tests. 5 of the file's 164 problems, chosen with seed 7. Source: HumanEval, https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz, licence MIT (https://github.com/openai/human-eval/blob/master/LICENSE), file sha256 `b796127e635a67f93fb35c04f4cb03cf06f38c8072ee7cee8833d7bee06979ef`.
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
| Direct | direct | 5 of 5 | 57% to 100% | 615 | 1.3 s | - |
| Ralph Loop | baseline | 5 of 5 | 57% to 100% | 15,301 | 6.2 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 17,050 | 9.4 s | - |
| Plan & Execute | arm | 5 of 5 | 57% to 100% | 18,229 | 7.8 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 18,448 | 9.6 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 22,843 | 11.0 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 35,683 | 14.8 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 12,550 | 6.4 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 22,937 | 11.3 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 25,051 | 13.5 s | - |

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

- **One model.** Every role of every arm ran on `gemini/gemini-3.5-flash-lite`. Another model, or different models in different roles, may order the arms differently.
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
| `humaneval-1` | Direct | 1 | passed | 1 of 1 | 496 | 1.2 s | - | `direct.humaneval-1.1.mwpm4qik` |
| `humaneval-1` | Ralph Loop | 1 | passed | 1 of 1 | 5,714 | 3.8 s | 1 | `ralph-loop.humaneval-1.1.mwpm4qjy` |
| `humaneval-1` | Execute & Evaluate | 1 | passed | 1 of 1 | 10,731 | 6.7 s | 1 | `exec-eval.humaneval-1.1.mwpm4qjj` |
| `humaneval-1` | Plan & Execute | 1 | passed | 1 of 1 | 18,229 | 7.8 s | 1 | `plan-execute.humaneval-1.1.mwpm4rnl` |
| `humaneval-1` | Reflexion | 1 | passed | 1 of 1 | 11,316 | 6.9 s | 1 | `reflexion.humaneval-1.1.mwpm4tk8` |
| `humaneval-1` | Supervised Coder | 1 | passed | 1 of 1 | 16,220 | 8.9 s | 1 | `supervised-coder.humaneval-1.1.mwpm4vt2` |
| `humaneval-1` | Adversarial Duel | 1 | passed | 1 of 1 | 31,229 | 13.7 s | 1 | `adversarial-duel.humaneval-1.1.mwpm4ycg` |
| `humaneval-1` | Advisor | 1 | passed | 1 of 1 | 33,608 | 11.2 s | 1 | `advisor.humaneval-1.1.mwpm4yxl` |
| `humaneval-1` | Deep Reasoning | 1 | passed | 1 of 1 | 26,789 | 11.3 s | 1 | `deep-reasoning.humaneval-1.1.mwpm52qw` |
| `humaneval-1` | Full Agent Pipeline | 1 | passed | 1 of 1 | 31,871 | 13.5 s | 1 | `full-agent-pipeline.humaneval-1.1.mwpm57o6` |
| `humaneval-11` | Direct | 1 | passed | 1 of 1 | 338 | 0.9 s | - | `direct.humaneval-11.1.mwpm58zc` |
| `humaneval-11` | Ralph Loop | 1 | passed | 1 of 1 | 6,676 | 3.2 s | 1 | `ralph-loop.humaneval-11.1.mwpm59pu` |
| `humaneval-11` | Execute & Evaluate | 1 | passed | 1 of 1 | 10,756 | 6.0 s | 1 | `exec-eval.humaneval-11.1.mwpm5bk3` |
| `humaneval-11` | Plan & Execute | 1 | passed | 1 of 1 | 29,780 | 6.1 s | 1 | `plan-execute.humaneval-11.1.mwpm5c8o` |
| `humaneval-11` | Reflexion | 1 | passed | 1 of 1 | 11,592 | 6.6 s | 1 | `reflexion.humaneval-11.1.mwpm5g9c` |
| `humaneval-11` | Supervised Coder | 1 | passed | 1 of 1 | 12,675 | 7.7 s | 1 | `supervised-coder.humaneval-11.1.mwpm5h00` |
| `humaneval-11` | Adversarial Duel | 1 | passed | 1 of 1 | 31,968 | 14.8 s | 1 | `adversarial-duel.humaneval-11.1.mwpm5i4y` |
| `humaneval-11` | Advisor | 1 | passed | 1 of 1 | 6,912 | 3.3 s | 1 | `advisor.humaneval-11.1.mwpm5lf6` |
| `humaneval-11` | Deep Reasoning | 1 | passed | 1 of 1 | 17,020 | 10.3 s | 1 | `deep-reasoning.humaneval-11.1.mwpm5n09` |
| `humaneval-11` | Full Agent Pipeline | 1 | passed | 1 of 1 | 15,206 | 9.5 s | 1 | `full-agent-pipeline.humaneval-11.1.mwpm5o0y` |
| `humaneval-87` | Direct | 1 | passed | 1 of 1 | 879 | 1.6 s | - | `direct.humaneval-87.1.mwpm5tlc` |
| `humaneval-87` | Ralph Loop | 1 | passed | 1 of 1 | 15,301 | 6.2 s | 1 | `ralph-loop.humaneval-87.1.mwpm5uwf` |
| `humaneval-87` | Execute & Evaluate | 1 | passed | 1 of 1 | 47,507 | 13.9 s | 1 | `exec-eval.humaneval-87.1.mwpm5v18` |
| `humaneval-87` | Plan & Execute | 1 | passed | 1 of 1 | 13,956 | 7.0 s | 1 | `plan-execute.humaneval-87.1.mwpm5veb` |
| `humaneval-87` | Reflexion | 1 | passed | 1 of 1 | 35,258 | 11.9 s | 1 | `reflexion.humaneval-87.1.mwpm5zs2` |
| `humaneval-87` | Supervised Coder | 1 | passed | 1 of 1 | 22,843 | 11.0 s | 1 | `supervised-coder.humaneval-87.1.mwpm60wa` |
| `humaneval-87` | Adversarial Duel | 1 | passed | 1 of 1 | 37,838 | 15.8 s | 1 | `adversarial-duel.humaneval-87.1.mwpm65se` |
| `humaneval-87` | Advisor | 1 | passed | 1 of 1 | 24,133 | 10.3 s | 1 | `advisor.humaneval-87.1.mwpm691m` |
| `humaneval-87` | Deep Reasoning | 1 | passed | 1 of 1 | 17,739 | 10.2 s | 1 | `deep-reasoning.humaneval-87.1.mwpm69hx` |
| `humaneval-87` | Full Agent Pipeline | 1 | passed | 1 of 1 | 46,450 | 15.8 s | 1 | `full-agent-pipeline.humaneval-87.1.mwpm6h2s` |
| `humaneval-115` | Direct | 1 | passed | 1 of 1 | 888 | 1.4 s | - | `direct.humaneval-115.1.mwpm6hh8` |
| `humaneval-115` | Ralph Loop | 1 | passed | 1 of 1 | 28,691 | 11.6 s | 1 | `ralph-loop.humaneval-115.1.mwpm6i1u` |
| `humaneval-115` | Execute & Evaluate | 1 | passed | 1 of 1 | 17,050 | 9.4 s | 1 | `exec-eval.humaneval-115.1.mwpm6ily` |
| `humaneval-115` | Plan & Execute | 1 | passed | 1 of 1 | 17,241 | 8.6 s | 1 | `plan-execute.humaneval-115.1.mwpm6pyi` |
| `humaneval-115` | Reflexion | 1 | passed | 1 of 1 | 18,448 | 9.6 s | 1 | `reflexion.humaneval-115.1.mwpm6r34` |
| `humaneval-115` | Supervised Coder | 1 | passed | 1 of 1 | 23,207 | 11.1 s | 1 | `supervised-coder.humaneval-115.1.mwpm6tao` |
| `humaneval-115` | Adversarial Duel | 1 | passed | 1 of 1 | 35,683 | 14.3 s | 1 | `adversarial-duel.humaneval-115.1.mwpm6wmm` |
| `humaneval-115` | Advisor | 1 | passed | 1 of 1 | 9,035 | 5.1 s | 1 | `advisor.humaneval-115.1.mwpm6yjx` |
| `humaneval-115` | Deep Reasoning | 1 | passed | 1 of 1 | 26,288 | 11.7 s | 1 | `deep-reasoning.humaneval-115.1.mwpm71xm` |
| `humaneval-115` | Full Agent Pipeline | 1 | passed | 1 of 1 | 22,969 | 11.7 s | 1 | `full-agent-pipeline.humaneval-115.1.mwpm72ip` |
| `humaneval-160` | Direct | 1 | passed | 1 of 1 | 615 | 1.3 s | - | `direct.humaneval-160.1.mwpm77qt` |
| `humaneval-160` | Ralph Loop | 1 | passed | 1 of 1 | 45,626 | 14.3 s | 1 | `ralph-loop.humaneval-160.1.mwpm78u8` |
| `humaneval-160` | Execute & Evaluate | 1 | passed | 1 of 1 | 18,390 | 9.9 s | 1 | `exec-eval.humaneval-160.1.mwpm7azm` |
| `humaneval-160` | Plan & Execute | 1 | passed | 1 of 1 | 43,560 | 14.1 s | 1 | `plan-execute.humaneval-160.1.mwpm7bml` |
| `humaneval-160` | Reflexion | 1 | passed | 1 of 1 | 25,864 | 12.8 s | 1 | `reflexion.humaneval-160.1.mwpm7io8` |
| `humaneval-160` | Supervised Coder | 1 | passed | 1 of 1 | 33,513 | 14.6 s | 1 | `supervised-coder.humaneval-160.1.mwpm7jx2` |
| `humaneval-160` | Adversarial Duel | 1 | passed | 1 of 1 | 38,551 | 17.1 s | 1 | `adversarial-duel.humaneval-160.1.mwpm7mk3` |
| `humaneval-160` | Advisor | 1 | passed | 1 of 1 | 12,550 | 6.4 s | 1 | `advisor.humaneval-160.1.mwpm7skq` |
| `humaneval-160` | Deep Reasoning | 1 | passed | 1 of 1 | 22,937 | 12.2 s | 1 | `deep-reasoning.humaneval-160.1.mwpm7v7z` |
| `humaneval-160` | Full Agent Pipeline | 1 | passed | 1 of 1 | 25,051 | 13.6 s | 1 | `full-agent-pipeline.humaneval-160.1.mwpm7xjd` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:33:54.493Z from 50 recorded attempts.
