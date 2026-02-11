# Extending Agentic Lab

This guide explains how to extend Agentic Lab with custom providers, tools, and configurations.

## Custom LLM Providers

To add a new LLM provider, implement the `LLMProvider` interface:

```typescript
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResult,
} from '@agentic-lab/core';

export class MyProvider implements LLMProvider {
  readonly name = 'my-provider';
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    // Make API calls to your LLM
    // Convert messages to your format
    // Handle tool calls
    // Return standardized result
  }

  async listModels(): Promise<string[]> {
    return ['model-a', 'model-b'];
  }

  async healthCheck(): Promise<boolean> {
    // Test connectivity
    return true;
  }
}
```

Register it:

```typescript
import { registerProvider } from '@agentic-lab/core';
registerProvider('my-provider', MyProvider);
```

## Custom Tools

Create a tool that the agent can call:

```typescript
import type { AgentTool, ToolContext, ToolDefinition } from '@agentic-lab/core';

export class DatabaseQueryTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'database_query',
    description: 'Execute a read-only SQL query against the database',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SQL query to execute (SELECT only)',
        },
        database: {
          type: 'string',
          description: 'The database name',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const query = args.query as string;

    // Safety: only allow SELECT
    if (!query.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT queries are allowed');
    }

    context.log(`Executing query: ${query}`);

    // Your database logic here...
    const results = await runQuery(query);
    return JSON.stringify(results, null, 2);
  }
}
```

Register it in the toolkit:

```typescript
const tools = createDefaultToolkit();
tools.register(new DatabaseQueryTool());
```

## Custom Prompt Templates

Create your own prompt templates in `PROMPT.md`:

```markdown
# Agent Prompt

## Role
You are a [describe role].

## Context
[Project-specific context]

## Workflow
1. Read PLAN.md
2. Pick ONE task
3. [Your specific workflow steps]
4. Update PLAN.md
5. End turn

## Rules
- [Your rules]
```

## Configuration File

Create `agentic-lab.config.json` in your project:

```json
{
  "loop": {
    "provider": "ollama",
    "model": "codellama:34b",
    "maxIterations": 20,
    "delayMs": 2000,
    "autoCommit": true,
    "verbose": false
  },
  "providers": {
    "ollama": {
      "baseUrl": "http://gpu-server:11434"
    }
  }
}
```

## Event Hooks

Listen to loop events for custom behavior:

```typescript
const loop = new AgenticLoop({ config, provider, tools });

// Log to external service
loop.on('iteration:end', async ({ iteration }) => {
  await sendToMonitoring({
    iteration: iteration.number,
    tokens: iteration.tokenUsage.totalTokens,
    tools: iteration.toolCalls.length,
    success: iteration.success,
  });
});

// Custom stop condition
loop.on('llm:response', ({ content }) => {
  if (content.includes('ESCALATE')) {
    loop.stop('Agent requested escalation');
  }
});

// Cost tracking
let totalCost = 0;
loop.on('llm:response', ({ usage }) => {
  totalCost += estimateCost(usage);
  if (totalCost > MAX_BUDGET) {
    loop.stop('Budget exceeded');
  }
});
```

## Custom Storage Backends

Agentic Lab uses a pluggable storage layer. You can implement your own backend by conforming to the `Storage` interface.

### Storage Interface

```typescript
import type {
  Storage,
  RunStore,
  CheckpointStore,
  MemoryStore,
  EventStore,
  UsageStore,
} from '@agentic-lab/core';
```

The `Storage` interface aggregates 5 sub-stores:

| Sub-store     | Interface         | Responsibility                             |
|---------------|-------------------|--------------------------------------------|
| `runs`        | `RunStore`        | CRUD for runs, iterations, and tool calls  |
| `checkpoints` | `CheckpointStore` | State snapshots for time-travel / resume   |
| `memory`      | `MemoryStore`     | Cross-run key-value memory with namespaces |
| `events`      | `EventStore`      | Event publishing and subscription          |
| `usage`       | `UsageStore`      | Provider usage tracking and analytics      |

