# Agentic Lab, redesigned: an instrument that reaches conclusions

This is a proposal for the author to decide on before anything is built. Nothing in any repository was changed. The sheets referred to below are in `sheets/`, rendered from `html/`. Every run value shown in a sheet is illustrative and stamped as such; the roles, ways back, parameters and walls come from the code.

## 1. The idea

Agentic Lab stops being a dashboard with a pipeline editor and becomes an instrument for finding out which agent topologies work on your own tasks, and why. Its centre is not the run but the finding: a conclusion with its strength, tied to a hypothesis, built from repeated runs against simple baselines, with every value a role saw marked as measured by the system or written by a model.

**It is also your harness (the author, 2026-11-18).** The lab is not only an instrument to measure. It is where you define your own harness, the roles, the models from any collection you choose, the tools, the skills and the constraints, and use it for real work: the same topology runs your tasks every day and is what an experiment varies. Measuring is a layer on top of that harness, never a separate product.

**Its name will be Jig** (the author, 2026-11-18): in a workshop, a jig is the piece you make to hold and guide your tools so the work comes out the same every time, and a test jig holds a device to measure it. It is also an acronym, JIG: **Joint Inference Graph**, several models reasoning together, arranged as a graph, which is what a topology is. The rename goes in steps (the author, 2026-11-18): first the command (`jig`), the packages, the README and the docs; then, when the branch merges into main, the GitHub repository (GitHub keeps redirecting the old name) and the link on the author's profile. The project's page on destbreso.com is rewritten at the end of the rebuild.

**Three packages, one tool anyone can install (the author, 2026-11-18).** Jig must be something anyone installs on its own from npm, and a desktop-style app comes later. `jig-core` is the library: the engine, `AgentSession`, the formats module, the grid, the schemas and the built-in topologies, for `jig-console`, for the later app and for anyone who builds a harness in code. `jig-console` is the `jig` command, with `agentic-lab` and `alab` kept for a while as aliases that warn. `jig-desktop` is today's web dashboard, private and unpublished, which may grow into "una app web tipo Claude Desktop" (a local web app, Electron or Tauri is decided then). Publishing is the author's, with his own npm account; the packages are left so it is one command.

**Console first, desktop last (the author, 2026-11-18).** "La fase de la app desktop la dejaremos de última; vamos a dejar toda la funcionalidad probada hasta el console, y luego, cuando tengamos esto fino, pasamos a lo otro si procede." Experiments and findings are built and proven in the console first, as `jig` subcommands and slash commands; the web viewer, removing the builder and jig-desktop move to the end, as a phase that happens only if it is worth it. Until then the dashboard in `packages/web` is legacy: kept building and passing its tests, and nothing more.

The loop the product is organised around:

1. **A question** in your words ("does the Planner help on refactoring tasks?"), or one the lab proposes from what it has seen.
2. **An experiment** designed from it: the variable, what is held constant, the task set and its checks, the baselines added on their own, the repetitions needed, the cost before anything runs, and the conclusion rule fixed before the first run.
3. **Runs**, drawn on the same console-style viewer at rest, running and in replay, each step recording what each role saw and where each value came from.
4. **A conclusion** in plain words with its strength, which never claims more than the counts support, including "inconclusive, and here is how many more runs would decide it".
5. **The ledger**: the hypotheses of `docs/FOUNDATIONS.md` (H1 to H7, on branch `feat/topology-lab`), each with the evidence your experiments added for or against it, by task type.
6. **What nobody was looking for**: surprises flagged by rule, wrong turns traced to their cause, failures classified, and the next question proposed.

A line for the author's posts, if it lands: *the lab claims only what it measures, and the first thing it measured was itself.* The design started by running the engine against its own recipes, and half of what the recipes say did not happen (section 2).

## 2. What the code does today, and why it shapes the design

I read `packages/core` and the web routes, and ran three small probes against the built core (`packages/core/dist`) with a scripted mock model: no network, no tokens, nothing written to the repository. The probes are in `probe/` (`instantiate.mjs`, `walls.mjs`, `ralph.mjs`, `recipes.mjs`).

Measured by the probes:

