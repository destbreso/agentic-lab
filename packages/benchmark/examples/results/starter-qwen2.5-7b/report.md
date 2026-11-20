# starter-qwen2.5-7b

> On the starter tasks and qwen2.5:7b, do Execute & Evaluate and Reflexion pass more often than the model asked directly, and than the Ralph Loop?

Complete: all 40 attempts ran.

## The experiment

- **Spec:** `packages/benchmark/examples/starter.yaml`, hash `c8e5a1fe9dee41e5d6ca679aad81a9e59504a6c48e04042d831b5bee9507959e`, locked 2026-11-20T02:39:26.793Z before its first attempt.
- **Tasks:** starter (`../tasks/starter.yaml`), 5 tasks: Three questions with one exact answer and two small Python tasks, each meant to be within reach of a 7B local model sometimes but not always.
- **Model:** `ollama/qwen2.5:7b`, for every role of every arm.
- **Versions:** jig-core 0.1.7 for every attempt; locked by jig-benchmark 0.1.0, reported by jig-benchmark 0.1.0.
- **Arms:** the direct arm (the model asked once, with the task and its files, no tools), the baseline Ralph Loop, and Execute & Evaluate (`exec-eval`), Reflexion (`reflexion`).
- **Repetitions:** 2 per task and arm.
- **Budget per attempt:** 60,000 tokens (a run stops after the model call that crosses it), and at most 3 rounds in every arm (the spec's limit replaces each topology's own).
- **Permissions:** edits inside the attempt's workspace run; allowed: `Shell(python3 *)`; anything else that would ask is denied, since nobody is there to ask.
- **Check's verdict:** the measured checks' result, with its model's verdict kept beside it (Jig's default).
- **Fallbacks:** an attempt where a role fell back to another model counts for nothing.
- **Rule, fixed before the first attempt:** per arm, k passed of n with a 95% Wilson interval. Against another arm: supports when the arm's interval lies wholly above the other's; against when it lies wholly below, or when the 95% Newcombe interval of the difference lies inside 15 points either way (no practical difference); inconclusive otherwise.

## The arms side by side

| Arm | Kind | Passed | 95% interval | Median tokens | Median time | Not counted |
|---|---|---|---|---|---|---|
| Direct | direct | 3 of 10 | 11% to 60% | 161 | 1.8 s | - |
| Ralph Loop | baseline | 3 of 10 | 11% to 60% | 2,245 | 13.7 s | - |
| Execute & Evaluate | arm | 3 of 10 | 11% to 60% | 14,972 | 71.4 s | - |
| Reflexion | arm | 4 of 10 | 17% to 69% | 16,652 | 64.3 s | - |

Model calls that ended in an error (a timeout, a refused connection), inside attempts that still counted: Reflexion 1.

Medians are over the attempts that count. Tokens are what the provider reported, input and output together.

## Every attempt, by task

| Task | Direct | Ralph Loop | Execute & Evaluate | Reflexion |
|---|---|---|---|---|
| `pen-and-notebook` | ✗✗ | ✓✗ | ✓✗ | ✓✗ |
| `fence-posts` | ✗✗ | ✗✗ | ✗✗ | ✓✗ |
| `birthday-23` | ✓✓ | ✗✗ | ✗✗ | ✗✗ |
| `fizzbuzz-digits` | ✓✗ | ✓✓ | ✓✗ | ✓✓ |
| `median-fix` | ✗✗ | ✗✗ | ✓✗ | ✗✗ |

One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.

## Conclusions

### Against the direct arm

