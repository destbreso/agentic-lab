# ⚡ Quickstart

Get Agentic Lab running in under 60 seconds.

---

## TL;DR (One Command)

```bash
git clone <your-repo-url> agentic-lab && cd agentic-lab
./setup.sh            # Dev mode (PostgreSQL + Redis + Qdrant)
```

That's it. The script handles everything: dependencies, build, Docker services, health checks.

### Setup Modes

```bash
./setup.sh --full     # All services (+ Prometheus, Grafana dashboards)
./setup.sh --dev      # Essential services only (default)
./setup.sh --minimal  # No Docker needed (in-memory storage)
```

---

## Step by Step (Manual)

If you prefer to do it manually or the script doesn't work:

### 1. Prerequisites

| Requirement       | Version | Check                    |
|-------------------|---------|--------------------------|
| Node.js           | ≥ 20    | `node -v`                |
| npm               | ≥ 10    | `npm -v`                 |
| Docker Desktop    | Latest  | `docker --version`       |
| Docker Compose V2 | Latest  | `docker compose version` |

> 💡 Docker is **optional**. Without it, the system uses in-memory storage (no persistence between restarts, but everything else works).

### 2. Install & Build

```bash
cd agentic-lab

# Install all workspace dependencies
npm install

# Build packages (order matters: core → cli → web)
npm run build:core
npm run build:cli
npm run build:web
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` to add your API keys. **Only fill in the provider you want to use:**

```dotenv
# For Ollama (local, free — no key needed):
OLLAMA_BASE_URL=http://localhost:11434

# For OpenAI:
OPENAI_API_KEY=sk-...

# For Anthropic:
ANTHROPIC_API_KEY=sk-ant-...

# For OpenRouter (100+ models):
OPENROUTER_API_KEY=sk-or-...
```

### 4. Start Infrastructure

```bash
# Essential services (PostgreSQL, Redis, Qdrant)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Verify everything is healthy
docker compose ps
```

Expected output:
```
NAME             STATUS          PORTS
alab-postgres    Up (healthy)    0.0.0.0:5432->5432/tcp
alab-redis       Up (healthy)    0.0.0.0:6379->6379/tcp
alab-qdrant      Up (healthy)    0.0.0.0:6333->6333/tcp
```

### 5. First Run

```bash
# Initialize a workspace in your project
cd your-project
npx agentic-lab init

# Run the loop
npx agentic-lab run --provider ollama --model llama3.1
```

### 6. Web Dashboard (Optional)

```bash
# From the agentic-lab directory
npm run dev:web
# → http://localhost:3000
```

#### Chat Interface

The Chat page (`/chat`) supports two interaction modes:

**Chat Mode** — Direct LLM conversation with streaming responses:
1. Navigate to `/chat`
2. Ensure "Chat" mode is selected (default)
3. Type a message and press Enter
4. Watch the streaming response arrive in real-time

**Agent Mode** — Full agentic pipeline execution:
1. Switch to "Agent" mode using the mode switcher
2. Select a recipe (e.g., **Deep Reasoning**)
3. Type a task description (e.g., "Build a REST API with authentication")
4. The Execution Panel appears on the right, showing:
   - Real-time pipeline steps (Planning → Execution → Evaluation → Critic → Refinement)
   - Subtask tracking with pass/fail indicators
   - Content previews for each step
   - Convergence decisions (converge/refine/backtrack)
5. Drag the panel edge to resize it (260px–640px)
6. Toggle between compact and detailed views

#### Pipeline Editor

The Pipeline page (`/pipeline`) provides a visual editor:
1. Load a recipe from the dropdown (e.g., Deep Reasoning)
2. See nodes and wires rendered as a graph
3. Inspect node ports and signal types
4. Understand data flow between loops

---

## Verify Everything Works

### Quick Health Check