- **Three of the six built-in recipes cannot be instantiated.** Deep Reasoning fails with `Target port not found: critic:in:evaluation`, Supervised Coder with `reviewer:in:original_task`, Adversarial Duel with `Source port not found: arena:out:challenge_alpha`. The runtime takes ports from the loop classes, not from the recipe, and the names disagree. No built-in recipe has a feedback rule on any wire.
- **Deep Reasoning, with its missing ports remapped** (delivery ignores the target port's name, so the remap changes nothing else), runs in this order: cycle 1 `exec eval refine`, cycle 2 `plan refine critic`, then `exec refine`, `eval refine`, `refine critic`... Do starts before Plan has written anything, Critique runs after Decide and only every third cycle, and the run goes on to its cycle cap because reaching "done" stops nothing.
- **What each role saw, measured with marked inputs:** Do saw the task and the plan, and never the corrections sent back to it. Check saw Do's full account of its work. Plan saw none of the marks, not even the task. Critique and Decide saw none of the content marks.
- **The Ralph Loop recipe runs one cycle and stops** on the pipeline engine: nothing triggers Do again. It is the baseline every experiment needs, so this matters.

Read in the code:

- **Three engines.** The chat (`packages/web/src/app/api/chat/agent/route.ts`, 2,659 lines) runs its own copy of each recipe with its own prompts, and its critic reads the last four messages, which include Do's output: the opposite of the thesis. The builder runs the core engine. The CLI's `run` uses the legacy `AgenticLoop`. `AgentSession` is used by nothing outside its tests, although `docs/ROADMAP.md` calls the core vision complete.
- **Decide's pass rate comes from Check's written verdict, counted once per signal** (`evaluation` and `eval_metrics` both carry it), never from the exit codes Check's automated checks produce, and a round with no verdict counts as a pass (`computePassRate` returns 1 with no data).
- **Colour:** `packages/web/src` uses 14 hues in 50 hue-and-shade pairs, 161 distinct colour classes when property and opacity are counted (grep, not a full audit).
- **Smaller things seen in passing:** Plan prints `Checks: undefined/undefined` (it reads fields the evaluation signal doesn't carry); the cost table in the route prices models that are no longer current; the builder's runs use the web package's own directory as the working directory; a stored iteration has no role id, so a run cannot be replayed by role today.

What this means for the design: the claims in FOUNDATIONS are treated as hypotheses the lab tests, never as facts the interface asserts, and the interface itself shows when a topology's definition and its behaviour disagree (sheet 01, "what this topology says and doesn't do today"). The first phases of the plan make the engine do what the definitions say before any visual work.

Legacy Spanish to flag, not translated here: `docs/ROADMAP.md`; the benchmark problems in `packages/web/src/lib/benchmarks/problems.ts`; chat UI strings such as "RAZONAMIENTO DEL AGENTE", "EN VIVO", "Sin memorias previas", "Procesando".

## 3. Principles

- **Findings over runs.** Every screen helps reach a conclusion or form a question, or it goes.
- **The definition is data; every view is drawn from it.** A topology and an experiment are files you can diff, version and share. The drag-and-drop builder is retired; ports and wires survive only as a read-only view for debugging.
- **The walls are measured, not declared.** What each role sees is found by running the topology with a mock model and marked inputs and reading which marks reach each role's prompt (section 5.3). The viewer cannot claim a wall the code doesn't have.
- **Every value carries its provenance:** measured by the lab, written by a model, or from you. It is shown by glyph and type style, never colour.
- **Baselines are always in the comparison:** the single loop and best-of-N at the same budget.
- **The conclusion rule is fixed before the first run.** Changing it, or adding runs after looking, marks the result exploratory.
- **Colour means the state of a run or the one primary action, nothing else.** Roles are told apart by icon, name and position.

## 4. Information architecture

| Today | Proposed | Why |
|---|---|---|
| Dashboard | **Home** (sheet 09) | Totals and a 100% "success rate" (the run status, not a check) say nothing. Home shows what was found, what nobody was looking for, what to ask next, and what is running or waiting for you. |
| (none) | **Ledger** (sheet 08) | The hypotheses and their evidence by task type. The product's memory of what it has learned. |
| Benchmarks | **Experiments** (sheets 06, 07) | Benchmarks compared contenders once, scored by a judge. Experiments repeat, include baselines, fix their rule first and feed the ledger. The 13 problems move to Tasks. |
| Pipelines, Recipes | **Topologies** (sheets 01 to 04, 10) | One library of definitions, built in and yours, each opening on the viewer. The builder goes; Recipes as a separate page goes. |
| (none) | **Tasks** | Task sets with their checks, reusable across experiments. |
| Chat | folded into **Run** on the viewer | The chat's live side panel was the clearest view in the app; the viewer is that panel made the whole page. A plain single-model answer is the "one answer" baseline. |
| Runs | **Runs** (sheet 05) | Kept as raw material; every run opens as a replay with its cause trace when it went wrong. |
| Memory | Memory | Kept, restyled, secondary. |
| Providers, Settings | **Settings** | One page; providers gain a price table, needed for cost. |

Navigation: home, ledger, experiments, topologies, tasks, runs; then memory, settings.

## 5. The views, what each lets you do, and what it needs

Support status uses three marks: **core today** (exists and works), **backend** (new work in `packages/core` or the API), **interface** (only web or CLI work).

### 5.1 The topology viewer (sheets 01 to 04, 12)

One viewer for every topology, built in and custom, at rest, running and in replay, in a retro console mode: a character grid drawn with box-drawing characters.

- **At rest:** roles as boxes in order; each way back as an arc labelled with its condition in plain words and its limit (`↺ not passing: back to Do ○ ○ ○ at most 3`); secondary edges dotted below (`┄ also: corrections`); a consulted role hanging under its caller (`⇅`); the exit with its stop condition; and below, the walls: a matrix of what each role sees, one column per role, each row marked `■` measured, `“` written or `›` from you. Below the grid, what the definition says and the code doesn't do, and the questions it raises, each with "Design the experiment".
- **Running:** the same drawing: the task `▣` advancing between boxes, a braille spinner in the active box, the round counter ticking on the arc (`● ◉ ○`), critic notes marked `⚑` on their round, tokens and cost on the status line, and a side panel with what the active role sees now and what it is writing. Steering in place: "Tell Do something" (a context signal Do reads on its next turn) and "Pause before Decide" (waits for you, amber).
- **Replay:** the same view with a timeline row; drag to any step and the side panel shows what that role saw, with provenance, and the exact prompt it got.
- **390 px:** the same engine's vertical layout (roles top to bottom, ways back on the right margin, numbered), with the walls collapsed to one line per role; or the exact wide grid panned inside its frame.

| Needs | Status |
|---|---|
| A topology definition with roles, order, ways back with condition and limit, also-edges, consult edges, exit | backend (5.6) |
| The layout engine: definition plus run state in, character grid out; horizontal, vertical and one-line strip layouts | backend, in `packages/core` (prototype in `html/topogrid.js`) |
| Web renderer (grid to HTML, cells pinned to one character width) and CLI renderer (grid to ANSI) | interface |
| The sight matrix, measured | backend (5.3) |
| Lints: instantiation errors, signals delivered that no role reads, ways back with no limit, order differing from the drawing | backend (instantiation exists, the rest is new) |
| Live step events, steering, pause before a role | core today partly (`pause`, `resume`, `injectSignal`, events); a pause-before-role and a run registry are backend |
| Replay | backend: step records (5.4) |

### 5.2 One engine, two surfaces

The layout engine lives in `packages/core` so the web and the CLI draw the same grid. It emits cells with a meaning (`ln`, `ink`, `dim`, `faint`, `b`, `run`, `pass`, `fail`, `you`), never a colour; the web maps meanings to the tokens, the CLI to ANSI codes (dim, default, bold, bright black, bold green, red, yellow). The prototype in `html/topogrid.js` draws every sheet's grid and its terminal panels through a real `toANSI` and back through an ANSI reader, so the browser and the terminal panels are the same characters.

What it needs: box-drawing and a few geometric glyphs in the font (the web pins every non-ASCII cell to `1ch`, so a glyph Geist Mono lacks cannot break alignment; terminals have their own cell grid); a vertical layout under about 100 columns or 600 px; snapshot tests of the grid as text for every built-in topology; `agentic-lab show <topology>` and a live mode in `agentic-lab run`.

### 5.3 Measured walls and provenance

- **Sight by marks:** `measureSight(topology)` runs the topology with a mock model, filling every field of every input signal with a unique mark, and records which marks reach each role's prompt. This is how sheet 01's matrix was obtained (the `walls.mjs` probe). It costs no tokens, runs in a test, and pins the built-in topologies' matrices so a code change that moves a wall fails CI.
- **Provenance registry:** every field of every signal type is declared as given (from you), measured (exit codes, tool call counts, tokens, diffs, rounds) or written (plans, outputs, verdicts written by a model, critiques, advice). A value computed from a written value stays written (a pass rate counted from model verdicts is written). A test fails when a loop emits an undeclared field.
- **Per run:** each step stores its inputs with their provenance and the exact messages sent to the model, through a recorder wrapped around each role's provider. Advice from an advisor that returns sealed content is stored as sealed: written, and unreadable by the lab.

All backend.

### 5.4 Runs and the "why it went wrong" trace (sheet 05)

A failed run opens as a replay with a cause chain built from the step records: the measured fact, the written value that contradicted it, the decision that rested on the written value, and the decision recomputed on the measured one. For decisions made by a rule, the recomputation is exact and costs nothing. For decisions made by a model, the lab offers a counterfactual: re-ask that one step without the written field, k times, after showing the cost; the answer says "5 of 5 times it chose back to Do", never "the model was persuaded".

Failures are classified with the MAST taxonomy (arXiv 2503.13657: specification and system design, inter-agent misalignment, task verification and termination) by explicit rules, for example: stopped while the measured check fails (verification and termination); the same tool pattern repeated across rounds (specification and design, step repetition); a role received a correction and produced the same output (inter-agent misalignment). Runs no rule matches stay unclassified and are counted as such.

| Needs | Status |
|---|---|
| Step records per role with inputs, provenance, prompt, output, tokens, time | backend |
| A final measured check run by the lab after the topology stops, independent of what the topology said | backend |
| Cause chain from records; counterfactual re-ask | backend |
| MAST rules | backend |
| The replay view | interface |

### 5.5 Experiments: the designer and the result (sheets 06, 07)

**The designer** starts from your question. A model fills a fixed schema with structured output (the core already validates structured output with Zod), so the draft is marked as written by a model and every field is editable:

- the hypothesis it tests (from the ledger);
- the variable: a role removed or added, what a role sees, a role's model, a parameter (rounds, threshold, the Planner's timescale), the shape, or a consult;
- what is held constant;
- the task set and how each task is checked: a command's exit code, a file, an exact answer, or a model judge, which is marked as opinion and makes the whole result say so; check files the producer could edit are copied back in before each check (H4);
- the metrics: the primary one fixed in advance, the rest secondary;
- the baselines, added by the lab: the Ralph Loop and best-of-N at the same per-attempt token budget (independent single-loop answers drawn until the budget is spent, kept if any passes the measured check). A baseline is removed only with a written reason, which the result repeats;
- the repetitions, with the smallest difference they can tell apart (normal approximation, 95% two-sided, power 80%; for pass rates near a half, about 36 points at 30 runs per arm, 30 at 44, 20 at 98);
- the cost before anything runs, from the dry run: role turns per attempt at most, tokens bounded by attempts times budget, typical tokens from past runs when there are any, money from the price table;
- **the conclusion rule, fixed now:** what supports, what refutes (including a margin of no practical difference), and otherwise inconclusive. It is stored with the experiment and locked with a hash when you press Run.

An experiment is a versioned file (`experiments/<name>.yaml`) and a database index, rerunnable and shareable. Task sets are files too (`tasks/<set>.yaml`) and are reused across experiments.

**The result** shows the arms side by side, each drawn as a one-line strip of the same viewer with the variant's change in bold; every repetition as ✓ or ✗, grouped by task; k of n with a 95% Wilson interval; medians of tokens and time; and a quality against cost chart with the arms nothing beats on both axes joined. The conclusion follows the locked rule: the difference between the pre-registered pair with a Newcombe interval, wins by task with a sign test, the extra cost, and how many runs a difference of that size would need. Strength words are defined once: **strong** when the 99% interval leaves out no difference, **clear** at 95%, otherwise **inconclusive**; **exploratory** when the rule changed or runs were added after looking. Comparisons beyond the pre-registered pair are reported without strength words.

| Needs | Status |
|---|---|
| Experiment and task-set schema, versioning, the stored and locked rule | backend |
| Repetition runner: background queue, resumable, per-attempt budget, concurrency setting | backend (the benchmark runner and store are a starting pattern) |
| Baselines that work: the Ralph Loop recipe looping (Phase 0), best-of-N at a budget | backend |
| Variant switches the hypotheses need: Critique's sight (counts or output), Check's verdict source (checks or model), a consult's sight | backend |
| Statistics and sentence templates; sample-size calculator | backend |
| Dry-run estimate | backend |
| Designer draft from words | backend (structured output exists) |
| Screens | interface |

### 5.6 Findings: the ledger, surprises and the next question (sheets 08, 09)

**The ledger** holds H1 to H7 as data, plus hypotheses you add. Each experiment declares which hypothesis it tests and how its rule maps to "supports" or "against". Each finished experiment adds an entry by task type with its strength, effect, cost and a link to its runs; exploratory results are listed and count for nothing. The literature's status from FOUNDATIONS is shown beside your evidence and kept apart from it.

**Surprises** are rules over the stored runs, each shown with the rule that fired: a baseline's interval above a team arm's; a role that never intervened in 20 runs or more; a model call whose output never differed from the rule beside it (Decide's model agreeing with its own threshold rule every time); a way back no run took; a check that passed after the producer changed the checked files.

**Next questions** are templates filled from a surprise or an inconclusive result: "Critique seems redundant on math: test without it", "run 80 per arm, rule fixed again", "does a vendor's claim hold on your tasks". Each opens the designer prefilled with its cost estimate; nothing runs without your yes.

All backend except the screens.

### 5.7 Starting from intent (sheet 10)

You describe what you want done. The lab ranks the topologies with the same matching it already uses to activate skills (embeddings when configured, shared words otherwise), shows why each matched, draws the proposed one, and gives each role its sentence stored with the recipe. It asks how you will know it worked, and that check is required. A dry run with a mock model shows the exact path for a scenario ("every check fails", "passes in round 2"), the role turns, and token estimates marked as estimates until past runs give real ones. From there: run it, edit the definition, or make it an experiment, which adds the baselines.

Needs: ranking over recipe descriptions (core today: `resolveActiveSkills` and its helpers, applied to recipes, is backend glue); role sentences in the definition (backend, data); dry run (backend); the screen (interface).

### 5.8 The advisor and the consult edge (sheet 04)

Verified in Anthropic's docs (`platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool`, read up to about 100k of its 124k characters, and `code.claude.com/docs/en/advisor`): the advisor is a server tool of type `advisor_20260301` (beta header `advisor-tool-2026-03-01`). The executor decides when to call it, like any tool. The advisor receives the executor's full transcript, runs without tools, and only its advice text returns; nothing the executor passes as input reaches it. `max_uses` caps calls per turn, `max_tokens` (minimum 1024) caps each answer, and `caching` is optional. The advisor must be at least as capable as the executor. Several current advisors (among them Claude Opus 5.5 and Claude Sonnet 5.5) return sealed advice the caller cannot read. Claude Code's page says Claude follows the advice but surfaces a conflict when its own evidence contradicts it, and compares the advisor with `opusplan`, subagents and switching `/model`.

A correction to the brief: the figures it quotes (about 7 points for Haiku 4.5, no measurable effect on Sonnet, slightly lower on Opus) are on the page, but they describe **nudging the executor to consult** in a mid-conversation message, in Anthropic's internal evaluation, not the advisor against no advisor. I did not find on the pages the claim that the benefit shrinks as the executor approaches the advisor's capability.

What the lab adds:

- **A new edge type, consult:** the calling role decides when to call another role, at most N times a turn. It sits beside the fixed order and the ways back, with its own glyph `⇅`, and turns live during a call with the reason it was called.
- **An Advisor topology, built in:** Do with a consult to an Advisor role. With Anthropic models and full sight, the runtime can use the real advisor tool. With any other provider, or with a narrower sight, the lab emulates it: the consult is a lab tool on the caller, and the lab builds the advisor's prompt from what its sight allows.
- **The experiment the real tool cannot run (H7 with H2):** an advisor given the whole transcript against one given only measured evidence, without the executor's narrative. Both arms are emulated, so both are recorded.
- **A template that checks a vendor's claim on your own tasks:** executor alone, executor with advisor, advisor alone, at the same budget, baselines included.
- **Other ways of combining models** become topologies the lab can compare: `opusplan` is Plan on a large model and Do on a small one (per-role brains, core today); switching `/model` is a variant; subagents need a role that runs another topology, which is a later addition.

Backend: the consult edge in the runtime, the emulated advisor, the real advisor tool's adapter, sealed advice stored as sealed. Interface: the glyph and live state.

## 6. The definition format and Agent Spec

**Recommendation: keep the lab's own format, with export to and import from Oracle's Open Agent Specification, and a loss report.** The evaluation read the 26.3.1 language spec, its JSON Schema, the Python and TypeScript SDKs, the adapters and the open issues, at commit `9beda2b` of `oracle/agent-spec` (cloned in `agentspec-research/`, nothing installed or run). The evidence:

- **About half the lab's model has no native construct.** Loops are expressible (a control-flow edge back to an earlier node through a BranchingNode, which maps exact values to branches), but there is no maximum of rounds (issue #238 shows a branching loop that never exits until LangGraph's recursion limit), no edge filters, re-typing or caps, no run-level cycle cap, no skills, no memory ("future versions"), no trigger rules, and parallelism only inside two special nodes.
- **The spec disclaims what the lab is about:** "The conversation of the parent Flow is shared with sub-flows and sub-agents ... Do not use sub-flows or sub-agents for information isolation purposes."
- **Extensions:** every component has a `metadata` dictionary that survives a save and load through either SDK, and plugin components exist. But the published JSON Schema rejects unknown fields, no adapter reads `metadata`, and the TypeScript SDK breaks on nested custom components (issue #219). Walls and provenance could be stored there, and every other runtime would ignore them.
- **Running elsewhere:** adapters are Python only. LangGraph and Oracle's WayFlow run branching flows; CrewAI has no BranchingNode; AutoGen and Microsoft Agent Framework convert agents, not flows. No test on main runs a cyclic flow; the only executed loop found is in an unmerged conformance-suite branch. The TypeScript SDK (`tsagentspec`, 0.1.0) is not published to npm.
- **Governance:** maintained by Oracle, Apache-2.0 or UPL-1.0, quarterly versions where "any version update, including PATCH ones, could contain breaking changes", with a one-year deprecation cycle.
- **The Agent Workflow Protocol** is not a candidate: its graph "MUST be a valid DAG (no cycles)", so it cannot express a way back, and its spec, schema and code disagree.

What the recommendation costs: an exporter for the subset Agent Spec can hold (models, agents, tools, data edges, ways back as a branching node with an explicit counter), a loss report naming what each export drops, a namespaced `metadata` block so lab to Agent Spec to lab round-trips, an importer for agents and flows, and validation against a pinned schema version; then a mapping layer to update each quarter. What it rules out: nothing in the lab. What it gives up for now: running the same topology in LangGraph through Oracle's adapters, which today would drop the walls and the round limits anyway. Cross-framework runs are an optional later phase, through a Python bridge, for the subset without walls, once the conformance suite lands.

The lab's format: YAML or JSON with a published JSON Schema, one file per topology, holding roles (engine, brain, tools, skills, memory, the role's sentence), edges (next, way back with condition and limit, also, consult with its limit and sight), the exit, parameters, and the version. The six built-in recipes migrate to it.

**Decision (the author, 2026-11-18): Agent Spec as the base, the lab's additions as an extension.** The author: an own format "but without reinventing the wheel; think of it as an extension, to have room for what we need that the other does not have". So the recommendation above changes from an own format with export and import to this:

- A topology is a valid Agent Spec document (pinned at 26.3.1): agents, models, tools, flows, data edges, and ways back as a BranchingNode with a control-flow edge back and an explicit counter, so the flow also stops in a runtime that ignores the extension.
- What Agent Spec has no construct for lives in a namespaced block in `metadata`, its documented extension point, which survives a save and load: what each role sees (the walls), the provenance of each value, edge conditions and limits, the consult edge, round and cycle limits, and the role's sentence. The block has a JSON Schema of its own, published in this repository as a profile of Agent Spec.
- Both serializations, JSON and YAML, as Agent Spec allows (the author, 2026-11-18). The lab reads and writes either; a YAML document is parsed to the same data model as its JSON twin, and both are validated against the same schemas, Agent Spec's and the extension's. Every built-in topology is tested in both: JSON to YAML and back gives the same document.
- For what Agent Spec leaves to others, the most used standard: tools as MCP where possible, skills in the Agent Skills `SKILL.md` format the lab already reads, data shapes in JSON Schema.
- The lab reads and validates documents against the pinned Agent Spec schema with its own reader (the TypeScript SDK is unpublished and breaks on nested custom components), and imports a plain Agent Spec document with defaults for the extension. Another runtime runs the file ignoring the extension.
- The cost: the mapping is revised each quarter, as Agent Spec versions may break it; documents are more verbose than a format of the lab's own, which the playbook view and the CLI's commands offset.

### The formats module (the author, 2026-11-18)

Everything that handles a format lives in one module of `packages/core` with that single responsibility: detecting, parsing, validating, converting and writing. The rest of the engine never sees a file; it works only on the internal topology model, already validated. The author: a parser and validator that is "well modular inside the engine", its own responsibility, extended "by adding support separately without breaking anything else".

- **Two layers, each growing without touching the other.** The syntax layer reads and writes bytes: JSON and YAML. The dialect layer gives a document its meaning: Agent Spec 26.3.1, the lab's extension block, and the legacy recipe definitions, the last one for migration only.
- **One small interface per dialect, as a plugin:** recognise a document, read it into the internal model, validate it with errors that point at the exact path, write it from the internal model, and report what a conversion drops.
- **Conversions go through the internal model,** from any format to the model and from the model to any other, so there are no converters from each format to each other. A new dialect (another Agent Spec version, or another standard if one wins) is one more plugin.
- **A contract every plugin passes before it is registered:** a round trip without loss or with the loss declared, invalid documents rejected with the exact error, and JSON and YAML equivalent. The built-in topologies are the fixtures.
- **The CLI's `agentic-lab validate` and `agentic-lab convert`** use the same module, as do the importer, the exporter and the web.

## 7. Visual system (sheet 11)

The tokens are defined once (`html/common.css` here, `globals.css` in the web, a meaning table in the CLI). Structure is the same green-grey at four lightness steps on the site's near-black. The only hues mean something: `--go` (terminal green) is running and the one primary action; `--pass` is the brightest ink with ✓; `--fail` is red with ✗; `--you` (the site's amber) is waiting for you, with ‖. Contrast against the background, measured on the rendered swatches: text 15.4:1, secondary 7.8:1, running 13.6:1, failed 6.5:1, waiting 8.9:1; faint labels 5.3:1 and the grid's lines 3.1:1, after both were raised from a first pass that measured 3.8:1 and 2.3:1.

