// ============================================
// measureSight: what each role sees, measured
// ============================================
// The walls between roles are measured, not declared. measureSight runs a
// topology with a mock model and marked inputs: the task, the conversation,
// recalled memories, the operator's note and the measured check each carry a
// mark, and every value a role writes carries one naming the role. Reading
// the recorded steps, each cell says whether another role's mark reached a
// role's prompt, was delivered to it without reaching its prompt, or never
// reached it. Values a mark cannot carry (Check's verdict, Do's tool calls)
// are measured by a pair of runs that differ only in that value: a role sees
// it when its prompts differ. No network, no tokens.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "./agent-session.js";
import { getRecipe } from "../loops/recipes.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import type { ChatCompletionOptions, ChatCompletionResult, LLMProvider, ToolCall } from "../types/llm.js";
import type { LoopCategory, Provenance, Recipe } from "../types/pipeline.js";
import type { StepRecord } from "../types/step.js";
import type { CheckRunner, MeasuredCheckRun } from "../tasks/types.js";
import type { RoleRef } from "./recorder.js";

/** One thing a role may see. */
export interface SightRow {
  key: string;
  label: string;
  /** Where the value comes from; Check's verdict is measured with a check and written without. */
  provenance: Provenance | "measured or written";
  /** The categories of the roles that write it ("own" in their column). */
  producers: LoopCategory[];
}

/**
 * prompt: another role's value reached this role's prompt.
 * delivered: it reached this role's inputs but not its prompt (unread).
 * none: it never reached this role.
 * own: this role writes it, and sees no other role's.
 */
export type SightCell = "prompt" | "delivered" | "none" | "own";

export interface SightRole {
  id: string;
  name: string;
  category: LoopCategory;
  /** Turns it took in the probe run, and model calls it made. */
  turns: number;
  calls: number;
  /** Tools offered on its model calls (null when it never called its model). */
  tools: string[] | null;
}

export interface SightMatrix {
  topology: { id: string; name: string };
  roles: SightRole[];
  rows: SightRow[];
  /** cells[row.key][role.id] */
  cells: Record<string, Record<string, SightCell>>;
}

export const SIGHT_ROWS: SightRow[] = [
  { key: "task", label: "your task", provenance: "given", producers: [] },
  { key: "conversation", label: "the conversation", provenance: "written", producers: [] },
  { key: "memories", label: "recalled memories", provenance: "written", producers: [] },
  { key: "note", label: "the operator's note", provenance: "given", producers: [] },
  { key: "plan", label: "the plan", provenance: "written", producers: ["planning"] },
  { key: "account", label: "Do's account", provenance: "written", producers: ["execution"] },
  { key: "world", label: "files Do read", provenance: "measured", producers: ["execution"] },
  { key: "toolcalls", label: "Do's tool calls", provenance: "measured", producers: ["execution"] },
  { key: "tokens", label: "Do's tokens", provenance: "measured", producers: ["execution"] },
  { key: "check", label: "the measured check", provenance: "measured", producers: [] },
  { key: "verdict", label: "Check's verdict", provenance: "measured or written", producers: ["evaluation"] },
  { key: "evidence", label: "Check's evidence", provenance: "written", producers: ["evaluation"] },
  { key: "corrections", label: "corrections", provenance: "written", producers: ["evaluation", "refinement"] },
  { key: "critique", label: "Critique's notes", provenance: "written", producers: ["critic"] },
  { key: "decision", label: "Decide's reason", provenance: "written", producers: ["refinement"] },
  { key: "summary", label: "Memory's summary", provenance: "written", producers: ["memory"] },
];

/** Rows a mark written by a role carries, and the mark's name. */
const ROLE_MARKS: Record<string, string> = {
  plan: "PLAN",
  account: "DO",
  evidence: "EVIDENCE",
  corrections: "CORR",
  critique: "CRITIQUE",
  decision: "DECIDE",
  summary: "MEMSUM",
};

/** Rows carried by one mark the lab or you wrote. */
const FIXED_MARKS: Record<string, string> = {
  task: "MARK-TASK",
  conversation: "MARK-CONVERSATION",
  memories: "MARK-MEMORY",
  note: "MARK-NOTE",
  check: "MARK-CHECK",
  world: "MARK-WORLD",
};

const mark = (name: string, roleId: string) => `MARK-${name}{${roleId}}`;

/** The tokens a Do role's answer reports: a number no other value in a run has. */
const tokensFor = (execIds: string[], id: string) => 48611 + 1000 * execIds.indexOf(id);

interface Variant {
  /** Check's model verdict while failing, and where the verdict comes from. */
  failVerdict: "fail" | "partial";
  verdictFrom: "measured" | "model";
  /** Tool calls Do makes before it answers. */
  doToolCalls: number;
}

const BASE: Variant = { failVerdict: "fail", verdictFrom: "measured", doToolCalls: 1 };

