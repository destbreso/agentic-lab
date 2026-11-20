// ============================================
// The guard: the one place Jig deletes or moves what it made
// ============================================
// Housekeeping looks only in a project's .jig/runs, .jig/sessions and
// .jig/trash, and in the temp folder for Jig's prefixes. In those, a path is a
// candidate only when it is a direct child of its root, is not a symlink,
// resolves inside the root, and carries Jig's marker of the root's kind; a
// project's root must be a real folder, and so must .jig (the temp folder is
// taken by its real path, see tempRoot). Every removal and every move
// to or from the trash goes through this file, and each one inspects its
// candidate again just before it acts. Records are never deleted where they
// are: they go to the trash first.

import { constants, realpathSync } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PROJECT_DIR } from "../config/places.js";
import { MARKER, SESSION_MARKER_FIELD, asMarker, isPlainName, newMarker, type OwnedKind, type OwnedMarker } from "./marker.js";

/** The names Jig gives its temp folders; nothing else in the temp folder is looked at. */
export const TEMP_PREFIXES = ["jig-check-", "jig-sight-", "jig-play-"] as const;
export type TempPrefix = (typeof TEMP_PREFIXES)[number];

export type RootKind = "runs" | "sessions" | "trash" | "temp";

export interface Root {
  kind: RootKind;
  /** The folder, absolute. */
  dir: string;
  /** The project a .jig root belongs to. */
  project?: string;
}

const KIND_OF: Record<RootKind, OwnedKind> = { runs: "run", sessions: "session", trash: "trash", temp: "temp" };
const MARKER_LIMIT = 64 * 1024;
const SESSION_LIMIT = 64 * 1024 * 1024;

/** A project's .jig/runs, .jig/sessions or .jig/trash. Never the legacy .agentic-lab: it is read, never cleaned. */
export function projectRoot(workingDir: string, kind: "runs" | "sessions" | "trash"): Root {
  const project = path.resolve(workingDir);
  return { kind, dir: path.join(project, PROJECT_DIR, kind), project };
}

/**
 * The temp folder (the system's, unless a test or the checker names another), by its real path: it is often
 * reached through a symlink (/tmp on a Mac), and refusing it would leave every check copy behind. It comes from
 * the environment, never from a project, and its candidates are held to every other rule.
 */
export function tempRoot(dir: string = tmpdir()): Root {
  const abs = path.resolve(dir);
  try {
    return { kind: "temp", dir: realpathSync(abs) };
  } catch {
    return { kind: "temp", dir: abs };
  }
}

export interface Candidate {
  root: Root;
  name: string;
  path: string;
  /** Its real path, checked to be a direct child of the root's. */
  real: string;
  marker: OwnedMarker;
}

export type Inspection = { ok: true; candidate: Candidate } | { ok: false; reason: string };

const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;
const lstatOrNull = (p: string) => lstat(p).catch(() => null);

/** The root's real path, or why Jig will not act in it. */
export async function checkRoot(root: Root): Promise<{ real: string } | { reason: string }> {
  if (!path.isAbsolute(root.dir)) return { reason: "its folder is not an absolute path" };
  if (root.kind !== "temp") {
    if (!root.project) return { reason: "it names no project" };
    const jig = path.join(root.project, PROJECT_DIR);
    if (root.dir !== path.join(jig, root.kind)) return { reason: `it is not the project's ${PROJECT_DIR}/${root.kind}` };
    const st = await lstatOrNull(jig);
    if (!st) return { reason: `${PROJECT_DIR} does not exist` };
    if (st.isSymbolicLink() || !st.isDirectory()) return { reason: `${PROJECT_DIR} is a symlink or not a folder` };
  }
  const st = await lstatOrNull(root.dir);
  if (!st) return { reason: "its folder does not exist" };
  if (st.isSymbolicLink()) return { reason: "its folder is a symlink" };
  if (!st.isDirectory()) return { reason: "it is not a folder" };
  return { real: await realpath(root.dir) };
}

/** A direct child of a root that is not a symlink and resolves inside it, before its marker is read. */
export async function locate(root: Root, name: string): Promise<{ ok: true; path: string; real: string } | { ok: false; reason: string }> {
  if (!isPlainName(name)) return no("its name is not a plain name");
  if (root.kind === "temp" && !TEMP_PREFIXES.some((p) => name.startsWith(p))) return no("its name has none of Jig's temp prefixes");
  if (root.kind === "sessions" && !name.endsWith(".json")) return no("it is not a session file");
  const r = await checkRoot(root);
  if ("reason" in r) return no(r.reason);
  const full = path.join(root.dir, name);
  const st = await lstatOrNull(full);
  if (!st) return no("it does not exist");
  if (st.isSymbolicLink()) return no("it is a symlink");
  const file = root.kind === "sessions";
  if (file ? !st.isFile() : !st.isDirectory()) return no(file ? "it is not a file" : "it is not a folder");
  if (file && st.size > SESSION_LIMIT) return no("it is too large to be read as a session");
  const real = await realpath(full).catch(() => null);
  if (!real || path.dirname(real) !== r.real) return no("it resolves outside its folder");
  return { ok: true, path: full, real };
}

async function folderMarker(dir: string, kind: OwnedKind): Promise<OwnedMarker | string> {
  const file = path.join(dir, MARKER);
  const st = await lstatOrNull(file);
  if (!st) return "it carries no marker of Jig's";
  if (st.isSymbolicLink() || !st.isFile() || st.size > MARKER_LIMIT) return "its marker is not a plain file";
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return "its marker cannot be read";
  }
  return asMarker(value, kind) ?? `its marker is not a ${kind}'s`;
}