Two departures from destbreso.com, both deliberate: text is a near-neutral ink rather than terminal green, so that green can mean running; and the site's decorative amber becomes "waiting for you". Geist Mono everywhere, sharp corners, the prompt and `./` idioms in ink, not amber.

### Jig's identity (the author, 2026-11-19)

Approved with "integrate it now, polish the large nodes later". The sheets and the frames are in the identity's design folder; the console reads the frames as data (`packages/cli/src/session/jig-theme.json`, through `theme.ts`).

- **Jig is a small symmetric graph that dances:** three equal round nodes and three straight edges at rest, a topology drawn in the grid's own language. Every deformation is elastic motion that returns to rest.
- **Missing edges are states:** the base snaps on a failed check, an edge is let go while it waits for you, an edge stretches on a way back.
- **The palette is the topology view's own Meaning tokens, and nothing else.** Every cell of the logo, the character and the indicators carries one, so the one style table draws them all, and `--plain`, 16 colours, light themes and ASCII follow from it.
- **The workshop meaning stays in the lore and the text, never drawn.** A jig holds and guides your tools; the drawing is the dance and the graph.
- **Where it appears:** the large form and its startup (about 1.9 s, any key skips it) when a session opens; the medium form in the session's header, in the pose of the engine's state; the 3-cell indicators and the `▞▚` mark in the footer, the strip and the chat's lines, the idle mark dim.

