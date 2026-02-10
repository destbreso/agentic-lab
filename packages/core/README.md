# @agentic-lab/core

Core engine for the Agentic Lab platform. Provides:

- **LLM Provider abstraction** — Unified interface for Ollama, OpenAI, Anthropic, OpenRouter
- **Agentic Loop engine** — Stateless iterative loop based on the Ralph Loop pattern
- **Tool system** — Extensible tools that agents can call (file I/O, shell, git, etc.)
- **Plan management** — Parse and update PLAN.md structured task lists
- **Prompt building** — Template-based prompt construction with dynamic context
- **Iteration logging** — Persistent run data for analytics and debugging

## Usage

```typescript
import {
  AgenticLoop,
  createProvider,
  createDefaultToolkit,
  type LoopConfig,
} from '@agentic-lab/core';

// 1. Create a provider
const provider = createProvider('ollama', {
  model: 'llama3.1',
  baseUrl: 'http://localhost:11434',
});

// 2. Create a toolkit
const tools = createDefaultToolkit();

// 3. Configure the loop
const config: LoopConfig = {
  name: 'my-experiment',
  provider: 'ollama',
  model: 'llama3.1',
  maxIterations: 10,
  delayMs: 1000,
  promptFile: 'PROMPT.md',
  planFile: 'PLAN.md',
  workingDir: process.cwd(),
};

// 4. Run
const loop = new AgenticLoop({ config, provider, tools });
loop.on('iteration:end', ({ iteration }) => {
  console.log(`Iteration ${iteration.number}: ${iteration.success ? '✅' : '❌'}`);
});

const result = await loop.run();
console.log(result.summary);
```

## API

### Providers

- `createProvider(name, config)` — Create an LLM provider
- `getAvailableProviders()` — List available provider names
- `registerProvider(name, ProviderClass)` — Register a custom provider

### Loop

- `new AgenticLoop({ config, provider, tools })` — Create a loop
- `loop.run()` — Start the loop (returns `LoopResult`)
- `loop.stop()` — Stop the loop
- `loop.pause()` / `loop.resume()` — Pause/resume

### Tools

- `createDefaultToolkit(enabledTools?)` — Create toolkit with built-in tools
- Individual tools: `FileReadTool`, `FileWriteTool`, `ShellTool`, `GlobTool`, `GrepTool`, `GitTool`

### Events

| Event | Payload |
|-------|---------|
| `loop:start` | `{ config, startedAt }` |
| `loop:complete` | `{ result }` |
| `loop:error` | `{ error, iteration }` |
| `iteration:start` | `{ iteration, planItem? }` |
| `iteration:end` | `{ iteration }` |
| `tool:call` | `{ name, args, iteration }` |
| `tool:result` | `{ name, result, durationMs, iteration }` |
| `llm:request` | `{ messages, iteration }` |
| `llm:response` | `{ content, usage, iteration }` |