/** A mock model for one role: marked answers by category, the same scenario in every topology. */
function mockFor(role: RoleRef, variant: Variant, tokensOf: Map<string, number>): LLMProvider {
  let turn = 0;
  const reply = (content: string, toolCalls?: ToolCall[], usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }): ChatCompletionResult => ({
    message: { role: "assistant", content, ...(toolCalls ? { toolCalls } : {}) },
    usage,
    finishReason: toolCalls ? "tool_calls" : "stop",
    model: "sight-probe",
  });
  const id = role.id;
  return {
    name: "sight-probe",
    listModels: async () => ["sight-probe"],
    healthCheck: async () => true,
    async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
      const toolTurns = options.messages.filter((m) => m.role === "tool").length;
      if (toolTurns === 0) turn++;
      switch (role.category) {
        case "planning":
          return reply(`STRATEGY: continue\nREASONING: steady\nNEXT_TASK: ${mark("PLAN", id)}`);
        case "execution": {
          const canRead = (options.tools ?? []).some((t) => t.name === "file_read");
          if (canRead && toolTurns < variant.doToolCalls) {
            return reply("", [{ id: `sight-${id}-${turn}-${toolTurns}`, name: "file_read", arguments: { path: "SIGHT.txt" } }], {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            });
          }
          const total = tokensOf.get(id)!;
          return reply(mark("DO", id), undefined, { inputTokens: total - 611, outputTokens: 611, totalTokens: total });
        }
        case "evaluation":
          return reply(
            JSON.stringify({
              verdict: turn <= 3 ? variant.failVerdict : "pass",
              evidence: [mark("EVIDENCE", id)],
              corrections: turn <= 3 ? [mark("CORR", id)] : [],
              confidence: 0.5,
            }),
          );
        case "critic":
          return reply(
            JSON.stringify({ status: "warning", issues: [mark("CRITIQUE", id)], intervention: "none", reasoning: mark("CRITIQUE", id) }),
          );
        case "refinement": {
          const decision = turn === 2 ? "backtrack" : turn <= 3 ? "refine" : "converge";
          return reply(JSON.stringify({ decision, reason: mark("DECIDE", id), corrections: [mark("CORR", id)] }));
        }
        case "memory":
          return reply(
            JSON.stringify({ summary: mark("MEMSUM", id), isMilestone: false, milestoneDescription: "", memories: [], noiseFiltered: "" }),
          );
        default:
          return reply("ok");
      }
    },
  };
}

/** The lab's check, scripted: it fails three times and passes from its fourth run on. */
function scriptedChecker(): CheckRunner {
  let runs = 0;
  return {
    capture: async () => {},
    run: async ({ label }): Promise<MeasuredCheckRun> => {
      runs++;
      const passed = runs > 3;
      return {
        label,
        passed,
        results: [{ name: "probe", kind: "command", passed, exitCode: passed ? 0 : 1, output: "MARK-CHECK", durationMs: 0 }],
        at: new Date(0).toISOString(),
        durationMs: 0,
      };
    },
  };
}

