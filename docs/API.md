# API Reference

The Agentic Lab web dashboard exposes a REST + SSE API for managing runs, viewing analytics, and monitoring infrastructure health.

**Base URL:** `http://localhost:3000/api`

---

## Runs

### List Runs

```http
GET /api/runs?status=completed&provider=openai&limit=20&offset=0
```

**Query Parameters:**

| Parameter  | Type     | Default | Description                                                        |
|------------|----------|---------|--------------------------------------------------------------------|
| `status`   | `string` | —       | Filter by run status (`running`, `completed`, `failed`, `stopped`) |
| `provider` | `string` | —       | Filter by LLM provider name                                        |
| `limit`    | `number` | `50`    | Max results to return                                              |
| `offset`   | `number` | `0`     | Pagination offset                                                  |

**Response:**

```json
{
  "runs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "externalId": "abc123",
      "status": "completed",
      "provider": "openai",
      "model": "gpt-4o",
      "totalIterations": 5,
      "totalTokens": 12345,
      "totalPromptTokens": 8000,
      "totalCompletionTokens": 4345,
      "totalToolCalls": 12,
      "config": { ... },
      "tags": ["experiment-1"],
      "error": null,
      "startedAt": "2025-01-15T10:30:00.000Z",
      "completedAt": "2025-01-15T10:35:22.000Z",
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "total": 42
}
```

---

### Get Run Details

```http
GET /api/runs/:id
```

**Response:** Same as a run object above, plus `iterations` array:

```json
{
  "run": { ... },
  "iterations": [
    {
      "id": "...",
      "runId": "...",
      "iterationNumber": 1,
      "promptTokens": 1500,
      "completionTokens": 800,
      "totalTokens": 2300,
      "toolCalls": 3,
      "success": true,
      "durationMs": 4200,
      "result": { ... },
      "error": null,
      "createdAt": "..."
    }
  ]
}
```

---

### Delete Run

```http
DELETE /api/runs/:id
```

Deletes a run and all associated data (iterations, tool calls, checkpoints, events, usage records). Uses CASCADE.

**Response:**

```json
{
  "success": true
}
```

---

## Analytics

### Get Stats

```http
GET /api/stats
```

Returns aggregated analytics across all runs.

**Response:**

```json
{
  "totalRuns": 42,
  "totalTokens": 500000,
  "totalCost": 12.50,
  "providerBreakdown": [
    {
      "provider": "openai",
      "model": "gpt-4o",
      "totalRequests": 150,
      "totalTokens": 300000,
      "totalCost": 9.00
    }
  ],
  "dailyStats": [
    {
      "date": "2025-01-15",
      "runs": 5,
      "iterations": 25,
      "tokens": 50000,
      "toolCalls": 60,
      "cost": 2.50
    }
  ],
  "toolStats": [
    {
      "toolName": "file_write",
      "totalCalls": 200,
      "successRate": 0.95,
      "avgDurationMs": 45
    }
  ]
}
```

---

## Real-Time Events

### Event Stream (SSE)

```http
GET /api/events/:runId
```

Server-Sent Events endpoint that streams real-time events for a specific run. The connection stays open and pushes events as they occur.

**Event Types:**

| Event             | Data                           | Description            |
|-------------------|--------------------------------|------------------------|
| `connected`       | `{ runId }`                    | Connection established |
| `iteration:start` | `{ iteration, timestamp }`     | Iteration beginning    |
| `iteration:end`   | `{ iteration, tokens, tools }` | Iteration completed    |
| `tool:call`       | `{ name, args }`               | Tool invoked           |
| `tool:result`     | `{ name, result }`             | Tool returned          |
| `llm:response`    | `{ tokens, content_preview }`  | LLM responded          |
| `run:complete`    | `{ status, totalIterations }`  | Run finished           |
| `keepalive`       | `{}`                           | Heartbeat (every 30s)  |

**Example (JavaScript):**

```javascript
const events = new EventSource('/api/events/abc123');

events.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`[${data.type}]`, data);
};

events.onerror = () => {
  console.log('Connection lost, reconnecting...');
};
```

---

## Health & Monitoring

### Health Check

```http
GET /api/health
```

Checks connectivity to all infrastructure services.

**Response:**

```json
{
  "status": "healthy",
  "services": {
    "postgres": { "status": "healthy", "latencyMs": 2 },
    "redis": { "status": "healthy", "latencyMs": 1 },
    "qdrant": { "status": "unhealthy", "error": "Connection refused" }
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

Overall `status` is `"healthy"` only if ALL services are reachable. Individual service failures don't prevent the API from working — they just disable that service's features.

---

### Prometheus Metrics

```http
GET /api/metrics
```

Returns metrics in Prometheus text exposition format. Designed to be scraped by a Prometheus instance.

**Response (text/plain):**

```
# HELP agentic_lab_runs_total Total number of runs
# TYPE agentic_lab_runs_total gauge
agentic_lab_runs_total{status="completed"} 35
agentic_lab_runs_total{status="failed"} 5
agentic_lab_runs_total{status="running"} 2

# HELP agentic_lab_tokens_total Total tokens used
# TYPE agentic_lab_tokens_total gauge
agentic_lab_tokens_total{type="prompt"} 400000
agentic_lab_tokens_total{type="completion"} 100000

