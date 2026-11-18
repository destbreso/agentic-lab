// ============================================
// Run Registry
// ============================================
// The sessions running in this process, by run id, so a request that is not
// the one running the session (a nudge, a cancel) can reach it. Kept on
// globalThis: Next.js may load this module once per route.

import type { NudgePriority } from "../types/loop.js";
import type { AgentSession, SteeringNote } from "./agent-session.js";

const g = globalThis as unknown as { __agenticLabRuns?: Map<string, AgentSession> };
g.__agenticLabRuns ??= new Map();
const runs: Map<string, AgentSession> = g.__agenticLabRuns;

export function registerRun(runId: string, session: AgentSession): void {
  runs.set(runId, session);
}

export function unregisterRun(runId: string): void {
  runs.delete(runId);
}

export function getRun(runId: string): AgentSession | undefined {
  return runs.get(runId);
}

export function listRunIds(): string[] {
  return [...runs.keys()];
}

/** Steer a running session; null when no such run is active. */
export function steerRun(runId: string, message: string, priority: NudgePriority = "normal"): SteeringNote | null {
  const session = runs.get(runId);
  return session ? session.steer(message, priority) : null;
}

/** Stop a running session; false when no such run is active. */
export function stopRun(runId: string, reason?: string): boolean {
  const session = runs.get(runId);
  if (!session) return false;
  session.stop(reason);
  return true;
}
