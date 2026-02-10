# Infrastructure Guide

## Architecture Overview

Agentic Lab uses a service-oriented infrastructure for persistence, real-time communication, semantic memory, and observability.

```
┌─────────────────────────────────────────────────────────┐
│                     Agentic Lab                         │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
│  │   CLI    │   │   Web    │   │   Core Engine    │   │
│  │          │   │ Dashboard│   │   (AgenticLoop)  │   │
│  └────┬─────┘   └────┬─────┘   └───────┬──────────┘   │
│       │              │                  │              │
│       └──────────────┼──────────────────┘              │
│                      │                                  │
│              ┌───────┴────────┐                        │
│              │  Storage Layer │                        │
│              │   (Abstract)   │                        │
│              └───────┬────────┘                        │
│                      │                                  │
├──────────────────────┼──────────────────────────────────┤
│  Infrastructure      │                                  │
│                      │                                  │
│  ┌─────────┐   ┌────┴────┐   ┌──────────┐            │
│  │PostgreSQL│   │  Redis  │   │  Qdrant  │            │
│  │  (State) │   │(Pub/Sub)│   │(Vectors) │            │
│  └─────────┘   └─────────┘   └──────────┘            │
│                                                         │
│  ┌───────────┐   ┌──────────┐                          │
│  │Prometheus │   │ Grafana  │                          │
│  │ (Metrics) │   │  (Viz)   │                          │
│  └───────────┘   └──────────┘                          │
└─────────────────────────────────────────────────────────┘
```

## Services

### PostgreSQL (Port 5432)

**Purpose:** Primary relational store for structured data.

**What it stores:**
- **runs** — Top-level loop executions with status, token usage, timing, config snapshots
- **iterations** — Individual iterations within runs, with token counts and results
- **tool_calls** — Every tool invocation with arguments, results, errors, and timing
- **checkpoints** — Full state snapshots for time-travel and resume functionality
- **memories** — Cross-run semantic memory (key-value with namespaces)
- **provider_usage** — Per-request usage metrics with estimated costs
- **events** — Timeline of all events for replay and auditing

**Views:**
- `v_run_summary` — Run overview with iteration/tool call counts and costs
- `v_tool_analytics` — Tool usage breakdown with error rates
- `v_daily_stats` — Daily aggregates for dashboards

**Why PostgreSQL:**
- LangGraph uses PostgreSQL for production checkpointers
- JSONB columns for flexible schema evolution
- Array types for tags and namespace queries
- Full text search and GIN indexes for fast filtering
- Mature, reliable, well-tooled

### Redis (Port 6379)

**Purpose:** Real-time communication layer.

**What it does:**
- **Pub/Sub** — Streams events from CLI to Dashboard in real-time (SSE)
- **Caching** — Ephemeral run state, model lists, provider health status
- **Rate Limiting** — Sliding window counters for API protection
- **Metrics** — Fast counters for real-time stats

**Key patterns:**
- `alab:run:stream:{runId}` — Event channel per run
- `alab:event:{runId}` — Sorted set of recent events for late-joining clients
- `alab:run:state:{runId}` — Cached current state (1h TTL)
- `alab:cache:*` — Generic cache entries
- `alab:ratelimit:*` — Rate limit windows

**Why Redis:**
- Native pub/sub for real-time event streaming
- Sub-millisecond latency for state queries
- Built-in TTL for automatic cache expiration
- Sorted sets for efficient event replay

### Qdrant (Ports 6333 HTTP, 6334 gRPC)

**Purpose:** Vector store for semantic memory and context retrieval.

**What it does:**
- Stores embeddings of run context, tool outputs, and user-defined memories
- Enables semantic search across runs ("find runs where we discussed X")
- Cross-project knowledge base for the agent

**Embedding providers:**
- **Ollama** (local): `nomic-embed-text` model — free, private, 768 dimensions
- **OpenAI**: `text-embedding-3-small` — 1536 dimensions, best quality
- Bring your own embedding function

**Why Qdrant:**
- Purpose-built for vector similarity search
- REST + gRPC APIs
- Filtering + payload storage combined with vector search
- Lightweight Docker image, easy self-hosting

### Prometheus (Port 9090)

**Purpose:** Time series metrics collection.

