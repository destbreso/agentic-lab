# Semantic Memory System

> Persistent, vector-searchable memory that lets agents and chat sessions accumulate knowledge over time.

---

## Overview

Agentic Lab includes a semantic memory layer backed by **Qdrant** (vector database) and **PostgreSQL** (structured storage). Every chat message and agent result is automatically persisted and can be retrieved via semantic similarity search, giving the LLM access to relevant context from previous interactions.

Key capabilities:

- **Per-session memory** — Each chat session stores its own conversation history.
- **Memory banks** — Named, reusable knowledge collections that can be shared across sessions.
- **Semantic search** — Retrieve memories by meaning, not just keyword matching.
- **Aggregation** — LLM-powered consolidation of many memories into concise summaries.
- **Knowledge transfer** — Clone memories between namespaces.

---

## Architecture

```
┌──────────────────┐        ┌──────────────────────────────────────────┐
│   Chat UI        │        │              Storage.memory              │
│  (memory bank    │───────▶│           (MemoryStore interface)        │
│   selector)      │        ├──────────────────────────────────────────┤
└──────────────────┘        │                                          │
                            │  VectorMemoryStore  (decorator)          │
         ┌──────────────────│    ├─ put()  → baseStore + Qdrant        │
         │                  │    ├─ get()  → baseStore                 │
         ▼                  │    ├─ search() → baseStore               │
┌──────────────────┐        │    └─ semanticSearch() → Qdrant + base   │
│  /api/chat/send  │        │                                          │
│  /api/chat/agent │        │  Base Store (one of):                    │
│  /api/memories/* │        │    ├─ PostgresStorage.memory (PgMemory)  │
└──────────────────┘        │    └─ InMemoryStorage.memory (fallback)  │
                            └──────────────────────────────────────────┘
                                           │               │
                                           ▼               ▼
                                     ┌──────────┐   ┌───────────┐
                                     │ Qdrant   │   │ PostgreSQL│
                                     │ (vectors)│   │ (rows)    │
                                     └──────────┘   └───────────┘
                                           ▲
                                           │
                                     ┌───────────┐
                                     │ Embeddings│
                                     │ OpenAI or │
                                     │  Ollama   │
                                     └───────────┘
```

### Storage stack

| Layer | Role |
|-------|------|
| **`VectorMemoryStore`** | Decorator that wraps any `MemoryStore`. Intercepts `put()` to also store embeddings in Qdrant. Intercepts `semanticSearch()` to query Qdrant by vector similarity. All other methods delegate to the base store. |
| **`PgMemoryStore`** | PostgreSQL-backed implementation. Stores `MemoryItem` rows with `namespace` (string array), `key`, `value` (JSON), and timestamps. |
| **`InMemoryMemoryStore`** | Fallback when no PostgreSQL is configured. Uses a `Map<string, MemoryItem>` with composite keys (`namespace/key`). Semantic search throws an error. |
| **Qdrant** | Vector database storing embeddings with payload metadata. Collection: `agentic_lab_memories`, distance: Cosine. |
| **Embedding function** | If `OPENAI_API_KEY` is set, uses `text-embedding-3-small` (1536 dims). Otherwise, falls back to Ollama `nomic-embed-text`. |

### Factory resolution (`createStorage()`)

1. Check for explicit config, then environment variables.
2. If PostgreSQL is available → `PostgresStorage`.
3. Otherwise → `InMemoryStorage`.
4. If Qdrant is available → wrap `storage.memory` with `VectorMemoryStore`.

---

## Core types

### `MemoryItem`

