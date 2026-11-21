# The passes of 2026-11-20

Five HumanEval problems and five GSM8K problems (`jig-benchmark fetch <dataset> --sample 5 --seed 7`), run through every built-in topology beside the model asked directly and the Ralph Loop, one attempt each, on cheap cloud models. They were run to find what was wrong in the harness, not to rank topologies: at five tasks every comparison is inconclusive (5 of 5 has a 95% interval of 57% to 100%).

Each folder holds a pass as it ran: its spec, its lock, one line per attempt (`results.jsonl`) and its report. `tasks-v2/` holds the two task sets. The step records are not kept here.

## Which code each pass ran

- The first round (`*-gemini35lite`, `*-haiku55`, `*-gpt54nano`) ran on commit 61e87e6.
- The second round (`*-haiku55-v2`, `*-gpt54nano-v2`, `*-gpt41mini`) ran on the code of commit 2c8ef00: the fix for Claude's thinking signatures and OpenAI through the Responses API.
- Both say jig-core 0.1.9 in their reports, since neither build was published.

## What the first round found

- `*-haiku55`: in every topology built on the evaluation engine, the verdict call failed with "Invalid `signature` in thinking block", once in most attempts (the error counts below). Fixed in 63a1803; the second round has none.
- `*-gpt54nano`: on Chat Completions the model cannot reason when tools are offered, so Do wrote a guessed number with its first call. On GSM8K the Ralph Loop passed 1 of 5 and the Advisor 0 of 5, against 5 of 5 for the model asked directly. Fixed in 2c8ef00 (the Responses API at effort low); compare `gsm8k-gpt54nano` with `gsm8k-gpt54nano-v2`.

## HumanEval

| Arm | gemini-3.5-flash-lite | claude-haiku-5-5, 1st | claude-haiku-5-5, 2nd | gpt-5.4-nano, chat | gpt-5.4-nano, responses | gpt-4.1-mini |
|---|---|---|---|---|---|---|
| Direct | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 |
| Ralph Loop | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 3 of 5 | 4 of 5 |
| Execute & Evaluate | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Plan & Execute | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 | 4 of 5 |
| Reflexion | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 | 5 of 5 |
| Supervised Coder | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Adversarial Duel | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Advisor | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 4 of 5 | 4 of 5 |
| Deep Reasoning | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 |
| Full Agent Pipeline | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |

Model calls that ended in an error:

- gemini-3.5-flash-lite: none
- claude-haiku-5-5, 1st: Execute & Evaluate 2, Reflexion 4, Supervised Coder 2, Adversarial Duel 5, Deep Reasoning 3, Full Agent Pipeline 5.
- claude-haiku-5-5, 2nd: none
- gpt-5.4-nano, chat: none
- gpt-5.4-nano, responses: none
- gpt-4.1-mini: none

## GSM8K

| Arm | gemini-3.5-flash-lite | claude-haiku-5-5, 1st | claude-haiku-5-5, 2nd | gpt-5.4-nano, chat | gpt-5.4-nano, responses | gpt-4.1-mini |
|---|---|---|---|---|---|---|
| Direct | 4 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Ralph Loop | 4 of 5 | 5 of 5 | 5 of 5 | 1 of 5 | 3 of 5 | 2 of 5 |
| Execute & Evaluate | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Plan & Execute | 4 of 5 | 5 of 5 | 5 of 5 | 2 of 5 | 4 of 5 | 4 of 5 |
| Reflexion | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Supervised Coder | 4 of 5 | 5 of 5 | 4 of 5 | 4 of 5 | 5 of 5 | 5 of 5 |
| Adversarial Duel | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 | 5 of 5 |
| Advisor | 5 of 5 | 5 of 5 | 5 of 5 | 0 of 5 | 5 of 5 | 5 of 5 |
| Deep Reasoning | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 | 5 of 5 |
| Full Agent Pipeline | 5 of 5 | 5 of 5 | 5 of 5 | 4 of 5 | 5 of 5 | 4 of 5 |

Model calls that ended in an error:

- gemini-3.5-flash-lite: none
- claude-haiku-5-5, 1st: Execute & Evaluate 4, Reflexion 4, Supervised Coder 2, Adversarial Duel 5, Deep Reasoning 4, Full Agent Pipeline 5.
- claude-haiku-5-5, 2nd: none
- gpt-5.4-nano, chat: none
- gpt-5.4-nano, responses: none
- gpt-4.1-mini: none

## What these numbers do not say

- HumanEval is saturated for these models: on Haiku and Gemini every arm passes all five. A harder set is needed to tell topologies apart.
- The arms that go round again after a failed measured check hear the check's verdict, pass or fail, never the answer. On a problem with one numeric answer that is close to three tries with a referee, where the direct arm gets one. Compare an arm with the direct arm with that in mind.
- The problems are public, so a model may have seen them in training.
- The Ralph Loop does one turn on a task with no plan file, so it never hears the check: it stays the weakest arm on GSM8K with gpt-4.1-mini (2 of 5) and gpt-5.4-nano (3 of 5).
- A pass on qwen2.5:7b through Ollama was stopped at 7 of 50 attempts (one Supervised Coder attempt took 640 s on an Apple M4) and is not kept.

## Licence of the task sets

The task sets hold five problems of each dataset, with their tests and answers in hidden check files: HumanEval, Copyright (c) OpenAI, under the MIT licence; GSM8K, Copyright (c) 2021 OpenAI, under the MIT licence.
