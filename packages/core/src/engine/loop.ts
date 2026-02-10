// ============================================
// Agentic Loop Engine
// ============================================
// Stateless iterative loop based on the "Ralph Loop" pattern.
// Each iteration: read specs → read plan → pick task → work → update plan → commit.
// The agent has NO knowledge of the loop — it only sees current-iteration context.

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import type { LLMProvider, ChatMessage, ToolResult } from '../types/llm.js';
import type {
  LoopConfig,
  LoopState,
  LoopIteration,
  LoopResult,
} from "../types/loop.js";
import type { ToolRegistry, ToolContext } from "../types/tools.js";
import { PlanManager } from "./plan-manager.js";
import { PromptBuilder } from "./prompt-builder.js";
import { IterationLogger } from "./iteration-logger.js";
import { createLogger, type Logger } from "../utils/logger.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AgenticLoop extends EventEmitter {
  private config: LoopConfig;
  private provider: LLMProvider;
  private tools: ToolRegistry;
  private planManager: PlanManager;
  private promptBuilder: PromptBuilder;
  private iterationLogger: IterationLogger;
  private logger: Logger;
  private state: LoopState;
  private abortController: AbortController | null = null;

  constructor(options: {
    config: LoopConfig;
    provider: LLMProvider;
    tools: ToolRegistry;
  }) {
    super();
    this.config = {
      ...options.config,
      id: options.config.id || nanoid(12),
    };
    this.provider = options.provider;
    this.tools = options.tools;

    this.planManager = new PlanManager(
      this.config.workingDir,
      this.config.planFile,
    );
    this.promptBuilder = new PromptBuilder(this.config.workingDir);
    this.iterationLogger = new IterationLogger(
      this.config.workingDir,
      this.config.id!,
    );
    this.logger = createLogger({
      level: this.config.verbose ? "debug" : "info",
      logFile: this.config.logFile,
      prefix: `loop:${this.config.id!.slice(0, 6)}`,
    });

    // Initialize state
    this.state = {
      config: this.config,
      status: "idle",
      iterations: [],
      currentIteration: 0,
      totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalToolCalls: {},
      plan: [],
      errors: [],
    };
  }

  /**
   * Run the agentic loop.
   * This is the main entry point — the "Ralph Loop".
   */
  async run(): Promise<LoopResult> {
    const startTime = Date.now();

    // Initialize
    await this.iterationLogger.init();
    this.state.status = "running";
    this.state.startedAt = new Date().toISOString();

    this.logger.info("🚀 Starting agentic loop");
    this.logger.info(`   Provider: ${this.provider.name}`);
    this.logger.info(`   Model: ${this.config.model}`);
    this.logger.info(`   Max iterations: ${this.config.maxIterations}`);
    this.logger.info(`   Working dir: ${this.config.workingDir}`);

    this.emit("loop:start", {
      config: this.config,
      startedAt: this.state.startedAt,
    });

    this.abortController = new AbortController();

    try {
      // Main loop
      for (let i = 0; i < this.config.maxIterations; i++) {
        // Check if stopped
        if (this.abortController.signal.aborted) {
          this.logger.info("🛑 Loop stopped by user");
          break;
        }

        // Check if paused (status can change externally via pause())
        while ((this.state.status as string) === "paused") {
          await sleep(500);
          if (this.abortController.signal.aborted) break;
        }

        this.state.currentIteration = i + 1;
        this.logger.info(
          `\n🔄 === Iteration ${i + 1}/${this.config.maxIterations} ===`,
        );

        const iteration = await this.runIteration(i + 1);
        this.state.iterations.push(iteration);

        // Update aggregate stats
        this.state.totalTokenUsage.inputTokens +=
          iteration.tokenUsage.inputTokens;
        this.state.totalTokenUsage.outputTokens +=
          iteration.tokenUsage.outputTokens;
        this.state.totalTokenUsage.totalTokens +=
          iteration.tokenUsage.totalTokens;

        for (const tc of iteration.toolCalls) {
          this.state.totalToolCalls[tc.name] =
            (this.state.totalToolCalls[tc.name] || 0) + 1;
        }

        if (iteration.errors.length > 0) {
          this.state.errors.push(...iteration.errors);
        }

        // Log iteration
        await this.iterationLogger.logIteration(iteration);

        // Emit iteration end event
        this.emit("iteration:end", { iteration });

        // Check if plan is complete
        const plan = await this.planManager.read();
        this.state.plan = plan;
        const allDone =
          plan.length > 0 &&
          plan.every(
            (item) => item.status === "completed" || item.status === "skipped",
          );

        if (allDone) {
          this.logger.info("✅ All plan items completed!");
          break;
        }

        // Delay between iterations
        if (i < this.config.maxIterations - 1) {
          this.logger.info(
            `⏳ Waiting ${this.config.delayMs}ms before next iteration...`,
          );
          await sleep(this.config.delayMs);
        }
      }
    } catch (error) {
      this.state.status = "failed";
      this.state.errors.push((error as Error).message);
      this.logger.error(`❌ Loop failed: ${(error as Error).message}`);
      this.emit("loop:error", {
        error: error as Error,
        iteration: this.state.currentIteration,
      });
    }

    // Finalize
    this.state.endedAt = new Date().toISOString();
    if (this.state.status === "running") {
      this.state.status = "completed";
    }

    const totalDurationMs = Date.now() - startTime;
    const result: LoopResult = {
      state: this.state,
      totalDurationMs,
      totalIterations: this.state.iterations.length,
      success: this.state.status === "completed",
      summary: this.buildSummary(totalDurationMs),
    };

    // Save final state and result
    await this.iterationLogger.saveState(this.state);
    await this.iterationLogger.saveResult(result);

    // Print summary
    this.printStats(totalDurationMs);

    this.emit("loop:complete", { result });
    this.logger.close();

    return result;
  }

  /** Stop the loop */
  stop(reason: string = "User requested stop"): void {
    this.abortController?.abort();
    this.state.status = "stopped";
    this.emit("loop:stop", { reason, state: this.state });
    this.logger.info(`🛑 Stopping loop: ${reason}`);
  }

  /** Pause the loop */
  pause(): void {
    this.state.status = "paused";
    this.emit("loop:pause", { iteration: this.state.currentIteration });
    this.logger.info("⏸️  Loop paused");
  }

  /** Resume the loop */
  resume(): void {
    this.state.status = "running";
    this.emit("loop:resume", { iteration: this.state.currentIteration });
    this.logger.info("▶️  Loop resumed");
  }

  /** Get the current state */
  getState(): LoopState {
    return { ...this.state };
  }

  // ---- Private: Run a single iteration ----

  private async runIteration(number: number): Promise<LoopIteration> {
    const iteration: LoopIteration = {
      number,
      startedAt: new Date().toISOString(),
      toolCalls: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      errors: [],
      success: false,
    };

    this.emit("iteration:start", {
      iteration: number,
      planItem: undefined,
    });

    try {
      // 1. Read current plan
      const planContent = await this.planManager.getRawContent();

      // 2. Load specs if available
      let specsContent = "";
      if (this.config.specsDir) {
        specsContent = await this.promptBuilder.loadSpecs(this.config.specsDir);
      }

      // 3. Build the prompt for this iteration
      const prompt = await this.promptBuilder.buildIterationPrompt({
        promptFile: this.config.promptFile,
        planContent: planContent || undefined,
        specsContent: specsContent || undefined,
        iterationNumber: number,
        maxIterations: this.config.maxIterations,
      });

      // 4. Build messages
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are an autonomous AI agent working in an agentic loop. " +
            "Follow the prompt instructions carefully. Pick ONE task, complete it, " +
            "update the plan, and end your turn. Use the provided tools for all operations.",
        },
        {
          role: "user",
          content: prompt,
        },
      ];

      // 5. Tool loop — keep calling LLM until no more tool calls
      let continueLoop = true;
      let maxToolRounds = 20; // Safety limit

      while (continueLoop && maxToolRounds > 0) {
        maxToolRounds--;

        this.emit("llm:request", { messages, iteration: number });

        const result = await this.provider.chat({
          messages,
          tools: this.tools.getDefinitions(),
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });

        // Track token usage
        iteration.tokenUsage.inputTokens += result.usage.inputTokens;
        iteration.tokenUsage.outputTokens += result.usage.outputTokens;
        iteration.tokenUsage.totalTokens += result.usage.totalTokens;

        this.emit("llm:response", {
          content: result.message.content,
          usage: iteration.tokenUsage,
          iteration: number,
        });

        // If no tool calls, we're done
        if (
          result.finishReason !== "tool_calls" ||
          !result.message.toolCalls?.length
        ) {
          iteration.responseText = result.message.content;
          if (result.message.content) {
            this.logger.info(
              `💬 ${result.message.content.slice(0, 200)}${result.message.content.length > 200 ? "..." : ""}`,
            );
          }
          continueLoop = false;
          break;
        }

        // Add assistant message with tool calls to conversation
        messages.push(result.message);

        // Execute tool calls
        const toolResults: ToolResult[] = [];

        for (const toolCall of result.message.toolCalls) {
          this.logger.info(`🔧 Tool: ${toolCall.name}`);
          this.emit("tool:call", {
            name: toolCall.name,
            args: toolCall.arguments,
            iteration: number,
          });

          const toolStartTime = Date.now();
          const tool = this.tools.get(toolCall.name);

          if (!tool) {
            const errorMsg = `Unknown tool: ${toolCall.name}`;
            this.logger.warn(`⚠️  ${errorMsg}`);
            toolResults.push({
              toolCallId: toolCall.id,
              content: errorMsg,
              isError: true,
            });
            iteration.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: errorMsg,
              durationMs: Date.now() - toolStartTime,
            });
            continue;
          }

          try {
            const context: ToolContext = {
              workingDir: this.config.workingDir,
              iteration: number,
              log: (msg) => this.logger.debug(`  [${toolCall.name}] ${msg}`),
              verbose: this.config.verbose ?? false,
            };

            const toolResult = await tool.execute(toolCall.arguments, context);
            const durationMs = Date.now() - toolStartTime;

            toolResults.push({
              toolCallId: toolCall.id,
              content: toolResult,
            });

            iteration.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: toolResult.slice(0, 500),
              durationMs,
            });

            this.emit("tool:result", {
              name: toolCall.name,
              result: toolResult,
              durationMs,
              iteration: number,
            });

            this.logger.debug(
              `  ✅ ${toolCall.name} completed (${durationMs}ms)`,
            );
          } catch (error) {
            const durationMs = Date.now() - toolStartTime;
            const errorMsg = (error as Error).message;

            toolResults.push({
              toolCallId: toolCall.id,
              content: `Error: ${errorMsg}`,
              isError: true,
            });

            iteration.toolCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: `Error: ${errorMsg}`,
              durationMs,
            });

            iteration.errors.push(`Tool ${toolCall.name} failed: ${errorMsg}`);
            this.logger.error(`  ❌ ${toolCall.name} failed: ${errorMsg}`);
          }
        }

        // Add tool results to conversation
        for (const tr of toolResults) {
          messages.push({
            role: "tool",
            content: tr.content,
            toolCallId: tr.toolCallId,
          });
        }
      }

      // Auto-commit if configured
      if (this.config.autoCommit) {
        try {
          const gitTool = this.tools.get("git");
          if (gitTool) {
            const ctx: ToolContext = {
              workingDir: this.config.workingDir,
              iteration: number,
              log: (msg) => this.logger.debug(msg),
              verbose: false,
            };

            await gitTool.execute({ command: "add -A" }, ctx);
            const commitResult = await gitTool.execute(
              {
                command: `commit -m "agentic-lab: iteration ${number}" --allow-empty`,
              },
              ctx,
            );

            // Extract SHA
            const shaMatch = commitResult.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
            if (shaMatch) {
              iteration.commitSha = shaMatch[1];
            }

            if (this.config.autoPush) {
              await gitTool.execute({ command: "push" }, ctx);
            }
          }
        } catch (error) {
          this.logger.warn(`Git commit failed: ${(error as Error).message}`);
        }
      }

      iteration.success = iteration.errors.length === 0;
    } catch (error) {
      iteration.errors.push((error as Error).message);
      this.logger.error(
        `❌ Iteration ${number} failed: ${(error as Error).message}`,
      );
      this.emit("iteration:error", {
        iteration: number,
        error: error as Error,
      });
    }

    iteration.endedAt = new Date().toISOString();
    iteration.durationMs = Date.now() - new Date(iteration.startedAt).getTime();

    return iteration;
  }

  // ---- Private: Summary & Stats ----

  private buildSummary(totalDurationMs: number): string {
    const elapsed = this.formatElapsed(totalDurationMs);
    const { totalTokenUsage, totalToolCalls, iterations } = this.state;
    const successCount = iterations.filter((i) => i.success).length;

    return [
      `Loop completed: ${iterations.length} iterations (${successCount} successful)`,
      `Duration: ${elapsed}`,
      `Tokens: ${totalTokenUsage.totalTokens.toLocaleString()} (in: ${totalTokenUsage.inputTokens.toLocaleString()}, out: ${totalTokenUsage.outputTokens.toLocaleString()})`,
      `Tool calls: ${Object.entries(totalToolCalls)
        .map(([name, count]) => `${name}(${count})`)
        .join(", ")}`,
    ].join(" | ");
  }

  private printStats(totalDurationMs: number): void {
    const elapsed = this.formatElapsed(totalDurationMs);
    const { totalTokenUsage, totalToolCalls, iterations } = this.state;

    this.logger.info("\n📊 === Loop Statistics ===");
    this.logger.info(
      `   Iterations: ${iterations.length}/${this.config.maxIterations}`,
    );
    this.logger.info(
      `   Successful: ${iterations.filter((i) => i.success).length}`,
    );
    this.logger.info(`   Duration: ${elapsed}`);
    this.logger.info(
      `   Tokens — Input: ${totalTokenUsage.inputTokens.toLocaleString()} | Output: ${totalTokenUsage.outputTokens.toLocaleString()} | Total: ${totalTokenUsage.totalTokens.toLocaleString()}`,
    );

    if (Object.keys(totalToolCalls).length > 0) {
      this.logger.info("   Tool calls:");
      for (const [name, count] of Object.entries(totalToolCalls).sort(
        (a, b) => b[1] - a[1],
      )) {
        this.logger.info(`     ${name}: ${count}`);
      }
    }

    if (this.state.errors.length > 0) {
      this.logger.warn(`   Errors: ${this.state.errors.length}`);
    }
  }

  private formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((n) => n.toString().padStart(2, "0"))
      .join(":");
  }
}