```typescript
interface MemoryItem {
  id: string;
  namespace: string[];           // Hierarchical path, e.g. ["chat", "session-abc"]
  key: string;                   // Unique within namespace
  value: Record<string, unknown>; // Payload (text, role, sessionId, etc.)
  qdrantPointId?: string;        // Qdrant point ID (when vector store is active)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

### `MemoryStore`

```typescript
interface MemoryStore {
  put(namespace: string[], key: string, value: Record<string, unknown>): Promise<MemoryItem>;
  get(namespace: string[], key: string): Promise<MemoryItem | null>;
  search(namespace: string[], options?: { limit?: number }): Promise<MemoryItem[]>;
  semanticSearch(namespace: string[], query: string, options?: { limit?: number }): Promise<MemoryItem[]>;
  delete(namespace: string[], key: string): Promise<boolean>;
  deleteNamespace(namespace: string[]): Promise<void>;
}
```

---

## Namespace strategy

Namespaces are hierarchical string arrays that partition memories.

| Context | Namespace | Key pattern |
|---------|-----------|-------------|
| Per-session chat | `["chat", sessionId]` | `user-{timestamp}`, `assistant-{timestamp}` |
| Global chat search | `["chat"]` | Prefix-matches all sessions |
| Memory bank | `["memory-bank", bankId]` | `__meta__`, plus content keys |
| Cloned memories | `["memory-bank", targetBankId]` | `clone-{timestamp}-{index}` |
| Aggregated memories | *(any namespace)* | `consolidated-{timestamp}-{index}` |
| Agent task results | `["chat", sessionId]` or `["memory-bank", bankId]` | `task-{runId}`, `result-{runId}` |
| Benchmark suites | `["benchmarks"]` | `suite.id` |

### How namespace search works

- `search(["chat", "abc123"])` → exact namespace match, returns items in that session.
- `search(["chat"])` → prefix match, returns items across all chat sessions.
- `semanticSearch(["chat"], "machine learning")` → vector similarity within all chat memories.
- `semanticSearch(["memory-bank", "bank-xyz"], "deployment steps")` → vector similarity within a specific bank.

---

## Memory banks

Memory banks are named, persistent collections of knowledge that can be attached to any chat session or benchmark suite. They live under the namespace `["memory-bank", bankId]`.

### Bank metadata

Each bank stores a `__meta__` key with:

```typescript
{
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  sourceSession?: string;   // If created from a chat session
  tags: string[];
}
```

### Creating a bank

```bash
POST /api/memories/banks
{
  "name": "Project Knowledge",
  "description": "Accumulated project decisions",
  "tags": ["project", "decisions"],
  "sourceSession": "session-abc"    # Optional: pre-populate from session
}
```

When `sourceSession` is provided, all memories from `["chat", sourceSession]` are copied into the new bank.

### Attaching a bank to a chat

In the Chat UI, click the **HardDrive** icon to open the memory bank selector. Select a bank to switch from per-session memory to shared bank memory. When a bank is selected:

- **Retrieval**: semantic search queries the bank namespace instead of global chat.
- **Persistence**: new messages are saved to the bank namespace instead of the session.
- **Agent mode**: agent task results are also stored in the bank.

### Knowledge transfer (cloning)

```bash
POST /api/memories/banks/clone
{
  "sourceNamespace": ["chat", "session-abc"],
  "targetBankId": "bank-1234567890-abcd",
  "overwrite": false
}
```

Copies all memories from the source namespace into the target bank with `clone-` prefixed keys. Each cloned item includes metadata about its origin.

---

## Memory aggregation

When a namespace accumulates many memories, you can consolidate them using LLM-powered aggregation:

```bash
POST /api/memories/aggregate
{
  "namespace": ["memory-bank", "bank-xyz"],
  "model": "gpt-4o-mini",
  "provider": "openai",
  "maxSummaries": 5
}
```

### How it works

1. Fetch all memories in the namespace (up to 1000).
2. If count ≤ `maxSummaries`, skip (no consolidation needed).
3. Build a prompt asking the LLM to consolidate N memories into M summaries.
4. **Delete the entire namespace**.
5. Write the consolidated memories with keys `consolidated-{timestamp}-{index}`.

Each consolidated memory has the structure:

```typescript
{
  text: string;            // Summary content
  title: string;           // Title of the summary
  role: "system";
  messageType: "consolidated";
  importance: "high" | "medium" | "low";
  topics: string[];
  aggregatedFrom: number;  // Original count
  aggregatedAt: string;    // ISO timestamp
}
```

> **⚠️ Warning**: Aggregation is destructive — it replaces all original memories with summaries. Use it on banks or old sessions, not on active conversations.

---

## Chat integration

### Send route (`/api/chat/send`)

**Retrieval** (before LLM call):

1. Determine search namespace:
   - If `memoryNamespace` is set → `["memory-bank", memoryNamespace]`
   - Otherwise → `["chat"]` (global prefix)
2. `semanticSearch(namespace, userMessage, { limit: 5 })`
3. Inject matching memories into the system prompt as `RELEVANT MEMORIES FROM PREVIOUS CONVERSATIONS`.

**Persistence** (after LLM response, fire-and-forget):

- Determine write namespace:
  - If `memoryNamespace` is set → `["memory-bank", memoryNamespace]`
  - Otherwise → `["chat", sessionId]`
- Store two items:
  - `user-{timestamp}` with user text (capped at 2000 chars).
  - `assistant-{timestamp}` with assistant text (capped at 4000 chars).

### Agent route (`/api/chat/agent`)

Same namespace resolution logic. After a successful run:

- `task-{runExternalId}` — the user's task prompt.
- `result-{runExternalId}` — the agent's final answer (capped at 4000 chars), plus metadata (model, recipe, token counts).

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memories?namespace=..&q=..&limit=..` | List or search memories. With `q`, uses semantic search with text-fallback. |
| `POST` | `/api/memories` | Create a memory: `{ namespace, key, value }` |
| `GET` | `/api/memories/:key?namespace=..` | Get a single memory by key |
| `DELETE` | `/api/memories/:key?namespace=..` | Delete a single memory |
| `GET` | `/api/memories/namespaces` | List all distinct namespaces with counts |
| `GET` | `/api/memories/banks` | List all memory banks with metadata and item counts |
| `POST` | `/api/memories/banks` | Create a bank: `{ name, description?, tags?, sourceSession? }` |
| `DELETE` | `/api/memories/banks?id=..` | Delete a bank and all its memories |
| `POST` | `/api/memories/banks/clone` | Clone memories: `{ sourceNamespace, targetBankId, overwrite? }` |
| `POST` | `/api/memories/aggregate` | Consolidate: `{ namespace, model?, provider?, maxSummaries? }` |

