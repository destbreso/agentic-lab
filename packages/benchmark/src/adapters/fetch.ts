// Fetching a public dataset from its authors' repository into a cache, choosing a seeded sample of it,
// and writing it as an ordinary task set file.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { stringify } from "yaml";
import { DATASETS, type DatasetId } from "./datasets.js";

/** Where downloads are kept: JIG_BENCHMARK_CACHE, else the platform's cache folder. */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.JIG_BENCHMARK_CACHE ?? path.join(env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"), "jig-benchmark");
}

export interface Fetched {
  bytes: Buffer;
  sha256: string;
  cached: boolean;
}

/** The dataset's file: a local copy when given, else the cache, else its authors' repository (then cached). */
export async function fetchDataset(id: DatasetId, o: { cache?: string; fromFile?: string; fetchImpl?: typeof fetch } = {}): Promise<Fetched> {
  const ds = DATASETS[id];
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  if (o.fromFile) {
    const bytes = await readFile(o.fromFile);
    return { bytes, sha256: hash(bytes), cached: false };
  }
  // Named by the dataset, so two datasets whose files share a name (test.jsonl) never meet in the cache.
  const file = path.join(o.cache ?? cacheDir(), `${id}-${path.basename(new URL(ds.url).pathname)}`);
  if (existsSync(file)) {
    const bytes = await readFile(file);
    return { bytes, sha256: hash(bytes), cached: true };
  }
  const res = await (o.fetchImpl ?? fetch)(ds.url);
  if (!res.ok) throw new Error(`${ds.name}: ${ds.url} answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(file), { recursive: true });
  // Written beside it and renamed: an interrupted download never leaves a broken file in the cache.
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, file);
  return { bytes, sha256: hash(bytes), cached: false };
}

/** The file's records, one JSON object a line. */
export function recordsOf(id: DatasetId, bytes: Buffer): Array<Record<string, unknown>> {
  const text = (DATASETS[id].gzip ? gunzipSync(bytes) : bytes).toString("utf-8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** A seeded choice of n of total indices, in ascending order: the same seed always picks the same tasks. */
export function sampleIndices(total: number, n: number, seed: number): number[] {
  if (n >= total) return [...Array(total).keys()];
  // mulberry32: small, seeded, and the same on every machine.
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...Array(total).keys()];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(next() * (total - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).sort((x, y) => x - y);
}

export interface BuildOptions {
  /** How many tasks; all of them when absent or larger than the file. */
  sample?: number;
  seed: number;
  sha256: string;
  retrieved: string;
}

/** The task set, as the object a task set file holds. */
export function buildTaskSet(id: DatasetId, records: Array<Record<string, unknown>>, o: BuildOptions): Record<string, unknown> {
  const ds = DATASETS[id];
  const n = Math.min(o.sample ?? records.length, records.length);
  const indices = sampleIndices(records.length, n, o.seed);
  const selection = n === records.length ? `All ${records.length} problems of the file` : `${n} of the file's ${records.length} problems, chosen with seed ${o.seed}`;
  return {
    name: n === records.length ? id : `${id}-${n}-seed${o.seed}`,
    description: ds.describe(selection),
    source: { name: ds.name, url: ds.url, license: `${ds.license} (${ds.licenseUrl})`, file_sha256: o.sha256, selection, retrieved: o.retrieved },
    tasks: indices.map((i) => ds.toTask(records[i], i)),
  };
}

/** The task set file's text, with a header saying where it came from and how it was made. */
export function taskSetText(id: DatasetId, set: Record<string, unknown>, command: string): string {
  const ds = DATASETS[id];
  const header = [
    `# ${ds.name} as a jig-benchmark task set, made by: ${command}`,
    `# From ${ds.url} (${ds.license}, ${ds.licenseUrl}).`,
    "# Each task's check file holds the dataset's tests or answer; it exists only where the checks run, so no role sees it.",
  ];
  return `${header.join("\n")}\n${stringify(set, { lineWidth: 0 })}`;
}