What was tried and rejected, and why:

- A pixel creature with a face read as a copy of Claude Code's mascot.
- The marionette was ugly.
- The workshop as a visual did not read.
- A teal, blue and violet palette did not fit: colour already means a run's state.

## 8. Build plan

Ordered so the first phases close "does what it says" before any visual work. Each phase ships something whole and names how it is verified.

**Phase 0. One engine, and it does what the definitions say.** No interface work.

- Every built-in recipe instantiates; delivery checks the target port's accepted types. Verified by a test that instantiates every registered recipe, and one that a mistyped wire is refused.
- Round scheduling: the run order is the drawn order (topological over forward edges), a way back starts the next round at its target, Critique runs every round in round mode. Verified by the order probe as a test: `plan, exec, eval, critic, refine` per round.
- Ways back carry what their target reads: Do reads corrections, Plan reads the task and the reason to start over. Verified by the marks probe as a test: each mark reaches the role the definition says.
- Decide: a round without a verdict is inconclusive, a verdict counts once, "done" stops the run, the round limit counts rounds taken. Verified by tests.
- The Ralph Loop recipe loops until PLAN.md is done or 20 turns. Verified by a test that it runs more than one cycle when the plan is incomplete.
- Chat, builder and CLI run through `AgentSession`: the web agent route becomes an adapter streaming `AgentSession`'s events, its own copies of the loops are deleted, mid-run steering becomes a context signal to Do through a run registry, and the CLI gains `agentic-lab run --topology`. Verified by a contract test: the same mock run produces the same event sequence through the web route and the CLI; then a run in the app by the author.
- A behaviour change to announce: the chat's critic stops reading Do's output, because it now follows the definition.

