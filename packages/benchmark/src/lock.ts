// ============================================
// lock.json: the experiment as it was fixed before its first attempt
// ============================================
// Written before the first attempt runs, with the hash of the spec (its rule
// included), the task set and any topology file. A rerun into the same
// folder resumes only when the hash and the jig-core version are the same:
// a changed rule, more repetitions, an edited task or another engine is a new
// experiment, in a new folder. The lock also keeps the spec and the task set
// themselves, so a report needs nothing but the folder.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keptPath } from "./paths.js";
import { armInfo, type ArmInfo, type LoadedSpec, type SpecData } from "./spec.js";
import type { TaskSet } from "./taskset.js";

export const LOCK_FILE = "lock.json";

export interface Lock {
  hash: string;
  lockedAt: string;
  /** The jig-core the attempts run on. */
  core: string;
  /** The jig-benchmark that fixed the experiment. */
  benchmark: string;
  /** The spec's file, relative to the folder the run started from, or with the home folder as ~. */
  specFile: string;
  /** The task set's file, relative to the spec. */
  taskSetFile: string;
  spec: SpecData;
  taskSet: TaskSet;
  /** Direct first, then the baselines, then the arms. */
  arms: ArmInfo[];
  topologyFiles: Record<string, string>;
}

export class LockRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockRefused";
  }
}

export async function readLock(outDir: string): Promise<Lock | null> {
  try {
    return JSON.parse(await readFile(join(outDir, LOCK_FILE), "utf-8")) as Lock;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${join(outDir, LOCK_FILE)} cannot be read: ${(e as Error).message}`);
  }
}

/** The lock of this folder, written now if it has none; refused when the folder holds another experiment. */
export async function lockExperiment(outDir: string, loaded: LoadedSpec, versions: { core: string; benchmark: string }, now = new Date()): Promise<{ lock: Lock; created: boolean }> {
  const existing = await readLock(outDir);
  if (existing) {
    if (existing.hash !== loaded.hash) {
      throw new LockRefused(
        `${outDir} holds another experiment: its spec, task set or topology files have changed since it was locked on ${existing.lockedAt} (hash ${existing.hash.slice(0, 12)}, now ${loaded.hash.slice(0, 12)}). Its rule and attempts are kept as they were. Start a new experiment in a new folder (--out), or put the spec back as it was to resume.`,
      );
    }
    if (existing.core !== versions.core) {
      throw new LockRefused(
        `${outDir} was started on jig-core ${existing.core}, and this is jig-core ${versions.core}: resuming would mix two engines in one experiment. Start it again in a new folder (--out), or run it with jig-core ${existing.core}.`,
      );
    }
    return { lock: existing, created: false };
  }
  const lock: Lock = {
    hash: loaded.hash,
    lockedAt: now.toISOString(),
    core: versions.core,
    benchmark: versions.benchmark,
    // Never the absolute path: a lock may be shared, and the path could name the person.
    specFile: keptPath(loaded.path),
    taskSetFile: loaded.taskSetFile,
    spec: loaded.data,
    taskSet: loaded.taskSet,
    arms: loaded.arms.map(armInfo),
    topologyFiles: loaded.topologyFiles,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  return { lock, created: true };
}
