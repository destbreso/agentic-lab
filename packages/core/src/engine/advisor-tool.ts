// ============================================
// The real advisor tool, for an Anthropic caller with full sight
// ============================================
// Anthropic's advisor_20260301 is a server tool: the executor's model decides
// when to call it, the advisor model reads the executor's whole transcript on
// Anthropic's side, and only its advice comes back, often encrypted. When a
// consult edge's caller runs on Anthropic and the edge's sight is that full
// transcript, the lab offers this tool instead of emulating the advisor.
// Every result is recorded as the consulted role's step: readable advice as
// written, sealed advice as sealed. Docs:
// platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool

import type { ChatCompletionOptions, LLMProvider, ServerToolResult } from "../types/llm.js";
import type { ConsultEdge } from "../formats/model.js";

export const ADVISOR_TOOL_TYPE = "advisor_20260301";
export const ADVISOR_BETA = "advisor-tool-2026-03-01";
/** The advisor when the definition names none: the current Opus, valid for every executor but Fable and Mythos. */
export const DEFAULT_ADVISOR_MODEL = "claude-opus-5-5";

/** Whether a consult edge runs as Anthropic's own advisor tool: an Anthropic caller, and a sight of the whole transcript. */
export function usesRealAdvisor(caller: LLMProvider, edge: ConsultEdge): boolean {
  const full = edge.sees.includes("transcript") && edge.sees.every((s) => s === "task" || s === "transcript");
  const advisorProvider = edge.role.brain?.provider;
  return caller.name === "anthropic" && full && (!advisorProvider || advisorProvider === "anthropic");
}

/** The advisor's model: the definition's, else Opus, else (for a Fable or Mythos executor, which takes only its own kind) the executor's. */
export function advisorModelFor(edge: ConsultEdge, executorModel?: string): string {
  if (edge.role.brain?.model) return edge.role.brain.model;
  if (executorModel && /^claude-(fable|mythos)-/.test(executorModel)) return executorModel;
  return DEFAULT_ADVISOR_MODEL;
}

/** The tool as Anthropic defines it. Its max_uses counts per request, not per turn. */
export function advisorToolDefinition(edge: ConsultEdge, model: string): Record<string, unknown> {
  return {
    type: ADVISOR_TOOL_TYPE,
    name: "advisor",
    model,
    max_uses: edge.limit,
    ...(edge.role.maxTokens ? { max_tokens: Math.max(1024, edge.role.maxTokens) } : {}),
  };
}

/** A caller's provider that offers the advisor tool on every call and reports what the advisor returned. */
export function withAdvisorTool(
  base: LLMProvider,
  edge: ConsultEdge,
  onResults: (results: ServerToolResult[], model: string) => void,
): LLMProvider {
  const model = advisorModelFor(edge, (base as { model?: unknown }).model as string | undefined);
  const tool = advisorToolDefinition(edge, model);
  const wrapped: LLMProvider = {
    get name() {
      return base.name;
    },
    async chat(options: ChatCompletionOptions) {
      const result = await base.chat({
        ...options,
        serverTools: [...(options.serverTools ?? []), tool],
        betas: [...new Set([...(options.betas ?? []), ADVISOR_BETA])],
      });
      const advice = (result.serverToolResults ?? []).filter((r) => r.tool === "advisor");
      if (advice.length) onResults(advice, model);
      return result;
    },
    listModels: () => base.listModels(),
    healthCheck: () => base.healthCheck(),
  };
  const own = (base as { model?: unknown }).model;
  if (typeof own === "string") Object.assign(wrapped, { model: own });
  return wrapped;
}
