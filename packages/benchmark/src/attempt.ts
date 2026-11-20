// ============================================
// One attempt: an arm on a task, once, in a fresh workspace
// ============================================
// A topology arm runs through jig-core's TopologyRun with the task's checks,
// the spec's budget and permissions, nobody to ask. The direct arm is one
// model call with the task and its starting files, no tools: its answer is
// written where the task says, and the same checks decide. Either way the
// workspace is a temporary folder, removed when the attempt ends.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_MAX_TOKENS,
  MeasuredChecker,
  TopologyRun,
  coreVersion,
  createDefaultToolkit,
  environmentBlock,
  mergeRules,
  type LLMProvider,
  type MeasuredCheckRun,
  type RunEvent,
} from "jig-core";
import type { AttemptRecord } from "./results.js";
import type { Arm, SpecData } from "./spec.js";
import type { BenchTask, DirectConvention } from "./taskset.js";

export interface AttemptInput {
  spec: SpecData;
  arm: Arm;
  task: BenchTask;
  repetition: number;
  provider: LLMProvider;
  /** Where each run's records go: <runsDir>/<run id>/. */
  runsDir: string;
  /** Where the attempt's workspace is made (default: the system's temporary folder). */
  workRoot?: string;
  signal?: AbortSignal;
}

export interface AttemptOutput {
  record: AttemptRecord;
  /** Stopped by the person: not recorded, so a rerun does it again. */
  interrupted: boolean;
}

export type AttemptRunner = (input: AttemptInput) => Promise<AttemptOutput>;

const runIdOf = (arm: string, task: string, repetition: number) => `${arm}.${task}.${repetition}.${Date.now().toString(36)}`;