**Phase 1. Record what each role saw, and where each value came from.**

- Provenance registry for every signal field. Verified by a test that fails on an undeclared field.
- Provider recorder and step records (new `steps` storage: run, round, role, inputs with provenance, messages, output, tokens, time). Verified by replaying a recorded mock run and getting the same prompts byte for byte.
- `measureSight`, with the built-in matrices pinned in CI. Verified by the snapshot test.
- Tasks carry their checks; the lab runs a final measured check after every run; check files are copied back in before each check; a per-attempt token budget stops a run. Verified by tests.
- Check's verdict follows the measured check when there is one, the model's verdict kept beside it as written (a switch, so H2 can be tested; the default is the author's choice, section 10).

**Phase 2. The definition format and the grid engine.**

- The lab's format with its JSON Schema; the six recipes migrated. Verified by a test per recipe: old recipe and new definition produce the same nodes, edges and limits, and the same sight matrix.
- The consult edge in the runtime, the emulated advisor, the Advisor topology, and the real advisor tool when the provider is Anthropic and the sight is full. Verified with the mock provider for the emulation and one real call for the server tool, by the author.
- The layout engine in `packages/core` (horizontal, vertical, strip, run-state overlay) and the CLI renderer (`agentic-lab show`, live `run`). Verified by text snapshots of every built-in topology at rest and in scripted states.
- Agent Spec export and import with a loss report. Verified by round-trip tests and validation against the pinned schema.

**Phase 3, as reordered by the author (2026-11-18): `jig`, an interactive session like `claude`.** The rename comes first (the command `jig`, the packages, the README and the docs). Then `jig` with no arguments opens a full chat in the terminal, built with Ink, where each message is a task your harness runs: the conversation at the centre with the answer streaming, the topology's grid live above it (folded with a key), the two-line footer below, typing during a run to steer it, and slash commands to administer everything without leaving (`/topology`, `/models` for a model per role from any collection, `/tools`, `/sight`, `/checks`, `/budget`, `/memory`, `/advisor`, `/runs`, `/replay`). A shell command outside a role's allow-list asks for permission, as Claude Code does. The subcommands stay for scripts. The author: "no importa que sea grande, es lo que tiene sentido".

**Providers and brains, part of phase 3 (the author, 2026-11-18).** Jig connects to model providers through their APIs: Ollama and other local servers, OpenAI, Claude, Gemini and the like, "una config por apikeys, a no ser que haya otra más segura... pero podemos empezar por lo básico". Named provider entries live in the user's config, a key is a reference (an environment variable, the OS keychain, or a helper command) and never written in clear by Jig, and a role names a model as `<entry>/<model>`. The topologies "se pueden configurar con cualquier brain disponible, con fallback en caso de que no haya disponibilidad... flexibilidad máxima": a brain is a name for an ordered chain of models, and a role falls back along it only when a provider is unavailable, never on a bad answer, and stays on the fallback for the rest of the run, every fallback recorded and shown.

**Later, safer credentials (recorded, not built).** Credentials that are not a long-lived key: Claude through Amazon Bedrock or Google Vertex AI with the cloud's own identity (AWS SSO profiles, gcloud's application default credentials), Gemini on Vertex the same way, OpenAI on Azure with Entra ID, and OpenRouter's OAuth PKCE sign-in.