- **Ralph Loop** inconclusive: Ralph Loop passed 3 of 10 (11% to 60%) and Direct 3 of 10 (11% to 60%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 3 of 10 (11% to 60%) and Direct 3 of 10 (11% to 60%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 4 of 10 (17% to 69%) and Direct 3 of 10 (11% to 60%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+10 points) would take about 356 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

### Against Ralph Loop, a baseline

- **Execute & Evaluate** inconclusive: Execute & Evaluate passed 3 of 10 (11% to 60%) and Ralph Loop 3 of 10 (11% to 60%). The 95% intervals overlap, so these counts do not tell the two apart. They passed equally often here, so these counts give no difference to size a longer run by.
- **Reflexion** inconclusive: Reflexion passed 4 of 10 (17% to 69%) and Ralph Loop 3 of 10 (11% to 60%). The 95% intervals overlap, so these counts do not tell the two apart. Finding a difference of this size (+10 points) would take about 356 runs per arm (two proportions, 95% two-sided, power 80%); the rule here, intervals that do not overlap, is stricter than that test, so expect more.

## What this does not show

- **One model.** Every role of every arm ran on `ollama/qwen2.5:7b`. Another model, or different models in different roles, may order the arms differently.
- **Few runs.** 2 repetitions of 5 tasks: 10 attempts per topology arm. Intervals this wide tell apart only large differences. Inconclusive means these counts cannot tell the arms apart, not that they are equal.
- **A small task set.** 5 tasks (reasoning, coding, python, bug-fix), chosen by whoever wrote the set. They are not a sample of any wider kind of work, and what holds on them may not hold on yours.
- **Attempts are not independent draws.** Each interval treats every attempt as one independent try. Attempts on the same task share its difficulty, so the real uncertainty is larger than the intervals show.
- **The direct arm gets one call and no tools, by design.** It measures the model asked plainly, so the other arms show what a harness adds. Writing its answer into the task's file is the lab's doing, not the model's: the last line of its reply, or its last code block, is written where the task says, and nothing else is done to it.
- **Who hears the checks.** In the arms with a Check role, Check's verdict is the lab's measured check, so on a way back Do learns whether the checks passed and what they printed (never the checks themselves). The direct arm and the Ralph Loop get no such signal. This compares the topologies as Jig runs them by default, not the roles' reasoning alone.
- **No best-of-N baseline yet.** Best-of-N at the same budget (independent single-loop attempts until the budget is spent, kept if any passes the checks) is planned and not built.
- **Tokens and time, not money.** No prices are applied. Time is wall-clock on one machine and depends on whatever else it was running.

## Runs

<details><summary>Every attempt with its run id</summary>

| Task | Arm | # | Outcome | Checks | Tokens | Time | Rounds | Run id |
|---|---|---|---|---|---|---|---|---|
| `pen-and-notebook` | Direct | 1 | failed | 0 of 1 | 144 | 0.3 s | - | `direct.pen-and-notebook.1.mwodez4e` |
| `pen-and-notebook` | Direct | 2 | failed | 0 of 1 | 144 | 0.3 s | - | `direct.pen-and-notebook.2.mwoekbfa` |
| `pen-and-notebook` | Ralph Loop | 1 | passed | 1 of 1 | 2,207 | 7.1 s | 1 | `ralph-loop.pen-and-notebook.1.mwodeze3` |
| `pen-and-notebook` | Ralph Loop | 2 | failed | 0 of 1 | 2,207 | 7.1 s | 1 | `ralph-loop.pen-and-notebook.2.mwoekbp8` |
| `pen-and-notebook` | Execute & Evaluate | 1 | passed | 1 of 1 | 3,863 | 20.0 s | 1 | `exec-eval.pen-and-notebook.1.mwodf4wd` |
| `pen-and-notebook` | Execute & Evaluate | 2 | failed | 0 of 1 | 14,567 | 45.0 s | 3 | `exec-eval.pen-and-notebook.2.mwoekh5o` |
| `pen-and-notebook` | Reflexion | 1 | passed | 1 of 1 | 5,406 | 30.7 s | 1 | `reflexion.pen-and-notebook.1.mwodfkb9` |
| `pen-and-notebook` | Reflexion | 2 | failed | 0 of 1 | 20,750 | 151.5 s | 3 | `reflexion.pen-and-notebook.2.mwoelfvr` |
| `fence-posts` | Direct | 1 | failed | 0 of 1 | 125 | 0.8 s | - | `direct.fence-posts.1.mwodg81k` |
| `fence-posts` | Direct | 2 | failed | 0 of 1 | 125 | 0.4 s | - | `direct.fence-posts.2.mwoeoot4` |
| `fence-posts` | Ralph Loop | 1 | failed | 0 of 1 | 2,170 | 9.5 s | 1 | `ralph-loop.fence-posts.1.mwodg8pc` |
| `fence-posts` | Ralph Loop | 2 | failed | 0 of 1 | 2,167 | 20.4 s | 1 | `ralph-loop.fence-posts.2.mwoeop3q` |
| `fence-posts` | Execute & Evaluate | 1 | failed | 0 of 1 | 14,309 | 75.4 s | 3 | `exec-eval.fence-posts.1.mwodgg2x` |
| `fence-posts` | Execute & Evaluate | 2 | failed | 0 of 1 | 14,425 | 103.4 s | 3 | `exec-eval.fence-posts.2.mwoep4ud` |
| `fence-posts` | Reflexion | 1 | passed | 1 of 1 | 19,706 | 125.6 s | 3 | `reflexion.fence-posts.1.mwodi2rl` |
| `fence-posts` | Reflexion | 2 | failed | 0 of 1 | 16,314 | 64.1 s | 3 | `reflexion.fence-posts.2.mwoercp0` |
| `birthday-23` | Direct | 1 | passed | 1 of 1 | 161 | 2.8 s | - | `direct.birthday-23.1.mwodks50` |
| `birthday-23` | Direct | 2 | passed | 1 of 1 | 161 | 0.4 s | - | `direct.birthday-23.2.mwoesq76` |
| `birthday-23` | Ralph Loop | 1 | failed | 0 of 1 | 2,248 | 13.9 s | 1 | `ralph-loop.birthday-23.1.mwodkuqi` |
| `birthday-23` | Ralph Loop | 2 | failed | 0 of 1 | 2,241 | 7.4 s | 1 | `ralph-loop.birthday-23.2.mwoesqhi` |
| `birthday-23` | Execute & Evaluate | 1 | failed | 0 of 1 | 15,377 | 67.4 s | 3 | `exec-eval.birthday-23.1.mwodl69s` |
| `birthday-23` | Execute & Evaluate | 2 | failed | 0 of 1 | 15,408 | 54.8 s | 3 | `exec-eval.birthday-23.2.mwoesw7m` |
| `birthday-23` | Reflexion | 1 | failed | 0 of 1 | 17,050 | 64.5 s | 3 | `reflexion.birthday-23.1.mwodmmrn` |
| `birthday-23` | Reflexion | 2 | failed | 0 of 1 | 16,989 | 62.6 s | 3 | `reflexion.birthday-23.2.mwoeu2gq` |
| `fizzbuzz-digits` | Direct | 1 | passed | 1 of 1 | 311 | 5.8 s | - | `direct.fizzbuzz-digits.1.mwodo0kx` |
| `fizzbuzz-digits` | Direct | 2 | failed | 0 of 1 | 352 | 7.2 s | - | `direct.fizzbuzz-digits.2.mwoevesz` |
| `fizzbuzz-digits` | Ralph Loop | 1 | passed | 1 of 1 | 2,567 | 13.5 s | 1 | `ralph-loop.fizzbuzz-digits.1.mwodo517` |
| `fizzbuzz-digits` | Ralph Loop | 2 | passed | 1 of 1 | 2,629 | 15.3 s | 1 | `ralph-loop.fizzbuzz-digits.2.mwoevkbz` |
| `fizzbuzz-digits` | Execute & Evaluate | 1 | passed | 1 of 1 | 5,952 | 29.9 s | 1 | `exec-eval.fizzbuzz-digits.1.mwodofg2` |
| `fizzbuzz-digits` | Execute & Evaluate | 2 | failed | 0 of 1 | 18,959 | 96.3 s | 3 | `exec-eval.fizzbuzz-digits.2.mwoevw4s` |
| `fizzbuzz-digits` | Reflexion | 1 | passed | 1 of 1 | 7,247 | 46.7 s | 1 | `reflexion.fizzbuzz-digits.1.mwodp2jp` |
| `fizzbuzz-digits` | Reflexion | 2 | passed | 1 of 1 | 6,664 | 37.6 s | 1 | `reflexion.fizzbuzz-digits.2.mwoexygo` |
| `median-fix` | Direct | 1 | failed | 0 of 1 | 415 | 4.7 s | - | `direct.median-fix.1.mwodq2km` |
| `median-fix` | Direct | 2 | failed | 0 of 1 | 394 | 3.8 s | - | `direct.median-fix.2.mwoeyrgc` |
| `median-fix` | Ralph Loop | 1 | failed | 0 of 1 | 3,616 | 16.0 s | 1 | `ralph-loop.median-fix.1.mwodq687` |
| `median-fix` | Ralph Loop | 2 | failed | 0 of 1 | 3,687 | 19.6 s | 1 | `ralph-loop.median-fix.2.mwoeyudd` |
| `median-fix` | Execute & Evaluate | 1 | passed | 1 of 1 | 40,790 | 344.8 s | 2 | `exec-eval.median-fix.1.mwodqik9` |
| `median-fix` | Execute & Evaluate | 2 | failed | 0 of 1 | 47,747 | 206.4 s | 3 | `exec-eval.median-fix.2.mwoez9gn` |
| `median-fix` | Reflexion | 1 | failed | 0 of 1 | 13,013 | 1045.6 s | 2 | `reflexion.median-fix.1.mwodxwm4` |
| `median-fix` | Reflexion | 2 | failed | 0 of 1 | 20,928 | 154.4 s | 3 | `reflexion.median-fix.2.mwof3orn` |

</details>

A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.

Report drawn 2026-11-20T03:29:34.995Z from 40 recorded attempts.