### Example: Custom Storage Backend

```typescript
import type {
  Storage,
  RunStore,
  CheckpointStore,
  MemoryStore,
  EventStore,
  UsageStore,
  StoredRun,
  StoredIteration,
  StoredToolCall,
  RunFilter,
  Checkpoint,
  MemoryItem,
  StoredEvent,
  UsageRecord,
  DailyStats,
} from '@agentic-lab/core';

export class MongoDBStorage implements Storage {
  runs: RunStore;
  checkpoints: CheckpointStore;
  memory: MemoryStore;
  events: EventStore;
  usage: UsageStore;

  private client: MongoClient;

  constructor(connectionString: string) {
    this.client = new MongoClient(connectionString);
    // Initialize sub-stores with mongo collections
    this.runs = new MongoRunStore(this.client);
    this.checkpoints = new MongoCheckpointStore(this.client);
    this.memory = new MongoMemoryStore(this.client);
    this.events = new MongoEventStore(this.client);
    this.usage = new MongoUsageStore(this.client);
  }

  async init(): Promise<void> {
    await this.client.connect();
    // Create indexes, etc.
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.db().admin().ping();
      return true;
    } catch {
      return false;
    }
  }
}
```

### Using Custom Storage with the Engine

```typescript
import { AgenticLoop } from '@agentic-lab/core';

const storage = new MongoDBStorage('mongodb://localhost:27017/agentic_lab');
await storage.init();

const loop = new AgenticLoop({
  config,
  provider,
  tools,
  storage,  // Pass your custom storage
});

await loop.start();
await storage.close();
```

### Built-in Backends

| Backend    | Class             | Requirements                     |
|------------|-------------------|----------------------------------|
| PostgreSQL | `PostgresStorage` | `pg` package + PostgreSQL server |
| In-Memory  | `InMemoryStorage` | None (testing/development)       |

### Enhancing with Redis Events

Wrap any storage backend with Redis for real-time event streaming:

```typescript
import { RedisEventBus, RedisEventStore } from '@agentic-lab/core';

const redis = new RedisEventBus({ host: 'localhost', port: 6379 });
await redis.connect();

// Replace the event store with the Redis-backed version
storage.events = new RedisEventStore(redis);
```

### Enhancing with Vector Memory

Add semantic search to any storage backend:

```typescript
import { VectorMemoryStore, createOllamaEmbedding } from '@agentic-lab/core';

const embedding = createOllamaEmbedding('nomic-embed-text');
const vectorMemory = new VectorMemoryStore(
  storage.memory,   // Base memory store
  {
    host: 'localhost',
    port: 6333,
    collectionName: 'agentic_lab_memories',
    embeddingDimension: 768,
  },
  embedding,
);
await vectorMemory.init();

// Now you have both exact and semantic search
const results = await vectorMemory.semanticSearch('debugging auth issues', 5);
```

---

## Custom Loop Nodes

The composable pipeline engine allows you to create custom loop nodes that participate in the pipeline alongside the built-in loops. Each node processes typed signals and produces new signals.

### Implementing a Custom Loop

Create a class that extends the base `LoopNode` pattern:

```typescript
import type {
  LoopNode,
  NodeContext,
  NodeResult,
  Signal,
  SerializedNode,
} from '@agentic-lab/core';

interface MyLoopConfig {
  provider: LLMProvider;
  threshold: number;
  customOption?: string;
}

export class MyCustomLoop implements LoopNode {
  readonly id: string;
  readonly type = 'my-custom';
  readonly name: string;
  readonly category = 'custom' as const;
  readonly description = 'A custom loop that does something specific';
  readonly version = '1.0.0';

  config: { maxIterations: number; delayMs: number; concurrent: boolean };
  ports: { inputs: Port[]; outputs: Port[] };
  metadata: Record<string, unknown>;

  private myConfig: MyLoopConfig;

  constructor(id: string, name: string, myConfig: MyLoopConfig) {
    this.id = id;
    this.name = name;
    this.myConfig = myConfig;
    this.config = { maxIterations: 1, delayMs: 0, concurrent: false };
    this.metadata = { threshold: myConfig.threshold };

    this.ports = {
      inputs: [
        {
          name: 'input_data',
          direction: 'input',
          signalTypes: ['execution_result', 'evaluation'],
          description: 'Data to process',
          required: true,
        },
      ],
      outputs: [
        {
          name: 'result',
          direction: 'output',
          signalTypes: ['custom_result'],
          description: 'Processing result',
        },
      ],
    };
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    // 1. Gather input signals
    const inputs = context.inputSignals.filter(
      (s) => s.type === 'execution_result' || s.type === 'evaluation',
    );

    if (inputs.length === 0) {
      return { signals: [], metrics: { skipped: true } };
    }

    // 2. Process with your custom logic
    const analysis = await this.processSignals(inputs);

    // 3. Emit output signals
    const outputSignal: Signal = {
      id: `${this.id}-${Date.now()}`,
      sourceNodeId: this.id,
      type: 'custom_result',
      data: analysis,
      timestamp: new Date().toISOString(),
    };

    return {
      signals: [outputSignal],
      metrics: { processed: inputs.length },
    };
  }

  serialize(): SerializedNode {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      category: this.category,
      description: this.description,
      version: this.version,
      config: this.config,
      ports: this.ports,
      metadata: this.metadata,
    };
  }
}
```

### Registering a Custom Node Type

Register your node type so it can be used in recipes and the pipeline editor:

```typescript
import { registerNodeType } from '@agentic-lab/core';

registerNodeType({
  type: 'my-custom',
  category: 'custom',
  description: 'A custom loop that does something specific',
  inputs: [
    {
      name: 'input_data',
      direction: 'input',
      signalTypes: ['execution_result', 'evaluation'],
      description: 'Data to process',
      required: true,
    },
  ],
  outputs: [
    {
      name: 'result',
      direction: 'output',
      signalTypes: ['custom_result'],
      description: 'Processing result',
    },
  ],
  defaultConfig: {
    maxIterations: 1,
    delayMs: 0,
    concurrent: false,
  },
  factory: (id, name, config) => {
    return new MyCustomLoop(id, name, {
      provider: config.metadata?.provider,
      threshold: (config.metadata?.threshold as number) ?? 0.5,
    });
  },
});
```

### Using Custom Nodes in Recipes

Once registered, your custom node can be referenced in recipe definitions:

```typescript
const myRecipe: Recipe = {
  id: 'my-recipe',
  name: 'My Custom Pipeline',
  nodes: [
    { id: 'exec', type: 'execution', /* ... */ },
    { id: 'custom', type: 'my-custom', /* ... */ },
  ],
  wires: [
    {
      id: 'w1',
      sourcePortId: 'exec:out:result',
      targetPortId: 'custom:in:input_data',
      enabled: true,
    },
  ],
  // ...
};
```

### Built-in Loop Reference

| Type          | Class             | Category     | Key Ports                              |
|---------------|-------------------|--------------|----------------------------------------|
| `execution`   | `ExecutionLoop`   | `execution`  | In: task, context → Out: result, tools |
| `evaluation`  | `EvaluationLoop`  | `evaluation` | In: result, truth → Out: evaluation    |
| `planning`    | `PlanningLoop`    | `planning`   | In: evaluations → Out: plan, subtasks  |
| `refinement`  | `RefinementLoop`  | `refinement` | In: eval, critic → Out: decision       |
| `critic`      | `CriticLoop`      | `critic`     | In: result → Out: critique, intervention|
| `memory`      | `MemoryLoop`      | `memory`     | In: all signals → Out: summaries       |