**Phase 3b, moved to the end (the author, 2026-11-18): the viewer in the web, the builder removed, jig-desktop.** It happens only once the console is fine, and only if it is worth it. (Phase 3 before the first reorder.)

- Tokens in `globals.css`, hue classes removed. Verified by a check that fails on a hue class in a component.
- The viewer at rest, running (SSE of step events) and in replay with the timeline, the side panel, steering and pause-before. Verified by Playwright captures at 1440 and 390 px compared with these sheets, and a test that a replay shows the same sequence as the live run it recorded.
- The drag-and-drop builder deleted; the wiring view read-only; Runs open replays; the chat page folded into Run.

**Phase 4. Experiments.** Built and proven in the console first.

- An experiment flags every run where a role fell back to another model of its brain, because mixing models changes what is being compared (H7): such a run is listed apart and counts for nothing until the experiment says otherwise. (Recorded with the providers work, 2026-11-18.)

- Schema, files, versioning, the hash-locked rule; task sets; the repetition runner; the baselines; the variant switches; statistics, strength words and sentences; the sample-size table; the dry-run estimate; the designer's draft from words.
- Verified by statistics tests against known values; a simulated experiment with a seeded mock model of known pass probabilities that must reach the right conclusion, and must say inconclusive when the counts don't decide; then one small real experiment run by the author on Ollama.