async function sessionFileMarker(file: string): Promise<OwnedMarker | string> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return "it cannot be read as a session";
  }
  const field = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[SESSION_MARKER_FIELD] : undefined;
  if (field === undefined) return "it carries no marker of Jig's";
  return asMarker(field, "session") ?? "its marker is not a session's";
}

/** Whether a direct child of a root is Jig's to act on, and why not when it is not. */
export async function inspect(root: Root, name: string): Promise<Inspection> {
  const at = await locate(root, name);
  if (!at.ok) return at;
  const marker = root.kind === "sessions" ? await sessionFileMarker(at.path) : await folderMarker(at.path, KIND_OF[root.kind]);
  if (typeof marker === "string") return no(marker);
  return { ok: true, candidate: { root, name, path: at.path, real: at.real, marker } };
}

/** The candidate as it is now: the same path, still Jig's. */
async function again(c: Candidate): Promise<Candidate> {
  const now = await inspect(c.root, c.name);
  if (!now.ok) throw new Error(`${c.path} is no longer Jig's to touch: ${now.reason}`);
  if (now.candidate.real !== c.real) throw new Error(`${c.path} changed since it was looked at`);
  return now.candidate;
}

/** Delete a temp folder or a trash entry for good. */
export async function removeOwned(c: Candidate): Promise<void> {
  if (c.root.kind !== "temp" && c.root.kind !== "trash") throw new Error(`Jig deletes only its temp folders and its trash entries, never from ${c.root.kind} directly`);
  const cur = await again(c);
  // The marker goes last, so a removal cut short is still Jig's and the next sweep finishes it.
  for (let pass = 0; pass < 3; pass++) {
    const left = (await readdir(cur.path)).filter((n) => n !== MARKER);
    if (!left.length) break;
    for (const child of left) await rm(path.join(cur.path, child), { recursive: true, force: true });
  }
  await unlink(path.join(cur.path, MARKER));
  await rmdir(cur.path);
}

/** Move a run's folder or a session file into .jig/trash, inside an entry of its own that says when. */
export async function moveToTrash(c: Candidate, when: Date = new Date()): Promise<{ entry: string; path: string }> {
  if ((c.root.kind !== "runs" && c.root.kind !== "sessions") || !c.root.project) throw new Error("only runs and sessions go to the trash");
  const cur = await again(c);
  const trash = projectRoot(c.root.project, "trash");
  await mkdir(trash.dir).catch((e) => {
    if (errCode(e) !== "EEXIST") throw e;
  });
  const t = await checkRoot(trash);
  if ("reason" in t) throw new Error(`${PROJECT_DIR}/trash: ${t.reason}`);
  const base = c.root.kind === "sessions" ? c.name.replace(/\.json$/, "") : c.name;
  for (let i = 1; i < 100; i++) {
    const entry = i === 1 ? base : `${base}-${i}`;
    const dir = path.join(trash.dir, entry);
    try {
      await mkdir(dir);
    } catch (e) {
      if (errCode(e) === "EEXIST") continue;
      throw e;
    }
    try {
      const marker = newMarker("trash", `moved to the trash by Jig's housekeeping; deleted for good after the trash's days`, { trashedAt: when.toISOString(), from: c.root.kind, name: c.name });
      await writeFile(path.join(dir, MARKER), JSON.stringify(marker, null, 1), { flag: "wx" });
      await rename(cur.path, path.join(dir, c.name));
    } catch (e) {
      // The entry was made just now and holds at most its marker.
      await unlink(path.join(dir, MARKER)).catch(() => {});
      await rmdir(dir).catch(() => {});
      throw e;
    }
    return { entry, path: dir };
  }
  throw new Error(`no free name in ${PROJECT_DIR}/trash for ${base}`);
}

/** Move a trash entry's run or session back where it was; the emptied entry goes. */
export async function restoreFromTrash(c: Candidate): Promise<{ to: string }> {
  if (c.root.kind !== "trash" || !c.root.project) throw new Error("only a trash entry can be restored");
  const cur = await again(c);
  const from = cur.marker.from!;
  const name = cur.marker.name!;
  const inner = path.join(cur.path, name);
  const st = await lstatOrNull(inner);
  if (!st || st.isSymbolicLink() || (from === "sessions" ? !st.isFile() : !st.isDirectory())) throw new Error(`${name} is not in its trash entry as Jig left it`);
  const target = projectRoot(c.root.project, from);
  await mkdir(target.dir).catch((e) => {
    if (errCode(e) !== "EEXIST") throw e;
  });
  const t = await checkRoot(target);
  if ("reason" in t) throw new Error(`${PROJECT_DIR}/${from}: ${t.reason}`);
  const dest = path.join(target.dir, name);
  if (await lstatOrNull(dest)) throw new Error(`${PROJECT_DIR}/${from}/${name} already exists`);
  if (from === "sessions") {
    // A link fails when the name is taken, so a session written meanwhile is never replaced.
    try {
      await link(inner, dest);
    } catch (e) {
      if (errCode(e) === "EEXIST") throw new Error(`${PROJECT_DIR}/${from}/${name} already exists`);
      await copyFile(inner, dest, constants.COPYFILE_EXCL);
    }
    await unlink(inner);
  } else {
    await rename(inner, dest);
  }
  const left = await readdir(cur.path);
  if (left.length === 1 && left[0] === MARKER) {
    await unlink(path.join(cur.path, MARKER));
    await rmdir(cur.path);
  }
  return { to: dest };
}

/** Undo a temp folder made a moment ago whose marker could not be written: only an empty folder with Jig's prefix goes. */
export async function discardEmptyTemp(dir: string): Promise<void> {
  if (!TEMP_PREFIXES.some((p) => path.basename(dir).startsWith(p))) return;
  await rmdir(dir).catch(() => {});
}
