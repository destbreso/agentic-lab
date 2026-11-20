// ============================================
// A benchmark spec: the question, the arms, the model, the budget and the rule
// ============================================
// Every experiment has the direct arm (the model asked once, no tools), which
// no spec can remove, and the baselines, the Ralph Loop unless the spec says
// baselines: []. Every role of every arm runs on the one model the spec
// names, so the arms differ by their topology alone.

import { readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getRecipe, parseRule, readTopologyFile, describeIssue, type Topology } from "jig-core";
import { FileProblems, describeIssues, parseText, readParsed, showPath, type ParsedFile } from "./document.js";
import { loadTaskSet, subset, type TaskSet } from "./taskset.js";

export const DIRECT = "direct";
export const DEFAULT_BASELINE = "ralph-loop";

const rule = z.string().refine((r) => parseRule(r) !== null, "a rule looks like Shell(python3 *), Write(src/**) or Read(./.env)");

const armSchema = z.union([z.string().min(1), z.object({ topology: z.string().min(1), label: z.string().min(1).optional() }).strict()]);

const specSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "a name is letters, digits, dots, dashes and underscores (it names the output folder)"),
    question: z.string().min(1),
    tasks: z.union([z.string().min(1), z.object({ file: z.string().min(1), only: z.array(z.string().min(1)).min(1).optional() }).strict()]),
    arms: z.array(armSchema).default([]),
    baselines: z.array(armSchema).default([DEFAULT_BASELINE]),
    model: z.string().regex(/^[^/\s]+\/\S+$/, "a model is <provider>/<model>, as ollama/qwen2.5:7b"),
    repetitions: z.number().int().min(1),
    budget: z.object({ tokens: z.number().int().positive(), rounds: z.number().int().positive().optional() }).strict(),
    permissions: z
      .object({
        mode: z.enum(["acceptEdits", "default", "plan"]).default("acceptEdits"),
        allow: z.array(rule).default([]),
        deny: z.array(rule).default([]),
      })
      .strict()
      .default({}),
    concurrency: z.number().int().min(1).default(1),
    verdict_from: z.enum(["measured", "model"]).default("measured"),
    count_fallbacks: z.boolean().default(false),
    rule: z.object({ margin: z.number().gt(0).lt(1).optional() }).strict().default({}),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.arms.length + s.baselines.length === 0) ctx.addIssue({ code: "custom", path: ["arms"], message: "name at least one arm or baseline to compare with the direct arm" });
  });

export type SpecData = z.infer<typeof specSchema>;

export type ArmKind = "direct" | "baseline" | "arm";

/** What an arm is, as the lock and the results keep it. */
export interface ArmInfo {
  /** Unique in the experiment: "direct", a built-in topology's id, or a file topology's id. */
  key: string;
  label: string;
  kind: ArmKind;
  /** The topology's id; null for the direct arm. */
  topology: string | null;
  /** "built in", or the topology file's path relative to the spec. */
  source: string;
}

export interface Arm extends ArmInfo {
  /** The definition to run; absent for the direct arm. */
  definition?: Topology;
  /** A topology file's absolute path, for the run's record (so jig replay can draw it). */
  definitionPath?: string;
}

export interface LoadedSpec {
  path: string;
  data: SpecData;
  taskSet: TaskSet;
  /** The task set's file, relative to the spec. */
  taskSetFile: string;
  /** Direct first, then the baselines, then the arms. */
  arms: Arm[];
  /** Each topology file's text, by its path relative to the spec: part of the hash. */
  topologyFiles: Record<string, string>;
  /** sha256 of the spec, the task set and the topology files as they will run. */
  hash: string;
  warnings: string[];
}

