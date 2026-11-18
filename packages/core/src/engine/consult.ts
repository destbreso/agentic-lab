// ============================================
// The consult edge: a role asks another when it decides to
// ============================================
// A consult edge gives the calling role a tool, consult_<role>. The caller's
// model decides when to call it, at most `limit` times a turn. The consulted
// role is shown only what the edge's sight lists: your task, the caller's
// question, the caller's whole turn so far, only its tool calls' results, or
// the lab's measured check run at that moment. Its answer comes back as the
// tool's result. Each consultation is a step of the consulted role, recorded
// with what it saw (each with its provenance), its model call and its advice.

import type { ChatMessage, LLMProvider } from "../types/llm.js";
import type { AgentTool, ToolContext, ToolRegistry } from "../types/tools.js";
import type { Provenance } from "../types/pipeline.js";
import type { StepInput } from "../types/step.js";
import type { MeasuredCheckRun } from "../tasks/types.js";
import type { ConsultEdge, ConsultSight } from "../formats/model.js";

export const DEFAULT_ADVISOR_PROMPT =
  "You are an advisor to an agent working on a task. You see only what is shown below. " +
  "Give short, concrete advice the agent can act on now: what to do next, what to check, what it may have missed. " +
  "You cannot use tools and you do not do the work yourself.";

/** The longest advice an emulated advisor gives, in tokens, unless its definition says otherwise. */
export const DEFAULT_ADVICE_TOKENS = 1024;

export interface ConsultOutcome {
  advice?: string;
  /** The advice came back encrypted: written by a model, unreadable by the lab. */
  sealed?: boolean;
  error?: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** What the orchestrator offers a consult: a step for the consulted role, and the lab's check. */
export interface ConsultHost {
  begin(edge: ConsultEdge, callerId: string, inputs: StepInput[], question?: string): { roleStep: unknown };
  end(handle: { roleStep: unknown }, edge: ConsultEdge, callerId: string, outcome: ConsultOutcome): void;
  /** Run the task's measured checks now, when the task has any. */
  measure?(label: string, signal?: AbortSignal): Promise<MeasuredCheckRun | null>;
}

const clip = (text: string, max = 4000) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The caller's turn as text: every message, its tool calls and their results. */
export function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const calls = m.toolCalls?.length ? `\n(calls ${m.toolCalls.map((c) => `${c.name} ${JSON.stringify(c.arguments)}`).join("; ")})` : "";
      return `[${m.role}${m.role === "tool" && m.name ? ` ${m.name}` : ""}]\n${m.content}${calls}`;
    })
    .join("\n\n");
}

/** Only the results of the caller's tool calls: what its tools returned, measured, without its words. */
export function renderToolResults(messages: ChatMessage[]): string {
  const names = new Map<string, string>();
  for (const m of messages) for (const c of m.toolCalls ?? []) names.set(c.id, c.name);
  const results = messages.filter((m) => m.role === "tool");
  if (results.length === 0) return "(no tool has run yet this turn)";
  return results.map((m) => `[${names.get(m.toolCallId ?? "") ?? "tool"}]\n${clip(m.content)}`).join("\n\n");
}

function renderCheck(run: MeasuredCheckRun | null): string {
  if (!run) return "(the task has no checks)";
  return [
    `${run.passed ? "passed" : "failed"}: ${run.results.filter((r) => r.passed).length} of ${run.results.length}`,
    ...run.results.map((r) => `- ${r.passed ? "pass" : "fail"} ${r.name}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}: ${clip(r.output, 1000)}`),
  ].join("\n");
}

const SIGHT_WORDS: Record<ConsultSight, string> = {
  task: "the task",
  question: "your question",
  transcript: "your whole turn so far",
  tool_results: "your tool calls' results only",
  checks: "the lab's check, run when you ask",
};

export function sightInWords(sees: readonly ConsultSight[]): string {
  return sees.map((s) => SIGHT_WORDS[s]).join(", ");
}

export interface ConsultToolDeps {
  edge: ConsultEdge;
  callerId: string;
  /** The consulted role's provider, already recording its calls on its step. */
  provider: LLMProvider;
  task?: string;
  host: ConsultHost;
}

