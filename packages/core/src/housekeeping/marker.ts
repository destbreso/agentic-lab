// ============================================
// The marker: how Jig knows a folder or a file is its own
// ============================================
// Every folder Jig makes to throw away later (a run's record, a temp copy, a
// trash entry) gets a .jig-owned.json when it is made; a session file carries
// the same fields under "jigOwned". Housekeeping acts only on what carries one
// of the right kind, so a folder Jig did not make is never a candidate.

import { hostname, uptime } from "node:os";
import * as path from "node:path";
import { coreVersion } from "../version.js";

/** The marker's file name, inside a folder Jig made. */
export const MARKER = ".jig-owned.json";
/** The field that holds the marker inside a session file. */
export const SESSION_MARKER_FIELD = "jigOwned";

export type OwnedKind = "temp" | "run" | "session" | "trash";

export interface OwnedMarker {
  kind: OwnedKind;
  /** What it is, in words, for a person who opens it. */
  purpose: string;
  /** The process that made it (a session: the one that last wrote it). */
  pid: number;
  host: string;
  /** When the machine started, in seconds: a pid from another boot is another process. */
  boot?: number;
  createdAt: string;
  /** The jig-core version that wrote it. */
  version: string;
  /** A run the person pinned with jig clean --keep. */
  keep?: boolean;
  /** Brought back from the trash: its age counts from here. */
  restoredAt?: string;
  /** Marked by jig clean --adopt, not when it was made. */
  adopted?: boolean;
  /** A trash entry: when it was moved, from which folder, and the name it had there. */
  trashedAt?: string;
  from?: "runs" | "sessions";
  name?: string;
}

/** A name that is one path component Jig could have made: no separators, no dots in front, nothing that walks up. */
export function isPlainName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith(".") &&
    !/[\\/\0]/.test(name) &&
    path.basename(name) === name
  );
}

export function newMarker(kind: OwnedKind, purpose: string, extra: Partial<OwnedMarker> = {}): OwnedMarker {
  return { kind, purpose, pid: process.pid, host: hostname(), boot: bootTime(), createdAt: new Date().toISOString(), version: coreVersion(), ...extra };
}

/** When this machine started, in whole seconds. */
export function bootTime(): number {
  return Math.round(Date.now() / 1000 - uptime());
}

/** Whether the process a marker names is still running: same machine, same boot, and its pid alive. */
export function markerProcessRunning(m: OwnedMarker, alive: (pid: number) => boolean): boolean {
  if (m.host !== hostname()) return false;
  // Uptime drifts a little against the clock; a reboot moves it by far more.
  if (typeof m.boot === "number" && Math.abs(m.boot - bootTime()) > 120) return false;
  return m.pid === process.pid || alive(m.pid);
}

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** The marker in a value, or null unless it is a well-formed marker of this kind. */
export function asMarker(value: unknown, kind: OwnedKind): OwnedMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (m.kind !== kind) return null;
  if (typeof m.purpose !== "string" || typeof m.host !== "string" || typeof m.version !== "string" || !isTime(m.createdAt)) return null;
  if (!Number.isInteger(m.pid) || (m.pid as number) <= 0) return null;
  if (m.boot !== undefined && typeof m.boot !== "number") return null;
  if (m.restoredAt !== undefined && !isTime(m.restoredAt)) return null;
  if (kind === "trash" && (!isTime(m.trashedAt) || (m.from !== "runs" && m.from !== "sessions") || !isPlainName(m.name))) return null;
  return m as unknown as OwnedMarker;
}

/** The marker a session file is written with. */
export function sessionMarker(createdAt: string): OwnedMarker {
  return newMarker("session", "a session of jig: its settings and conversation, opened again by jig --resume", { createdAt });
}