/** JSON with every object's keys sorted, so a hash never depends on key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function specHash(data: SpecData, taskSet: TaskSet, topologyFiles: Record<string, string>): string {
  return sha256(canonical({ spec: data, taskSet, topologyFiles }));
}

function validate(file: ParsedFile): SpecData {
  const raw = file.value;
  const problems: string[] = [];
  if (raw && typeof raw === "object" && "direct" in raw) {
    problems.push(`direct${file.lineOf(["direct"]) ? ` (line ${file.lineOf(["direct"])})` : ""}: the direct arm is part of every experiment, and a spec cannot remove or configure it`);
  }
  const rest = raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "direct")) : raw;
  const parsed = specSchema.safeParse(rest);
  if (!parsed.success) problems.push(...describeIssues(file, parsed.error.issues));
  if (problems.length) throw new FileProblems(file.path, problems);
  return parsed.data!;
}

async function resolveArm(entry: z.infer<typeof armSchema>, kind: ArmKind, at: Array<string | number>, file: ParsedFile, dir: string, files: Record<string, string>, warnings: string[]): Promise<Arm> {
  const where = `${showPath(at)}${file.lineOf(at) ? ` (line ${file.lineOf(at)})` : ""}`;
  const arg = typeof entry === "string" ? entry : entry.topology;
  if (arg === DIRECT) throw new FileProblems(file.path, [`${where}: the direct arm is always there; it is not listed among the ${kind === "baseline" ? "baselines" : "arms"}`]);
  const looksLikeFile = /[\\/]|\.(ya?ml|json)$/i.test(arg);
  let definition: Topology | undefined;
  let source = "built in";
  let definitionPath: string | undefined;
  if (looksLikeFile) {
    definitionPath = resolve(dir, arg);
    let text: string;
    try {
      text = await readFile(definitionPath, "utf-8");
    } catch {
      throw new FileProblems(file.path, [`${where}: no topology file ${arg}`]);
    }
    try {
      const read = await readTopologyFile(definitionPath);
      definition = read.topology;
      for (const w of read.warnings) warnings.push(`${arg}: ${describeIssue(w)}`);
    } catch (e) {
      throw new FileProblems(file.path, [`${where}: ${arg} is not a topology Jig can read: ${(e as Error).message.split("\n")[0]}`]);
    }
    source = relative(dir, definitionPath) || basename(definitionPath);
    files[source] = text;
  } else {
    definition = getRecipe(arg);
    if (!definition) throw new FileProblems(file.path, [`${where}: "${arg}" is not a built-in topology, and does not look like a file (.yaml or .json)`]);
  }
  return {
    key: definition.id,
    label: typeof entry === "string" ? definition.name : (entry.label ?? definition.name),
    kind,
    topology: definition.id,
    source,
    definition,
    ...(definitionPath ? { definitionPath } : {}),
  };
}

export function directArm(): Arm {
  return { key: DIRECT, label: "Direct", kind: "direct", topology: null, source: "one model call, no tools" };
}

/** Read and validate a spec, its task set and its topologies; every problem at its path and line. */
export async function loadSpec(path: string): Promise<LoadedSpec> {
  const full = resolve(path);
  const file = await readParsed(full);
  return loadSpecFrom(file);
}

export async function loadSpecText(text: string, path: string): Promise<LoadedSpec> {
  return loadSpecFrom(parseText(text, resolve(path)));
}

async function loadSpecFrom(file: ParsedFile): Promise<LoadedSpec> {
  const data = validate(file);
  const dir = dirname(file.path);
  const tasksRef = typeof data.tasks === "string" ? { file: data.tasks } : data.tasks;
  const taskSetPath = resolve(dir, tasksRef.file);
  const { set } = await loadTaskSet(taskSetPath);
  let taskSet: TaskSet;
  try {
    taskSet = subset(set, tasksRef.only);
  } catch (e) {
    const line = file.lineOf(["tasks", "only"]);
    throw new FileProblems(file.path, (e as FileProblems).problems.map((p) => `tasks.only${line ? ` (line ${line})` : ""}: ${p}`));
  }
  const warnings: string[] = [];
  const topologyFiles: Record<string, string> = {};
  const arms: Arm[] = [directArm()];
  for (const [i, b] of data.baselines.entries()) arms.push(await resolveArm(b, "baseline", ["baselines", i], file, dir, topologyFiles, warnings));
  for (const [i, a] of data.arms.entries()) arms.push(await resolveArm(a, "arm", ["arms", i], file, dir, topologyFiles, warnings));
  const seen = new Map<string, Arm>();
  for (const arm of arms) {
    const before = seen.get(arm.key);
    if (before) throw new FileProblems(file.path, [`${arm.kind === "baseline" ? "baselines" : "arms"}: ${arm.key} is listed twice (also as ${before.kind === "baseline" ? "a baseline" : "an arm"}): an arm runs once per task and repetition`]);
    seen.set(arm.key, arm);
  }
  const taskSetFile = relative(dir, taskSetPath) || basename(taskSetPath);
  return { path: file.path, data, taskSet, taskSetFile, arms, topologyFiles, hash: specHash(data, taskSet, topologyFiles), warnings };
}

export const armInfo = (a: Arm): ArmInfo => ({ key: a.key, label: a.label, kind: a.kind, topology: a.topology, source: a.source });

/** Whether the direct arm applies to a task: only when the task says where its answer goes. */
export const directApplies = (task: { direct?: unknown }) => task.direct !== undefined;
