# Topology files: Agent Spec with the lab's extension

A topology file is a valid [Open Agent Specification](https://github.com/oracle/agent-spec) document, version 26.3.1: a `Flow` that any Agent Spec runtime can read. What Agent Spec has no construct for lives in one block of the Flow's `metadata`, under the key `jig`. This page is that profile: how a topology is written in Agent Spec, what the block holds, how the lab reads and checks a file, and what another runtime makes of it.

The built-in topologies are files of this kind, in `packages/core/topologies/`. Each YAML file is the definition; the JSON file beside it is its twin, written from it by `npm run topologies -w packages/core`. A test fails when a twin differs from what that command writes.

## JSON and YAML alike

The lab reads and writes either. A YAML document is read with YAML 1.2's core schema, so it parses to the same data as its JSON twin: no custom tags, no timestamps, and `yes` stays a string. Both are checked against the same schemas. Every built-in topology is tested both ways: YAML to the model to JSON gives its twin, and JSON to the model to YAML gives the same document.

## How a topology is written

| The lab | Agent Spec |
|---|---|
| The topology | A `Flow` whose `id` is the topology's id, with `agentspec_version: 26.3.1` |
| A role | An `AgentNode` whose `id` is the role's id, holding an inline `Agent` |
| The drawn order | Control-flow edges from `start` through every role in order |
| A wire | A `DataFlowEdge` from the source role's output to the target role's input, named by the wire's id |
| Your task, and the run's other inputs | The flow's inputs `task` and `run_inputs`, sent by data edges to the inputs `run_task` and `run_inputs` of each role that reads them |
| The answer | The flow's output `answer`, from the last Do role |
| A way back | A `BranchingNode` keyed on the deciding role's output `way`, a control-flow edge back to the target, through a round counter |
| The round limit | The round counter: a `FlowNode` running a sub-flow that lets a round below the limit go on and stops at the limit |
| The run's model | An `LlmConfig` with the id `model.run` and `model_id: chosen-at-run`; a role with its own model has its own `LlmConfig` |
| The lab's tools | `BuiltinTool`s executed by `jig`, one per tool, shared by reference |
| A consult edge | A `BuiltinTool` of type `jig.consult` on the calling role's agent; the consulted role is in the extension |

The round counter is what makes a way back stop in a runtime that ignores the extension. Agent Spec has no arithmetic node, so the counter is written out: its sub-flow's `BranchingNode` maps the round `1`, `2`, ... up to one below the limit to an `EndNode` whose output `round` defaults to the next round, with the branch `again`; any other round goes to an `EndNode` with the branch `limit`. Every counter's output feeds every counter's input, so the ways back share one count, as the lab's rounds do. Agent Spec issue #238 shows a branching loop with no counter running until LangGraph's recursion limit; this one stops at its own.

The `system_prompt` of each agent is written from the role's sentence and a `{{placeholder}}` for each input, because Agent Spec infers an agent's inputs from its prompt's placeholders. The lab's own engines write their own prompts and do not read it.

## References and the compact form

A file writes each component once and points at it everywhere else, with Agent Spec's own reference: `{"$component_ref": id}`, resolved in the `$referenced_components` of the component it sits in or of any component above it. Every role's node, the tools and the run's model, the way node, the round counters and the counter's subflow are written once in `$referenced_components`; every agent that uses a tool or the model, every edge and every list of nodes refers to them. A document whose top is itself a reference (`{"$component_ref": id, "$referenced_components": {...}}`, which the schema allows) is read as the component it names, and its errors point into it as written.

A reference shares a component, and only a component: an input or an output is a property, a JSON Schema, and Agent Spec gives a document no way to point at one. Most of what made the phase 2 files long was properties: every agent's inputs and outputs written again on its node, every start and end node listing the same property as input and output, every counter node repeating its subflow's. What removes that is the inference the specification itself defines, and the lab's compact form leaves out exactly what it gives back:

| Left out | Inferred from |
|---|---|
| An `AgentNode`'s inputs, outputs and branches | Its agent's inputs and outputs, and the branch `next` |
| A `FlowNode`'s inputs, outputs and branches | Its subflow's inputs and outputs, and one branch per `branch_name` of the subflow's end nodes |
| A `StartNode`'s outputs and branches | Its inputs, and `next` |
| An `EndNode`'s branches | None: an end node has no branch |
| A `BranchingNode`'s outputs | None |
| A `Flow`'s inputs | Its `StartNode`'s inputs |

What inference cannot give back stays: an agent's inputs keep their descriptions and their empty defaults (inferred from the prompt they would have neither), an end node keeps its inputs and outputs, a flow its outputs, and a `BranchingNode` its branches, which pyagentspec infers as a set, so their order would change. The specification says an SDK's export always lists a node's inputs and outputs; `jig convert --expanded` (or `form: "expanded"` in the formats module) writes them all, and the lab reads either form to the same topology. On reading, a document is compared with what the lab writes with both sides in full, so a node that leaves its inputs to inference is never reported as changed; a difference shows at its source, the agent.

In YAML the writer also puts small things on one line: an edge, a port, a property, a list of scalars or references. A text of several lines never goes on one line, and a string a YAML 1.1 reader would take for another type (a timestamp, `yes`, `on`, `12:30`) is quoted, because PyYAML, which pyagentspec uses, reads YAML 1.1. Only the layout changes, never the data: the JSON twin is the same document.

## What each side owns

When a file has the extension, the native part owns what Agent Spec can say: the topology's id, name and description; each role's `AgentNode`, its name, its description and its model; each wire's data edge and its two ends. The extension owns the rest. Everything else in the native part (system prompts, tools, the way node, the round counters, the inputs and outputs of each node) is written by the lab from the model. On reading, the lab writes the document again from what it read and compares: any difference is reported as a loss at its exact path, and as a warning, never applied silently.

## The extension block

The block's JSON Schema is `packages/core/schemas/jig-topology.schema.json`. Keys this profile defines are snake_case; values the engine reads as they are (a role's `config` and `params`, a wire's `feedback`, the topology's `parameters`) keep the engine's own names.

