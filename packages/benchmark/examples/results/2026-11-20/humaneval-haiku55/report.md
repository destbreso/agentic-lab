# humaneval-5-seed7-haiku55-all

> On five humaneval problems and anthropic/claude-haiku-5-5, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `humaneval-haiku55.yaml`, hash `420584a1dbf701d91cb066b400b43e381c82b24adc8944e00fc9706d78cface5`, locked 2026-11-20T23:31:11.734Z before its first attempt.
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
| Direct | direct | 5 of 5 | 57% to 100% | 1,320 | 3.4 s | - |
| Ralph Loop | baseline | 5 of 5 | 57% to 100% | 8,485 | 4.8 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 15,452 | 11.1 s | - |
| Plan & Execute | arm | 5 of 5 | 57% to 100% | 14,418 | 10.1 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 14,861 | 10.0 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 21,643 | 17.0 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 28,920 | 19.0 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 9,734 | 4.3 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 19,199 | 14.9 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 21,217 | 15.1 s | - |

Model calls that ended in an error (a timeout, a refused connection), inside attempts that still counted: Execute & Evaluate 2, Reflexion 4, Supervised Coder 2, Adversarial Duel 5, Deep Reasoning 3, Full Agent Pipeline 5.

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
| `humaneval-1` | Direct | 1 | passed | 1 of 1 | 862 | 2.7 s | - | `direct.humaneval-1.1.mwpm4qk5` |
| `humaneval-1` | Ralph Loop | 1 | passed | 1 of 1 | 7,057 | 4.6 s | 1 | `ralph-loop.humaneval-1.1.mwpm4qmb` |
| `humaneval-1` | Execute & Evaluate | 1 | passed | 1 of 1 | 12,016 | 9.1 s | 1 | `exec-eval.humaneval-1.1.mwpm4qm1` |
| `humaneval-1` | Plan & Execute | 1 | passed | 1 of 1 | 12,947 | 8.8 s | 1 | `plan-execute.humaneval-1.1.mwpm4srn` |
| `humaneval-1` | Reflexion | 1 | passed | 1 of 1 | 14,861 | 10.8 s | 1 | `reflexion.humaneval-1.1.mwpm4uaz` |
| `humaneval-1` | Supervised Coder | 1 | passed | 1 of 1 | 20,383 | 14.5 s | 1 | `supervised-coder.humaneval-1.1.mwpm4xss` |
| `humaneval-1` | Adversarial Duel | 1 | passed | 1 of 1 | 27,225 | 17.5 s | 1 | `adversarial-duel.humaneval-1.1.mwpm4zpl` |
| `humaneval-1` | Advisor | 1 | passed | 1 of 1 | 9,122 | 4.3 s | 1 | `advisor.humaneval-1.1.mwpm52rg` |
| `humaneval-1` | Deep Reasoning | 1 | passed | 1 of 1 | 19,199 | 12.6 s | 1 | `deep-reasoning.humaneval-1.1.mwpm5687` |
| `humaneval-1` | Full Agent Pipeline | 1 | passed | 1 of 1 | 21,217 | 14.9 s | 1 | `full-agent-pipeline.humaneval-1.1.mwpm594r` |
| `humaneval-11` | Direct | 1 | passed | 1 of 1 | 733 | 2.3 s | - | `direct.humaneval-11.1.mwpm5dhw` |
| `humaneval-11` | Ralph Loop | 1 | passed | 1 of 1 | 6,309 | 2.7 s | 1 | `ralph-loop.humaneval-11.1.mwpm5fdi` |
| `humaneval-11` | Execute & Evaluate | 1 | passed | 1 of 1 | 16,466 | 11.1 s | 1 | `exec-eval.humaneval-11.1.mwpm5g3v` |
| `humaneval-11` | Plan & Execute | 1 | passed | 1 of 1 | 11,728 | 7.7 s | 1 | `plan-execute.humaneval-11.1.mwpm5hmt` |
| `humaneval-11` | Reflexion | 1 | passed | 1 of 1 | 12,983 | 7.7 s | 1 | `reflexion.humaneval-11.1.mwpm5kqy` |
| `humaneval-11` | Supervised Coder | 1 | passed | 1 of 1 | 18,260 | 13.7 s | 1 | `supervised-coder.humaneval-11.1.mwpm5nqd` |
| `humaneval-11` | Adversarial Duel | 1 | passed | 1 of 1 | 25,847 | 17.5 s | 1 | `adversarial-duel.humaneval-11.1.mwpm5otl` |
| `humaneval-11` | Advisor | 1 | passed | 1 of 1 | 8,584 | 3.1 s | 1 | `advisor.humaneval-11.1.mwpm5qs3` |
| `humaneval-11` | Deep Reasoning | 1 | passed | 1 of 1 | 18,758 | 14.0 s | 1 | `deep-reasoning.humaneval-11.1.mwpm5t9l` |
| `humaneval-11` | Full Agent Pipeline | 1 | passed | 1 of 1 | 22,152 | 13.9 s | 1 | `full-agent-pipeline.humaneval-11.1.mwpm5ygv` |
| `humaneval-87` | Direct | 1 | passed | 1 of 1 | 1,320 | 3.4 s | - | `direct.humaneval-87.1.mwpm62h0` |
| `humaneval-87` | Ralph Loop | 1 | passed | 1 of 1 | 10,119 | 4.8 s | 1 | `ralph-loop.humaneval-87.1.mwpm6458` |
| `humaneval-87` | Execute & Evaluate | 1 | passed | 1 of 1 | 14,592 | 9.3 s | 1 | `exec-eval.humaneval-87.1.mwpm657f` |
| `humaneval-87` | Plan & Execute | 1 | passed | 1 of 1 | 14,418 | 10.1 s | 1 | `plan-execute.humaneval-87.1.mwpm6821` |
| `humaneval-87` | Reflexion | 1 | passed | 1 of 1 | 15,288 | 9.7 s | 1 | `reflexion.humaneval-87.1.mwpm69do` |
| `humaneval-87` | Supervised Coder | 1 | passed | 1 of 1 | 24,828 | 17.4 s | 1 | `supervised-coder.humaneval-87.1.mwpm6cgi` |
| `humaneval-87` | Adversarial Duel | 1 | passed | 1 of 1 | 28,920 | 19.0 s | 1 | `adversarial-duel.humaneval-87.1.mwpm6g01` |
| `humaneval-87` | Advisor | 1 | passed | 1 of 1 | 9,734 | 4.3 s | 1 | `advisor.humaneval-87.1.mwpm6gza` |
| `humaneval-87` | Deep Reasoning | 1 | passed | 1 of 1 | 21,951 | 15.1 s | 1 | `deep-reasoning.humaneval-87.1.mwpm6kev` |
| `humaneval-87` | Full Agent Pipeline | 1 | passed | 1 of 1 | 20,489 | 15.7 s | 1 | `full-agent-pipeline.humaneval-87.1.mwpm6q1c` |
| `humaneval-115` | Direct | 1 | passed | 1 of 1 | 1,389 | 3.4 s | - | `direct.humaneval-115.1.mwpm6uup` |
| `humaneval-115` | Ralph Loop | 1 | passed | 1 of 1 | 8,485 | 5.6 s | 1 | `ralph-loop.humaneval-115.1.mwpm6w5u` |
| `humaneval-115` | Execute & Evaluate | 1 | passed | 1 of 1 | 15,452 | 11.1 s | 1 | `exec-eval.humaneval-115.1.mwpm6xjs` |
| `humaneval-115` | Plan & Execute | 1 | passed | 1 of 1 | 27,217 | 13.5 s | 1 | `plan-execute.humaneval-115.1.mwpm70km` |
| `humaneval-115` | Reflexion | 1 | passed | 1 of 1 | 13,062 | 10.0 s | 1 | `reflexion.humaneval-115.1.mwpm729s` |
| `humaneval-115` | Supervised Coder | 1 | passed | 1 of 1 | 22,087 | 17.0 s | 1 | `supervised-coder.humaneval-115.1.mwpm76a4` |
| `humaneval-115` | Adversarial Duel | 1 | passed | 1 of 1 | 31,682 | 22.0 s | 1 | `adversarial-duel.humaneval-115.1.mwpm7a44` |
| `humaneval-115` | Advisor | 1 | passed | 1 of 1 | 10,417 | 5.2 s | 1 | `advisor.humaneval-115.1.mwpm7b3j` |
| `humaneval-115` | Deep Reasoning | 1 | passed | 1 of 1 | 18,964 | 14.9 s | 1 | `deep-reasoning.humaneval-115.1.mwpm7fak` |
| `humaneval-115` | Full Agent Pipeline | 1 | passed | 1 of 1 | 19,357 | 15.1 s | 1 | `full-agent-pipeline.humaneval-115.1.mwpm7jjl` |
| `humaneval-160` | Direct | 1 | passed | 1 of 1 | 1,877 | 5.8 s | - | `direct.humaneval-160.1.mwpm7qyq` |
| `humaneval-160` | Ralph Loop | 1 | passed | 1 of 1 | 9,642 | 9.1 s | 1 | `ralph-loop.humaneval-160.1.mwpm7r75` |
| `humaneval-160` | Execute & Evaluate | 1 | passed | 1 of 1 | 19,968 | 17.1 s | 1 | `exec-eval.humaneval-160.1.mwpm7vbv` |
| `humaneval-160` | Plan & Execute | 1 | passed | 1 of 1 | 17,518 | 14.7 s | 1 | `plan-execute.humaneval-160.1.mwpm7vks` |
| `humaneval-160` | Reflexion | 1 | passed | 1 of 1 | 18,244 | 13.1 s | 1 | `reflexion.humaneval-160.1.mwpm7ybu` |
| `humaneval-160` | Supervised Coder | 1 | passed | 1 of 1 | 21,643 | 22.4 s | 1 | `supervised-coder.humaneval-160.1.mwpm874k` |
| `humaneval-160` | Adversarial Duel | 1 | passed | 1 of 1 | 33,079 | 27.5 s | 1 | `adversarial-duel.humaneval-160.1.mwpm88jf` |
| `humaneval-160` | Advisor | 1 | passed | 1 of 1 | 10,544 | 6.3 s | 1 | `advisor.humaneval-160.1.mwpm88o7` |
| `humaneval-160` | Deep Reasoning | 1 | passed | 1 of 1 | 31,534 | 25.9 s | 1 | `deep-reasoning.humaneval-160.1.mwpm8dn6` |
| `humaneval-160` | Full Agent Pipeline | 1 | passed | 1 of 1 | 25,330 | 22.9 s | 1 | `full-agent-pipeline.humaneval-160.1.mwpm8on8` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:34:38.937Z from 50 recorded attempts.
