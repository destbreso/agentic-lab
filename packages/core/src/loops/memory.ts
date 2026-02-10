// ============================================
// Memory / Compression Loop
// ============================================
// Summarizes, compresses, denoises.
//
// Prevents the system from reasoning about its
// own reasoning infinitely. Creates clean,
// canonical state snapshots.
//
// Key responsibilities:
//   - Compress verbose execution history into summaries
//   - Identify and freeze "canonical" states (milestones)
//   - Filter signal noise for the planner
//   - Manage long-term memory across runs
//
// Input signals:
//   - execution_result: raw execution outputs
//   - evaluation: verdicts
//   - tool_calls: raw tool call history
//
// Output signals:
//   - compressed_context: clean summary for the planner
//   - milestone: a canonical state worth remembering
//   - memory: long-term memory entries to persist

import type { LLMProvider, ChatMessage } from "../types/llm.js";
import type { NodeContext, NodeResult, Signal } from "../types/pipeline.js";
import { BaseLoopNode } from "./base.js";

export interface MemoryLoopConfig {
  /** LLM provider — can be cheap/fast, summarization is simpler */
  provider: LLMProvider;
  /** How many signals to buffer before compressing */
  bufferSize?: number;
  /** Max length of compressed summary (tokens, approximate) */
  maxSummaryLength?: number;
  /** Custom system message */
  systemMessage?: string;
}

export class MemoryLoop extends BaseLoopNode {
  private llmProvider: LLMProvider;
  private bufferSize: number;
  private maxSummaryLength: number;
  private systemMessage: string;

  // Internal buffers
  private signalBuffer: Signal[] = [];
  private currentSummary: string = "";
  private milestoneCount: number = 0;

  constructor(
    config: MemoryLoopConfig,
    overrides?: {
      id?: string;
      name?: string;
      config?: Partial<import("../types/pipeline.js").NodeRunConfig>;
    },
  ) {
    super({
      id: overrides?.id,
      name: overrides?.name || "Memory Loop",
      category: "memory",
      description:
        "Summarizes, compresses, and denoises. Prevents infinite " +
        "meta-reasoning by creating clean canonical state snapshots.",
      config: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: true,
        frequency: {
          everyNIterations: 3,
        },
        ...overrides?.config,
      },
      inputPorts: [
        {
          name: "execution_result",
          direction: "input",
          signalTypes: ["execution_result", "tool_calls"],
          description: "Raw execution outputs",
        },
        {
          name: "evaluation",
          direction: "input",
          signalTypes: ["evaluation", "eval_metrics"],
          description: "Evaluation verdicts",
        },
        {
          name: "strategy",
          direction: "input",
          signalTypes: ["strategy"],
          description: "Planning decisions",
          required: false,
        },
      ],
      outputPorts: [
        {
          name: "compressed_context",
          direction: "output",
          signalTypes: ["compressed_context"],
          description: "Clean summary for planner",
        },
        {
          name: "milestone",
          direction: "output",
          signalTypes: ["milestone"],
          description: "Canonical state worth remembering",
        },
        {
          name: "memory",
          direction: "output",
          signalTypes: ["memory"],
          description: "Long-term memory entries",
        },
      ],
    });

