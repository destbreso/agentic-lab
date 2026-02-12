# 🤖 Agentic Lab

> Extensible platform for experimenting with agentic loops, multiple LLM providers, and autonomous AI workflows.

Inspired by the [**"Human On the Loop"**](https://dotnetting.net/2026/02/the-human-on-the-loop-a-practical-guide-to-agentic-engineering/) agentic engineering pattern (Ralph Loop) by Lester Sanchez.

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
```

#### 3. Start infrastructure (optional)

```bash
npm run infra:up    # PostgreSQL + Redis + Qdrant
```

#### 4. Initialize a workspace

```bash
# In your target project directory:
npx agentic-lab init

# Or with the advanced prompt template:
npx agentic-lab init --template advanced
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
# With Ollama (local, free)
npx agentic-lab run --provider ollama --model llama3.1

# With OpenAI
npx agentic-lab run --provider openai --model gpt-4o

# With Anthropic
npx agentic-lab run --provider anthropic --model claude-sonnet-4-20250514

# With OpenRouter (100+ models)
npx agentic-lab run --provider openrouter --model anthropic/claude-sonnet-4-20250514
```

---

## ⌨️ CLI Commands

| Command                 | Description                              |
|-------------------------|------------------------------------------|
| `agentic-lab run`       | Run an agentic loop                      |
| `agentic-lab pipeline`  | Run or inspect composable pipelines      |
| `agentic-lab recipes`   | Browse, inspect, and run built-in recipes|
| `agentic-lab chat`      | Interactive chat REPL with any provider  |
| `agentic-lab config`    | Show and validate configuration          |
| `agentic-lab init`      | Initialize a new workspace               |
| `agentic-lab status`    | Show workspace status                    |
| `agentic-lab providers` | List and test LLM providers              |
| `agentic-lab history`   | Show past run history                    |

### Run Options

```
Options:
  -p, --provider <name>     LLM provider (ollama, openai, anthropic, openrouter)
  -m, --model <name>        Model to use
  -i, --iterations <n>      Max iterations (default: 10)
  -d, --delay <ms>          Delay between iterations (default: 1000)
  --prompt <file>           Prompt file (default: PROMPT.md)
  --plan <file>             Plan file (default: PLAN.md)
  --specs <dir>             Specs directory
  --dir <path>              Working directory
  --auto-commit             Auto-commit after each iteration
  --auto-push               Auto-push after commits
  -v, --verbose             Verbose output
  --log <file>              Log file path
  --temperature <n>         LLM temperature
  --max-tokens <n>          Max tokens per call
  --tools <names>           Comma-separated list of tools
```

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
| `shell`      | Execute shell commands (with safety checks)     |
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

| Loop          | Category     | Epistemic Role                                              |
|---------------|--------------|-------------------------------------------------------------|
| **Execution** | `execution`  | Produces artifacts via tool calls                           |
| **Evaluation**| `evaluation` | Verifies output against ground truth                        |
| **Planning**  | `planning`   | Strategic reasoning over aggregated signals                 |
| **Refinement**| `refinement` | Convergence gate — decides to converge, refine, or backtrack|
| **Critic**    | `critic`     | Adversarial monitoring via structural analysis              |
| **Memory**    | `memory`     | Lossless information compression                            |

Loops communicate through **typed signals** flowing through ports and wires — no unstructured natural-language conversations between agents.

### Built-in Recipes

| Recipe              | Loops                              | Use Case                                        |
|---------------------|------------------------------------|-------------------------------------------------|
| **Ralph Loop**      | Execution                          | Baseline — single-loop, no verification         |
| **Execute & Evaluate** | Execution → Evaluation          | Ground truth verification with feedback         |
| **Supervised Coder**| Planning → Execution → Evaluation  | Team simulation: Tech Lead + Dev + Reviewer     |
| **Full Pipeline**   | All 6 loops                        | Maximum epistemic coverage                      |
| **Deep Reasoning**  | Plan → Exec → Eval → Refine ↔ Critic | Iterative refinement with convergence detection |

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

📖 See [docs/FOUNDATIONS.md](docs/FOUNDATIONS.md) for the epistemic theory behind each loop.

---

## 🌐 Web Dashboard

```bash
npm run dev:web
# → http://localhost:3000
```

### Pages

| Page             | Path               | Description                                          |
|------------------|--------------------|------------------------------------------------------|
| **Dashboard**    | `/`                | Overview with loop statistics and recent activity     |
| **Chat**         | `/chat`            | Dual-mode interactive interface (Chat + Agent modes)  |
| **Runs**         | `/runs`            | Run history with details and iterations               |
| **Pipeline**     | `/pipeline`        | Visual pipeline editor with recipe loading            |
| **Providers**    | `/providers`       | LLM provider configuration and testing               |
| **Settings**     | `/settings`        | System settings and preferences                       |
| **Health**       | `/health`          | Infrastructure health monitoring                      |

### Chat Interface

The Chat page supports two interaction modes:

- **Chat Mode** — Direct conversation with the LLM (streaming via SSE)
- **Agent Mode** — Full agentic task execution with a selectable recipe pipeline

In Agent mode, the **Execution Panel** shows real-time progress:
- Resizable panel (drag to adjust width)
- Compact and detailed views
- Live subtask tracking with status indicators
- Content previews for each processing step
- Evaluation and critic feedback visualization

### API Endpoints

| Method   | Path                        | Description                                           |
|----------|-----------------------------|-------------------------------------------------------|
| `GET`    | `/api/runs`                 | List runs (filter by status, provider, limit, offset) |
| `GET`    | `/api/runs/:id`             | Get run details with iterations                       |
| `DELETE` | `/api/runs/:id`             | Delete a run and all associated data                  |
| `GET`    | `/api/stats`                | Aggregated analytics (tokens, costs, daily stats)     |
| `GET`    | `/api/events/:runId`        | SSE stream of real-time run events                    |
| `GET`    | `/api/health`               | Health check for PostgreSQL, Redis, Qdrant            |
| `GET`    | `/api/metrics`              | Prometheus-format metrics endpoint                    |
| `POST`   | `/api/chat`                 | Chat completion (SSE streaming)                       |
| `POST`   | `/api/chat/agent`           | Agent task execution (SSE streaming with steps)       |
| `GET`    | `/api/chat/sessions`        | List chat sessions                                    |
| `GET`    | `/api/pipelines/recipes`    | List available pipeline recipes with node/wire data   |
| `GET`    | `/api/pipelines/node-types` | List registered node types with port definitions      |

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

The composable engine runs loops as a **DAG of nodes** connected by typed signals. Each cycle executes nodes in category order: Planning → Execution → Evaluation → Refinement → Critic → Memory. Nodes fire only when their trigger conditions are met (signal-based or interval-based).

---

## 🛡️ Safety Features

- **Max iterations limit** — Prevents infinite loops
- **Dangerous command blocking** — Shell and git tools block destructive commands
- **Git integration** — Auto-commit for rollback capability
- **Ctrl+C handling** — Graceful shutdown
- **Run logging** — Every iteration is saved to disk for audit

---

## ⚠️ Warning

> **USE AT YOUR OWN RISK.** Agentic loops allow AI agents to run autonomously with access to files, shell commands, and git. Always:
> - Review the prompt and plan before running
> - Use in a sandboxed or git-tracked directory
> - Monitor the output
> - Set reasonable iteration limits
> - Use `--auto-commit` for rollback capability

---

## 📝 License

MIT
