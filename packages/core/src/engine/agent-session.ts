// ============================================
// Agent Session
// ============================================
// A single, reusable entry point for running an agent on a task — the core
// counterpart to the web's chat/agent route. It:
//   1. resolves which skills to activate for the task (semantic via embeddings
//      when available, heuristic keyword match otherwise),
//   2. instantiates the chosen recipe with the session's provider, tools,
//      memory and activated skills,
//   3. seeds the task onto the shared blackboard and runs the pipeline.
//
// This is what makes "auto" skill activation work in live execution: the task
// text is only known at run time, so activation happens here, not at authoring.

import { instantiateRecipe } from "../loops/recipes.js";
import { resolveActiveSkills } from "../skills/activation.js";
import { SkillRegistry } from "../skills/registry.js";
import type { Skill } from "../skills/types.js";
import type { LLMProvider } from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import type { MemoryStore } from "../types/storage.js";
import type { EmbeddingFunction } from "../storage/qdrant.js";
import type { ProviderFactory } from "./capability-resolver.js";
import type { PipelineResult } from "../types/pipeline.js";
import type { PipelineOrchestrator } from "./pipeline.js";

export interface AgentSessionConfig {
  /** Default provider (per-node brains can still override via the recipe). */
  provider: LLMProvider;
  /** Tool registry available to the pipeline. */
  tools?: ToolRegistry;
  /** Recipe id to run (default: "ralph-loop"). */
  recipe?: string;
  /** Working directory for the agent. */
  workingDir?: string;
  /** Available skills (registry or list) considered for activation. */
  skills?: Skill[] | SkillRegistry;
  /** Skill names to always attach for this session (manual activation). */
  manualSkills?: string[];
  /** Memory store backing recall/remember. */
  memory?: MemoryStore;
  /** Embedding fn for semantic skill activation; falls back to heuristic. */
  embed?: EmbeddingFunction;
  /** Provider factory for resolving per-node brains. */
  providerFactory?: ProviderFactory;
  /** Override the recipe's max cycles. */
  maxCycles?: number;
}

export interface AgentRunResult {
  result: PipelineResult;
  /** Skills activated for this task (names). */
  activatedSkills: string[];
}

export class AgentSession {
  constructor(private readonly config: AgentSessionConfig) {}

  private skillList(): Skill[] {
    const s = this.config.skills;
    if (!s) return [];
    if (s instanceof SkillRegistry) return s.list();
    return s;
  }

  /**
   * Resolve which skills to activate for a task. Always/manual skills are
   * included; auto skills are matched by relevance (semantic or heuristic).
   */
  async activateSkills(task: string): Promise<string[]> {
    const skills = this.skillList();
    if (skills.length === 0) return [];
    const active = await resolveActiveSkills(
      skills,
      { query: task, manualSkills: this.config.manualSkills },
      { embed: this.config.embed },
    );
    return active.map((a) => a.skill.name);
  }

  /** Run the agent on a task. */
  async run(
    task: string,
    onPipeline?: (pipeline: PipelineOrchestrator) => void,
  ): Promise<AgentRunResult> {
    const activatedSkills = await this.activateSkills(task);

    const pipeline = instantiateRecipe(
      this.config.recipe ?? "ralph-loop",
      {
        provider: this.config.provider,
        tools: this.config.tools,
        skills: this.skillList(),
        sessionSkills: activatedSkills,
        memory: this.config.memory,
        providerFactory: this.config.providerFactory,
        workingDir: this.config.workingDir ?? process.cwd(),
        seedShared: { task },
      },
      this.config.maxCycles != null ? { maxCycles: this.config.maxCycles } : undefined,
    );

    onPipeline?.(pipeline);
    const result = await pipeline.run();
    return { result, activatedSkills };
  }
}