    this.llmProvider = config.provider;
    this.bufferSize = config.bufferSize || 10;
    this.maxSummaryLength = config.maxSummaryLength || 500;
    this.systemMessage =
      config.systemMessage ||
      "You are a memory/compression agent. Your job is to:\n\n" +
        "1. SUMMARIZE: Take verbose execution history and create a concise summary\n" +
        "2. COMPRESS: Reduce noise while preserving critical information\n" +
        "3. DETECT MILESTONES: Identify significant achievements worth remembering\n" +
        "4. EXTRACT MEMORIES: Pull out facts/learnings that should persist long-term\n\n" +
        "Output format:\n" +
        "SUMMARY: <concise summary of recent activity>\n" +
        "MILESTONE: <yes|no>\n" +
        "MILESTONE_DESCRIPTION: <what was achieved if yes>\n" +
        "MEMORIES:\n- <fact 1>\n- <fact 2>\n" +
        "NOISE_FILTERED: <what was dropped as noise>";
  }

  async execute(context: NodeContext): Promise<NodeResult> {
    const startTime = Date.now();
    const result = this.emptyResult();
    const errors: string[] = [];

    context.log.info(`💾 Memory compression cycle ${context.iteration}`);

    try {
      // 1. Buffer incoming signals
      this.signalBuffer.push(...context.inputSignals);

      // Keep buffer bounded
      if (this.signalBuffer.length > this.bufferSize * 2) {
        this.signalBuffer = this.signalBuffer.slice(-this.bufferSize);
      }

      // 2. Only compress when buffer is full enough
      if (this.signalBuffer.length < 3 && !this.currentSummary) {
        context.log.info("  ⏳ Not enough signals to compress yet");
        result.durationMs = Date.now() - startTime;
        result.success = true;
        return result;
      }

      // 3. Build compression prompt
      const prompt = this.buildCompressionPrompt();

      const messages: ChatMessage[] = [
        { role: "system", content: this.systemMessage },
        { role: "user", content: prompt },
      ];

      const llmResult = await this.llmProvider.chat({
        messages,
        temperature: 0.1, // Low temperature for factual summarization
        maxTokens: this.maxSummaryLength * 2,
      });

      result.tokenUsage.inputTokens += llmResult.usage.inputTokens;
      result.tokenUsage.outputTokens += llmResult.usage.outputTokens;
      result.tokenUsage.totalTokens += llmResult.usage.totalTokens;

      // 4. Parse output
      const compressed = this.parseCompression(llmResult.message.content || "");

      // Update running summary
      this.currentSummary = compressed.summary;

      // 5. Emit compressed context
      context.emit("compressed_context", "compressed_context", {
        summary: compressed.summary,
        previousSummary: this.currentSummary,
        signalsProcessed: this.signalBuffer.length,
        iteration: context.iteration,
      });

      // 6. Emit milestone if detected
      if (compressed.isMilestone) {
        this.milestoneCount++;
        context.emit("milestone", "milestone", {
          number: this.milestoneCount,
          description: compressed.milestoneDescription,
          timestamp: new Date().toISOString(),
          iteration: context.iteration,
        });
        context.log.info(
          `  🏁 Milestone #${this.milestoneCount}: ${compressed.milestoneDescription}`,
        );
      }

      // 7. Emit long-term memories
      for (const mem of compressed.memories) {
        context.emit("memory", "memory", {
          content: mem,
          source: "compression",
          iteration: context.iteration,
        });
      }

      // Clear processed signals
      this.signalBuffer = [];

      result.metadata = {
        summaryLength: compressed.summary.length,
        isMilestone: compressed.isMilestone,
        memoriesExtracted: compressed.memories.length,
        noiseFiltered: compressed.noiseFiltered,
      };
    } catch (error) {
      errors.push((error as Error).message);
      context.log.error(
        `❌ Memory compression failed: ${(error as Error).message}`,
      );
    }

    result.durationMs = Date.now() - startTime;
    result.errors = errors;
    result.success = errors.length === 0;
    return result;
  }

  private buildCompressionPrompt(): string {
    let prompt = "## Compression Task\n\n";

    if (this.currentSummary) {
      prompt += `### Previous Summary\n\n${this.currentSummary}\n\n`;
    }

    prompt += `### New Signals to Process (${this.signalBuffer.length})\n\n`;

    for (const signal of this.signalBuffer) {
      // Only include essential info, not raw data dumps
      const essentials: Record<string, unknown> = {
        type: signal.type,
        from: signal.sourceNodeId,
      };

      // Cherry-pick useful fields based on signal type
      switch (signal.type) {
        case "execution_result":
          essentials.toolCallCount = signal.data.toolCallCount;
          essentials.responsePreview = (
            signal.data.responseText as string
          )?.slice(0, 100);
          break;
        case "evaluation":
          essentials.verdict = signal.data.verdict;
          essentials.confidence = signal.data.confidence;
          break;
        case "tool_calls":
          essentials.tools = (
            signal.data.calls as Array<{ name: string }>
          )?.map((c) => c.name);
          break;
        case "strategy":
          essentials.decision = signal.data.decision;
          break;
        default:
          essentials.data = JSON.stringify(signal.data).slice(0, 100);
      }

      prompt += `- ${JSON.stringify(essentials)}\n`;
    }

    prompt +=
      "\nCompress the above into a clean summary. Identify milestones and extract memories.";
    return prompt;
  }

  private parseCompression(response: string): {
    summary: string;
    isMilestone: boolean;
    milestoneDescription: string;
    memories: string[];
    noiseFiltered: string;
  } {
    const summaryMatch = response.match(
      /SUMMARY:\s*([\s\S]*?)(?=MILESTONE:|$)/i,
    );
    const summary =
      summaryMatch?.[1]?.trim() || response.slice(0, this.maxSummaryLength);

    const milestoneMatch = response.match(/MILESTONE:\s*(yes|no)/i);
    const isMilestone = milestoneMatch?.[1]?.toLowerCase() === "yes";

    const milestoneDescMatch = response.match(
      /MILESTONE_DESCRIPTION:\s*([\s\S]*?)(?=MEMORIES:|$)/i,
    );
    const milestoneDescription = milestoneDescMatch?.[1]?.trim() || "";

    const memoriesMatch = response.match(
      /MEMORIES:([\s\S]*?)(?=NOISE_FILTERED:|$)/i,
    );
    const memories = memoriesMatch
      ? memoriesMatch[1]
          .split("\n")
          .filter((l) => l.trim().startsWith("-"))
          .map((l) => l.trim().slice(2))
      : [];

    const noiseMatch = response.match(/NOISE_FILTERED:\s*([\s\S]*?)$/i);
    const noiseFiltered = noiseMatch?.[1]?.trim() || "";

    return {
      summary,
      isMilestone,
      milestoneDescription,
      memories,
      noiseFiltered,
    };
  }
}
