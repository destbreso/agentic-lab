// ============================================
// Task sets: tasks, the files each starts from, and the checks that say whether it was done
// ============================================
// Every task has at least one check, a shell command the lab runs after the
// run in a copy of the workspace no role can write (jig-core's
// MeasuredChecker): the benchmark measures, it never judges. A check file
// named by its path is one of the task's files, put back as it was before
// every check; one given with its content exists only where the checks run,
// so no role can read it (a hidden test, an expected answer).

import { isAbsolute } from "node:path";
import { z } from "zod";
import type { CheckFile, TaskCheck } from "jig-core";
import { parseText, problemsOf, readParsed, FileProblems, type ParsedFile } from "./document.js";

const inside = z
  .string()
  .min(1)
  .refine((p) => !isAbsolute(p) && !p.split(/[\\/]/).includes(".."), "must be a path inside the workspace: relative, without ..");

const checkSchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1).optional(), command: z.string().min(1), timeout_ms: z.number().int().positive().optional() }).strict(),
]);

const directSchema = z
  .object({ answer_file: inside.optional(), file: inside.optional() })
  .strict()
  .refine((d) => Number(d.answer_file !== undefined) + Number(d.file !== undefined) === 1, "give answer_file or file, one of the two");

const taskSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "an id is letters, digits, dots, dashes and underscores"),
    task: z.string().min(1),
    files: z.record(inside, z.string()).default({}),
    checks: z.array(checkSchema).min(1, "a task needs at least one check: the lab measures whether it was done, it does not judge"),
    check_files: z.array(z.union([inside, z.object({ path: inside, content: z.string() }).strict()])).default([]),
    direct: directSchema.optional(),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

const setSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    tasks: z.array(taskSchema).min(1, "a task set needs at least one task"),
  })
  .strict()
  .superRefine((set, ctx) => {
    const seen = new Map<string, number>();
    set.tasks.forEach((t, i) => {
      if (seen.has(t.id)) ctx.addIssue({ code: "custom", path: ["tasks", i, "id"], message: `"${t.id}" is already the id of tasks[${seen.get(t.id)}]` });
      else seen.set(t.id, i);
      t.check_files.forEach((f, j) => {
        if (typeof f === "string" && !(f in t.files)) {
          ctx.addIssue({ code: "custom", path: ["tasks", i, "check_files", j], message: `"${f}" is not one of the task's files: give it as { path, content } for a file only the checks see` });
        }
      });
      const target = t.direct?.answer_file ?? t.direct?.file;
      const guarded = t.check_files.map((f) => (typeof f === "string" ? f : f.path));
      if (target && guarded.includes(target)) {
        ctx.addIssue({ code: "custom", path: ["tasks", i, "direct"], message: `the direct arm's answer goes to "${target}", a check file: the lab puts check files back before it checks, so the answer would be lost` });
      }
    });
  });

/** How the direct arm's answer reaches the task's checks. */
export type DirectConvention = { answerFile: string } | { file: string };

export interface BenchTask {
  id: string;
  task: string;
  /** The workspace every attempt starts from: path to content. */
  files: Record<string, string>;
  checks: Array<Extract<TaskCheck, { kind: "command" }>>;
  checkFiles: CheckFile[];
  /** Absent: the direct arm does not apply to this task. */
  direct?: DirectConvention;
  tags: string[];
}

export interface TaskSet {
  name: string;
  description: string;
  tasks: BenchTask[];
}

function normalise(raw: z.infer<typeof setSchema>): TaskSet {
  return {
    name: raw.name,
    description: raw.description,
    tasks: raw.tasks.map((t) => ({
      id: t.id,
      task: t.task,
      files: t.files,
      checks: t.checks.map((c, i) =>
        typeof c === "string"
          ? { name: `check ${i + 1}`, kind: "command" as const, command: c }
          : { name: c.name ?? `check ${i + 1}`, kind: "command" as const, command: c.command, ...(c.timeout_ms ? { timeoutMs: c.timeout_ms } : {}) },
      ),
      checkFiles: t.check_files,
      ...(t.direct ? { direct: t.direct.answer_file !== undefined ? { answerFile: t.direct.answer_file } : { file: t.direct.file! } } : {}),
      tags: t.tags,
    })),
  };
}

export function taskSetFrom(file: ParsedFile): TaskSet {
  const parsed = setSchema.safeParse(file.value);
  if (!parsed.success) throw problemsOf(file, parsed.error);
  return normalise(parsed.data);
}

/** Validate a task set's text; every problem is reported at its path and line. */
export function parseTaskSet(text: string, path = "task set"): TaskSet {
  return taskSetFrom(parseText(text, path));
}

export async function loadTaskSet(path: string): Promise<{ set: TaskSet; text: string }> {
  const file = await readParsed(path);
  return { set: taskSetFrom(file), text: file.text };
}

/** Keep only the tasks named, in the set's order; an id the set lacks is an error. */
export function subset(set: TaskSet, only: string[] | undefined, where = "tasks.only"): TaskSet {
  if (!only) return set;
  const ids = new Set(set.tasks.map((t) => t.id));
  const missing = only.filter((id) => !ids.has(id));
  if (missing.length) throw new FileProblems(where, missing.map((id) => `"${id}" is not a task of ${set.name} (its tasks: ${[...ids].join(", ")})`));
  const wanted = new Set(only);
  return { ...set, tasks: set.tasks.filter((t) => wanted.has(t.id)) };
}
