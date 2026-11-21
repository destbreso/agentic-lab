# gsm8k-5-seed7-haiku55-all

> On five gsm8k problems and anthropic/claude-haiku-5-5, how does each of Jig's built-in topologies do against the model asked directly and against the Ralph Loop?

Complete: all 50 attempts ran.

## The experiment

- **Spec:** `gsm8k-haiku55.yaml`, hash `3f35e771a5a066aed942cda64269fd365bea59a23e107e9a53391fb62a20e6b3`, locked 2026-11-20T23:34:39.880Z before its first attempt.
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
| Direct | direct | 5 of 5 | 57% to 100% | 582 | 2.1 s | - |
| Ralph Loop | baseline | 5 of 5 | 57% to 100% | 4,238 | 2.2 s | - |
| Execute & Evaluate | arm | 5 of 5 | 57% to 100% | 8,901 | 5.6 s | - |
| Plan & Execute | arm | 5 of 5 | 57% to 100% | 7,104 | 5.7 s | - |
| Reflexion | arm | 5 of 5 | 57% to 100% | 8,449 | 5.7 s | - |
| Supervised Coder | arm | 5 of 5 | 57% to 100% | 11,866 | 10.1 s | - |
| Adversarial Duel | arm | 5 of 5 | 57% to 100% | 20,513 | 14.4 s | - |
| Advisor | arm | 5 of 5 | 57% to 100% | 5,738 | 2.3 s | - |
| Deep Reasoning | arm | 5 of 5 | 57% to 100% | 11,431 | 9.2 s | - |
| Full Agent Pipeline | arm | 5 of 5 | 57% to 100% | 11,351 | 9.1 s | - |