| Key | What it holds |
|---|---|
| `profile` | `jig/topology@1`: this profile and its version |
| `version`, `author`, `category`, `tags`, `created_at`, `updated_at` | The topology's own version and labels |
| `order` | The drawn order, made explicit: the roles left to right, the order every round runs in |
| `roles` | Per role: its `engine` (the node type that runs it), its `category`, its `face` (label, icon and one sentence), the run inputs it `reads` (the walls), its `config` and engine `params`, and its `ports` with the signal types each accepts or emits. The `config` holds the role's tool policy: `toolPolicy.allow` and `deny` for its tools, and `toolPolicy.commands` for the programs its shell runs, in place of the default allow-list |
| `wires` | Per data edge: the `fields` the wire delivers (the walls between roles), its `feedback` (condition and limit), and whether it is switched off |
| `provenance` | For each signal type the roles emit, where each field comes from: given, measured, written, or "measured or written" when the run decides. It is the engine's declaration, written out; on reading, a difference is a warning, and the engine's declaration holds |
| `ways_back` | Each way back: the deciding role, the target, the condition in a short label and in a sentence, and the wires that carry it. A way back with no wire is the plan file's repeat |
| `also` | Wires back that start no round, drawn dotted |
| `consults` | Each consult edge: the calling role, the consulted role (name, face, model, instructions, longest answer), the calls allowed a turn, and what the consulted role sees (`task`, `question`, `transcript`, `tool_results`, `checks`) |
| `exit` | The exit's label and its condition in short lines, as drawn |
| `limits` | `rounds` (0 for none), `delay_ms`, `token_budget`, `timeout_ms`, and `repeat` while the plan file is not done |
| `parameters` | The parameters the topology takes when it is instantiated |

## A role's brain or chain

