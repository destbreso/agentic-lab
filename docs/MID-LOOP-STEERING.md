# Mid-Loop Steering — Tactical Nudges

> **Status**: Implemented | **Package**: `@agentic-lab/core` + `packages/web` | **Non-breaking**: Yes

## Credits

This feature is inspired by the work of **Lester Sanchez** on evolving the Ralph Loop pattern with asynchronous mid-loop messaging for tactical steering.

> *"...asynchronous mid-loop messaging for tactical steering — the ability to inject course corrections into a running loop without stopping it."*

Original post: [LinkedIn — Lester Sanchez](https://www.linkedin.com/feed/update/urn:li:activity:7433475225335484416/?originTrackingId=mOtSwNO0CgGYW07hxjTdOg%3D%3D)

## The Problem

In a standard Ralph Loop (iterative agentic pattern), once the agent is running autonomously it is strictly driven by the initial prompt, specs, and plan. If a human operator notices drifting, a technical wall, or wants to inject a course correction, the only option is:

1. **Stop** the loop
2. **Update** the driving documents (prompt, specs, plan)
3. **Restart** the loop

This works, but for minor tactical corrections it introduces excessive friction and **breaks the momentum of the autonomous flow**. The context from the current iteration is lost, and the agent starts cold.

## The Solution

Agentic Lab now supports **asynchronous mid-loop messaging** — the ability to inject "tactical nudges" into a running loop without stopping it.

```
┌──────────────────────────────────────────────────────┐
│                  AgenticLoop.run()                    │
│                                                      │
│  for each iteration:                                 │
│    ├─ abort check                                    │
│    ├─ pause check                                    │
│    ├─ ★ drain nudge queue (all priorities) ◄──────── │ ◄── nudge("...", "normal")
│    ├─ runIteration()                                 │
│    │   ├─ build prompt                               │
│    │   ├─ inject nudges into messages                │
│    │   ├─ tool loop:                                 │
│    │   │   ├─ ★ drain critical nudges ◄──────────── │ ◄── nudge("...", "critical")
│    │   │   ├─ LLM call                               │
│    │   │   ├─ execute tools                          │
│    │   │   └─ repeat until no more tool calls        │
│    │   └─ auto-commit                                │
│    ├─ persist to storage                             │
│    ├─ plan complete?                                 │
│    └─ delay                                          │
└──────────────────────────────────────────────────────┘
```

## Usage

### Basic Usage

```typescript
import { AgenticLoop } from '@agentic-lab/core';

const loop = new AgenticLoop({ config, provider, tools });

// Start the loop (non-blocking if you use a separate async context)
const resultPromise = loop.run();

// Inject a nudge at any time while the loop is running
loop.nudge("Focus on the API endpoints, skip CSS styling for now");

// With explicit priority
loop.nudge("The database credentials changed — use the new .env values", "high");

// Critical nudges interrupt mid-tool-loop (before the next LLM call)
loop.nudge("STOP working on feature X — the requirement was dropped", "critical");

const result = await resultPromise;
```

### Priority Levels

| Priority   | When consumed                            | Use case                                           |
|------------|------------------------------------------|----------------------------------------------------|
| `low`      | Between iterations                       | Nice-to-have hints, style preferences              |
| `normal`   | Between iterations                       | Standard course corrections (default)              |
| `high`     | Between iterations                       | Important directional changes                      |
| `critical` | **Mid-tool-loop** (before next LLM call) | Urgent: stop current approach, requirement changed |

### Events

```typescript
// Fired when a nudge is queued
loop.on('steering:nudge', ({ nudge }) => {
  console.log(`Nudge queued: ${nudge.message} [${nudge.priority}]`);
});

// Fired when nudges are consumed into the iteration context
loop.on('steering:consumed', ({ nudges, iteration, injectionPoint }) => {
  console.log(`${nudges.length} nudge(s) consumed at ${injectionPoint} in iteration ${iteration}`);
});
```

### Inspecting State

```typescript
// Get nudges waiting to be consumed
const pending = loop.getPendingNudges();

// Get all nudges that have been consumed (with metadata)
const history = loop.getNudgeHistory();
for (const nudge of history) {
  console.log(`"${nudge.message}" consumed at iteration ${nudge.consumedAtIteration}`);
}
```

## How It Works Internally

1. **Queue**: `nudge()` pushes a `SteeringNudge` object to an internal queue. This is synchronous and thread-safe (single-threaded JS).

2. **Injection Point A — Between iterations**: Before each `runIteration()` call, all pending nudges (regardless of priority) are drained from the queue, formatted as a `user` role message, and prepended to the iteration's LLM context.

3. **Injection Point B — Mid-tool-loop**: Inside the inner tool-loop (which may make 1-20 LLM calls per iteration), **only `critical` priority nudges** are checked and injected before each LLM call. This provides sub-iteration responsiveness for urgent corrections.

4. **Message format**: Nudges are injected as a clearly delimited user message:
   ```
   --- STEERING NUDGE FROM HUMAN OPERATOR ---
   The following tactical instruction(s) have been injected mid-loop.
   Adjust your current approach accordingly without losing progress.

   [📡 NORMAL] Focus on the API endpoints, skip CSS styling for now

   --- END STEERING NUDGE ---
   ```

5. **Persistence**: If storage is configured, nudge events are persisted to the event store for audit/replay.

## Design Decisions

- **Non-breaking**: The nudge queue defaults to empty. Zero nudges = zero overhead (just an empty array check per iteration). No existing APIs or behaviors change.
- **No architecture changes**: The steering system is a simple queue-read pattern added to the existing loop, not a new subsystem.
- **Priority-based consumption**: Only critical nudges interrupt mid-tool-loop to avoid destabilizing the LLM context during complex multi-tool sequences. Normal/high/low nudges wait for a clean boundary (between iterations).
- **User message role**: Nudges are injected as `user` role messages (not system), so the LLM treats them as instructions from the operator rather than personality/behavior changes.

## Relation to Pipeline Steering

The `PipelineOrchestrator` already has `injectSignal()` which provides a similar capability at the pipeline level via the signal/port system. The loop-level `nudge()` is the simpler equivalent for the single-loop "Ralph Loop" pattern. Both mechanisms coexist — use `nudge()` for `AgenticLoop`, use `injectSignal()` for `PipelineOrchestrator`.

## Web UI Integration

The steering system is fully integrated into the web dashboard, providing a visual interface for sending nudges during live agent runs.

### Architecture

```
┌─────────────────────┐     POST /api/chat/agent/nudge     ┌─────────────────────────┐
│   SteeringBar UI    │ ──────────────────────────────────► │  Module-level           │
│   (chat/page.tsx)   │                                     │  nudgeQueues Map        │
│                     │ ◄── SSE: steering:nudge ─────────── │  (agent/route.ts)       │
│                     │ ◄── SSE: steering:consumed ──────── │                         │
└─────────────────────┘                                     │  drainNudges() called   │
                                                            │  before each callLLM()  │
                                                            └─────────────────────────┘
```

### UI Components

| Component               | Location                          | Purpose                                                   |
|-------------------------|-----------------------------------|-----------------------------------------------------------|
| **SteeringBar**         | Input area (below agent controls) | Nudge input with priority selector                        |
| **ExecutionPanel step** | Right sidebar                     | Shows consumed nudges as "steering" steps in the timeline |
| **Nudge list**          | Inside SteeringBar                | Shows recent nudges with consumed/pending status          |

### API Endpoint

```
POST /api/chat/agent/nudge
Content-Type: application/json

{
  "runId": "run-1234...",
  "message": "Focus on the API endpoints, skip CSS",
  "priority": "normal"  // low | normal | high | critical
}

Response: { "ok": true, "nudge": { id, message, priority, createdAt } }
```

### SSE Events

The agent route emits two new SSE events that the UI consumes:

- **`steering:nudge`** — Fired when a nudge is queued (broadcasts to all connected clients)
- **`steering:consumed`** — Fired when nudges are drained and injected into the LLM context. The UI marks them as consumed and adds a "Steering" step to the execution timeline.

## Types

```typescript
type NudgePriority = 'low' | 'normal' | 'high' | 'critical';

interface SteeringNudge {
  id: string;
  message: string;
  priority: NudgePriority;
  createdAt: string;
  consumedAt?: string;
  consumedAtIteration?: number;
}
```