**Phase 5. Findings.** Built and proven in the console first.

- Hypotheses as data and ledger entries; surprise rules; cause chains and the counterfactual re-ask (behind a confirmation with its cost); MAST rules; next-question templates.
- Verified by fixtures of stored runs that must and must not trigger each rule, including one shaped like sheet 05's run, which must produce that cause chain.

**Phase 6. Home, intent and the rest.**

- Home, the intent proposal, Settings with providers and a price table, Memory restyled, the Benchmarks page retired with its problems moved to tasks (with exact checks where they exist: the bat and the ball, the fence posts, FizzBuzz with a twist), and the Spanish strings flagged above turned into English.
- Verified by Playwright captures and a walk through the visitor's path: a question typed on Home reaches a finished experiment and a ledger entry.

**Optional Phase 7.** Cross-framework runs of the Agent Spec subset through a Python bridge, once Oracle's conformance suite is merged.

## 9. What changed from the proposal I was given, and why

- **The walls are measured by marks, not declared.** A declared wall is a claim; a measured one is evidence, and it caught that the declared walls are not today's.
- **A sight matrix instead of walls drawn between roles.** It shows asymmetry at a glance and makes FOUNDATIONS' redundancy test checkable: two roles with the same column see the same things.
- **The viewer audits its own topology.** It lists what the definition says and the code doesn't do, because today that list is long, and keeps it visible after.
- **The order Plan, Do, Check, Critique, Decide is made true, not just drawn.** The engine runs Decide before Critique today; Phase 0 changes the engine to match the drawing.
- **Running is green; passed is quiet ink with ✓.** Colour marks what needs your eyes: what is moving, what needs you, what broke.
- **Text is near-neutral, not terminal green,** and amber means "waiting for you". Without that, green could not mean anything.
- **Experiments repeat by default and report counts with intervals,** with a strength vocabulary and a rule fixed in advance, because a single run of each variant is an anecdote.
- **The dry run promises an exact path and bounded tokens, not a cost.** Token counts are estimates until past runs exist, and say so.
- **No "fork from this step" in replay.** Loops keep internal state that is not serialised (Refinement's history, Critique's activity log); "run again with a change" is honest today.
- **Ranking for intent uses no model,** and the check is required, because without a measured check an experiment only measures a model's opinion.
- **The advisor figures were narrowed** to what the page says they measure (section 5.8).
- **"Topology" in the interface,** matching the rewritten FOUNDATIONS.

