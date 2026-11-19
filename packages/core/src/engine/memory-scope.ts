// ============================================
// Memory scope: which earlier memories a run may recall
// ============================================
// A memory recalled from an unrelated task is written text from somewhere
// else, and it can steer a role as much as anything a model writes. The scope
// says how far back a run may reach:
//   off     recall nothing
//   run     only what this run wrote
//   task    only what runs of the same task wrote
//   session only what runs of the same session wrote (jig's conversation)
//   shared  everything in the namespace, across tasks (the old behaviour)
// Benchmarks and experiments recall nothing unless told otherwise.

import { createHash } from "node:crypto";

export type MemoryScope = "off" | "run" | "task" | "session" | "shared";

/** A short, stable key for a task: the same words give the same key. */
export function taskKey(task: string): string {
  const normalized = task.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/**
 * The namespace prefix a scope puts in front of every memory namespace a run
 * reads or writes, or null when the scope recalls nothing.
 */
export function scopePrefix(scope: MemoryScope, ids: { runId: string; task: string; sessionId?: string }): string[] | null {
  switch (scope) {
    case "off":
      return null;
    case "run":
      return ["run", ids.runId];
    case "task":
      return ["task", taskKey(ids.task)];
    case "session":
      // A run outside a session has nothing to share with: it reads only what it wrote.
      return ids.sessionId ? ["session", ids.sessionId] : ["run", ids.runId];
    case "shared":
      return [];
  }
}
