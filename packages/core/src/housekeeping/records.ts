// ============================================
// Records: runs and sessions kept with a limit, the trash, the log
// ============================================
// A project's runs and sessions are kept for keepDays and up to maxMB; what
// passes the limit is moved to .jig/trash, never deleted where it is, and is
// deleted for good after trashDays there. Never moved: the runs of a session
// that can still be resumed, runs the person pinned, the 20 most recent runs,
// a record whose process is still running, and anything without Jig's marker.
// Records from before the marker are listed apart, and only jig clean --adopt
// marks the ones whose name and contents are exactly what Jig writes. Every
// action is one line in .jig/housekeeping.log.

import { appendFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { LEGACY_PROJECT_DIR, PROJECT_DIR, ensureProjectDir, projectPath } from "../config/places.js";
import { MARKER, SESSION_MARKER_FIELD, isPlainName, markerProcessRunning, newMarker, type OwnedMarker } from "./marker.js";
import { checkRoot, inspect, locate, moveToTrash, projectRoot, removeOwned, restoreFromTrash, type Candidate, type Root } from "./guard.js";
import { DAY_MS, MB, formatAge, formatBytes, pidAlive, sizeOf } from "./disk.js";

export interface HousekeepingSettings {
  /** Records not written for this many days move to the trash. */
  keepDays: number;
  /** Past this many MB of records in a project, the oldest move to the trash. */
  maxMB: number;
  /** Days an entry stays in the trash before it is deleted for good. */
  trashDays: number;
  /** false: Jig never moves or deletes records by itself; jig clean still does when asked. */
  auto: boolean;
}

export const DEFAULT_HOUSEKEEPING: HousekeepingSettings = { keepDays: 30, maxMB: 500, trashDays: 7, auto: true };
/** The most recent runs, kept whatever their age or size. */
export const KEEP_RECENT_RUNS = 20;
export const HOUSEKEEPING_LOG = "housekeeping.log";

/** The settings as written in a config, each one checked; a value that is not a positive number keeps its default. */
export function housekeepingSettings(written: { [K in keyof HousekeepingSettings]?: unknown } = {}): HousekeepingSettings {
  const positive = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  return {
    keepDays: positive(written.keepDays, DEFAULT_HOUSEKEEPING.keepDays),
    maxMB: positive(written.maxMB, DEFAULT_HOUSEKEEPING.maxMB),
    trashDays: positive(written.trashDays, DEFAULT_HOUSEKEEPING.trashDays),
    auto: written.auto !== false,
  };
}

// ---- The log ----

export async function appendLog(workingDir: string, line: string, when: Date = new Date()): Promise<void> {
  await ensureProjectDir(workingDir);
  await appendFile(projectPath(workingDir, HOUSEKEEPING_LOG), `${when.toISOString()} ${line}\n`);
}

/** A path as the log and the notes show it: inside the project, from .jig. */
const shown = (project: string, p: string) => {
  const rel = path.relative(project, p);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : p;
};

// ---- What is there ----

export interface RecordEntry {
  kind: "run" | "session";
  /** The folder's or the file's name. */
  name: string;
  /** The run's id, or the session's. */
  id: string;
  path: string;
  bytes: number;
  /** When it was last written, in ms. */
  at: number;
  /** Jig's, with its marker: the policy applies to it. */
  candidate?: Candidate;
  /** Why it is not Jig's to act on. */
  notOwned?: string;
  /** No marker, and its name and contents are exactly what Jig writes: jig clean --adopt may mark it. */
  adoptable?: boolean;
  /** The session a run belongs to. */
  sessionId?: string;
  keep?: boolean;
  /** The process that wrote it is still running. */
  live?: boolean;
}

export interface TrashEntry {
  name: string;
  path: string;
  bytes: number;
  trashedAt: number;
  from: "runs" | "sessions";
  /** The run's or the session's name inside the entry. */
  item: string;
  sessionId?: string;
  candidate: Candidate;
}

export interface Survey {
  project: string;
  /** Jig's runs and sessions, with their markers. */
  runs: RecordEntry[];
  sessions: RecordEntry[];
  /** Runs and sessions without a marker: never moved or deleted by the policy. */
  unowned: RecordEntry[];
  trash: TrashEntry[];
  /** What sits in .jig/trash without being one of Jig's entries: left alone. */
  strays: Array<{ name: string; reason: string }>;
  /** A folder Jig would not look in at all, and why. */
  refused: Array<{ folder: string; reason: string }>;
  /** The sessions in the legacy .agentic-lab/sessions, read only: they can be resumed too, so their runs stay. */
  legacySessions: string[];
}

const RUN_NAME = /^run-\d{13}-[A-Za-z0-9_-]{6}$/;
const RUN_FILES = new Set(["result.json", "steps.json", "record.json", "state.json"]);
const ITERATION_FILE = /^iteration-\d{4}\.json$/;
const SESSION_NAME = /^session-\d{14}-[A-Za-z0-9_-]{4}\.json$/;
const SESSION_KEYS = ["createdAt", "id", "messages", "settings", "updatedAt", "version", "workingDir"];
const NO_MARKER = "it carries no marker of Jig's";

async function names(root: Root, s: Survey): Promise<string[]> {
  const jig = await lstat(path.join(s.project, PROJECT_DIR)).catch(() => null);
  if (!jig) return [];
  if (!(await lstat(root.dir).catch(() => null)) && !jig.isSymbolicLink()) return [];
  // inspect() refuses a symlinked root on every entry; the survey says it once.
  const r = await checkRoot(root);
  if ("reason" in r) {
    if (!s.refused.some((x) => x.reason === r.reason)) s.refused.push({ folder: shown(s.project, root.dir), reason: r.reason });
    return [];
  }
  return (await readdir(root.dir).catch(() => [] as string[])).sort();
}

async function readJSON(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return undefined;
  }
}