**What it scrapes:**
- `/api/metrics` endpoint from the web dashboard
- Custom metrics: run counts, token usage, tool call rates by tool name, provider usage

### Grafana (Port 3001)

**Purpose:** Observability dashboards.

**Pre-built dashboard:**
- Runs Overview (total, active, success rate)
- Token Usage Over Time (time series chart)
- Tool Usage Distribution (pie chart)
- Runs Timeline (duration + tokens over time)
- Provider Usage Breakdown (bar chart)
- Average Latency by Provider

**Data sources:**
- Prometheus (time series metrics)
- PostgreSQL direct (SQL queries for analytics)

## Quick Start

### Option 1: Full Stack

```bash
# Start all services
docker compose up -d

# Verify everything is running
docker compose ps

# Access services:
# - PostgreSQL:  localhost:5432
# - Redis:       localhost:6379
# - Qdrant:      localhost:6333
# - Grafana:     localhost:3001 (admin/agentic_lab)
# - Prometheus:  localhost:9090
```

### Option 2: Development (Minimal)

```bash
# Only essential services (no observability)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# This starts: PostgreSQL + Redis + Qdrant
```

### Option 3: With Admin Tools

```bash
# Include pgAdmin for database management
docker compose --profile admin up -d

# pgAdmin: localhost:5050 (admin@agenticlab.local / admin)
```

### Option 4: No Infrastructure (In-Memory)

```bash
# Just run without any Docker services
# The system falls back to in-memory storage automatically
agentic-lab run --provider ollama --model llama3.1
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `agentic_lab` | Database name |
| `POSTGRES_USER` | `agentic` | Database user |
| `POSTGRES_PASSWORD` | `agentic_lab_secret` | Database password |
| `DATABASE_URL` | — | Full connection string (overrides above) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_URL` | — | Full Redis URL |
| `QDRANT_HOST` | `localhost` | Qdrant host |
| `QDRANT_PORT` | `6333` | Qdrant HTTP port |
| `QDRANT_API_KEY` | — | Qdrant API key |
| `EMBEDDING_PROVIDER` | `ollama` | Embedding provider (ollama/openai) |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model |
| `GRAFANA_PORT` | `3001` | Grafana port |
| `GRAFANA_USER` | `admin` | Grafana admin user |
| `GRAFANA_PASSWORD` | `agentic_lab` | Grafana admin password |
| `PROMETHEUS_PORT` | `9090` | Prometheus port |

## Storage Fallback Strategy

The system is designed to **gracefully degrade**:

```
PostgreSQL available? ──yes──> Use PostgreSQL storage
                    └──no───> Use In-Memory storage (data lost on restart)

Redis available? ──yes──> Real-time pub/sub + caching
              └──no───> Local EventEmitter only (no cross-process events)

Qdrant available? ──yes──> Semantic search enabled
               └──no───> search() still works, semanticSearch() throws
```

This means you can **always run the system** — even without Docker. Infrastructure adds persistence, real-time features, and observability, but is never required.

## Database Schema

See [infra/postgres/init/001-schema.sql](../infra/postgres/init/001-schema.sql) for the full schema with tables, indexes, views, and triggers.

### Key Design Decisions

1. **UUIDs everywhere** — Internal IDs are UUIDs for cross-system compatibility
2. **External IDs** — nanoid from the engine mapped to DB UUIDs
3. **JSONB for flexibility** — Config, errors, metadata stored as JSONB
4. **Aggregate views** — Pre-computed views for common dashboard queries
5. **Cascade deletes** — Deleting a run removes all associated data
6. **Updated_at triggers** — Automatic timestamp tracking

## Connecting from Code

```typescript
import { createStorage, createStorageWithRedis } from '@agentic-lab/core';

// Basic: auto-detects from env vars
const storage = await createStorage();

// With Redis event bus
const { storage, redis } = await createStorageWithRedis();

// Explicit config
const storage = await createStorage({
  backend: 'postgres',
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'agentic_lab',
    user: 'agentic',
    password: 'agentic_lab_secret',
  },
});

// Using storage
const { runs, total } = await storage.runs.listRuns({ status: 'completed', limit: 10 });
const checkpoint = await storage.checkpoints.getLatest(runId);
const memories = await storage.memory.search(['project-x', 'context']);
```