A role can name more than one model. In the extension, the role's `models` block holds either a brain's name (`brain: strong`), an ordered chain in the user's config, or a chain of its own (`chain: [claude/claude-sonnet, ollama/qwen2.5:7b]`), each model as `<entry>/<model>`. Agent Spec has no construct for a chain, so the agent's `llm_config` holds the chain's first model, and a runtime that ignores the extension runs that one; for a brain, the `llm_config` is the run's model, chosen when the run starts. Jig reads both back to the same role, so a chain or a brain makes the round trip without loss, which a test checks in YAML and JSON. When Jig runs it, a role moves along its chain only when a provider is unavailable, and stays there for the rest of the run.

### What Do's turn changed, measured

Do's `execution_result` carries two measured fields beside what its model wrote: `filesChanged` (each file the turn created, modified or deleted) and `diff` (a bounded diff of the text files), both taken by the lab from snapshots of the workspace before and after the turn, never from the answer. They travel on the wire to Check like the rest of the signal, and Check's prompt shows them apart from the claim, under "measured by the lab". The provenance block of every topology file declares them as measured.

### The built-in topologies' brains

The built-in topologies name brains, never models, so they run on any machine and each user maps the names to what they have (the author's rule, 2026-11-19):

- A role that produces work (Plan, Do, Memory and their kin) uses `fast`.
- A role that verifies, judges or advises (Check, Critique, Decide, an Advisor) uses `strong`.
- A topology of a single role keeps `default`: the Ralph Loop is the baseline, and its model must not be confounded with a team's verifier. The Advisor topology's Do is its only role, so it keeps `default` too, the same as the Ralph Loop it is compared with; its Advisor uses `strong`.
- A role that makes no model call gets no brain. No built-in role is one today: Critique and Decide use rules first and a model when the rules do not decide.

`packages/core/src/formats/brains.ts` holds the rule and `scripts/brains.mjs` applies it to the files. Jig's own brains resolve to what is configured: `default` starts with the default model, `fast` with the local entries, `strong` with the hosted ones; each entry gives its default model, local entries in the order the config lists them. There is no size heuristic: with only Ollama, every brain is Ollama's default model, whatever else it has installed. A brain of your own in the config replaces Jig's of the same name. `jig run` and the web dashboard run every role on the model they are given, as before; the session resolves the brains.

## The extension's name, before and after the rename

The block was `metadata.agentic_lab`, its profile `agentic-lab/topology@1`, the tools executed by `agentic-lab` and the consult tool typed `agentic_lab.consult`. With the rename to Jig they are `metadata.jig`, `jig/topology@1`, `jig` and `jig.consult`, and the schema is `schemas/jig-topology.schema.json`.

The namespace moved instead of staying, for one reason: nothing had been released under the old names, so this was the cheapest moment it will ever be, and a format that says "agentic_lab" in every Jig file forever would be a puzzle for every reader. Nothing is lost by it: the formats module still reads a file written before the rename. It reads the old names as the new ones, says so in one warning at `/metadata/agentic_lab`, points every error at the place in the file as written, and `jig convert` writes the file again under the new names. A test reads two built-in topologies rewritten with the old names and gets the same topology back.

## Standards beside Agent Spec

For what Agent Spec leaves to others, the most used standard. Tools are the lab's own today and are written as `BuiltinTool`s, which Agent Spec defines for tools an engine implements; a tool served over MCP will be an `MCPTool`, and the lab has no MCP client yet. Skills are in the Agent Skills `SKILL.md` format the lab already reads. Data shapes are JSON Schema: Agent Spec's own properties, and the extension's schema.

## How a file is checked

1. **Syntax.** JSON or YAML, by the file's extension or by how it starts. A broken text is refused with its line.
2. **Agent Spec's schema.** Against `packages/core/schemas/agentspec/26.3.1/agentspec_json_spec_26_3_1.json`, vendored unchanged with its licence notice. The schema as published puts `agentspec_version` beside an `anyOf` whose branches forbid properties they do not list, so a document with a version never validates as written: none of the 33 JSON examples in Oracle's repository does, and with the version set apart 29 of them pass. The lab checks the version against the schema's own `AgentSpecVersionEnum` and the rest of the document against the schema.
3. **Agent Spec's rules a schema cannot state.** References resolve and ids are unique; a flow's start node is one of its nodes and its inputs are the start node's; edges join nodes of the same flow, from branches and to properties those nodes declare; an agent's inputs are its prompt's placeholders; a `BranchingNode`'s branches are its mapping's values and `default`.
4. **The extension's schema**, then the extension against the flow: every role in `order` is an `AgentNode`, every wire entry names a data edge, every way back and also edge names roles and wires that exist.
5. **The model.** Ids, ports, wires, ways back that really run back, consult edges.

Every error carries a JSON Pointer to the exact place, and a line and column when the text gives one. The schema's `anyOf` trees make collecting every error exponential, so the lab stops at the first schema error and then checks each component alone, deepest first: the first component that fails on its own gives the error.

## Importing a plain Agent Spec document

A document without the extension is read with defaults. Every `AgentNode` and `LlmNode` becomes a Do role on the lab's execution engine, with the agent's system prompt or the node's prompt template as its instructions, in the order the control flow first reaches them. A data edge from the start node makes the role read your task; a data edge between two roles is a wire, and the target reads what the source wrote. A `BranchingNode` keyed on a role's output that leads back to a role already reached is a way back: wires that fire on the mapped value, from the role that decides. A way back with no limit is stopped after five rounds, and the import says so. A standalone `Agent` becomes one Do role. Everything the lab cannot run (other node types, tools it does not have, the document's models, prompt placeholders, data passed by name) is reported as lost, each at its path.

## Exporting for another runtime

A file the lab writes is already Agent Spec, so exporting is writing it. The writer also reports what another runtime will ignore, because only the extension holds it: the engines (another runtime runs every `AgentNode` as a plain agent on its system prompt), the walls (Agent Spec shares one conversation with every agent in a flow and says not to rely on sub-agents for isolation), the fields each wire delivers, provenance, the conditions of the ways back (another runtime follows the deciding role's `way` output, which its model must fill), the also edges, the consult edges, the repeat on the plan file, the token budget, the engines' parameters, the model (`chosen-at-run` must be replaced), and the tools (another runtime must provide tools of the same names). The round limit is not lost: the counter is in the flow.

## The formats module

Everything that handles a file is in `packages/core/src/formats`; the rest of the engine sees only the validated model (`Topology`, a recipe plus faces, ways back, also edges, consult edges and the exit).

- **The syntax layer** (`syntax.ts`) reads and writes JSON and YAML, and says on which line a path lands.
- **The dialect layer** (`dialects/`) gives data its meaning: Agent Spec 26.3.1 with the lab's extension, and the legacy recipes, for migration. A dialect is a plugin with one small interface (`dialect.ts`): recognise a document, validate it with errors at the exact path, read it into the model, write it from the model, and report what a conversion drops (`dropped`) or what only the lab will read (`ignored`).
- **Conversions go through the model**, from any dialect and syntax to any other.
- **The contract** (`src/test-support/dialect-contract.ts`) runs over every registered plugin with the built-in topologies as fixtures: a round trip without loss or with the loss declared, invalid documents refused at the exact path, JSON and YAML equivalent.
- **The command line** uses the same module: `jig validate <file>` and `jig convert <file> --to yaml|json [--dialect agentspec|legacy]`.

## Moving to another Agent Spec version

Agent Spec ships every quarter, and any version, patches included, may break documents. A new version is a new schema folder beside `26.3.1` and a new dialect plugin, which passes the same contract; the 26.3.1 plugin stays to read older files. The mapping above is what has to be checked again each time.

## What is not verified

Oracle's pyagentspec 26.3.1 reads every built-in file: the compact files as they are written, the full form and the phase 2 files, and it reads each compact file exactly as the full one (its own serialization of both is the same). `src/formats/pyagentspec.test.ts` checks this when `JIG_PYAGENTSPEC` names a Python that has pyagentspec, and is skipped otherwise. Before the quoting above, PyYAML read the files' dates as dates, which pyagentspec then could not write back.

Reading is not running: no file the lab writes has been run by another Agent Spec runtime (pyagentspec's adapters, WayFlow), and the round counter has been executed by nothing but the lab. Validity in the lab is checked against the vendored schema and the rules of the language specification the lab implements, which are a subset of what pyagentspec checks.