/** The tool a calling role gets for one consult edge. */
export function createConsultTool(deps: ConsultToolDeps): AgentTool {
  const { edge, callerId, provider, host } = deps;
  const asks = edge.sees.includes("question");
  const uses = new Map<number, number>();
  return {
    definition: {
      name: `consult_${edge.role.id}`,
      description:
        `Ask ${edge.role.face.label} for advice when you want a second opinion, for instance before you finish. ` +
        `It sees ${sightInWords(edge.sees)}, and nothing else. At most ${edge.limit} time${edge.limit > 1 ? "s" : ""} a turn.`,
      parameters: asks
        ? { type: "object", properties: { question: { type: "string", description: "What you want advice on" } }, required: ["question"] }
        : { type: "object", properties: {} },
    },
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      const used = uses.get(ctx.iteration) ?? 0;
      if (used >= edge.limit) {
        return `Error: you have consulted ${edge.role.face.label} ${used} time${used > 1 ? "s" : ""} this turn, the most this topology allows`;
      }
      uses.set(ctx.iteration, used + 1);
      const question = asks && typeof args.question === "string" ? args.question : undefined;
      const transcript = ctx.transcript?.() ?? [];
      const sections: string[] = [];
      const inputs: StepInput[] = [];
      const add = (name: string, heading: string, text: string, provenance: Provenance) => {
        sections.push(`## ${heading}\n\n${text}`);
        inputs.push({ source: "run", name, from: name === "task" ? "you" : name === "checks" ? "lab" : callerId, provenance, value: text });
      };
      if (edge.sees.includes("task") && deps.task !== undefined) add("task", "The task", deps.task, "given");
      if (edge.sees.includes("transcript")) {
        // The caller's own system prompt is part of its turn, as the real advisor tool shows it.
        add("transcript", "The agent's turn so far", renderTranscript(transcript), "written");
      }
      if (edge.sees.includes("tool_results")) add("tool_results", "What the agent's tools returned", renderToolResults(transcript), "measured");
      if (edge.sees.includes("checks")) {
        const run = (await host.measure?.(`consult · ${edge.role.name}`, ctx.signal)) ?? null;
        add("checks", "The lab's check, run now", renderCheck(run), "measured");
      }
      if (question !== undefined) add("question", "The agent asks", question, "written");

      const handle = host.begin(edge, callerId, inputs, question);
      try {
        const result = await provider.chat({
          messages: [
            { role: "system", content: edge.role.systemMessage ?? DEFAULT_ADVISOR_PROMPT },
            { role: "user", content: sections.join("\n\n") || "(nothing is shown to you)" },
          ],
          maxTokens: edge.role.maxTokens ?? DEFAULT_ADVICE_TOKENS,
          temperature: 0.2,
          signal: ctx.signal,
        });
        const advice = result.message.content ?? "";
        host.end(handle, edge, callerId, { advice, usage: result.usage });
        return advice || "(the advisor gave no advice)";
      } catch (error) {
        host.end(handle, edge, callerId, { error: (error as Error).message, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
        if (ctx.signal?.aborted) throw error;
        return `Error: ${edge.role.face.label} could not be consulted: ${(error as Error).message}`;
      }
    },
  };
}

/** A view of a tool registry with more tools on top; registrations still go to the base. */
export function withTools(base: ToolRegistry | undefined, extra: AgentTool[]): ToolRegistry {
  const own = new Map(extra.map((t) => [t.definition.name, t]));
  return {
    register: (tool) => base?.register(tool),
    remove: (name) => own.delete(name) || (base?.remove(name) ?? false),
    get: (name) => own.get(name) ?? base?.get(name),
    has: (name) => own.has(name) || (base?.has(name) ?? false),
    getAll: () => [...(base?.getAll() ?? []).filter((t) => !own.has(t.definition.name)), ...own.values()],
    getDefinitions: () => [...(base?.getDefinitions() ?? []).filter((d) => !own.has(d.name)), ...[...own.values()].map((t) => t.definition)],
  };
}
