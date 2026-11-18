// ============================================
// Reading a task with its checks
// ============================================
// A task file is JSON: the task, its checks and the files they depend on.
// The same schema validates checks that arrive in an API request.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { CheckFile, TaskCheck } from "./types.js";

const condition = {
  equals: z.string().optional(),
  contains: z.string().optional(),
  matches: z.string().optional(),
};

export const taskCheckSchema = z.discriminatedUnion("kind", [
  z.object({ name: z.string().min(1), kind: z.literal("command"), command: z.string().min(1), timeoutMs: z.number().positive().optional() }),
  z.object({ name: z.string().min(1), kind: z.literal("file"), path: z.string().min(1), ...condition }),
  z.object({ name: z.string().min(1), kind: z.literal("answer"), ...condition }),
]);

export const checkFileSchema = z.union([z.string().min(1), z.object({ path: z.string().min(1), content: z.string() })]);

export const taskFileSchema = z.object({
  task: z.string().min(1),
  checks: z.array(taskCheckSchema).default([]),
  checkFiles: z.array(checkFileSchema).default([]),
});

export interface TaskFile {
  task: string;
  checks: TaskCheck[];
  checkFiles: CheckFile[];
}

/** Validate a task with its checks; the error names the path that is wrong. */
export function parseTask(value: unknown): TaskFile {
  const parsed = taskFileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`invalid task: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  return parsed.data as TaskFile;
}

/** Validate a list of checks (from an API request, say). */
export function parseChecks(value: unknown): TaskCheck[] {
  return parseTask({ task: "-", checks: value ?? [] }).checks;
}

/** Read a task file (JSON). */
export async function loadTaskFile(path: string): Promise<TaskFile> {
  const text = await readFile(path, "utf-8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not JSON: ${(e as Error).message}`);
  }
  return parseTask(json);
}