/** A run's folder is written by its files: its age counts from the newest, or from a restore. */
async function runWritten(dir: string, marker?: OwnedMarker): Promise<number> {
  let at = 0;
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (n === MARKER) continue;
    const st = await lstat(path.join(dir, n)).catch(() => null);
    if (st) at = Math.max(at, st.mtimeMs);
  }
  if (!at) at = marker ? Date.parse(marker.createdAt) : (await lstat(dir).catch(() => null))?.mtimeMs ?? 0;
  if (marker?.restoredAt) at = Math.max(at, Date.parse(marker.restoredAt));
  return at;
}

async function sessionWritten(file: string, marker?: OwnedMarker): Promise<number> {
  const value = (await readJSON(file)) as { updatedAt?: unknown } | undefined;
  const updated = typeof value?.updatedAt === "string" ? Date.parse(value.updatedAt) : NaN;
  let at = Number.isFinite(updated) ? updated : (await lstat(file).catch(() => null))?.mtimeMs ?? 0;
  if (marker?.restoredAt) at = Math.max(at, Date.parse(marker.restoredAt));
  return at;
}

async function sessionOfRun(dir: string): Promise<string | undefined> {
  const rec = (await readJSON(path.join(dir, "record.json"))) as { sessionId?: unknown } | undefined;
  return typeof rec?.sessionId === "string" ? rec.sessionId : undefined;
}

/** A run folder from before the marker whose name and files are exactly what Jig writes. */
async function runShape(dir: string, name: string): Promise<boolean> {
  if (!RUN_NAME.test(name)) return false;
  const files = await readdir(dir).catch(() => null);
  if (!files?.length) return false;
  for (const f of files) {
    if (!RUN_FILES.has(f) && !ITERATION_FILE.test(f)) return false;
    const st = await lstat(path.join(dir, f)).catch(() => null);
    if (!st?.isFile()) return false;
  }
  return true;
}

/** A session file from before the marker whose name and fields are exactly what Jig writes. */
async function sessionShape(file: string, name: string): Promise<boolean> {
  if (!SESSION_NAME.test(name)) return false;
  const v = (await readJSON(file)) as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (Object.keys(v).sort().join(",") !== SESSION_KEYS.join(",")) return false;
  return (
    v.id === name.slice(0, -".json".length) &&
    v.version === 1 &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.workingDir === "string" &&
    Array.isArray(v.messages) &&
    !!v.settings &&
    typeof v.settings === "object"
  );
}