Model calls that ended in an error (a timeout, a refused connection), inside attempts that still counted: Execute & Evaluate 4, Reflexion 4, Supervised Coder 2, Adversarial Duel 5, Deep Reasoning 4, Full Agent Pipeline 5.

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Plan & Execute | Reflexion | Supervised Coder | Adversarial Duel | Advisor | Deep Reasoning | Full Agent Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|
| `gsm8k-15` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
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
| `gsm8k-15` | Direct | 1 | passed | 1 of 1 | 586 | 2.1 s | - | `direct.gsm8k-15.1.mwpm976a` |
| `gsm8k-15` | Ralph Loop | 1 | passed | 1 of 1 | 4,281 | 2.2 s | 1 | `ralph-loop.gsm8k-15.1.mwpm978l` |
| `gsm8k-15` | Execute & Evaluate | 1 | passed | 1 of 1 | 8,345 | 5.4 s | 1 | `exec-eval.gsm8k-15.1.mwpm977l` |
| `gsm8k-15` | Plan & Execute | 1 | passed | 1 of 1 | 7,104 | 5.3 s | 1 | `plan-execute.gsm8k-15.1.mwpm98vz` |
| `gsm8k-15` | Reflexion | 1 | passed | 1 of 1 | 10,891 | 7.4 s | 1 | `reflexion.gsm8k-15.1.mwpm990x` |
| `gsm8k-15` | Supervised Coder | 1 | passed | 1 of 1 | 11,593 | 9.0 s | 1 | `supervised-coder.gsm8k-15.1.mwpm9bh5` |
| `gsm8k-15` | Adversarial Duel | 1 | passed | 1 of 1 | 21,407 | 14.4 s | 1 | `adversarial-duel.gsm8k-15.1.mwpm9d2w` |
| `gsm8k-15` | Advisor | 1 | passed | 1 of 1 | 5,738 | 2.1 s | 1 | `advisor.gsm8k-15.1.mwpm9evk` |
| `gsm8k-15` | Deep Reasoning | 1 | passed | 1 of 1 | 11,230 | 8.6 s | 1 | `deep-reasoning.gsm8k-15.1.mwpm9gkr` |
| `gsm8k-15` | Full Agent Pipeline | 1 | passed | 1 of 1 | 11,351 | 9.1 s | 1 | `full-agent-pipeline.gsm8k-15.1.mwpm9ika` |
| `gsm8k-82` | Direct | 1 | passed | 1 of 1 | 286 | 1.1 s | - | `direct.gsm8k-82.1.mwpm9nem` |
| `gsm8k-82` | Ralph Loop | 1 | passed | 1 of 1 | 3,977 | 1.7 s | 1 | `ralph-loop.gsm8k-82.1.mwpm9ocp` |
| `gsm8k-82` | Execute & Evaluate | 1 | passed | 1 of 1 | 9,338 | 5.6 s | 1 | `exec-eval.gsm8k-82.1.mwpm9of4` |
| `gsm8k-82` | Plan & Execute | 1 | passed | 1 of 1 | 7,195 | 5.2 s | 1 | `plan-execute.gsm8k-82.1.mwpm9pqg` |
| `gsm8k-82` | Reflexion | 1 | passed | 1 of 1 | 7,738 | 4.4 s | 1 | `reflexion.gsm8k-82.1.mwpm9pr9` |
| `gsm8k-82` | Supervised Coder | 1 | passed | 1 of 1 | 11,862 | 8.9 s | 1 | `supervised-coder.gsm8k-82.1.mwpm9stl` |
| `gsm8k-82` | Adversarial Duel | 1 | passed | 1 of 1 | 20,742 | 12.1 s | 1 | `adversarial-duel.gsm8k-82.1.mwpm9tb0` |
| `gsm8k-82` | Advisor | 1 | passed | 1 of 1 | 5,383 | 1.8 s | 1 | `advisor.gsm8k-82.1.mwpm9tvb` |
| `gsm8k-82` | Deep Reasoning | 1 | passed | 1 of 1 | 11,595 | 8.6 s | 1 | `deep-reasoning.gsm8k-82.1.mwpm9vdu` |
| `gsm8k-82` | Full Agent Pipeline | 1 | passed | 1 of 1 | 10,244 | 7.1 s | 1 | `full-agent-pipeline.gsm8k-82.1.mwpm9zuo` |
| `gsm8k-689` | Direct | 1 | passed | 1 of 1 | 582 | 2.1 s | - | `direct.gsm8k-689.1.mwpma23n` |
| `gsm8k-689` | Ralph Loop | 1 | passed | 1 of 1 | 4,238 | 2.2 s | 1 | `ralph-loop.gsm8k-689.1.mwpma2rv` |
| `gsm8k-689` | Execute & Evaluate | 1 | passed | 1 of 1 | 11,461 | 8.2 s | 1 | `exec-eval.gsm8k-689.1.mwpma3vi` |
| `gsm8k-689` | Plan & Execute | 1 | passed | 1 of 1 | 7,063 | 5.7 s | 1 | `plan-execute.gsm8k-689.1.mwpma4np` |
| `gsm8k-689` | Reflexion | 1 | passed | 1 of 1 | 8,449 | 5.9 s | 1 | `reflexion.gsm8k-689.1.mwpma5h8` |
| `gsm8k-689` | Supervised Coder | 1 | passed | 1 of 1 | 12,855 | 10.1 s | 1 | `supervised-coder.gsm8k-689.1.mwpma96x` |
| `gsm8k-689` | Adversarial Duel | 1 | passed | 1 of 1 | 18,338 | 14.0 s | 1 | `adversarial-duel.gsm8k-689.1.mwpmaa7a` |
| `gsm8k-689` | Advisor | 1 | passed | 1 of 1 | 8,732 | 3.4 s | 1 | `advisor.gsm8k-689.1.mwpmaacl` |
| `gsm8k-689` | Deep Reasoning | 1 | passed | 1 of 1 | 11,431 | 9.6 s | 1 | `deep-reasoning.gsm8k-689.1.mwpmad83` |
| `gsm8k-689` | Full Agent Pipeline | 1 | passed | 1 of 1 | 10,912 | 9.0 s | 1 | `full-agent-pipeline.gsm8k-689.1.mwpmah4e` |
| `gsm8k-922` | Direct | 1 | passed | 1 of 1 | 478 | 2.1 s | - | `direct.gsm8k-922.1.mwpmakti` |
| `gsm8k-922` | Ralph Loop | 1 | passed | 1 of 1 | 4,133 | 2.1 s | 1 | `ralph-loop.gsm8k-922.1.mwpmal31` |
| `gsm8k-922` | Execute & Evaluate | 1 | passed | 1 of 1 | 8,079 | 5.3 s | 1 | `exec-eval.gsm8k-922.1.mwpmamkn` |
| `gsm8k-922` | Plan & Execute | 1 | passed | 1 of 1 | 6,911 | 6.0 s | 1 | `plan-execute.gsm8k-922.1.mwpmamsm` |
| `gsm8k-922` | Reflexion | 1 | passed | 1 of 1 | 8,078 | 5.7 s | 1 | `reflexion.gsm8k-922.1.mwpmao6p` |
| `gsm8k-922` | Supervised Coder | 1 | passed | 1 of 1 | 12,704 | 11.4 s | 1 | `supervised-coder.gsm8k-922.1.mwpmaquo` |
| `gsm8k-922` | Adversarial Duel | 1 | passed | 1 of 1 | 20,513 | 15.2 s | 1 | `adversarial-duel.gsm8k-922.1.mwpmarjz` |
| `gsm8k-922` | Advisor | 1 | passed | 1 of 1 | 5,625 | 2.3 s | 1 | `advisor.gsm8k-922.1.mwpmasot` |
| `gsm8k-922` | Deep Reasoning | 1 | passed | 1 of 1 | 11,050 | 9.2 s | 1 | `deep-reasoning.gsm8k-922.1.mwpmaulb` |
| `gsm8k-922` | Full Agent Pipeline | 1 | passed | 1 of 1 | 11,856 | 11.0 s | 1 | `full-agent-pipeline.gsm8k-922.1.mwpmazsu` |
| `gsm8k-1288` | Direct | 1 | passed | 1 of 1 | 592 | 1.9 s | - | `direct.gsm8k-1288.1.mwpmb1tn` |
| `gsm8k-1288` | Ralph Loop | 1 | passed | 1 of 1 | 4,347 | 2.3 s | 1 | `ralph-loop.gsm8k-1288.1.mwpmb3ef` |
| `gsm8k-1288` | Execute & Evaluate | 1 | passed | 1 of 1 | 8,901 | 7.0 s | 1 | `exec-eval.gsm8k-1288.1.mwpmb3hm` |
| `gsm8k-1288` | Plan & Execute | 1 | passed | 1 of 1 | 8,051 | 9.2 s | 1 | `plan-execute.gsm8k-1288.1.mwpmb5dt` |
| `gsm8k-1288` | Reflexion | 1 | passed | 1 of 1 | 8,517 | 5.6 s | 1 | `reflexion.gsm8k-1288.1.mwpmb8fa` |
| `gsm8k-1288` | Supervised Coder | 1 | passed | 1 of 1 | 11,866 | 11.5 s | 1 | `supervised-coder.gsm8k-1288.1.mwpmb8z8` |
| `gsm8k-1288` | Adversarial Duel | 1 | passed | 1 of 1 | 19,855 | 16.1 s | 1 | `adversarial-duel.gsm8k-1288.1.mwpmbcn1` |
| `gsm8k-1288` | Advisor | 1 | passed | 1 of 1 | 5,882 | 2.7 s | 1 | `advisor.gsm8k-1288.1.mwpmbcut` |
| `gsm8k-1288` | Deep Reasoning | 1 | passed | 1 of 1 | 11,519 | 10.0 s | 1 | `deep-reasoning.gsm8k-1288.1.mwpmbf38` |
| `gsm8k-1288` | Full Agent Pipeline | 1 | passed | 1 of 1 | 11,730 | 10.8 s | 1 | `full-agent-pipeline.gsm8k-1288.1.mwpmbhz2` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T23:36:38.107Z from 50 recorded attempts.