---

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_URL` | — | Full Qdrant URL (e.g. `http://localhost:6333`) |
| `QDRANT_HOST` | `localhost` | Qdrant host (used if `QDRANT_URL` not set) |
| `QDRANT_PORT` | `6333` | Qdrant port |
| `QDRANT_API_KEY` | — | Optional API key for Qdrant Cloud |
| `OPENAI_API_KEY` | — | Enables OpenAI embeddings (`text-embedding-3-small`) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model override |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model (fallback) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |

### Docker Compose

Qdrant is included in the default `docker-compose.yml`:

```yaml
qdrant:
  image: qdrant/qdrant:v1.12.4
  ports:
    - "6333:6333"
  volumes:
    - qdrant_data:/qdrant/storage
```

### Defaults

| Parameter | Value |
|-----------|-------|
| Collection name | `agentic_lab_memories` |
| Embedding dimension | `1536` |
| Distance metric | `Cosine` |
| Text extraction fields | `text`, `content`, `description`, `summary`, `memory`, `note` |
| Text cap for embedding | 8000 chars |
| User text cap (persistence) | 2000 chars |
| Assistant text cap (persistence) | 4000 chars |
| Semantic search limit (retrieval) | 5 |
| Search limit (listing) | 50 (API), 100 (store) |
| Aggregation max summaries | 5 |

---

## Embedding pipeline

When `VectorMemoryStore.put()` is called:

1. Extract text from the `value` object by checking fields in priority order: `text` → `content` → `description` → `summary` → `memory` → `note`. Falls back to `JSON.stringify(value)` (capped at 8000 chars).
2. Generate embedding via the configured function (OpenAI or Ollama).
3. Upsert to Qdrant with payload: `{ namespace, key, memoryId, text, ...value }`.
4. Vector storage is **best-effort** — failures are caught silently so the base store write always succeeds.

When `semanticSearch()` is called:

1. Generate embedding of the query text.
2. Query Qdrant with the vector + namespace filter.
3. For each match, look up the full `MemoryItem` from the base store.

---

## UI guide

### Memory page (`/memories`)

Browse, search, and manage memories across all namespaces. Supports both keyword and semantic search.

### Chat memory bank selector

Located in the chat header (HardDrive icon). Options:

- **Per session (default)** — Each session uses its own namespace `["chat", sessionId]`.
- **Named bank** — Select an existing bank to share knowledge across sessions.

When a bank is selected, the button shows an emerald border and the bank name.

### Benchmark memory integration

When creating a benchmark suite, you can optionally select a memory bank. The bank namespace is passed to both the baseline (send) and recipe (agent) contenders, giving them access to accumulated knowledge during evaluation.