// An adopted marker's pid is the process that adopted it, not one that writes the record.
const liveMarker = (m: OwnedMarker, alive: (pid: number) => boolean) => !m.adopted && markerProcessRunning(m, alive);

/** Everything in a project's runs, sessions and trash, each with whether it is Jig's to act on. Reads only. */
export async function survey(workingDir: string, o: { alive?: (pid: number) => boolean } = {}): Promise<Survey> {
  const project = path.resolve(workingDir);
  const alive = o.alive ?? pidAlive;
  const s: Survey = { project, runs: [], sessions: [], unowned: [], trash: [], strays: [], refused: [], legacySessions: [] };
  s.legacySessions = (await readdir(path.join(project, LEGACY_PROJECT_DIR, "sessions")).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));

  const runs = projectRoot(project, "runs");
  for (const name of await names(runs, s)) {
    const full = path.join(runs.dir, name);
    const found = await inspect(runs, name);
    if (found.ok) {
      const m = found.candidate.marker;
      const sessionId = await sessionOfRun(full);
      s.runs.push({ kind: "run", name, id: name, path: full, bytes: await sizeOf(full), at: await runWritten(full, m), candidate: found.candidate, ...(sessionId ? { sessionId } : {}), ...(m.keep ? { keep: true } : {}), ...(liveMarker(m, alive) ? { live: true } : {}) });
    } else {
      const adoptable = found.reason === NO_MARKER && (await runShape(full, name));
      s.unowned.push({ kind: "run", name, id: name, path: full, bytes: await sizeOf(full), at: await runWritten(full), notOwned: found.reason, ...(adoptable ? { adoptable } : {}) });
    }
  }

  const sessions = projectRoot(project, "sessions");
  for (const name of await names(sessions, s)) {
    const full = path.join(sessions.dir, name);
    const id = name.replace(/\.json$/, "");
    const found = await inspect(sessions, name);
    if (found.ok) {
      const m = found.candidate.marker;
      s.sessions.push({ kind: "session", name, id, path: full, bytes: await sizeOf(full), at: await sessionWritten(full, m), candidate: found.candidate, ...(liveMarker(m, alive) ? { live: true } : {}) });
    } else {
      const adoptable = found.reason === NO_MARKER && (await sessionShape(full, name));
      s.unowned.push({ kind: "session", name, id, path: full, bytes: await sizeOf(full), at: await sessionWritten(full), notOwned: found.reason, ...(adoptable ? { adoptable } : {}) });
    }
  }

  const trash = projectRoot(project, "trash");
  for (const name of await names(trash, s)) {
    const found = await inspect(trash, name);
    if (!found.ok) {
      s.strays.push({ name, reason: found.reason });
      continue;
    }
    const m = found.candidate.marker;
    const item = m.name!;
    const sessionId = m.from === "runs" ? await sessionOfRun(path.join(found.candidate.path, item)) : undefined;
    s.trash.push({ name, path: found.candidate.path, bytes: await sizeOf(found.candidate.path), trashedAt: Date.parse(m.trashedAt!), from: m.from!, item, candidate: found.candidate, ...(sessionId ? { sessionId } : {}) });
  }
  return s;
}

// ---- What the policy would do ----

export interface PlannedMove {
  entry: RecordEntry;
  why: string;
}
export interface PlannedDelete {
  entry: TrashEntry;
  why: string;
}
export interface Plan {
  settings: HousekeepingSettings;
  moves: PlannedMove[];
  deletes: PlannedDelete[];
  /** Records past the limits that stay, and why. */
  kept: Array<{ entry: RecordEntry; why: string }>;
  /** Jig's records, in bytes, before the moves. */
  recordsBytes: number;
  /** Bytes still over maxMB after the moves: what the rules keep. */
  overBy: number;
}

