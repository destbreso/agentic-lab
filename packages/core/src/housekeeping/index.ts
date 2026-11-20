// ============================================
// Housekeeping: Jig cleans up what it leaves on disk, and only that
// ============================================
// When a session or jig run starts, housekeep() sweeps Jig's orphaned temp
// folders and applies the records policy (unless the config turns it off),
// and says what it did in a few words for the session's notes. Everything it
// touches goes through the guard (guard.ts); docs: the README's "What Jig
// keeps on disk" and Jig's own help.

import * as path from "node:path";
import { projectPath } from "../config/places.js";
import { formatBytes, sizeOf } from "./disk.js";
import { findOrphans, sweepTemp, type RemovedTemp } from "./temp.js";
import { appendLog, applyPlan, housekeepingSettings, planRecords, survey, type Applied, type HousekeepingSettings } from "./records.js";

export { MARKER, SESSION_MARKER_FIELD, isPlainName, newMarker, sessionMarker, type OwnedKind, type OwnedMarker } from "./marker.js";
export { TEMP_PREFIXES, type Candidate, type Root, type RootKind, type TempPrefix } from "./guard.js";
export { formatAge, formatBytes, pidAlive, sizeOf } from "./disk.js";
export { ORPHAN_AGE_MS, cloneTree, findOrphans, makeTempDir, removeTempDir, sweepTemp, withTempDir, type RemovedTemp, type TempOrphan, type TempScanOptions } from "./temp.js";
export {
  DEFAULT_HOUSEKEEPING,
  HOUSEKEEPING_LOG,
  KEEP_RECENT_RUNS,
  adoptRecords,
  appendLog,
  applyPlan,
  emptyTrash,
  ensureRunDir,
  housekeepingSettings,
  keepRun,
  planRecords,
  restoreRecord,
  runMarker,
  survey,
  type Applied,
  type HousekeepingSettings,
  type Plan,
  type PlannedDelete,
  type PlannedMove,
  type RecordEntry,
  type Survey,
  type TrashEntry,
} from "./records.js";

export interface HousekeepOptions {
  /** The config's housekeeping block, as written. */
  settings?: { [K in keyof HousekeepingSettings]?: unknown };
  now?: number;
  /** The temp folder to sweep (the system's by default). */
  tmpRoot?: string;
  alive?: (pid: number) => boolean;
  /** The session being opened: never moved, so its runs stay too. */
  openSession?: string;
}

export interface HousekeepResult {
  temp: RemovedTemp[];
  applied: Applied | null;
  /** What it did, in a few words, for the session's notes; empty when it did nothing. */
  notes: string[];
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The session's note on what housekeeping did. */
export function housekeepingNotes(r: Pick<HousekeepResult, "temp" | "applied">, settings: HousekeepingSettings): string[] {
  const notes: string[] = [];
  const moved = r.applied?.moved ?? [];
  if (moved.length) {
    const runs = moved.filter((m) => m.entry.kind === "run").length;
    const sessions = moved.length - runs;
    const what = [runs ? `${count(runs, "old run")}` : "", sessions ? count(sessions, "old session") : ""].filter(Boolean).join(" and ");
    const bytes = moved.reduce((n, m) => n + m.entry.bytes, 0);
    notes.push(`moved ${what}, ${formatBytes(bytes)}, to .jig/trash; deleted for good after ${settings.trashDays} days; jig clean --restore brings one back`);
  }
  const deleted = r.applied?.deleted ?? [];
  if (deleted.length) {
    const bytes = deleted.reduce((n, d) => n + d.entry.bytes, 0);
    notes.push(`deleted ${count(deleted.length, "entry", "entries")} of .jig/trash for good, ${formatBytes(bytes)}, after their ${settings.trashDays} days there`);
  }
  if (r.temp.length) notes.push(`deleted ${count(r.temp.length, "temp folder")} left by Jig processes that ended`);
  const failed = r.applied?.failed ?? [];
  if (failed.length) notes.push(`${count(failed.length, "record")} could not be moved or deleted: .jig/housekeeping.log says why`);
  return notes;
}

/** The startup pass: orphaned temp folders always, the records policy unless the config turns it off. Never throws. */
export async function housekeep(workingDir: string, o: HousekeepOptions = {}): Promise<HousekeepResult> {
  const project = path.resolve(workingDir);
  const settings = housekeepingSettings(o.settings);
  const log = (line: string) => appendLog(project, line);
  let temp: RemovedTemp[] = [];
  try {
    temp = (await sweepTemp({ ...(o.tmpRoot ? { root: o.tmpRoot } : {}), ...(o.now ? { now: o.now } : {}), ...(o.alive ? { alive: o.alive } : {}), log })).removed;
  } catch {
    /* a sweep that fails leaves everything where it was */
  }
  let applied: Applied | null = null;
  if (settings.auto) {
    try {
      const s = await survey(project, o.alive ? { alive: o.alive } : {});
      const now = o.now ?? Date.now();
      const plan = planRecords(s, settings, now, o.openSession ? { openSession: o.openSession } : {});
      if (plan.moves.length || plan.deletes.length) applied = await applyPlan(project, plan, new Date(now));
    } catch {
      /* the same */
    }
  }
  return { temp, applied, notes: housekeepingNotes({ temp, applied }, settings) };
}

export interface DiskReport {
  /** Everything in the project's .jig, in bytes. */
  jigBytes: number;
  trashBytes: number;
  /** Jig's temp folders left by processes that ended. */
  orphans: Array<{ path: string; bytes: number; pid: number; idleMs: number }>;
  /** Jig's temp folders still in use. */
  activeTemp: number;
}

/** What jig doctor shows: .jig's size, the trash's, and the orphaned temp folders. Reads only. */
export async function diskReport(workingDir: string, o: { tmpRoot?: string; now?: number; alive?: (pid: number) => boolean } = {}): Promise<DiskReport> {
  const [jigBytes, trashBytes] = await Promise.all([sizeOf(projectPath(workingDir)), sizeOf(projectPath(workingDir, "trash"))]);
  const scan = await findOrphans({ ...(o.tmpRoot ? { root: o.tmpRoot } : {}), ...(o.now ? { now: o.now } : {}), ...(o.alive ? { alive: o.alive } : {}) });
  const orphans = [];
  for (const x of scan.orphans) orphans.push({ path: x.path, bytes: await sizeOf(x.path), pid: x.pid, idleMs: x.idleMs });
  return { jigBytes, trashBytes, orphans, activeTemp: scan.active };
}
