# 🤖 Agentic Lab

> Extensible platform for experimenting with agentic loops, multiple LLM providers, and autonomous AI workflows.

Inspired by the [**"Human On the Loop"**](https://dotnetting.net/2026/02/the-human-on-the-loop-a-practical-guide-to-agentic-engineering/) agentic engineering pattern (Ralph Loop) by Lester Sanchez.

> **What's new:** every topology is now a file you can read, diff and share: an Agent Spec 26.3.1 document with the lab's own additions, in YAML or JSON ([docs/FORMAT.md](docs/FORMAT.md)). A role can consult another when it decides to, and the Advisor topology is built in. The CLI draws a topology with `agentic-lab show`, and draws a run live as it goes. Before that, tasks gained checks the lab runs itself, and every role's turn is recorded with what it saw. See [CHANGELOG.md](CHANGELOG.md).

---

## 🎯 What is this?

Agentic Lab is a **modular experimentation platform** for running AI agents in iterative loops. The core idea:

```
while hasTasksRemaining:
    agent reads specs + plan → picks ONE task → works on it → updates plan → ends turn
```

Each iteration is **stateless** — the agent gets fresh context every time, solving the context window dilution problem. The agent doesn't know it's in a loop.

### The 4 Pillars

| Pillar                | What                                           | File             |
|-----------------------|------------------------------------------------|------------------|
| **1. Specs**          | What to build — requirements & constraints     | `specs/SPEC.md`  |
| **2. Plan**           | Living TODO list — agent reads, picks, updates | `PLAN.md`        |
| **3. Prompt**         | Static instructions — how to behave each turn  | `PROMPT.md`      |
| **4. Brain + Muscle** | LLM (brain) + Tools (muscle)                   | Provider + Tools |

---

## 📦 Architecture

Monorepo with 3 packages:

```
agentic-lab/
├── packages/
│   ├── core/          # 🧠 Core engine — loop, providers, tools, storage, types
│   ├── cli/           # ⌨️  CLI — run loops from terminal
│   └── web/           # 🌐 Dashboard — visualization, API & analytics (Next.js)
├── infra/             # 🐳 Infrastructure configs (PostgreSQL, Prometheus, Grafana)
├── docs/              # 📖 Documentation
├── docker-compose.yml # Full infrastructure stack
├── package.json       # Workspace root
├── tsconfig.base.json # Shared TypeScript config
└── .env.example       # Environment template
```

---

## 🚀 Quick Start

### One Command Setup

```bash
cd agentic-lab
./setup.sh          # Installs, builds, starts infrastructure (~60s)
```

> See `./setup.sh --help` for modes: `--full` (all services), `--dev` (default), `--minimal` (no Docker).

📖 **Full guide with troubleshooting:** [docs/QUICKSTART.md](docs/QUICKSTART.md)

### Manual Setup

#### 1. Install dependencies

```bash
cd agentic-lab
npm install
```

#### 2. Build the core and CLI

```bash
npm run build:core
npm run build:cli

# Once: make the agentic-lab command available in any directory
cd packages/cli && npm link && cd ../..
```

The CLI is not published to npm; the link points the `agentic-lab` (and `alab`) command at this checkout.

#### 3. Start infrastructure (optional)

```bash
npm run infra:up    # PostgreSQL + Redis + Qdrant
```

#### 4. Initialize a workspace

```bash
# In your target project directory:
agentic-lab init

# Or with the advanced prompt template:
agentic-lab init --template advanced
```

This creates:
- `PROMPT.md` — Agent instructions
- `PLAN.md` — Implementation plan
- `specs/SPEC.md` — Project specifications

#### 5. Configure your LLM

```bash
cp .env.example .env
# Edit .env with your provider settings
```

#### 6. Run the loop

```bash
# The Ralph Loop on your PROMPT.md, with Ollama (local, free)
agentic-lab run --provider ollama --model llama3.1

# Another topology, on a task you type
agentic-lab run --topology deep-reasoning --task "Fix the failing test in src/sum.ts"

# With OpenAI
agentic-lab run --provider openai --model gpt-4o

# With Anthropic
agentic-lab run --provider anthropic --model claude-sonnet-4-20250514

# With OpenRouter (100+ models)
agentic-lab run --provider openrouter --model anthropic/claude-sonnet-4-20250514
```

---

## ⌨️ CLI Commands

| Command                 | Description                               |
|-------------------------|-------------------------------------------|
| `agentic-lab run`       | Run a topology on a task (Ralph Loop by default), drawn live |
| `agentic-lab show`      | Draw a topology at rest; `--sight` adds what each role sees |
| `agentic-lab validate`  | Check a definition file, with every problem at its path and line |
| `agentic-lab convert`   | Convert a definition between Agent Spec and recipes, JSON and YAML |
| `agentic-lab pipeline`  | Run or inspect composable pipelines       |
| `agentic-lab recipes`   | Browse, inspect, and run built-in recipes |
| `agentic-lab chat`      | Interactive chat REPL with any provider   |
| `agentic-lab config`    | Show and validate configuration           |
| `agentic-lab init`      | Initialize a new workspace                |
| `agentic-lab status`    | Show workspace status                     |
| `agentic-lab providers` | List and test LLM providers               |
| `agentic-lab history`   | Show past run history                     |

### Run Options

```
Options:
  -t, --topology <id|file> Topology to run: a built-in id or a .yaml/.json file (default: ralph-loop)
  --task <text>             The task (default: the prompt file's contents)
  -p, --provider <name>     LLM provider (ollama, openai, anthropic, openrouter)
  -m, --model <name>        Model to use
  -i, --iterations <n>      Round limit (turns, for the Ralph Loop)
  -d, --delay <ms>          Pause between rounds
  --prompt <file>           Prompt file the task is read from (default: PROMPT.md)
  --plan <file>             Plan file (default: PLAN.md)
  --specs <dir>             Specs directory
  --dir <path>              Working directory
  --param <key=value>       Topology parameter (repeatable)
  --json                    Print every engine event as a JSON line
  -v, --verbose             Verbose output
  --temperature <n>         LLM temperature
  --max-tokens <n>          Max tokens per call
  --tools <names>           Comma-separated list of tools
  --live / --no-live        Draw the run on its grid (the default in a terminal) or print lines
  --frames <file>           Write every frame of the live view to a file
  --layout <name>           auto, horizontal, vertical or strip
  --width <n>               Columns to draw for
  --plain                   No colour
```

`run`, `recipes --run` and `pipeline --recipe` all run through the same engine as the dashboard. The exit code is 0 when the run passed, 1 when it didn't, and 130 when you stopped it. Ctrl+C stops the run and the model call in flight; press it twice to quit at once.

---

## 🔌 LLM Providers

| Provider       | Type  | Tool Calling    | Setup                                 |
|----------------|-------|-----------------|---------------------------------------|
| **Ollama**     | Local | ✅ (most models) | `brew install ollama && ollama serve` |
| **OpenAI**     | Cloud | ✅               | Set `OPENAI_API_KEY`                  |
| **Anthropic**  | Cloud | ✅               | Set `ANTHROPIC_API_KEY`               |
| **OpenRouter** | Cloud | ✅               | Set `OPENROUTER_API_KEY`              |
| **Google**     | Cloud | ✅               | Set `GOOGLE_API_KEY`                  |

### Adding Custom Providers

```typescript
import { registerProvider, type LLMProvider, type LLMProviderConfig } from '@agentic-lab/core';

class MyProvider implements LLMProvider {
  readonly name = 'my-provider';
  // ... implement chat(), listModels(), healthCheck()
}

registerProvider('my-provider', MyProvider);
```

---

## 🔧 Built-in Tools

| Tool         | Description                                     |
|--------------|-------------------------------------------------|
| `file_read`  | Read file contents (with optional line ranges)  |
| `file_write` | Write/append to files (creates dirs)            |
| `shell`      | Run commands from the role's allow-list, inside the workspace |
| `glob`       | Find files by pattern                           |
| `grep`       | Search text in files                            |
| `git`        | Git operations (status, add, commit, diff, log) |

### Adding Custom Tools

```typescript
import type { AgentTool, ToolContext } from '@agentic-lab/core';

const myTool: AgentTool = {
  definition: {
    name: 'my_tool',
    description: 'Does something useful',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The input' },
      },
      required: ['input'],
    },
  },
  async execute(args, context) {
    // Your tool logic here
    return `Result: ${args.input}`;
  },
};
```

---

## 🧩 Composable Loop Engine

Beyond the basic Ralph Loop, Agentic Lab includes a **composable pipeline engine** that lets you wire together specialized loops into custom architectures. Each loop occupies a unique epistemic role:

| Loop           | Category     | Epistemic Role                                               |
|----------------|--------------|--------------------------------------------------------------|
| **Execution**  | `execution`  | Produces artifacts via tool calls                            |
| **Evaluation** | `evaluation` | Verifies output against ground truth                         |
| **Planning**   | `planning`   | Strategic reasoning over aggregated signals                  |
| **Refinement** | `refinement` | Convergence gate — decides to converge, refine, or backtrack |
| **Critic**     | `critic`     | Adversarial monitoring via structural analysis               |
| **Memory**     | `memory`     | Lossless information compression                             |

Loops communicate through **typed signals** flowing through ports and wires — no unstructured natural-language conversations between agents.

### Built-in Recipes

| Recipe                 | Loops                                | Use Case                                        |
|------------------------|--------------------------------------|-------------------------------------------------|
| **Ralph Loop**         | Execution                            | Baseline — single-loop, no verification         |
| **Execute & Evaluate** | Execution → Evaluation               | Ground truth verification with feedback         |
| **Supervised Coder**   | Planning → Execution → Evaluation    | Team simulation: Tech Lead + Dev + Reviewer     |
| **Adversarial Duel**   | 2× Execution + Evaluation + Planning | Two agents compete, Arbiter picks the best      |
| **Full Pipeline**      | Plan, Exec, Eval, Critic, Memory     | Maximum epistemic coverage                      |
| **Deep Reasoning**     | Plan → Exec → Eval → Refine ↔ Critic | Iterative refinement with convergence detection |
| **Advisor**            | Execution, consulting an Advisor     | Do asks an Advisor when it wants, 3 times a turn at most |

Each built-in topology is a definition file in `packages/core/topologies`: an Agent Spec 26.3.1 document with the lab's extension, in YAML, with a JSON twin written from it. [docs/FORMAT.md](docs/FORMAT.md) explains the format, how to import a document written elsewhere, and what another Agent Spec runtime makes of the lab's files.

### Deep Reasoning Pipeline

The most advanced built-in recipe. It implements a closed-feedback architecture:

```
┌──────────┐    ┌───────────┐    ┌────────────┐
│ Planning │───▶│ Execution │───▶│ Evaluation │
└──────────┘    └───────────┘    └────────────┘
     ▲               ▲  │              │
     │               │  │              ▼
     │               │  │       ┌────────────┐
     │               │  └──────▶│   Critic   │
     │               │          └────────────┘
     │               │                 │
     │          corrections            ▼
     │               │       ┌──────────────────┐
     │               └───────│   Refinement     │
     │   replan_signal       │   (convergence   │
     └───────────────────────│    gate)          │
                             └──────────────────┘
```

The **Refinement gate** inspects evaluation metrics and critic findings, then decides:
- **Converge** — quality threshold met, stop iterating
- **Refine** — send corrections back to Execution
- **Backtrack** — re-plan from scratch (when stuck in a loop)

Default settings: convergence threshold 70%, max 3 rounds.

### How a run goes

A run goes in rounds. Each round runs the roles in their drawn order, the order the recipe lists them. A wire to an earlier role is a way back. At the end of a round the deciding role chooses what happens next: Decide when the topology has one, otherwise the last Check. A Check that passes ends the run. A way back starts the next round where it points: corrections go to Do, a reason to start over goes to Plan. No way back ends the run. The Ralph Loop is the exception: it takes another turn while `PLAN.md` has unchecked items, up to 20.

A run ends as passed, failed, inconclusive or stopped. It only counts as a success when it passed: the last verdict passed (or the plan was finished) and no role failed. A round with no verdict is inconclusive, never a pass.

A task can carry its checks: a command that must exit 0, a file that must hold an expected text, or an expected answer (`--check`, `--check-file` and `--task-file` in the CLI; `checks` in the API). The lab runs them itself, in a copy of the workspace no role can write, with the check files put back as they were when the run started. When a task has checks, Check's verdict is their result, its model's verdict is kept beside it, and the run's outcome is the final measured check's. Each role's turn is recorded: what it saw, where each value came from (from you, measured by the lab, or written by a model), and the exact messages sent to its model.

📖 See [docs/FOUNDATIONS.md](docs/FOUNDATIONS.md) for the epistemic theory behind each loop.

---

## 🌐 Web Dashboard

```bash
npm run dev:web
# → http://localhost:3000 (it listens on 127.0.0.1 only)
```

The dashboard listens on your machine only. The API has no authentication yet, so if you open it to the network (`npx next dev --hostname 0.0.0.0` in `packages/web`), anyone who can reach it can run an agent with a shell.

### Pages

| Page           | Path          | Description                                                    |
|----------------|---------------|----------------------------------------------------------------|
| **Dashboard**  | `/`           | Overview with loop statistics and recent activity              |
| **Chat**       | `/chat`       | Dual-mode interface (Chat + Agent) with memory bank selection  |
| **Pipelines**  | `/pipelines`  | Visual pipeline editor with recipe loading                     |
| **Recipes**    | `/recipes`    | Browse built-in pipeline recipes                               |
| **Runs**       | `/runs`       | Run history with status filters, cancel/archive actions        |
| **Memory**     | `/memories`   | Semantic memory explorer — namespaces, search, create, delete  |
| **Benchmarks** | `/benchmarks` | Compare agentic architectures against a curated problem bank   |
| **Providers**  | `/providers`  | LLM provider configuration and testing                         |
| **Settings**   | `/settings`   | System settings and preferences                                |

### Chat Interface

The Chat page supports two interaction modes:

- **Chat Mode** — Direct conversation with the LLM (streaming via SSE)
- **Agent Mode** — Full agentic task execution with a selectable recipe pipeline

Both modes feature:
- **Semantic memory bank selection** — Attach an existing memory bank to enrich context
- **Per-session memory persistence** — Every exchange is saved for future retrieval
- **Thinking mode** — Live reasoning panel showing step/thinking/steering entries (Agent mode)
- **Mid-loop steering**: a nudge is a note Do reads on its next turn; no other role sees it

Agent mode runs the recipe on the same engine as the builder and the CLI. Each role sees what its definition says. Critique sees the process (verdicts, tool counts, tokens), not Do's output.

In Agent mode, the **Execution Panel** shows real-time progress:
- Resizable panel (drag to adjust width)
- Compact and detailed views
- Live subtask tracking with status indicators
- Content previews for each processing step
- Evaluation and critic feedback visualization

### Semantic Memory System

Agentic Lab includes a **Qdrant-powered semantic memory** layer that enables cross-session knowledge transfer:

- **Per-session memory** — Chat and agent exchanges are automatically saved to `["chat", sessionId]`
- **Memory banks** — Named, shareable memory pools across sessions, runs, and benchmarks
- **Memory aggregation** — LLM-powered consolidation compresses N memories into M high-quality summaries
- **Knowledge transfer** — Clone memories between sessions and banks

📖 See [docs/SEMANTIC-MEMORY.md](docs/SEMANTIC-MEMORY.md) for the full guide.

### Benchmark System

Compare baseline LLM vs agentic architectures on a curated bank of 13 tricky problems:

- **13 curated problems** across 6 categories (reasoning, logic, common-sense, math, coding, ambiguity)
- **Quality scoring** by a judge model you can name apart from the contenders', comparing answers against expected insights
- **Memory-aware**: suites can use a semantic memory bank you pick; without one, nothing is recalled
- **Persistent** — Suites are stored in the database and survive restarts

📖 See [docs/BENCHMARKS.md](docs/BENCHMARKS.md) for the full guide.

### API Endpoints

| Method   | Path                             | Description                                            |
|----------|----------------------------------|--------------------------------------------------------|
| **Chat & Agent** |                         |                                                        |
| `POST`   | `/api/chat/send`                | Chat completion (SSE streaming) + memory persistence   |
| `POST`   | `/api/chat/agent`               | Agent task execution (SSE streaming with steps)        |
| `POST`   | `/api/chat/agent/nudge`         | Inject a mid-loop steering nudge                       |
| `POST`   | `/api/chat/agent/cancel`        | Cancel a running agent task                            |
| `GET`    | `/api/chat/sessions`            | List chat sessions                                     |
| `POST`   | `/api/chat/sessions`            | Create a new session                                   |
| `PATCH`  | `/api/chat/sessions`            | Update a session                                       |
| `DELETE` | `/api/chat/sessions?id=X`       | Delete a session and its memories                      |
| `GET`    | `/api/chat/messages?sessionId=X`| Get messages for a session                             |
| **Runs** |                                 |                                                        |
| `GET`    | `/api/runs`                     | List runs (filter by status, provider, limit, offset)  |
| `GET`    | `/api/runs/:id`                 | Get run details with iterations                        |
| `DELETE` | `/api/runs/:id`                 | Delete a run and all associated data                   |
| `GET`    | `/api/events/:runId`            | SSE stream of real-time run events                     |
| **Memory** |                               |                                                        |
| `GET`    | `/api/memories?q=...`           | List / semantic-search memories                        |
| `POST`   | `/api/memories`                 | Create a memory item                                   |
| `GET`    | `/api/memories/namespaces`      | List all distinct namespaces                           |
| `GET`    | `/api/memories/banks`           | List memory banks                                      |
| `POST`   | `/api/memories/banks`           | Create a named memory bank                             |
| `DELETE` | `/api/memories/banks?id=X`      | Delete a memory bank                                   |
| `POST`   | `/api/memories/banks/clone`     | Clone memories between namespaces / banks              |
| `POST`   | `/api/memories/aggregate`       | LLM-powered memory consolidation                       |
| **Benchmarks** |                           |                                                        |
| `GET`    | `/api/benchmarks/problems`      | List the curated problem bank                          |
| `GET`    | `/api/benchmarks/suites`        | List benchmark suites                                  |
| `POST`   | `/api/benchmarks/suites`        | Create and start a benchmark suite                     |
| `GET`    | `/api/benchmarks/suites/:id`    | Get suite with aggregated stats per contender          |
| `DELETE` | `/api/benchmarks/suites?id=X`   | Delete a benchmark suite                               |
| **Infrastructure** |                       |                                                        |
| `GET`    | `/api/health`                   | Health check for PostgreSQL, Redis, Qdrant             |
| `GET`    | `/api/metrics`                  | Prometheus-format metrics endpoint                     |
| `GET`    | `/api/stats`                    | Aggregated analytics (tokens, costs, daily stats)      |
| `GET`    | `/api/meta`                     | System capabilities and version info                   |
| `GET`    | `/api/pipelines/recipes`        | List available pipeline recipes                        |
| `GET`    | `/api/pipelines/node-types`     | List registered node types with port definitions       |

---

## 🗄️ Infrastructure

Agentic Lab uses an optional infrastructure stack for persistence, real-time events, semantic memory, and observability. **No infrastructure is required** — the system falls back to in-memory storage automatically.

```
┌────────────┐   ┌────────────┐   ┌────────────┐
│ PostgreSQL │   │   Redis    │   │   Qdrant   │
│  (State)   │   │ (Pub/Sub)  │   │ (Vectors)  │
└────────────┘   └────────────┘   └────────────┘
┌────────────┐   ┌────────────┐
│ Prometheus │   │  Grafana   │
│ (Metrics)  │   │   (Viz)    │
└────────────┘   └────────────┘
```

### Quick Start

```bash
# Full stack (all services)
npm run infra:up:full

# Dev mode (PostgreSQL + Redis + Qdrant only)
npm run infra:up

# With pgAdmin
docker compose --profile admin up -d

# Check status
npm run infra:status

# View logs
npm run infra:logs

# Stop everything
npm run infra:down

# Nuclear reset (deletes all data!)
npm run infra:reset
```

### Services

| Service    | Port | Purpose                                   |
|------------|------|-------------------------------------------|
| PostgreSQL | 5432 | Runs, iterations, checkpoints, memories   |
| Redis      | 6379 | Real-time pub/sub, caching, rate limiting |
| Qdrant     | 6333 | Vector search for semantic memory         |
| Prometheus | 9090 | Time series metrics collection            |
| Grafana    | 3001 | Dashboards (admin/agentic_lab)            |
| pgAdmin    | 5050 | DB admin (admin profile only)             |

### Storage Fallback

The system **never requires infrastructure** to run:
- PostgreSQL unavailable → In-memory storage (data lost on restart)
- Redis unavailable → Local EventEmitter (no cross-process events)
- Qdrant unavailable → `semanticSearch()` disabled, text search still works

📖 See [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) for the full infrastructure guide.

---

## 📁 Workspace Structure

After `agentic-lab init`, your project will have:

```
your-project/
├── PROMPT.md               # Agent instructions
├── PLAN.md                 # Implementation plan (agent reads & updates)
├── specs/
│   └── SPEC.md             # Project specifications
├── .agentic-lab/
│   └── runs/               # Past run data (JSON logs)
└── .env                    # Provider configuration
```

---

## 🔄 How the Loop Works

### Basic Loop (Ralph Loop)

```
┌─────────────────────────────────────────────────┐
│                   Agentic Loop                   │
│                                                  │
│  ┌──── Iteration N ────────────────────────┐    │
│  │                                          │    │
│  │  1. Read PROMPT.md (static instructions) │    │
│  │  2. Read PLAN.md (current tasks)         │    │
│  │  3. Read specs/ (requirements)           │    │
│  │  4. Pick ONE task from plan              │    │
│  │  5. Use tools to implement               │    │
│  │  6. Verify work (tests, builds)          │    │
│  │  7. Update PLAN.md with progress         │    │
│  │  8. End turn                             │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
│              │                                   │
│              ▼                                   │
│        Wait delay → Next iteration               │
│              │                                   │
│    (Until: max iterations OR all tasks done)     │
│                                                  │
└─────────────────────────────────────────────────┘
```

Key insight: **Each iteration starts with fresh context.** The agent doesn't remember previous iterations — it reads the plan each time. This solves context window dilution.

### Composable Pipeline (Advanced)

```
┌─────────────────────────────────────────────────────────────┐
│                    Pipeline Cycle                            │
│                                                             │
│   Planning ──▶ Execution ──▶ Evaluation ──▶ Refinement     │
│      ▲              ▲             │              │          │
│      │              │             ▼              ▼          │
│      │              │          Critic ──▶ (convergence?)    │
│      │              │                                       │
│      │         corrections ◀─── refine action               │
│      │                                                      │
│      └──────── replan signal ◀── backtrack action           │
│                                                             │
│   Memory compresses signals at each cycle boundary          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The composable engine runs loops as nodes connected by typed signals, in rounds: each round runs the roles in their drawn order, and a way back taken by the deciding role starts the next round at its target (see [How a run goes](#how-a-run-goes)). A signal reaches a port only if the port accepts its type.

---

## 🛡️ Safety Features

- **Max iterations limit** — Prevents infinite loops
- **A shell allow-list**: the shell runs only the programs a role's allow-list names (by default, reading and arranging files; no interpreter, package manager or network tool), and no argument, redirection or working directory may leave the workspace. A role gets more programs in its definition: `config.toolPolicy.commands`
- **Ctrl+C handling**: stops the run and aborts the model call in flight
- **Call limits**: every model call has an output limit (4096 tokens) and a timeout (300 s) unless you set your own
- **Scrubbed environment**: commands the agent runs don't inherit your API keys or database URLs
- **Run logging**: the CLI keeps each run's result in `.agentic-lab/runs`; with storage configured, every role's turn is stored
- **Mid-loop steering** — Inject corrections without stopping the agent
- **AbortSignal propagation** — Clean cancellation through the entire stack

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [QUICKSTART.md](docs/QUICKSTART.md) | Setup guide with troubleshooting |
| [FOUNDATIONS.md](docs/FOUNDATIONS.md) | Epistemic theory behind each loop type |
| [AGENTIC-LOOP-PATTERN.md](docs/AGENTIC-LOOP-PATTERN.md) | The Ralph Loop pattern explained |
| [MID-LOOP-STEERING.md](docs/MID-LOOP-STEERING.md) | Tactical nudges for running agents |
| [SEMANTIC-MEMORY.md](docs/SEMANTIC-MEMORY.md) | Memory banks, aggregation, knowledge transfer |
| [BENCHMARKS.md](docs/BENCHMARKS.md) | Benchmark system for comparing architectures |
| [INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Docker services, PostgreSQL, Redis, Qdrant |
| [API.md](docs/API.md) | Full API reference |
| [FORMAT.md](docs/FORMAT.md) | Topology files: Agent Spec with the lab's extension |
| [EXTENDING.md](docs/EXTENDING.md) | Adding providers, tools, loop types, recipes |

---

## ⚠️ Warning

> **USE AT YOUR OWN RISK.** Agentic loops allow AI agents to run autonomously with access to files, shell commands, and git. Always:
> - Review the prompt and plan before running
> - Use in a sandboxed or git-tracked directory
> - Monitor the output
> - Set reasonable iteration limits
> - Work in a git-tracked directory, so you can roll back what the agent did

---

## 📝 License

MIT
