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
