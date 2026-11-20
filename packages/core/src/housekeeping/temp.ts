// ============================================
// Jig's temp folders: made with a marker, removed when done, orphans swept
// ============================================
// A check copy, a sight probe and a dry run each work in a folder of their
// own in the temp folder, named with Jig's prefix and holding its marker, and
// the folder is removed when the work ends. One left by a process that was
// killed is an orphan: Jig's prefix and marker, made on this machine, its
// process no longer running, and untouched for an hour. Orphans are swept
// when a session or jig run starts; a folder of a running process is never
// touched.

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, lstat, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import * as path from "node:path";
import { MARKER, markerProcessRunning, newMarker } from "./marker.js";
import { TEMP_PREFIXES, discardEmptyTemp, inspect, removeOwned, tempRoot, type Candidate, type TempPrefix } from "./guard.js";
import { formatBytes, pidAlive, sizeOf } from "./disk.js";

/** How long a temp folder of an ended process waits before it is an orphan. */
export const ORPHAN_AGE_MS = 60 * 60 * 1000;

/** A fresh temp folder with Jig's prefix and marker. */
export async function makeTempDir(prefix: TempPrefix, purpose: string, root: string = tmpdir()): Promise<string> {
  if (!TEMP_PREFIXES.includes(prefix)) throw new Error(`${prefix} is not one of Jig's temp prefixes`);
  const dir = await mkdtemp(path.join(tempRoot(root).dir, prefix));
  try {
    await writeFile(path.join(dir, MARKER), JSON.stringify(newMarker("temp", purpose), null, 1), { flag: "wx" });
  } catch (e) {
    await discardEmptyTemp(dir);
    throw e;
  }
  return dir;
}

/** Remove a temp folder this process made; anything else is left where it is, and false says so. */
export async function removeTempDir(dir: string): Promise<boolean> {
  const full = path.resolve(dir);
  const found = await inspect(tempRoot(path.dirname(full)), path.basename(full));
  if (!found.ok) return false;
  if (found.candidate.marker.pid !== process.pid || found.candidate.marker.host !== hostname()) return false;
  await removeOwned(found.candidate);
  return true;
}

/** Work in a fresh temp folder, removed afterwards whatever happens. */
export async function withTempDir<T>(prefix: TempPrefix, purpose: string, work: (dir: string) => Promise<T>, root?: string): Promise<T> {
  const dir = await makeTempDir(prefix, purpose, root);
  try {
    return await work(dir);
  } finally {
    await removeTempDir(dir).catch(() => false);
  }
}

/** Copy a folder as copy-on-write clones where the filesystem can (APFS, btrfs, XFS), and as a plain copy where it cannot. */
export async function cloneTree(from: string, to: string): Promise<void> {
  const src = path.resolve(from);
  // Node's COPYFILE_FICLONE clones on Linux but not on macOS (measured on APFS: the copy cost its full size),
  // where cp -c clones with clonefile(2) and falls back to a copy by itself.
  if (process.platform === "darwin" && (await macClone(src, path.resolve(to)))) return;
  try {
    await cp(src, to, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  } catch {
    // Whatever a failed clone left is overwritten file by file.
    await cp(src, to, { recursive: true, verbatimSymlinks: true, force: true });
  }
}

/** /bin/cp -cR, without a shell: symlinks copied as links, as fs.cp's verbatimSymlinks does. */
function macClone(from: string, to: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("/bin/cp", ["-cR", "--", from, to], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export interface TempOrphan {
  candidate: Candidate;
  path: string;
  pid: number;
  createdAt: string;
  /** Since it was made or last changed, whichever is later. */
  idleMs: number;
}

export interface TempScanOptions {
  /** The temp folder to look in (the system's by default). */
  root?: string;
  now?: number;
  alive?: (pid: number) => boolean;
}

/** Jig's temp folders left by processes that ended, and how many of Jig's are still in use. */
export async function findOrphans(o: TempScanOptions = {}): Promise<{ orphans: TempOrphan[]; active: number }> {
  const root = tempRoot(o.root);
  const now = o.now ?? Date.now();
  const alive = o.alive ?? pidAlive;
  const names = await readdir(root.dir).catch(() => [] as string[]);
  const orphans: TempOrphan[] = [];
  let active = 0;
  for (const name of names) {
    if (!TEMP_PREFIXES.some((p) => name.startsWith(p))) continue;
    const found = await inspect(root, name);
    if (!found.ok) continue;
    const m = found.candidate.marker;
    // A pid means nothing on another machine sharing the folder.
    if (m.host !== hostname()) continue;
    const st = await lstat(found.candidate.path).catch(() => null);
    const last = Math.max(Date.parse(m.createdAt), st?.mtimeMs ?? 0);
    if (markerProcessRunning(m, alive) || now - last < ORPHAN_AGE_MS) {
      active++;
      continue;
    }
    orphans.push({ candidate: found.candidate, path: found.candidate.path, pid: m.pid, createdAt: m.createdAt, idleMs: now - last });
  }
  return { orphans, active };
}

export interface RemovedTemp {
  path: string;
  pid: number;
  bytes?: number;
}

/** Remove the orphans; each removal is one call to log. */
export async function sweepTemp(
  o: TempScanOptions & { measure?: boolean; log?: (line: string) => Promise<void> } = {},
): Promise<{ removed: RemovedTemp[]; failed: Array<{ path: string; reason: string }> }> {
  const { orphans } = await findOrphans(o);
  const removed: RemovedTemp[] = [];
  const failed: Array<{ path: string; reason: string }> = [];
  for (const orphan of orphans) {
    const bytes = o.measure ? await sizeOf(orphan.path) : undefined;
    try {
      await removeOwned(orphan.candidate);
      removed.push({ path: orphan.path, pid: orphan.pid, ...(bytes !== undefined ? { bytes } : {}) });
      await o.log?.(`deleted temp ${orphan.path}${bytes !== undefined ? ` (${formatBytes(bytes)})` : ""}: left by process ${orphan.pid}, which has ended`).catch(() => {});
    } catch (e) {
      failed.push({ path: orphan.path, reason: (e as Error).message });
      await o.log?.(`kept temp ${orphan.path}: ${(e as Error).message}`).catch(() => {});
    }
  }
  return { removed, failed };
}
