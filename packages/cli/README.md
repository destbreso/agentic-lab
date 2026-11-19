# jig-console

`jig` is the terminal for Jig. Jig is a Joint Inference Graph: several models reasoning together, arranged as a graph you define. You pick a topology (roles such as Plan, Do, Check, Critique and Decide, the ways the work goes back, a role another may consult), give each role a model from any provider you have, and use it for real work.

Jig was called Agentic Lab before. The repository still has that name.

## Install

It is not on npm yet, so `npm i -g jig-console` will not find it. Today you build it from source and link it:

```sh
git clone https://github.com/destbreso/agentic-lab.git
cd agentic-lab
npm install
npm run build:core && npm run build:cli
cd packages/cli && npm link
```

Then `jig` works in any terminal. It needs Node 20 or later and a model to talk to; a local [Ollama](https://ollama.com) is enough.

## A session

Run `jig` in your project. Each message you send is a task your topology runs.

- The topology sits at the top, drawn on its grid, and moves while a task runs: who is at work, the round, each way back taken. Ctrl+T folds it to one line.
- The answer streams in as Do's model writes it, with the run's latest steps under it, and ends with its outcome: passed, failed, inconclusive or stopped.
- Typing while a run goes sends a note Do reads on its next turn. Esc stops the run.
- When a role wants to run a shell command that is not on its allow-list, you are asked: 1 allows it once, 2 allows that exact command for the session, 3 or Esc says no. Anything outside your project is refused before you are asked.
- Slash commands, completed with Tab: `/topology`, `/models`, `/tools`, `/sight`, `/checks`, `/budget`, `/memory`, `/advisor`, `/runs`, `/replay`, `/clear`, `/quit`, and `/help` for the rest.
- `jig --resume` opens your last session again, with its conversation and settings.

Jig keeps runs, sessions and your input history in `.jig/` in the folder you run it in. That folder gets its own `.gitignore`, so your prompts never end up in a commit.

`--plain` draws without colour or style, and `--ascii` with plain ASCII. Colour only ever means a run's state: green is running, red failed, amber waiting for you.

## For scripts

The subcommands stay:

- `jig run` runs a topology on a task and exits 0 when it passed. `--check "<command>"` gives it a check Jig runs itself, where no role can write.
- `jig show <topology>` draws a topology; `--play` runs it on a scripted model, with no tokens.
- `jig replay <run-id>` plays a recorded run.
- `jig validate <file>` and `jig convert <file>` check and convert topology files.

`jig --help` lists everything. The engine behind it is [jig-core](../core/README.md).

## Licence

MIT.