async function probe(recipe: Recipe, variant: Variant): Promise<StepRecord[]> {
  const ws = await mkdtemp(join(tmpdir(), "sight-"));
  try {
    await writeFile(join(ws, "SIGHT.txt"), "MARK-WORLD\n");
    const execIds = recipe.nodes.filter((n) => n.category === "execution").map((n) => n.id);
    const tokensOf = new Map(execIds.map((id) => [id, tokensFor(execIds, id)]));
    const session = new AgentSession({
      provider: mockFor({ id: "default", name: "default", category: "custom", type: "custom" }, variant, tokensOf),
      tools: createDefaultToolkit(),
      topology: recipe,
      workingDir: ws,
      delayMs: 0,
      maxRounds: 10,
      params: { maxRounds: 8 },
      verdictFrom: variant.verdictFrom,
      roleProvider: (role) => mockFor(role, variant, tokensOf),
      checkRunner: () => scriptedChecker(),
    });
    session.steer("MARK-NOTE");
    const run = await session.run({
      task: "MARK-TASK: do the probe task.",
      inputs: [
        { name: "conversation", content: "## Earlier in this conversation\n\nMARK-CONVERSATION", provenance: "written" },
        { name: "memories", content: "## Recalled from earlier conversations\n\nMARK-MEMORY", provenance: "written" },
      ],
      checks: [{ name: "probe", kind: "command", command: "true" }],
    });
    return run.steps.filter((s) => s.role !== "lab");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

/** Everything a role's model was shown, its system prompt aside. */
function promptsOf(steps: StepRecord[], roleId: string): string {
  return steps
    .filter((s) => s.role === roleId)
    .flatMap((s) => s.calls.flatMap((c) => c.messages.filter((m) => m.role !== "system").map((m) => m.content)))
    .join("\n");
}

/** Values that differ from run to run whatever the topology does: ids and clocks. */
const VOLATILE = new Set(["steerId", "timestamp", "at", "durationMs"]);

/** Everything a role was given, as recorded, its ids and clocks left out. */
function inputsOf(steps: StepRecord[], roleId: string): string {
  return steps
    .filter((s) => s.role === roleId)
    .map((s) => JSON.stringify(s.inputs, (key, value) => (VOLATILE.has(key) ? undefined : value)))
    .join("\n");
}

/** Measure what each role of a topology sees. */
export async function measureSight(topology: string | Recipe): Promise<SightMatrix> {
  const recipe = typeof topology === "string" ? getRecipe(topology) : topology;
  if (!recipe) throw new Error(`Unknown topology "${String(topology)}"`);

  const base = await probe(recipe, BASE);
  const verdictA = await probe(recipe, { ...BASE, verdictFrom: "model", failVerdict: "fail" });
  const verdictB = await probe(recipe, { ...BASE, verdictFrom: "model", failVerdict: "partial" });
  const toolsA = await probe(recipe, { ...BASE, doToolCalls: 0 });
  const toolsB = await probe(recipe, { ...BASE, doToolCalls: 2 });

  const execIds = recipe.nodes.filter((n) => n.category === "execution").map((n) => n.id);
  const roles: SightRole[] = recipe.nodes.map((n) => {
    const steps = base.filter((s) => s.role === n.id);
    const calls = steps.flatMap((s) => s.calls);
    return {
      id: n.id,
      name: n.name,
      category: n.category,
      turns: steps.length,
      calls: calls.length,
      tools: calls.length === 0 ? null : [...new Set(calls.flatMap((c) => c.tools))].sort(),
    };
  });

  // A row written by a kind of role the topology does not have says nothing.
  const categories = new Set(recipe.nodes.map((n) => n.category));
  const rows = SIGHT_ROWS.filter((r) => r.producers.length === 0 || r.producers.some((c) => categories.has(c)));

  const cells: SightMatrix["cells"] = {};
  for (const row of rows) {
    cells[row.key] = {};
    for (const role of roles) {
      const own = row.producers.includes(role.category);
      let cell: SightCell;
      if (row.key === "verdict" || row.key === "toolcalls") {
        const [a, b] = row.key === "verdict" ? [verdictA, verdictB] : [toolsA, toolsB];
        if (own) cell = "own";
        else if (promptsOf(a, role.id) !== promptsOf(b, role.id)) cell = "prompt";
        else if (inputsOf(a, role.id) !== inputsOf(b, role.id)) cell = "delivered";
        else cell = "none";
      } else {
        // The marks of every other role that writes this, or the one fixed mark.
        let others: string[];
        if (row.key === "tokens") {
          // Each Do's turn spends a number no other value has, written plain or with separators.
          others = execIds
            .filter((id) => id !== role.id)
            .map((id) => tokensFor(execIds, id))
            .flatMap((n) => [String(n), n.toLocaleString("en-US")]);
        } else if (ROLE_MARKS[row.key]) {
          others = recipe.nodes.filter((n) => n.id !== role.id).map((n) => mark(ROLE_MARKS[row.key], n.id));
        } else {
          others = own ? [] : [FIXED_MARKS[row.key]];
        }
        const prompt = promptsOf(base, role.id);
        const inputs = inputsOf(base, role.id);
        if (others.some((m) => prompt.includes(m))) cell = "prompt";
        else if (others.some((m) => inputs.includes(m))) cell = "delivered";
        else cell = own ? "own" : "none";
      }
      cells[row.key][role.id] = cell;
    }
  }

  return { topology: { id: recipe.id, name: recipe.name }, roles, rows, cells };
}

const GLYPH: Record<SightCell, string> = { prompt: "●", delivered: "○", none: "·", own: "own" };
const KIND: Record<SightRow["provenance"], string> = { given: "›", measured: "■", written: "“", "measured or written": "■“" };

/** The matrix as text: one column per role, in the drawn order. */
export function renderSight(m: SightMatrix): string {
  const width = Math.max(12, ...m.roles.map((r) => r.name.length + 2));
  const labelWidth = 24;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length));
  const lines: string[] = [];
  lines.push(`${m.topology.name} (${m.topology.id}): what each role sees, measured with a mock model and marked inputs`);
  lines.push("");
  lines.push(pad("", labelWidth) + m.roles.map((r) => pad(r.name, width)).join("").trimEnd());
  for (const row of m.rows) {
    const label = pad(`${KIND[row.provenance]} ${row.label}`, labelWidth);
    lines.push(label + m.roles.map((r) => pad(GLYPH[m.cells[row.key][r.id]], width)).join("").trimEnd());
  }
  lines.push("");
  lines.push("tools offered");
  for (const r of m.roles) {
    const tools = r.tools === null ? "(no model call)" : r.tools.length ? r.tools.join(", ") : "none";
    lines.push(`  ${pad(r.name, width)}${tools}`);
  }
  lines.push("");
  lines.push(`turns: ${m.roles.map((r) => `${r.name} ${r.turns}`).join(", ")}`);
  lines.push("");
  lines.push("● reaches its prompt   ○ delivered, not in its prompt   · never reaches it   own: this role writes it");
  lines.push("› from you   ■ measured by the lab   “ written by a model");
  return lines.join("\n") + "\n";
}
