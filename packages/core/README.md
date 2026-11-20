# jig-core

The engine of Jig. Jig is a Joint Inference Graph: several models reasoning together, arranged as a graph you define. You give it a topology (roles such as Plan, Do, Check, Critique and Decide, the ways the work goes back, the roles one may consult) and a task, and it runs the task through that topology with the models you choose.

This package is the library. The `jig` command lives in [jig-console](https://github.com/destbreso/jig/tree/main/packages/cli#readme), and anything you build in code can use this directly. Jig was called Agentic Lab before.

## Install

```sh
npm install jig-core
```

It needs Node 20 or later. To build it from source:

```sh
git clone https://github.com/destbreso/jig.git
cd jig
npm install
npm run build:core
```

## Run a topology

```ts
import { TopologyRun, createDefaultToolkit, createProvider } from "jig-core";

const provider = createProvider("ollama", { model: "qwen2.5:7b" });
const topologyRun = new TopologyRun({
  provider,
  tools: createDefaultToolkit(),
  topology: "deep-reasoning",
  workingDir: process.cwd(),
});
topologyRun.on("event", (e) => console.log(e.type));
const result = await topologyRun.run({
  task: "Write hello.txt containing hi",
  checks: [{ name: "the file", kind: "command", command: "grep -qx hi hello.txt" }],
});
console.log(result.outcome, result.answer);
```

`TopologyRun` is the one way a topology runs: one instance runs one task, with its own run id. It emits one stream of events (a role starting, each model call, a verdict and where it came from, a way back taken, a consultation, the end), takes a note mid-run (`topologyRun.steer("...")`), stops on request, and returns every role's turn as a step record: what it was given and where each value came from, the exact messages sent to its model, and what it answered. When the task carries checks, Jig runs them itself after the run, in a copy of the workspace no role can write, and the run's outcome is theirs.

## What else is in it

- **Topologies as files.** The built-in topologies are in `topologies/`, in YAML with a JSON twin. Each is a valid Agent Spec 26.3.1 document with Jig's extension under `metadata.jig`. `readTopologyText`, `validateTopologyText`, `writeTopologyText` and `convertTopologyText` read, check, write and convert them, with errors at their exact path. The format is explained in the repository's `docs/FORMAT.md`.
- **What each role sees, measured.** `measureSight(topology)` runs a topology on a mock model with marked inputs and tells you what reached each role's prompt.
- **The grid.** `drawingOf`, `draw`, `screen` and `footer` draw a topology and a run's state as a grid of characters with meanings, never colours; `toANSI` and `toText` turn it into terminal output.
- **Providers.** Ollama, OpenAI, Anthropic, OpenRouter and Google through one interface (`createProvider`), each call with an output limit, a timeout and an abort.
- **Tools.** Reading, writing and searching files, git, and a shell. Given `permissions`, every call is decided first (`decide`, `guardTools`); without them, the shell runs only what a role's allow-list names, inside the workspace.
- **Housekeeping.** Everything jig-core makes to throw away later (a run's folder, a check copy, a trash entry) carries a `.jig-owned.json` marker, and only what carries one is ever moved or deleted. `housekeep(dir)` deletes temp folders left by processes that ended and moves runs past the limits to `.jig/trash`; `survey` and `planRecords` say what it would do without changing anything, and `makeTempDir`, `withTempDir` and `ensureRunDir` make folders the same way Jig does.

## Storage

Runs are kept in memory unless you configure Postgres. Postgres and the Redis event bus need servers, so their client packages are optional: install `pg` or `redis` next to jig-core when you use them. Without them, nothing is loaded and the in-memory store is used.

## Licence

MIT.