```bash
# Check infrastructure services
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

Expected:
```json
{
  "status": "healthy",
  "services": [
    { "name": "postgres", "status": "healthy" },
    { "name": "redis", "status": "healthy" },
    { "name": "qdrant", "status": "healthy" }
  ]
}
```

### Test Database Connectivity

```bash
docker exec alab-postgres psql -U agentic -d agentic_lab -c "SELECT count(*) FROM runs;"
```

### Test Redis

```bash
docker exec alab-redis redis-cli ping
# → PONG
```

### Test Qdrant

```bash
curl -s http://localhost:6333/healthz
# → (empty 200 response)
```

### Test LLM Provider

```bash
# Ollama
npx agentic-lab providers

# Or test directly
curl http://localhost:11434/api/tags
```

---

## 🔧 Troubleshooting

### Docker Problems

#### `Cannot connect to the Docker daemon`
```
Error: Cannot connect to the Docker daemon at unix:///var/run/docker.sock
```
**Fix:** Start Docker Desktop. On macOS, open the Docker app from Applications.

#### `port is already allocated`
```
Error: bind: address already in use
```
**Fix:** Another service is using that port. Either stop it or change the port in `.env`:
```bash
# Find what's using the port
lsof -i :5432

# Option 1: Kill the existing process
kill -9 <PID>

# Option 2: Change the port in .env
echo "POSTGRES_PORT=5433" >> .env
```

Common port conflicts:
| Port | Usually             | Fix                    |
|------|---------------------|------------------------|
| 5432 | Local PostgreSQL    | `POSTGRES_PORT=5433`   |
| 6379 | Local Redis         | `REDIS_PORT=6380`      |
| 3000 | Another Next.js app | `WEB_PORT=3100`        |
| 3001 | Other dev server    | `GRAFANA_PORT=3002`    |
| 9090 | Another Prometheus  | `PROMETHEUS_PORT=9091` |

#### Containers keep restarting
```bash
# Check the logs
docker compose logs postgres
docker compose logs redis
docker compose logs qdrant

# Nuclear option: reset everything
docker compose down -v   # ⚠️ Deletes all data!
docker compose up -d
```

#### `no space left on device`
```bash
# Clean up Docker
docker system prune -a --volumes
```

---

### Node.js / Build Problems

#### `npm install` fails

```
npm ERR! ERESOLVE unable to resolve dependency tree
```
**Fix:**
```bash
# Clear caches and retry
rm -rf node_modules package-lock.json
npm install
```

#### `Cannot find module '@agentic-lab/core'`
**Fix:** Build packages in the correct order:
```bash
npm run build:core    # Must be first
npm run build:cli
npm run build:web
```

#### TypeScript errors during build
```bash
# Clean and rebuild
npm run clean
npm install
npm run build:core
```

#### `ENOENT: no such file or directory, open 'PROMPT.md'`
**Fix:** You need to initialize a workspace first:
```bash
npx agentic-lab init
```

---

### LLM Provider Problems

#### Ollama: `Cannot connect to ollama`
```bash
# Is Ollama running?
curl http://localhost:11434/api/tags

# Start it
ollama serve

# Pull a model (if first time)
ollama pull llama3.1
```

#### Ollama: `model not found`
```bash
# List installed models
ollama list

# Pull the model you need
ollama pull llama3.1
ollama pull codellama:34b
ollama pull nomic-embed-text  # For semantic memory
```

#### OpenAI / Anthropic: `401 Unauthorized`
**Fix:** Check your API key in `.env`:
```bash
# Verify the key is set
grep "API_KEY" .env

# Make sure there are no extra spaces or quotes
# ✅ Correct:
OPENAI_API_KEY=sk-abc123...
# ❌ Wrong:
OPENAI_API_KEY="sk-abc123..."
OPENAI_API_KEY= sk-abc123...
```

#### `429 Too Many Requests` / Rate Limiting
**Fix:** Increase the delay between iterations:
```bash
npx agentic-lab run --provider openai --model gpt-4o --delay 5000
```

---

### Storage Problems

#### `Storage: InMemory (no persistence)` when you expected PostgreSQL
**Fix:** Ensure PostgreSQL is running and env vars are set:
```bash
# Check if PostgreSQL is up
docker exec alab-postgres pg_isready -U agentic