/** What the policy would move and delete now. Pure: it reads the survey only. */
export function planRecords(s: Survey, settings: HousekeepingSettings, now: number, o: { openSession?: string } = {}): Plan {
  const limitMs = settings.keepDays * DAY_MS;
  const moves: PlannedMove[] = [];
  const kept: Plan["kept"] = [];
  const moving = new Set<RecordEntry>();
  const protectedEntries = new Set<RecordEntry>();
  const days = (e: RecordEntry) => formatAge(now - e.at);
  const ageWhy = (e: RecordEntry) => `not written for ${days(e)}, more than ${settings.keepDays}`;

  for (const e of s.sessions) {
    if (e.id === o.openSession) protectedEntries.add(e);
    else if (e.live) protectedEntries.add(e);
    if (protectedEntries.has(e)) {
      if (now - e.at > limitMs) kept.push({ entry: e, why: e.id === o.openSession ? "it is the session being opened" : "its process is still running" });
    } else if (now - e.at > limitMs) {
      moves.push({ entry: e, why: ageWhy(e) });
      moving.add(e);
    }
  }

  // A session that stays can be resumed, so its runs stay with it (one from before the marker, or in the legacy folder, too).
  const resumable = new Set([...s.sessions.filter((e) => !moving.has(e)).map((e) => e.id), ...s.unowned.filter((e) => e.kind === "session").map((e) => e.id), ...s.legacySessions]);
  const recent = new Set([...s.runs].sort((a, b) => b.at - a.at).slice(0, KEEP_RECENT_RUNS));
  const runKept = (e: RecordEntry): string | null =>
    e.keep ? "pinned (jig clean --unkeep releases it)" : e.sessionId && resumable.has(e.sessionId) ? `its session ${e.sessionId} can still be resumed` : e.live ? "its process is still running" : recent.has(e) ? `one of the ${KEEP_RECENT_RUNS} most recent runs` : null;

  for (const e of s.runs) {
    const why = runKept(e);
    if (why) {
      protectedEntries.add(e);
      if (now - e.at > limitMs) kept.push({ entry: e, why });
    } else if (now - e.at > limitMs) {
      moves.push({ entry: e, why: ageWhy(e) });
      moving.add(e);
    }
  }

  // Over the size, the oldest run that may move goes first. Sessions go by age only: they are small, and they hold their runs.
  const recordsBytes = [...s.runs, ...s.sessions].reduce((n, e) => n + e.bytes, 0);
  const limit = settings.maxMB * MB;
  let total = recordsBytes - [...moving].reduce((n, e) => n + e.bytes, 0);
  if (total > limit) {
    const movable = s.runs.filter((e) => !moving.has(e) && !protectedEntries.has(e)).sort((a, b) => a.at - b.at);
    for (const e of movable) {
      if (total <= limit) break;
      moves.push({ entry: e, why: `the records are over ${settings.maxMB} MB, and it is the oldest run that may go` });
      moving.add(e);
      total -= e.bytes;
    }
  }

  const deletes = s.trash
    .filter((t) => now - t.trashedAt > settings.trashDays * DAY_MS)
    .map((t) => ({ entry: t, why: `in the trash for ${formatAge(now - t.trashedAt)}, more than ${settings.trashDays}` }));

  return { settings, moves, deletes, kept, recordsBytes, overBy: Math.max(0, total - limit) };
}

// ---- Doing it ----

export interface Applied {
  moved: Array<PlannedMove & { to: string }>;
  deleted: PlannedDelete[];
  failed: Array<{ name: string; reason: string }>;
}

