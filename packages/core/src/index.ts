// ============================================
// @agentic-lab/core — Public API
// ============================================

// --- Types ---
export type {
  LLMProvider,
  LLMProviderConfig,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ToolDefinition,
  ToolParameter,
  ToolResult,
  ToolCall,
} from "./types/llm.js";

export type {
  LoopConfig,
  LoopState,
  LoopIteration,
  LoopResult,
  LoopStatus,
  LoopEvent,
  LoopEventMap,
  PlanItem,
  PlanStatus,
} from "./types/loop.js";

export type { AgentTool, ToolContext, ToolRegistry } from "./types/tools.js";

// --- Provider Factory ---
export { createProvider, getAvailableProviders } from "./providers/factory.js";
export { OllamaProvider } from "./providers/ollama.js";
export { OpenAIProvider } from "./providers/openai.js";
export { AnthropicProvider } from "./providers/anthropic.js";

// --- Loop Engine ---
export { AgenticLoop } from "./engine/loop.js";
export { PlanManager } from "./engine/plan-manager.js";
export { PromptBuilder } from "./engine/prompt-builder.js";
export { IterationLogger } from "./engine/iteration-logger.js";

// --- Built-in Tools ---
export { FileReadTool } from "./tools/file-read.js";
export { FileWriteTool } from "./tools/file-write.js";
export { ShellTool } from "./tools/shell.js";
export { GlobTool } from "./tools/glob.js";
export { GrepTool } from "./tools/grep.js";
export { GitTool } from "./tools/git.js";
export { createDefaultToolkit } from "./tools/defaults.js";

// --- Config ---
export { loadConfig } from "./config/loader.js";
export type { AgenticLabConfig } from "./config/loader.js";

// --- Logger ---
export { createLogger, type Logger } from "./utils/logger.js";