# Verify env vars
grep POSTGRES .env

# Required vars:
# POSTGRES_HOST=localhost
# POSTGRES_PORT=5432
# POSTGRES_DB=agentic_lab
# POSTGRES_USER=agentic
# POSTGRES_PASSWORD=agentic_lab_secret
```

#### `relation "runs" does not exist`
The init script didn't run. **Fix:**
```bash
# Restart PostgreSQL to re-run init scripts
docker compose restart postgres

# Or manually run the schema
docker exec -i alab-postgres psql -U agentic -d agentic_lab < infra/postgres/init/001-schema.sql
```

#### `ECONNREFUSED` to Redis or Qdrant
**Fix:**
```bash
# Check service status
docker compose ps

# Restart the specific service
docker compose restart redis
docker compose restart qdrant
```

> 💡 Remember: storage failures are **non-blocking**. The loop keeps running even if all infrastructure is down — it just falls back to in-memory.

---

### Grafana Problems

#### Can't log in to Grafana
**Default credentials:** `admin` / `agentic_lab`

If you changed them and forgot:
```bash
# Reset Grafana
docker compose down grafana
docker volume rm agentic-lab_grafana_data
docker compose up -d grafana
```

#### Dashboards are empty
**Fix:** Make sure Prometheus is scraping the metrics endpoint:
1. The web dashboard must be running (`npm run dev:web`)
2. Check Prometheus targets: http://localhost:9090/targets
3. Dashboards will populate after the first few runs

---

### macOS-Specific

#### Docker is slow on macOS
**Fix:** In Docker Desktop → Settings → Resources:
- Allocate at least 4GB RAM
- Enable VirtioFS (faster file system)
- Use "Apple Virtualization framework" in General settings

#### `xattr: Operation not supported` or quarantine issues
```bash
xattr -cr ./setup.sh
chmod +x ./setup.sh
```

---

### Windows-Specific (WSL2)

#### Docker not working in WSL
**Fix:** Enable WSL2 integration in Docker Desktop → Settings → Resources → WSL Integration

#### Line ending issues
```bash
git config core.autocrlf input
```

---

## 🧹 Useful Commands

| Command                        | Description                           |
|--------------------------------|---------------------------------------|
| `docker compose ps`            | Show running services                 |
| `docker compose logs -f`       | Tail all logs                         |
| `docker compose logs postgres` | Logs for a specific service           |
| `docker compose restart`       | Restart all services                  |
| `docker compose down`          | Stop everything (keep data)           |
| `docker compose down -v`       | Stop everything + delete data ⚠️      |
| `npm run clean`                | Remove build artifacts + node_modules |
| `npm run build`                | Rebuild all packages                  |
| `npx agentic-lab providers`    | Test LLM provider connectivity        |
| `npx agentic-lab status`       | Show workspace status                 |
| `npx agentic-lab history`      | Show past runs                        |

---

## 📚 More Documentation

| Doc                                                | Description                                      |
|----------------------------------------------------|--------------------------------------------------|
| [README.md](../README.md)                          | Project overview                                 |
| [FOUNDATIONS.md](FOUNDATIONS.md)                   | Epistemic theory behind the loop engine          |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md)             | Infrastructure architecture deep-dive            |
| [API.md](API.md)                                   | REST + SSE API reference (runs, chat, pipelines) |
| [EXTENDING.md](EXTENDING.md)                       | Custom providers, tools, storage, loop nodes     |
| [AGENTIC-LOOP-PATTERN.md](AGENTIC-LOOP-PATTERN.md) | Theory behind the Ralph Loop pattern             |
