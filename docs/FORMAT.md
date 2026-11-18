# Topology files: Agent Spec with the lab's extension

A topology file is a valid [Open Agent Specification](https://github.com/oracle/agent-spec) document, version 26.3.1: a `Flow` that any Agent Spec runtime can read. What Agent Spec has no construct for lives in one block of the Flow's `metadata`, under the key `agentic_lab`. This page is that profile: how a topology is written in Agent Spec, what the block holds, how the lab reads and checks a file, and what another runtime makes of it.

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
| The lab's tools | `BuiltinTool`s executed by `agentic-lab`, one per tool, shared by reference |
| A consult edge | A `BuiltinTool` of type `agentic_lab.consult` on the calling role's agent; the consulted role is in the extension |

The round counter is what makes a way back stop in a runtime that ignores the extension. Agent Spec has no arithmetic node, so the counter is written out: its sub-flow's `BranchingNode` maps the round `1`, `2`, ... up to one below the limit to an `EndNode` whose output `round` defaults to the next round, with the branch `again`; any other round goes to an `EndNode` with the branch `limit`. Every counter's output feeds every counter's input, so the ways back share one count, as the lab's rounds do. Agent Spec issue #238 shows a branching loop with no counter running until LangGraph's recursion limit; this one stops at its own.

The `system_prompt` of each agent is written from the role's sentence and a `{{placeholder}}` for each input, because Agent Spec infers an agent's inputs from its prompt's placeholders. The lab's own engines write their own prompts and do not read it.

## What each side owns

When a file has the extension, the native part owns what Agent Spec can say: the topology's id, name and description; each role's `AgentNode`, its name, its description and its model; each wire's data edge and its two ends. The extension owns the rest. Everything else in the native part (system prompts, tools, the way node, the round counters, the inputs and outputs of each node) is written by the lab from the model. On reading, the lab writes the document again from what it read and compares: any difference is reported as a loss at its exact path, and as a warning, never applied silently.

## The extension block

The block's JSON Schema is `packages/core/schemas/agentic-lab-topology.schema.json`. Keys this profile defines are snake_case; values the engine reads as they are (a role's `config` and `params`, a wire's `feedback`, the topology's `parameters`) keep the engine's own names.

| Key | What it holds |
|---|---|
| `profile` | `agentic-lab/topology@1`: this profile and its version |
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
- **The command line** uses the same module: `agentic-lab validate <file>` and `agentic-lab convert <file> --to yaml|json [--dialect agentspec|legacy]`.

## Moving to another Agent Spec version

Agent Spec ships every quarter, and any version, patches included, may break documents. A new version is a new schema folder beside `26.3.1` and a new dialect plugin, which passes the same contract; the 26.3.1 plugin stays to read older files. The mapping above is what has to be checked again each time.

## What is not verified

No file the lab writes has been run by another Agent Spec runtime: nothing of Oracle's (pyagentspec, its adapters, WayFlow) was installed or run. Validity is checked against the vendored schema and the rules of the language specification the lab implements, which are a subset of what pyagentspec checks. The round counter has been read, not executed, by anything but the lab.
