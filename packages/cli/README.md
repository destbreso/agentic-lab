# jig-console

`jig` is the terminal for Jig. Jig is a Joint Inference Graph: several models reasoning together, arranged as a graph you define. You pick a topology (roles such as Plan, Do, Check, Critique and Decide, the ways the work goes back, a role another may consult), give each role a model from any provider you have, and use it for real work.

Jig was called Agentic Lab before.

## Install

```sh
npm install -g jig-console
```

Then `jig` works in any terminal. It needs Node 20 or later and a model to talk to; a local [Ollama](https://ollama.com) is enough. It is tested on macOS, and on Linux in a container; not yet on Windows.

To work on Jig itself, build it from source and link it:

```sh
git clone https://github.com/destbreso/jig.git
cd jig
npm install
npm run build:core && npm run build:cli
cd packages/cli && npm link
```

## A session

Run `jig` in your project. Each message you send is a task your topology runs.

- The topology sits at the top, drawn on its grid, and moves while a task runs: who is at work, the round, each way back taken. Ctrl+T folds it to one line.
- The answer streams in as Do's model writes it, with the run's latest steps under it, and ends with its outcome: passed, failed, inconclusive or stopped.
- Typing while a run goes sends a note Do reads on its next turn. Esc stops the run.
- Jig asks before it acts, as Claude Code does. See Permissions below.
- Slash commands, completed with Tab: `/topology`, `/models`, `/tools`, `/permissions`, `/add-dir`, `/sight`, `/checks`, `/budget`, `/memory`, `/advisor`, `/runs`, `/replay`, `/clear`, `/quit`, and `/help` for the rest.
- A command that takes a choice opens a picker when you type it alone: `/topology` lists the topologies with the current one marked, and the arrows and Enter switch. Give it the choice and it acts at once: `/topology advisor`. Every command that takes a choice works this way, and new ones will too. `/tools` gives each role a checklist, and `list` prints what a picker would show.
- `jig --resume` opens your last session again, with its conversation and settings.

Jig keeps runs, sessions and your input history in `.jig/` in the folder you run it in. That folder gets its own `.gitignore`, so your prompts never end up in a commit.

`--plain` draws without colour or style, and `--ascii` with plain ASCII. Colour only ever means a run's state: green is running, red failed, amber waiting for you.

## Providers

Jig finds the model servers running on your computer by itself. When a session opens, it asks the usual ports of Ollama (11434, or the port in `OLLAMA_HOST`), LM Studio (1234), a llama.cpp server or llamafile (8080), vLLM (8000), Jan (1337), text-generation-webui (5000), KoboldCpp (5001), a LiteLLM proxy (4000), GPT4All (4891) and Docker Model Runner (12434), all at once, for their model lists. It never waits for them: the session opens straight away, and the header says what answered, like `ollama up (12 models) ∙ lmstudio up (3)`.

It only ever asks your own computer (127.0.0.1). It never looks at your network. A server on another machine is one you add yourself, with `/providers add` or `jig providers add`.

A server it finds can be used right away: it joins the `local` and `fast` brains after the providers you configured. It isn't written to your config until you keep it, with `/providers` (keep or ignore) or `jig providers discover --save`. If your config already names a server at the same address, yours wins and nothing shows twice. `/providers discover` asks again, and `jig doctor` shows what it found.

On a new computer you don't have to configure anything. Jig looks at what's there, lists every model, checks what each one can do, and picks the default and its brains only from models that really exist. It prefers models that can use tools, local ones first, and bigger ones for `strong`, smaller ones for `fast`. If it finds no model at all, it asks how you want to get one: install Ollama, add a cloud key (typed hidden and kept in your keychain), or give a server's address. `/models` shows whether each model runs locally or in the cloud, whether it can use tools, and its context, and Jig warns you before a run when a role with tools has a model that can't use them.

Your work stays local unless you say otherwise. When a local model is down, Jig won't quietly move that role's work to a cloud model. A brain can allow it by being written as `{ "chain": [...], "crossToCloud": true }`. A project that must never use the cloud says `"providers": "local-only"` in its `jig.config.json`. Then every brain runs on local models, and a cloud provider is refused there with the reason. `/brains` and `/providers` show where that line is.

Cloud providers are found by their usual key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`). Jig lists them as "key found in env" and never prints the key.

## Permissions

Every tool call a role makes is decided before it runs. Reading inside your project just happens. A write asks you, and shows you the diff. A shell command asks unless every part of it only reads, like `ls`, `cat` or `git status`. A read outside your project asks too.

You answer Yes, No, or a wider yes when there is one: all edits for this session, or "don't ask again" for a command's prefix, which Jig keeps in `.jig/settings.local.json`. No opens a field where you say what to do instead, and the role goes on with it. A plain No, or Esc, stops the run.

Shift+Tab cycles the mode: default, accept edits (writes inside your project just happen) and plan (reading only). `--dangerously-skip-permissions` skips the questions for one session, except your deny and ask rules and a removal that could wipe your home or the project.

Rules look like Claude Code's: `Shell(npm test *)`, `Write(src/**)`, `Read(./.env)`. They live in `~/.config/jig/config.json`, your project's `jig.config.json` and `.jig/settings.local.json`. Deny beats ask, and ask beats allow. `/permissions` lists them and changes them, and `/add-dir` lets roles work in another folder.

`jig run` has nobody to ask, so whatever would ask is denied. Allow it with `--permission-mode acceptEdits`, `--allow 'Shell(npm test *)'` or a rule.

The main README lists where this differs from Claude Code, and why.

## For scripts

The subcommands stay:

- `jig run` runs a topology on a task and exits 0 when it passed. `--check "<command>"` gives it a check Jig runs itself, where no role can write.
- `jig show <topology>` draws a topology; `--play` runs it on a scripted model, with no tokens.
- `jig replay <run-id>` plays a recorded run.
- `jig validate <file>` and `jig convert <file>` check and convert topology files.

`jig --help` lists everything. The engine behind it is [jig-core](https://github.com/destbreso/jig/tree/main/packages/core#readme).

## Licence

MIT.
