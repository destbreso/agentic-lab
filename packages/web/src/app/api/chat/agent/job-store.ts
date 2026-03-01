/**
 * job-store.ts — Shared process-wide store for active agent jobs and nudge queues
 *
 * CRITICAL: This module uses `globalThis` to guarantee that ALL route handlers
 * (agent, nudge, cancel) share the SAME Map instances, even if Next.js/Turbopack
 * creates separate module instances for each route file during bundling.
 *
 * Without this, each route gets its own copy of the Maps, so:
 *   - nudge/route.ts can't find the job → "No active run found"
 *   - cancel/route.ts can't signal the abort → job keeps running
 *
 * By attaching the Maps to `globalThis`, they persist as true process-level
 * singletons regardless of how many times the module is instantiated.
 */

import { EventEmitter } from "events";
import type { ChatMessage, NudgePriority } from "@agentic-lab/core";

/* ─── Types ──────────────────────────────────────── */

export interface ActiveJob {
  promise: Promise<void>;
  emitter: EventEmitter;
  abort: AbortController;
}

export interface WebNudge {
  id: string;
  message: string;
  priority: NudgePriority;
  createdAt: string;
}

/** Sentinel error thrown when a job is cancelled by the user */
export class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled by user");
    this.name = "JobCancelledError";
  }
}

/* ─── Singleton Maps via globalThis ──────────────── */

const g = globalThis as unknown as {
  __agenticLabActiveJobs?: Map<string, ActiveJob>;
  __agenticLabNudgeQueues?: Map<string, WebNudge[]>;
};

g.__agenticLabActiveJobs ??= new Map();
g.__agenticLabNudgeQueues ??= new Map();

const activeJobs: Map<string, ActiveJob> = g.__agenticLabActiveJobs;
const nudgeQueues: Map<string, WebNudge[]> = g.__agenticLabNudgeQueues;

/* ─── Job Management ─────────────────────────────── */

/** Register a newly-started job so other routes (nudge, cancel) can find it */
export function registerJob(runId: string, job: ActiveJob): void {
  activeJobs.set(runId, job);
}

/** Remove a finished/failed/cancelled job from the store */
export function unregisterJob(runId: string): void {
  activeJobs.delete(runId);
  nudgeQueues.delete(runId);
}

/** Check whether a run is still active (used by nudge & cancel routes) */
export function getActiveJob(runId: string): ActiveJob | null {
  return activeJobs.get(runId) ?? null;
}

/**
 * Cancel a running job by signalling its AbortController.
 * Returns true if the abort was signalled, false if the job wasn't found.
 */
export function cancelJob(runId: string): boolean {
  const job = activeJobs.get(runId);
  if (!job) return false;
  job.abort.abort();
  return true;
}

/* ─── Nudge Queue Management ─────────────────────── */

/** Enqueue a nudge for a running agent job (called from the nudge API route) */
export function enqueueNudge(
  runId: string,
  message: string,
  priority: NudgePriority = "normal",
): WebNudge {
  const nudge: WebNudge = {
    id: `nudge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    message,
    priority,
    createdAt: new Date().toISOString(),
  };
  const queue = nudgeQueues.get(runId) || [];
  queue.push(nudge);
  nudgeQueues.set(runId, queue);

  // Notify the job's SSE stream so the UI can show the nudge was queued
  const job = activeJobs.get(runId);
  if (job) {
    job.emitter.emit("sse", {
      event: "steering:nudge",
      nudge,
    });
  }

  return nudge;
}

/** Drain all nudges (or only critical ones) for a given run */
export function drainNudges(runId: string, onlyCritical = false): WebNudge[] {
  const queue = nudgeQueues.get(runId);
  if (!queue || queue.length === 0) return [];

  if (onlyCritical) {
    const critical = queue.filter((n) => n.priority === "critical");
    if (critical.length === 0) return [];
    nudgeQueues.set(
      runId,
      queue.filter((n) => n.priority !== "critical"),
    );
    return critical;
  }

  // Drain all
  nudgeQueues.set(runId, []);
  return queue;
}

/** Format nudges as a ChatMessage to inject into LLM context */
export function formatNudgesAsMessage(nudges: WebNudge[]): ChatMessage {
  const PRIORITY_TAG: Record<NudgePriority, string> = {
    low: "📌 LOW",
    normal: "📡 NORMAL",
    high: "⚠️ HIGH",
    critical: "🚨 CRITICAL",
  };
  const lines = nudges.map((n) => `[${PRIORITY_TAG[n.priority]}] ${n.message}`);
  return {
    role: "user" as const,
    content: [
      "--- STEERING NUDGE FROM HUMAN OPERATOR ---",
      "The following tactical instruction(s) have been injected mid-loop.",
      "Adjust your current approach accordingly without losing progress.",
      "",
      ...lines,
      "",
      "--- END STEERING NUDGE ---",
    ].join("\n"),
  };
}