# HELP agentic_lab_tool_calls_total Total tool calls
# TYPE agentic_lab_tool_calls_total gauge
agentic_lab_tool_calls_total{tool="file_write"} 200
agentic_lab_tool_calls_total{tool="shell"} 150
agentic_lab_tool_calls_total{tool="grep"} 80
```

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Run not found"
}
```

**Status Codes:**

| Code  | Meaning                                             |
|-------|-----------------------------------------------------|
| `200` | Success                                             |
| `404` | Resource not found                                  |
| `500` | Internal server error (usually storage unavailable) |

---

## Authentication

Currently, the API has **no authentication**. It is designed for local development use. For production deployments, add an authentication middleware or reverse proxy.

---

## Chat

### Chat Completion (Streaming)

```http
POST /api/chat
Content-Type: application/json
```

Sends a message and receives a streaming response via Server-Sent Events.

**Request Body:**

```json
{
  "messages": [
    { "role": "user", "content": "Explain the observer pattern" }
  ],
  "model": "llama3.1",
  "provider": "ollama"
}
```

**SSE Event Types:**

| Event    | Data                     | Description                   |
|----------|--------------------------|-------------------------------|
| `stream` | `{ content: "..." }`     | Token chunk from the LLM      |
| `result` | `{ content: "..." }`     | Final complete response        |
| `error`  | `{ error: "..." }`       | Error occurred                 |

---

### Agent Task Execution (Streaming)

```http
POST /api/chat/agent
Content-Type: application/json
```

Executes an agentic task using a pipeline recipe. The response is an SSE stream with structured step-by-step events.

**Request Body:**

```json
{
  "messages": [
    { "role": "user", "content": "Build a REST API with auth" }
  ],
  "model": "llama3.1",
  "provider": "ollama",
  "recipe": "deep-reasoning"
}
```

**Supported Recipes:** `"ralph-loop"`, `"exec-eval"`, `"deep-reasoning"` (default: `"deep-reasoning"`)

**SSE Event Types:**

| Event     | Data                                                                | Description                                |
|-----------|---------------------------------------------------------------------|--------------------------------------------|
| `step`    | `{ step, loop, status, title, description, contentPreview? }`      | Pipeline step started/updated              |
| `subtask` | `{ parentStep, subtaskId, title, status, contentPreview? }`        | Subtask within a step (e.g., eval criteria)|
| `stream`  | `{ content }`                                                       | Streaming token chunk                      |
| `result`  | `{ content, stepsCompleted, totalTokens }`                          | Final result with aggregated metrics       |
| `error`   | `{ error }`                                                         | Error occurred                             |

**Step Loops:** `"planning"`, `"execution"`, `"evaluation"`, `"critic"`, `"refinement"`

**Step Example:**

```json
{
  "step": 3,
  "loop": "evaluation",
  "status": "complete",
  "title": "Evaluating output",
  "description": "Checking 5 criteria...",
  "contentPreview": "✅ Correctness: PASS\n❌ Completeness: FAIL\n..."
}
```

---

### List Chat Sessions

```http
GET /api/chat/sessions
```

Returns the list of saved chat sessions with metadata.

**Response:**

```json
{
  "sessions": [
    {
      "id": "abc123",
      "title": "REST API project",
      "mode": "agent",
      "messageCount": 12,
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:35:22.000Z"
    }
  ]
}
```

---

## Pipelines

### List Pipeline Recipes

```http
GET /api/pipelines/recipes
```

Returns all registered pipeline recipes with their nodes, wires, and parameters. Used by the visual pipeline editor.

**Response:**

```json
{
  "recipes": [
    {
      "id": "deep-reasoning",
      "name": "Deep Reasoning",
      "description": "Iterative plan → execute → evaluate → refine cycle...",
      "category": "advanced",
      "tags": ["advanced", "refinement", "convergence"],
      "nodes": [
        {
          "id": "plan",
          "type": "planning",
          "name": "Planner",
          "position": { "x": 100, "y": 200 },
          "ports": { "inputs": [...], "outputs": [...] }
        }
      ],
      "wires": [
        { "id": "w1", "sourcePortId": "plan:out:plan", "targetPortId": "exec:in:task" }
      ],
      "parameters": [...]
    }
  ]
}
```

---

### List Node Types

```http
GET /api/pipelines/node-types
```

Returns all registered node types with their port definitions. Used for building custom pipelines in the editor.

**Response:**

```json
{
  "nodeTypes": [
    {
      "type": "refinement",
      "category": "refinement",
      "description": "Convergence gate — converge, refine, or backtrack",
      "inputs": [
        { "name": "evaluation", "signalTypes": ["evaluation", "eval_metrics"], "required": true },
        { "name": "critic_feedback", "signalTypes": ["critic_feedback", "critique"], "required": false },
        { "name": "execution_result", "signalTypes": ["execution_result"], "required": false }
      ],
      "outputs": [
        { "name": "refinement_decision", "signalTypes": ["refinement_decision"] },
        { "name": "corrections", "signalTypes": ["corrections"] },
        { "name": "replan_signal", "signalTypes": ["replan_signal"] },
        { "name": "convergence", "signalTypes": ["convergence"] }
      ]
    }
  ]
}
```
