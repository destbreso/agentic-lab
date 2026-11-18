/**
 * job-store.ts: the agent jobs running in this process, for the routes that
 * did not start them (cancel, and a reconnecting page).
 *
 * The map lives on `globalThis` so every route handler shares it, even when
 * Next.js loads this module once per route. Steering goes through the core's
 * run registry instead (steerRun), which reaches the session itself.
 */

import { EventEmitter } from "events";

export interface ActiveJob {
  promise: Promise<void>;
  emitter: EventEmitter;
  abort: AbortController;
}

const g = globalThis as unknown as { __agenticLabActiveJobs?: Map<string, ActiveJob> };
g.__agenticLabActiveJobs ??= new Map();
const activeJobs: Map<string, ActiveJob> = g.__agenticLabActiveJobs;

/** Register a newly-started job so other routes can find it */
export function registerJob(runId: string, job: ActiveJob): void {
  activeJobs.set(runId, job);
}

/** Remove a finished, failed or cancelled job */
export function unregisterJob(runId: string): void {
  activeJobs.delete(runId);
}

/** The job for a run, while it is active */
export function getActiveJob(runId: string): ActiveJob | null {
  return activeJobs.get(runId) ?? null;
}

/** Cancel a running job; false when it is not in this process */
export function cancelJob(runId: string): boolean {
  const job = activeJobs.get(runId);
  if (!job) return false;
  job.abort.abort();
  return true;
}