## 10. The author's choices

Decided on 2026-11-18: choices 1 to 6, 8 and 9 as recommended; choice 7 as Agent Spec with the lab's extension (section 6).

One at a time, each with my recommendation.

1. **Check's verdict follows the measured check by default,** with the model's verdict kept beside it? Recommended yes: H4 is the best-supported hypothesis and sheet 05's failure is exactly this. It changes what FOUNDATIONS v1 described and what users have been running.
2. **Passed shown as quiet ink with ✓** rather than green? Recommended yes; the alternative needs another sign for running.
3. **Near-neutral text** rather than the site's terminal-green text? Recommended yes.
4. **Fold the chat into Run on the viewer?** Recommended yes; a plain chat page would be a fourth surface to keep honest.
5. **Best-of-N picks by the measured check** (the strongest fair baseline) rather than by a judge? Recommended yes.
6. **Default repetitions:** 5 runs per task with the sample-size table shown, or a minimum of 30 per arm? Recommended the first, with the table always visible.
7. **Own definition format with Agent Spec export and import,** rather than adopting it? Recommended yes (section 6).
8. **Announce the chat's critic change** (Phase 0) in What's New and the README? Recommended yes.
9. **Role names Plan, Do, Check, Critique, Decide** in the interface, with the engine names in small type? Recommended yes.

## 11. What was verified, and what was not

- **Verified by running** (mock model, no network, nothing written to the repository): which recipes instantiate; Deep Reasoning's run order and what reaches each role's prompt, with a remap of missing ports that delivery makes behaviour-neutral; that the Ralph Loop recipe runs one cycle; the contrast ratios of the palette; that the grid engine's ANSI output reads back to the same characters.
- **Verified by reading:** the six loops' prompts and inputs, the orchestrator's routing and scheduling, the web agent route, the pipeline run route, the storage types, FOUNDATIONS on `feat/topology-lab`, the Agent Spec sources listed in section 6 (through the evaluation I delegated, which quotes file and line), and the two advisor pages.
- **Not verified:** the running app (another agent is auditing it); how any real model behaves in these topologies; every run value in the sheets, which are illustrative and stamped; the remaining 24k characters of the advisor API page; the CAIS 2026 paper's full text; Agent Spec's adapters at run time; whether every glyph used exists in Geist Mono (the renderer is built not to depend on it).
