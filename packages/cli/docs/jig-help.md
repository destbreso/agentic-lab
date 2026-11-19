# Jig's own documentation

The jig_help tool searches this file, with the slash commands, the built-in topologies and the version added from the code when it runs. Each part starts with a level-two heading.

## What Jig is

Jig is a Joint Inference Graph: several models reasoning together, arranged as a graph you define. A topology names the roles (Plan, Do, Check, Critique, Decide, an Advisor that another role may consult), the order they work in, the ways the work goes back (Check fails: back to Do), and the limits. Each role runs on a model from any provider you have, or on a brain, a named chain of models. You use it for real work in your own project, and every run is recorded so it can be replayed and measured.

`jig` with nothing after it opens a session in your terminal, the way `claude` does: each message you send is a task your topology runs, drawn live on its grid. `jig run` runs one task from a script. The packages are jig-console (the `jig` command) and jig-core (the engine, for building your own harness in code).

## The session and its keys

The topology sits at the top, drawn on its grid; the conversation is in the middle; the input is in its own box near the bottom, with the run's activity line just above it while a task runs; the footer is under the box: the topology, its roles, the model and the permission mode, then each role's state.

- Enter sends. Alt+Enter, Ctrl+J or a backslash before Enter start a new line. A paste goes in whole.
- Up and down walk your earlier messages. Tab completes a slash command and its arguments.
- Typing while a run goes sends a note Do reads on its next turn. Esc stops the run.
- Shift+Tab cycles the permission mode: default, accept edits, plan.
- Ctrl+T folds the topology to one line. PgUp and PgDn scroll the conversation. Ctrl+D quits.
- `jig --resume` opens your last session again, with its conversation and settings.
- A command that takes a choice opens a picker when you type it alone (arrows, Enter, Esc, the current value marked, typing filters a long list), and acts at once when you give it the choice.

## Switching the topology, a role's model or its brain

- To switch the topology, type `/topology` alone and pick one with the arrows and Enter, or type `/topology <id>`, for example `/topology deep-reasoning`. A `.yaml` or `.json` definition file in your project works too: `/topology my-flow.yaml`. `/topology list` prints them all.
- To change one role's model, type `/models` alone: pick the role (Check, for example), then pick a model or a brain from the live lists. Or give it at once: `/models <role id> <entry>/<model>`, for example `/models eval ollama/qwen2.5:14b` gives Check (its id is eval) that model. `/models default <entry>/<model>` changes every role not named. A role can also take a brain: `/models eval strong`.
- `/models table` shows each role with its model or brain; `/models list` shows the models each provider has now.
- From a script: `jig run --topology <id> --model <name> --provider <entry>`.
- The role ids of the built-in topologies are listed below under the built-in topologies; Do is usually exec, Check is eval, Plan is plan, Critique is critic, Decide is refine.

## Permissions and modes

Jig decides every tool call a role makes before it runs, as Claude Code does.

- Reads inside the working directories run without asking; a read outside asks.
- A write asks, with the diff of what would change: Yes, Yes and allow all edits for this session, or No.
- A shell command runs without asking when every part only reads (ls, cat, grep, git status, a cd inside); anything else asks, part by part. The wider yes keeps the command's prefix as a rule for the project, in `.jig/settings.local.json`.
- No opens a field for what to do instead; the role reads it and goes on. A plain No, or Esc, stops the run.
- Modes, cycled with Shift+Tab: default asks as above; accept edits runs writes (and mkdir, touch, mv, cp) inside the working directories without asking; plan only reads. `--dangerously-skip-permissions` skips the questions for one session or run, except deny rules, ask rules and dangerous removals.
- Rules look like `Shell(npm test *)`, `Write(src/**)`, `Read(./.env)`, in `~/.config/jig/config.json`, the project's `jig.config.json` or `.jig/settings.local.json`. Deny beats ask, and ask beats allow. `/permissions` lists and changes them; `/add-dir` adds a working directory.
- `jig run` has nobody to ask, so what would ask is denied: allow it with `--permission-mode acceptEdits`, `--allow 'Shell(npm test *)'` or a rule.