async function workspaceFor(task: BenchTask, root = tmpdir()): Promise<string> {
  const ws = await mkdtemp(join(root, "jig-benchmark-"));
  for (const [path, content] of Object.entries(task.files)) {
    const full = join(ws, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return ws;
}

function baseRecord(input: AttemptInput, runId: string): AttemptRecord {
  return {
    arm: input.arm.key,
    kind: input.arm.kind,
    topology: input.arm.topology,
    task: input.task.id,
    repetition: input.repetition,
    run_id: runId,
    outcome: null,
    checks_passed: 0,
    checks_total: input.task.checks.length,
    tokens: { input: 0, output: 0, total: 0 },
    duration_ms: 0,
    rounds: null,
    fallbacks: [],
    call_errors: 0,
    model: input.spec.model,
    core: coreVersion(),
    at: new Date().toISOString(),
  };
}

const checkCounts = (m: MeasuredCheckRun | undefined, total: number) => ({ checks_passed: m ? m.results.filter((r) => r.passed).length : 0, checks_total: m?.results.length ?? total });

/** The default runner: a topology through TopologyRun, the direct arm through one call. */
export const runAttempt: AttemptRunner = (input) => (input.arm.kind === "direct" ? runDirect(input) : runTopologyAttempt(input));

export async function runTopologyAttempt(input: AttemptInput): Promise<AttemptOutput> {
  const { spec, arm, task } = input;
  if (!arm.definition) throw new Error(`${arm.key} has no topology to run`);
  const runId = runIdOf(arm.key, task.id, input.repetition);
  const record = baseRecord(input, runId);
  const ws = await workspaceFor(task, input.workRoot);
  try {
    const run = new TopologyRun({
      provider: input.provider,
      tools: createDefaultToolkit(undefined, { unescapeNewlines: true }),
      topology: arm.definition,
      workingDir: ws,
      tokenBudget: spec.budget.tokens,
      ...(spec.budget.rounds ? { maxRounds: spec.budget.rounds } : {}),
      // The pause between rounds is for a person watching; nobody is.
      delayMs: 0,
      verdictFrom: spec.verdict_from,
      memoryScope: "off",
      environment: environmentBlock(ws),
      skipUnverifiable: true,
      // Only the spec's rules, never the person's own files: the experiment is what its spec says.
      permissions: {
        settings: { mode: spec.permissions.mode, rules: mergeRules({ allow: spec.permissions.allow, deny: spec.permissions.deny }), workingDirs: [ws] },
        grants: { edits: false, rules: [] },
      },
      runId,
      runInfo: { model: spec.model, tags: [arm.key, "jig-benchmark"], config: { source: "jig-benchmark", task: task.id, repetition: input.repetition } },
    });
    let end: Extract<RunEvent, { type: "run:end" }> | undefined;
    let limits: { rounds: number; tokenBudget?: number } | undefined;
    run.on("event", (e) => {
      if (e.type === "run:end") end = e;
      else if (e.type === "run:start") limits = e.limits;
      else if (e.type === "call" && e.error) record.call_errors++;
    });
    const onAbort = () => run.stop("the benchmark was interrupted");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
    let result;
    try {
      result = await run.run({ task: task.task, checks: task.checks, checkFiles: task.checkFiles });
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
    }
    if (result.outcome === "stopped" && input.signal?.aborted) return { record, interrupted: true };
    Object.assign(record, {
      outcome: result.outcome,
      reason: result.reason,
      ...checkCounts(result.measured, task.checks.length),
      tokens: { input: end?.tokens.inputTokens ?? 0, output: end?.tokens.outputTokens ?? 0, total: end?.tokens.totalTokens ?? 0 },
      duration_ms: end?.durationMs ?? 0,
      rounds: end?.rounds ?? result.result.totalCycles,
      fallbacks: end?.fallbacks ?? [],
    });
    // The CLI's own layout for a run's folder, so jig replay can read it once it is pointed there.
    const dir = join(input.runsDir, runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "steps.json"), JSON.stringify(result.steps, null, 1));
    await writeFile(
      join(dir, "record.json"),
      JSON.stringify(
        {
          runId,
          outcome: result.outcome,
          reason: result.reason,
          topology: arm.topology,
          ...(arm.definitionPath ? { definition: arm.definitionPath } : {}),
          task: task.task,
          provider: spec.model.slice(0, spec.model.indexOf("/")),
          model: spec.model.slice(spec.model.indexOf("/") + 1),
          ...(limits ? { limits } : {}),
          benchmark: { arm: arm.key, task: task.id, repetition: input.repetition },
        },
        null,
        2,
      ),
    );
    return { record, interrupted: false };
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

// ---- The direct arm ----

/** What the direct arm is told about where its answer goes: the lab writes it, and says how. */
function conventionLine(direct: DirectConvention): string {
  return "answerFile" in direct
    ? `The last line of your reply will be written to ${direct.answerFile} for you, trimmed: put your final answer alone on the last line.`
    : `The last fenced code block of your reply (or the whole reply, when it has none) will be written to ${direct.file} for you: give the complete file in one code block.`;
}

/** The one message the direct arm gets: the task, its starting files, and how its answer is applied. */
export function directPrompt(task: BenchTask): string {
  if (!task.direct) throw new Error(`${task.id} has no direct block: the direct arm does not apply to it`);
  const files = Object.entries(task.files);
  return [
    task.task.trim(),
    ...(files.length ? ["", "The files you start from:", ...files.map(([p, c]) => `\n${p}:\n\`\`\`\n${c.replace(/\n$/, "")}\n\`\`\``)] : []),
    "",
    `You have no tools: you cannot write files or run commands, and you get one reply. ${conventionLine(task.direct)}`,
  ].join("\n");
}

/** The last non-empty line, trimmed. */
export function lastLine(reply: string): string {
  return (
    reply
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

/** The content of the reply's last fenced code block, or null when it has none. */
export function lastCodeBlock(reply: string): string | null {
  let last: string | null = null;
  for (const m of reply.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)) last = m[1]!;
  return last;
}

/** What the lab writes for the direct arm, and where: the answer applied, nothing more. */
export function directWrite(direct: DirectConvention, reply: string): { path: string; content: string } {
  if ("answerFile" in direct) return { path: direct.answerFile, content: `${lastLine(reply)}\n` };
  return { path: direct.file, content: lastCodeBlock(reply) ?? reply };
}

const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

export async function runDirect(input: AttemptInput): Promise<AttemptOutput> {
  const { spec, task } = input;
  if (!task.direct) throw new Error(`${task.id} has no direct block: the direct arm does not apply to it`);
  const runId = runIdOf("direct", task.id, input.repetition);
  const record = baseRecord(input, runId);
  const prompt = directPrompt(task);
  const started = Date.now();
  let reply = "";
  let callError: string | undefined;
  let answeredBy = "";
  try {
    const res = await input.provider.chat({
      messages: [{ role: "user", content: prompt }],
      maxTokens: Math.min(DEFAULT_MAX_TOKENS, spec.budget.tokens),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    reply = res.message.content ?? "";
    answeredBy = res.model;
    record.tokens = { input: res.usage.inputTokens, output: res.usage.outputTokens, total: res.usage.totalTokens };
  } catch (e) {
    if (isAbort(e) && input.signal?.aborted) return { record, interrupted: true };
    // A call that failed gave no answer: the checks run on nothing, as a role's failed call would leave its run.
    callError = (e as Error).message;
    record.call_errors = 1;
  }
  const ws = await workspaceFor(task, input.workRoot);
  try {
    const checker = new MeasuredChecker({ workspace: ws, checks: task.checks, checkFiles: task.checkFiles });
    await checker.capture();
    const written = directWrite(task.direct, reply);
    const target = join(ws, written.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, written.content);
    const measured = await checker.run({ label: "final", answer: reply });
    Object.assign(record, {
      outcome: measured.passed ? "passed" : "failed",
      reason: callError ? `the model call failed: ${callError}` : measured.passed ? "the measured check passed" : `the measured check failed (${measured.results.filter((r) => !r.passed).map((r) => r.name).join(", ")})`,
      ...checkCounts(measured, task.checks.length),
      duration_ms: Date.now() - started,
    });
    const dir = join(input.runsDir, runId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "direct.json"),
      JSON.stringify({ runId, task: task.id, repetition: input.repetition, model: spec.model, answeredBy, prompt, reply, ...(callError ? { callError } : {}), written, measured, tokens: record.tokens }, null, 2),
    );
    return { record, interrupted: false };
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}