/** Move and delete what the plan says, each through the guard, each a line in the log. */
export async function applyPlan(workingDir: string, plan: Plan, when: Date = new Date()): Promise<Applied> {
  const project = path.resolve(workingDir);
  const out: Applied = { moved: [], deleted: [], failed: [] };
  const log = (line: string) => appendLog(project, line, when).catch(() => {});
  for (const m of plan.moves) {
    try {
      const { path: to } = await moveToTrash(m.entry.candidate!, when);
      out.moved.push({ ...m, to });
      await log(`moved ${m.entry.kind} ${shown(project, m.entry.path)} (${formatBytes(m.entry.bytes)}) to ${shown(project, to)}: ${m.why}`);
    } catch (e) {
      out.failed.push({ name: m.entry.name, reason: (e as Error).message });
      await log(`kept ${m.entry.kind} ${shown(project, m.entry.path)}: ${(e as Error).message}`);
    }
  }
  for (const d of plan.deletes) {
    try {
      await removeOwned(d.entry.candidate);
      out.deleted.push(d);
      await log(`deleted ${shown(project, d.entry.path)} (${formatBytes(d.entry.bytes)}) for good: ${d.why}`);
    } catch (e) {
      out.failed.push({ name: d.entry.name, reason: (e as Error).message });
      await log(`kept ${shown(project, d.entry.path)}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Delete every entry of the trash now. */
export async function emptyTrash(workingDir: string, s?: Survey): Promise<{ deleted: TrashEntry[]; failed: Array<{ name: string; reason: string }> }> {
  const project = path.resolve(workingDir);
  const found = s ?? (await survey(project));
  const deleted: TrashEntry[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const t of found.trash) {
    try {
      await removeOwned(t.candidate);
      deleted.push(t);
      await appendLog(project, `deleted ${shown(project, t.path)} (${formatBytes(t.bytes)}) for good: jig clean --empty-trash`).catch(() => {});
    } catch (e) {
      failed.push({ name: t.name, reason: (e as Error).message });
    }
  }
  return { deleted, failed };
}

/** Rewrite a record's marker with a change; a run's in its folder, a session's inside its file. */
async function remark(c: Candidate, change: Partial<OwnedMarker>): Promise<void> {
  if (c.root.kind === "runs") {
    await writeFile(path.join(c.path, MARKER), JSON.stringify({ ...c.marker, ...change }, null, 1));
    return;
  }
  if (c.root.kind === "sessions") {
    const saved = (await readJSON(c.path)) as Record<string, unknown> | undefined;
    if (!saved || typeof saved !== "object") throw new Error(`${c.name} cannot be read`);
    await writeFile(c.path, JSON.stringify({ ...saved, [SESSION_MARKER_FIELD]: { ...c.marker, ...change } }, null, 1));
    return;
  }
  throw new Error(`a ${c.root.kind} entry has no record marker`);
}

/** Bring one entry back from the trash; a session brings its runs back with it. */
export async function restoreRecord(workingDir: string, name: string): Promise<{ restored: Array<{ kind: "run" | "session"; name: string; to: string }>; error?: string }> {
  const project = path.resolve(workingDir);
  const wanted = name.trim();
  const bare = wanted.replace(/\.json$/, "");
  if (!isPlainName(bare)) return { restored: [], error: `${wanted} is not a name in ${PROJECT_DIR}/trash` };
  const s = await survey(project);
  const match = s.trash.find((t) => t.name === bare) ?? [...s.trash].sort((a, b) => b.trashedAt - a.trashedAt).find((t) => t.item === wanted || t.item === bare || t.item === `${bare}.json`);
  if (!match) return { restored: [], error: `nothing called ${wanted} in ${PROJECT_DIR}/trash: jig clean lists what is there` };
  const restored: Array<{ kind: "run" | "session"; name: string; to: string }> = [];
  const bring = async (t: TrashEntry): Promise<void> => {
    const { to } = await restoreFromTrash(t.candidate);
    const kind = t.from === "sessions" ? "session" : "run";
    // Its age counts from now, so the next pass does not move it straight back.
    const back = await inspect(projectRoot(project, t.from), t.item);
    if (back.ok) await remark(back.candidate, { restoredAt: new Date().toISOString() });
    restored.push({ kind, name: t.item, to });
    await appendLog(project, `restored ${kind} ${shown(project, t.path)} to ${shown(project, to)}`).catch(() => {});
  };
  try {
    await bring(match);
    if (match.from === "sessions") {
      const id = match.item.replace(/\.json$/, "");
      for (const t of s.trash.filter((x) => x.from === "runs" && x.sessionId === id)) await bring(t).catch(() => {});
    }
  } catch (e) {
    return { restored, error: (e as Error).message };
  }
  return { restored };
}

/** Pin a run so the policy never moves it, or release it. */
export async function keepRun(workingDir: string, runId: string, keep: boolean): Promise<{ ok: boolean; message: string }> {
  const project = path.resolve(workingDir);
  const id = runId.trim();
  if (!isPlainName(id)) return { ok: false, message: `${id} is not a run id` };
  const found = await inspect(projectRoot(project, "runs"), id);
  if (!found.ok) {
    const where = await locate(projectRoot(project, "runs"), id);
    if (where.ok && found.reason === NO_MARKER) return { ok: false, message: `${id} is from before Jig marked its runs: the policy never moves it, pinned or not` };
    const inTrash = (await survey(project)).trash.find((t) => t.item === id);
    if (inTrash) return { ok: false, message: `${id} is in the trash: jig clean --restore ${id} brings it back` };
    return { ok: false, message: `no run ${id} in ${PROJECT_DIR}/runs (${found.reason})` };
  }
  if (Boolean(found.candidate.marker.keep) === keep) return { ok: true, message: keep ? `${id} was already pinned` : `${id} was not pinned` };
  await remark(found.candidate, { keep });
  await appendLog(project, `${keep ? "pinned" : "released"} run ${shown(project, found.candidate.path)}${keep ? ": jig clean --keep" : ": jig clean --unkeep"}`).catch(() => {});
  return { ok: true, message: keep ? `${id} is pinned: Jig never moves it` : `${id} is released: the policy applies to it again` };
}

/** Mark the records from before the marker whose shape is exactly Jig's, so the policy applies to them. */
export async function adoptRecords(workingDir: string, o: { apply: boolean }): Promise<Array<{ entry: RecordEntry; adopted: boolean; reason?: string }>> {
  const project = path.resolve(workingDir);
  const s = await survey(project);
  const out: Array<{ entry: RecordEntry; adopted: boolean; reason?: string }> = [];
  for (const e of s.unowned.filter((x) => x.adoptable)) {
    if (!o.apply) {
      out.push({ entry: e, adopted: false });
      continue;
    }
    try {
      // Looked at again just before the marker is written.
      const root = projectRoot(project, e.kind === "run" ? "runs" : "sessions");
      const where = await locate(root, e.name);
      if (!where.ok) throw new Error(where.reason);
      if (e.kind === "run") {
        if (!(await runShape(where.path, e.name))) throw new Error("its files changed");
        const marker = newMarker("run", "a run's record: its steps and result, kept for jig replay and /runs", { adopted: true });
        await writeFile(path.join(where.path, MARKER), JSON.stringify(marker, null, 1), { flag: "wx" });
      } else {
        if (!(await sessionShape(where.path, e.name))) throw new Error("its contents changed");
        const saved = (await readJSON(where.path)) as Record<string, unknown>;
        const marker = newMarker("session", "a session of jig: its settings and conversation, opened again by jig --resume", { createdAt: String(saved.createdAt), adopted: true });
        await writeFile(where.path, JSON.stringify({ ...saved, [SESSION_MARKER_FIELD]: marker }, null, 1));
      }
      out.push({ entry: e, adopted: true });
      await appendLog(project, `adopted ${e.kind} ${shown(project, e.path)}: its name and contents are exactly what Jig writes (jig clean --adopt)`).catch(() => {});
    } catch (err) {
      out.push({ entry: e, adopted: false, reason: (err as Error).message });
    }
  }
  return out;
}

/** The marker a run's folder is made with. */
export function runMarker(): OwnedMarker {
  return newMarker("run", "a run's record: its steps and result, kept for jig replay and /runs");
}

/**
 * A run's folder in .jig/runs, marked when this call makes it. A folder that was already there keeps
 * whatever marker it has, or none: Jig marks only what it creates.
 */
export async function ensureRunDir(workingDir: string, runId: string): Promise<string> {
  if (!isPlainName(runId)) return ensureProjectDir(workingDir, "runs", runId);
  const dir = path.join(await ensureProjectDir(workingDir, "runs"), runId);
  try {
    await mkdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return dir;
    throw e;
  }
  await writeFile(path.join(dir, MARKER), JSON.stringify(runMarker(), null, 1), { flag: "wx" }).catch(() => {});
  return dir;
}