## Providers, keys and brains

- Jig finds the model servers running on this computer by itself, in the background when a session opens: Ollama (11434, or OLLAMA_HOST), LM Studio (1234), llama.cpp or llamafile (8080), vLLM (8000), Jan (1337), text-generation-webui (5000), KoboldCpp (5001), LiteLLM (4000), GPT4All (4891) and Docker Model Runner (12434). It only asks 127.0.0.1, never the network. What answers can be used at once and joins the local brains; `/providers keep <name>` or `jig providers discover --save` writes it to your config, and `/providers discover` asks again.
- With nothing configured, Jig chooses the default model and the brains only from models it finds listed, by one rule: tool users first; local brain: local models, larger first; fast: local, smaller first, then cloud; strong: cloud by context, then local, larger first; your own default when it is listed. With no model at all it asks how to get one: install Ollama, add a cloud key, or give a server's address. `/models` shows local or cloud, tool use and context for each model.
- The privacy boundary: a local model's work never falls back to a cloud model unless the brain says so, written as `{ "chain": [...], "crossToCloud": true }`. A project with `"providers": "local-only"` in its `jig.config.json` runs on local models only, and refuses cloud providers. `/brains` and `/providers` show it.
- Provider entries live in `~/.config/jig/config.json` under "providers": Ollama (the default, `http://localhost:11434`), Anthropic, OpenAI, Gemini, OpenRouter, or any server that speaks OpenAI's API (presets for LM Studio, llama.cpp, vLLM, Jan, Groq, Mistral, DeepSeek, Together).
- A key is always a reference, never written by Jig: `env:NAME`, `keychain` (your OS keychain) or `command:<program>`. `/providers` in the session, or `jig providers list|add|test|remove`, administers them.
- A role names a model as `<entry>/<model>`, for example `ollama/qwen2.5:7b`.
- A brain is a named chain of models: `default`, `strong`, `fast` and `local` come with Jig, and you can set your own under "brains". A role on a brain moves to the next model only when a provider is unavailable, never on a bad answer, and the screen marks it with ↪. `/brains` and `jig brains` show which model would answer now; `jig doctor` checks everything.
- The built-in topologies give roles that produce work `fast` and roles that judge `strong`; with only Ollama they are all your local model.

## Where files live: sessions, runs, settings

- Sessions, runs and your history are kept in `.jig/` in the folder you run Jig in: `sessions/` (each session's conversation and settings, which `jig --resume` opens), `runs/` (each run's steps and record, for /replay), `history.jsonl` (your input history) and `settings.local.json` (your own permission rules). It has its own .gitignore, so none of it lands in a commit.
- `~/.config/jig/config.json` (or under `XDG_CONFIG_HOME`): your providers, brains and settings. A project's `jig.config.json` goes over it.
- A topology file (`.yaml` or `.json`) can sit anywhere in your project; `jig validate <file>` checks it and `jig convert <file>` converts it.

## Checks and outcomes

- `/checks add <command>` gives the next task a check the lab runs itself, where no role can write: it passes when the command exits 0. `jig run --check "<command>"` does the same.
- A run ends passed, failed, inconclusive, stopped or not verified. Not verified means nothing could check the answer: nothing changed, there were no checks, and no role gave a verdict.
- `/runs` and `/replay` play a past run again on the same screen; `/budget` sets the tokens a task may spend; `/memory` sets how far back recall reaches.

## Scripts and other commands

- `jig run --topology <id> --task "<text>"` runs one task and exits 0 when it passed.
- `jig show <topology>` draws a topology; `--play` runs it on a scripted model, with no tokens.
- `jig replay <run-id>` plays a recorded run.
- `jig validate <file>` and `jig convert <file>` check and convert topology files.
- `jig --help` lists everything.
