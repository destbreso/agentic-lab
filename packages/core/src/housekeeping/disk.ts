// Sizes, processes and times, as housekeeping reads them. Nothing here writes.

import { lstat, readdir } from "node:fs/promises";
import * as path from "node:path";

/** Bytes under a path, symlinks counted as themselves and never followed. */
export async function sizeOf(p: string): Promise<number> {
  const st = await lstat(p).catch(() => null);
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  const names = await readdir(p).catch(() => [] as string[]);
  for (const n of names) total += await sizeOf(path.join(p, n));
  return total;
}

/** Whether a process is running. A process Jig may not signal is still running. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const MB = 1024 * 1024;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / (1024 * MB)).toFixed(1)} GB`;
}

/** A span of time in whole days, or hours under a day. */
export function formatAge(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
