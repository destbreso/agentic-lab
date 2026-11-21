# jig-benchmark

Benchmarks for [Jig](https://github.com/destbreso/jig) topologies. Jig runs a topology of models on a task and records what each role saw. jig-benchmark decides what to run, how many times, how to compare the results and how to show them, so you can answer one kind of question on your own tasks: does this topology pass more often than the model asked directly, and more often than the simplest harness?

It depends on [jig-core](https://github.com/destbreso/jig/tree/main/packages/core#readme) only. Every topology attempt runs through jig-core's `TopologyRun`, and the direct arm's one call goes to the same provider; either way the task's checks are run by the lab after the attempt, with jig-core's `MeasuredChecker`, in a copy of the workspace no role can write.

## Install

```sh
npm install -g jig-benchmark
```

It needs Node 20 or later and a model to talk to; a local [Ollama](https://ollama.com) is enough. The starter task set's checks need Python 3.

## What an experiment is

An experiment compares arms on a task set. Each arm runs every task a number of times, each time in a fresh temporary workspace holding the task's files, and the task's checks say whether it passed. Three kinds of arm are in every experiment:

- **The direct arm, always.** The model is asked once: the task, the contents of its starting files, no tools, no rounds, no retries. No spec can remove it. It is there to measure whether a harness helps at all, before asking whether one topology beats another.
- **The baselines.** The Ralph Loop (`ralph-loop`), Jig's smallest topology, unless the spec says `baselines: []`.
- **The arms you name.** Built-in topologies by id (`exec-eval`, `reflexion`, ...) or topology files.

Every role of every arm runs on the one model the spec names, so the arms differ by their topology alone. Best-of-N at the same budget is planned as a second baseline and is not built yet.

The direct arm's answer reaches the same checks through a convention each task declares. `direct: { answer_file: answer.txt }` writes the last line of the model's reply, trimmed, to that file. `direct: { file: solution.py }` writes the reply's last fenced code block (or the whole reply, when it has none) to that file. The model is told which, in one sentence after the task. Then the task's checks run exactly as for the other arms. Writing the answer into the file is the lab's doing, not the model's, and the report says so. A task without a `direct` block is not applicable to the direct arm: the report shows "n/a", never a failure, and the direct arm's count covers only the tasks where it applies.

## A task set

A YAML or JSON file: a name, a description and the tasks.

```yaml
name: my-tasks
description: Two small things I want done well.
tasks:
  - id: median-fix
    tags: [coding, python]
    task: Fix stats.py so that the tests in test_stats.py pass. Do not change test_stats.py.
    files:
      stats.py: |
        def median(values):
            values.sort()
            return values[len(values) // 2]
      test_stats.py: |
        ...
    checks:
      - python3 -m unittest -q test_stats
    check_files: [test_stats.py]
    direct: {file: stats.py}

  - id: fence-posts
    tags: [reasoning]
    task: A straight fence is 120 meters long, with a post at each end and one every 8 meters between them. How many posts? Write only the number to answer.txt.
    checks:
      - python3 .checks/answer.py
    check_files:
      - path: .checks/answer.py
        content: |
          import sys
          sys.exit(0 if open("answer.txt").read().strip() == "16" else "answer.txt does not hold the expected answer")
    direct: {answer_file: answer.txt}
```

- `id`: letters, digits, dots, dashes and underscores, unique in the set.
- `task`: what every arm is asked.
- `files`: the workspace every attempt starts from, path to content.
- `checks`: shell commands the lab runs after the run; a check passes when it exits 0, and a task passes when every check does. A check can also be `{ name, command, timeout_ms }`. At least one is required: the lab measures, it does not judge.
- `check_files`: files a check depends on. A path names one of the task's files, put back as it was before every check, so a role that edits a test changes nothing. A `{ path, content }` exists only in the copy where the checks run, so no role can read it: a hidden test, or an expected answer. A failing check's output reaches a Check role on a way back, so a check that holds an expected answer should print nothing that gives it away.
- `direct`: where the direct arm's answer goes, as above.
- `tags`: free words, shown in the report.

Every problem is reported at its path and line, as `tasks[1].check_files[1] (line 9): "gone.py" is not one of the task's files`.

The package ships one set, `tasks/starter.yaml`: three questions with one exact answer (variations on the bat and the ball, the fence posts and the birthday paradox, with new numbers) and two small Python tasks (FizzBuzz with digits, and a buggy median with its tests). Each is meant to be within reach of a 7B local model sometimes but not always.

## Public task sets

Two public datasets come in through `jig-benchmark fetch`, taken from their authors' own repositories, never from a copy:

```sh
jig-benchmark fetch humaneval --sample 20 --seed 1   # Python functions to complete, each with the dataset's own tests
jig-benchmark fetch gsm8k --sample 20 --seed 1       # math word problems with one numeric answer
```

Each writes an ordinary task set (`tasks/<name>.yaml`, or `--out <file>`) that you can read, edit and lock like any other. `--all` takes every task instead of a sample; the same seed always picks the same tasks. The file is downloaded once into a cache (`~/.cache/jig-benchmark`, or `JIG_BENCHMARK_CACHE`), and `--from <file>` uses a copy you already have.

- **HumanEval** (OpenAI, MIT): `solution.py` starts as the function's signature and docstring, and the task is to complete it. The dataset's tests run from a check file no role can see, and they say only whether they passed: a role that hears the checks on a way back learns that a test failed, never which one or what it expected. The direct arm's last code block becomes `solution.py`.
- **GSM8K** (OpenAI, MIT): the answer goes to `answer.txt`, and the check compares its last number with the dataset's answer exactly, never printing it. The direct arm's last line becomes `answer.txt`.
- **The checks can't be fooled by the work they check:** both run as `python3 -I`, so a module in the workspace never shadows the standard library, and HumanEval's runs the solution with everything it prints sent nowhere and fails on any exception, `SystemExit` included, reporting only its type and its line. Left open: a solution that calls `os._exit(0)` itself.

Both conversions were checked against the datasets themselves: every one of HumanEval's 164 reference solutions passes its check and every starting file fails it, and every one of GSM8K's 1,319 answers passes its check and every wrong answer fails it, with no check printing what it compares against.

A task set made this way names its source, licence and the file's sha256, and the report shows them. Its "what this does not show" adds that these problems are public, so the model may have seen them in training: that can raise every arm's count, the direct arm's above all.

## A spec

```yaml
name: starter-qwen2.5-7b
question: On the starter tasks and qwen2.5:7b, do Execute & Evaluate and Reflexion pass more often than the model asked directly, and than the Ralph Loop?
tasks: ../tasks/starter.yaml          # or {file: ..., only: [task ids]}
arms: [exec-eval, reflexion]          # built-in ids, topology files, or {topology, label}
model: ollama/qwen2.5:7b              # <entry>/<model>, for every role of every arm
repetitions: 2
budget: {tokens: 60000, rounds: 3}
permissions: {allow: ["Shell(python3 *)"]}
rule: {margin: 0.15}
```

| Field | Default | What it is |
|---|---|---|
| `name` | (required) | Names the experiment and its output folder. |
| `question` | (required) | The question in words, repeated at the top of the report. |
| `tasks` | (required) | A task-set file, relative to the spec, optionally `{ file, only }` for a subset of its ids. |
| `arms` | `[]` | Topologies to compare, each a built-in id, a `.yaml` or `.json` topology file, or `{ topology, label }`. |
| `baselines` | `[ralph-loop]` | Topologies the arms are compared against. `[]` removes them; the direct arm stays. |
| `model` | (required) | `<entry>/<model>`: an entry of your Jig configuration, or a provider kind (`ollama`, `openai`, `anthropic`, ...) with its defaults. Keys are read from their references, as `jig` reads them. |
| `repetitions` | (required) | Attempts per task and arm. |
| `budget.tokens` | (required) | Tokens one attempt may spend. A run stops after the model call that crosses it, so it can go over by that one call. The direct arm's single call is capped at the smaller of this and 4,096 output tokens. |
| `budget.rounds` | each topology's own | A round limit for every topology arm, the baselines included. |
| `permissions` | accept edits | `mode` (`acceptEdits`, `default` or `plan`), `allow` and `deny` rules in Jig's shape. Only these rules apply, never your own configuration files, and anything that would ask is denied, since nobody is there to ask. |
| `concurrency` | `1` | Attempts at once. |
| `verdict_from` | `measured` | Where a Check role's verdict comes from: the lab's measured checks (Jig's default) or its own model. |
| `count_fallbacks` | `false` | Whether an attempt in which a role fell back to another model counts. With one model and no chain this cannot happen; the flag is there for when roles get brains. |
| `rule` | `{}` | `margin`: a difference smaller than this either way counts as no practical difference. |

A spec cannot name a `direct` field: the direct arm is part of every experiment.

## The commands

```sh
jig-benchmark fetch humaneval --sample 20         # a task set from a public dataset (above)
jig-benchmark estimate examples/starter.yaml     # attempts and the token bound, before anything runs
jig-benchmark run examples/starter.yaml          # runs what is not recorded yet, prints the table, writes report.md
jig-benchmark report benchmark-results/starter-qwen2.5-7b   # the table again, and report.md
```

`run` writes into `--out <folder>` (default `benchmark-results/<name>` in the folder you run it from):

- `lock.json`: written before the first attempt. It holds the hash of the spec, the task set and any topology file, the jig-core version, the date, and the spec and task set themselves, so a report needs nothing but the folder.
- `results.jsonl`: one line per attempt (arm, task, repetition, run id, outcome, checks passed and total, tokens, duration, rounds, fallbacks, model call errors, an error if it could not start).
- `runs/<run id>/`: each topology run's `steps.json` and `record.json`, in the layout `jig run` keeps, and the direct arm's `direct.json` (its prompt, its reply, what was written and the checks' results).
- `report.md`.

Running the same spec again goes on where it stopped: attempts already recorded are skipped, and one that could not start (the provider down, say) is tried again. A rerun refuses when the spec, the task set or a topology file changed, or when jig-core is another version: that is another experiment, in another folder. The rule is fixed before the first attempt and locked by the hash, so it cannot be changed after looking, and neither can the number of repetitions. Ctrl+C stops the attempts in flight and records none of them; a second Ctrl+C quits at once.

## What the numbers mean

- **Per arm:** k passed of n attempts, with a 95% Wilson interval, and the medians of tokens and time over the attempts that count. An attempt that could not start, or in which a role fell back to another model, counts for nothing and is listed apart. One that ended without a result from the checks counts as not passed.
- **Against another arm:** every arm is compared with the direct arm (on the tasks the direct arm applies to) and every arm with each baseline, by the same rule. **Supports** when the arm's interval lies wholly above the other's; **against** when it lies wholly below, or, with a margin, when the 95% Newcombe interval of the difference lies inside the margin either way (no practical difference); **inconclusive** otherwise.
- **Inconclusive** comes with the runs per arm a difference of the observed size would need, by the usual two-proportion count (95% two-sided, power 80%). The rule here, intervals that do not overlap, is stricter than that test, so the real number is larger, and the sentence says so.

## What they don't mean

- Attempts on the same task are not independent draws: they share its difficulty, so the real uncertainty is larger than the intervals show.
- One model, one machine, one task set: what holds there may not hold on another model or on your tasks.
- The direct arm gets one call and no tools by design; it is not a weak harness, it is no harness.
- With Check's verdict from the measured checks (the default), an arm with a Check role learns on a way back whether the checks passed and what they printed; the direct arm and the Ralph Loop do not. The comparison is of the topologies as Jig runs them.
- Time is wall-clock on one machine and depends on whatever else it was running. There are no prices.

## Replaying a run

`jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so it cannot play a run from `runs/` as it is. Copy the run's folder there first:

```sh
cd benchmark-results/starter-qwen2.5-7b
mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>
```

## A first run

The run behind this section: [examples/results/starter-qwen2.5-7b/report.md](examples/results/starter-qwen2.5-7b/report.md), the spec `examples/starter.yaml` on one machine (an Apple M4 with 24 GB, Ollama serving qwen2.5:7b), 2 repetitions, jig-core 0.1.7. It shows what one small run can and cannot say, not how these topologies do in general. Its lock and results are beside the report; its `runs/` folder is not kept in the repository. The table, as the report draws it:

| Arm | Kind | Passed | 95% interval | Median tokens | Median time | Not counted |
|---|---|---|---|---|---|---|
| Direct | direct | 3 of 10 | 11% to 60% | 161 | 1.8 s | - |
| Ralph Loop | baseline | 3 of 10 | 11% to 60% | 2,245 | 13.7 s | - |
| Execute & Evaluate | arm | 3 of 10 | 11% to 60% | 14,972 | 71.4 s | - |
| Reflexion | arm | 4 of 10 | 17% to 69% | 16,652 | 64.3 s | - |

Every comparison, against the direct arm and against the Ralph Loop, is inconclusive: at 10 attempts per arm these counts cannot tell the four apart. In this run the two topologies with a Check role spent 6.7 and 7.4 times the Ralph Loop's median tokens for no difference the counts can show. One of Reflexion's model calls timed out (300 s) inside an attempt that still counted. The 40 attempts took 49 minutes 47 seconds of wall-clock time, by the clock before and after the run.

## The passes of 2026-11-20

[examples/results/2026-11-20](examples/results/2026-11-20/README.md) keeps the passes that found most of jig-core 0.1.9's fixes: five HumanEval and five GSM8K problems through every built-in topology, beside the model asked directly and the Ralph Loop, on gemini-3.5-flash-lite, claude-haiku-5-5, gpt-5.4-nano and gpt-4.1-mini, each with what it found. They were run to find what was wrong in the harness: at five tasks no comparison between topologies is conclusive, and HumanEval is saturated for these models (on Haiku and Gemini every arm passes all five).

## Not built yet

- **Every number of a run as tables, for statistics and charts:** a row per attempt, per role and per model call, with cost, time, reasoning and cached tokens, and every retry with its cause, exported as CSV, with a summary per arm and charts fit to publish. Today `results.jsonl` holds per attempt its outcome, checks, tokens in and out, duration, rounds, fallbacks, failed calls, the model and jig-core's version.
- Best-of-N at the same budget as a second baseline.
- Variant switches the hypotheses need (what Critique sees, where Check's verdict comes from per arm, a consult's sight), and per-role models.
- The designer that drafts an experiment from a question, and the ledger that keeps what each experiment found against Jig's hypotheses.
- Checks by a model judge (marked as opinion), more public datasets (a harder one than HumanEval, which current cheap models saturate), prices, and an HTML report.
- `fetch`: `--sample` larger than the file names the set as if it were `--all` while the recorded command says the sample, and HumanEval's `--from` takes only the gzipped file. The lock keeps the whole task set, check files included, readable only outside the permission guard.

## Licence

MIT.
