// jig clean prints what Jig's cleanup would do (path, kind, size, why) and
// changes nothing; --yes does it; --restore, --keep and --empty-trash act by
// name; jig doctor shows .jig, the trash and the orphaned temp folders; and
// jig run marks its run and says once what its cleanup did. Fixtures live in a
// fresh temp folder per test, and the person's own config is never read.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER, newMarker } from "jig-core";
import { cleanCommand } from "./commands/clean.js";
import { diskLines } from "./commands/providers.js";
import { runTopology, type RunnerIO } from "./session-runner.js";
import { scriptedProvider } from "../../core/src/test-support/scripted-provider.js";

const DAY = 86_400_000;
const DEAD = 999_999;
const dead = () => false;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

let base: string;
let project: string;
let tmp: string;
let configDir: string | undefined;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "cli-clean-"));
  project = join(base, "project");
  tmp = join(base, "tmp");
  await mkdir(project);
  await mkdir(tmp);
  configDir = process.env.JIG_CONFIG_DIR;
  process.env.JIG_CONFIG_DIR = join(base, "config");
});
afterEach(async () => {
  if (configDir === undefined) delete process.env.JIG_CONFIG_DIR;
  else process.env.JIG_CONFIG_DIR = configDir;
  process.exitCode = 0;
  await rm(base, { recursive: true, force: true });
});

const jig = (...parts: string[]) => join(project, ".jig", ...parts);
const id = (i: number) => `run-1700000000${String(i).padStart(3, "0")}-abcdef`;

async function run(name: string, days: number, o: { marked?: boolean; bytes?: number } = {}) {
  const dir = jig("runs", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "steps.json"), "x".repeat(o.bytes ?? 100));
  await writeFile(join(dir, "record.json"), JSON.stringify({ runId: name }));
  if (o.marked !== false) await writeFile(join(dir, MARKER), JSON.stringify({ ...newMarker("run", "a test's", { createdAt: ago(days).toISOString() }), pid: DEAD }));
  for (const f of await readdir(dir)) await utimes(join(dir, f), ago(days), ago(days));
}

async function orphan(name: string) {
  const dir = join(tmp, name);
  await mkdir(join(dir, "ws"), { recursive: true });
  await writeFile(join(dir, "ws", "node_modules.txt"), "y".repeat(5000));
  await writeFile(join(dir, MARKER), JSON.stringify({ ...newMarker("temp", "a test's", { createdAt: ago(1).toISOString() }), pid: DEAD }));
  await utimes(dir, ago(1), ago(1));
  return dir;
}

/** Every path under a folder, with its kind, size, time and contents: what "changes nothing" is checked against. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (p: string) => {
    const st = await lstat(p);
    const kind = st.isSymbolicLink() ? "link" : st.isDirectory() ? "dir" : "file";
    out.push(`${p.slice(root.length)} ${kind} ${st.size} ${st.mtimeMs}${kind === "file" ? ` ${await readFile(p, "utf-8")}` : ""}`);
    if (kind === "dir") for (const n of (await readdir(p)).sort()) await walk(join(p, n));
  };
  await walk(root);
  return out;
}

async function clean(options: Parameters<typeof cleanCommand>[0]): Promise<string> {
  const lines: string[] = [];
  await cleanCommand({ dir: project, ...options }, { tmpRoot: tmp, alive: dead, out: (l) => lines.push(strip(l)) });
  return lines.join("\n");
}

async function fixture() {
  for (let i = 10; i < 30; i++) await run(id(i), 1);
  await run(id(1), 45, { bytes: 2048 });
  await run(id(2), 300, { marked: false });
  await symlink(join(base, "config"), jig("runs", "a-link"));
  await writeFile(jig("settings.local.json"), "{}");
  await mkdir(jig("trash", "run-1600000000000-expird"), { recursive: true });
  await writeFile(jig("trash", "run-1600000000000-expird", MARKER), JSON.stringify({ ...newMarker("trash", "a test's"), pid: DEAD, trashedAt: ago(9).toISOString(), from: "runs", name: "run-1600000000000-expird" }));
  await mkdir(jig("trash", "run-1600000000000-expird", "run-1600000000000-expird"));
  await writeFile(jig("trash", "run-1600000000000-expird", "run-1600000000000-expird", "steps.json"), "z".repeat(300));
  return orphan("jig-check-left");
}

describe("jig clean", () => {
  it("prints what it would do, with path, kind, size and why, and changes nothing", async () => {
    await fixture();
    const before = [...(await tree(project)), ...(await tree(tmp))];
    const text = await clean({});
    expect([...(await tree(project)), ...(await tree(tmp))]).toEqual(before);

    expect(text).toMatch(/would move to \.jig\/trash \(1, [\d.]+ KB\)\n {4}\.jig\/runs\/run-1700000000001-abcdef +run +[\d.]+ KB {3}not written for 45 days, more than 30/);
    expect(text).toMatch(/would delete from the trash for good \(1, \d+ B\)\n {4}\.jig\/trash\/run-1600000000000-expird +trash +\d+ B {3}in the trash for 9 days, more than 7/);
    expect(text).toMatch(/would delete temp folders left by Jig processes that ended \(1, [\d.]+ KB\)\n {4}\S*jig-check-left +temp +[\d.]+ KB {3}its process 999999 has ended; untouched for 1 day/);
    expect(text).toMatch(/from before Jig marked its records: never moved or deleted by the policy \(2, /);
    expect(text).toMatch(/\.jig\/runs\/a-link +run +\d+ B {3}left alone: it is a symlink/);
    expect(text).toMatch(/\.jig\/runs\/run-1700000000002-abcdef +run +\d+ B {3}exactly Jig's shape: jig clean --adopt marks it/);
    expect(text).toContain("kept 30 days and up to 500 MB, then 7 days in the trash");
    expect(text).toContain("nothing changed: jig clean --yes does it");
    expect(existsSync(jig("housekeeping.log"))).toBe(false);
  });

  it("does it with --yes, through the guard, and writes each action to the log", async () => {
    const left = await fixture();
    const text = await clean({ yes: true });
    expect(text).toMatch(/✓ moved 1 record, [\d.]+ KB, to \.jig\/trash; deleted 1 trash entry for good; deleted 1 temp folder, [\d.]+ KB/);
    expect(existsSync(jig("runs", id(1)))).toBe(false);
    expect(existsSync(jig("trash", id(1), id(1), "steps.json"))).toBe(true);
    expect(existsSync(jig("trash", "run-1600000000000-expird"))).toBe(false);
    expect(existsSync(left)).toBe(false);
    // What is not Jig's is where it was.
    expect(existsSync(jig("runs", id(2), "steps.json"))).toBe(true);
    expect((await lstat(jig("runs", "a-link"))).isSymbolicLink()).toBe(true);
    expect(await readFile(jig("settings.local.json"), "utf-8")).toBe("{}");
    const log = (await readFile(jig("housekeeping.log"), "utf-8")).trim().split("\n");
    expect(log).toHaveLength(3);
    expect(log.map((l) => l.split(" ")[1])).toEqual(["moved", "deleted", "deleted"]);
  });

  it("restores, pins and empties the trash by name", async () => {
    await fixture();
    await clean({ yes: true });
    expect(await clean({ restore: id(1) })).toContain(`✓ restored run ${id(1)} to .jig/runs/${id(1)}`);
    expect(existsSync(jig("runs", id(1), "steps.json"))).toBe(true);
    expect(await clean({ keep: id(1) })).toContain(`✓ ${id(1)} is pinned: Jig never moves it`);
    expect(await clean({})).not.toContain("would move");
    expect(await clean({ unkeep: id(1) })).toContain(`✓ ${id(1)} is released`);
    expect(await clean({ restore: "nothing-here" })).toContain("✗ nothing called nothing-here in .jig/trash");
    // A restored run starts its days again, so another old run is what goes to the trash next.
    await run(id(3), 45);
    await clean({ yes: true });
    expect(existsSync(jig("runs", id(1), "steps.json"))).toBe(true);
    const emptied = await clean({ emptyTrash: true });
    expect(emptied).toMatch(/deleting for good \(1, \d+ B\)\n {4}\.jig\/trash\/run-1700000000003-abcdef +trash/);
    expect(emptied).toContain("✓ deleted 1 entry");
    expect(await readdir(jig("trash"))).toEqual([]);
  });

  it("adopts only what has exactly Jig's shape", async () => {
    await fixture();
    const text = await clean({ adopt: true });
    expect(text).toContain(`✓ adopted run .jig/runs/${id(2)}`);
    expect(existsSync(jig("runs", id(2), MARKER))).toBe(true);
    expect(existsSync(jig("runs", "a-link", MARKER))).toBe(false);
  });
});

describe("jig doctor's disk", () => {
  it("shows .jig's size, the trash's, and the temp folders left by Jig processes that ended", async () => {
    await fixture();
    const text = (await diskLines(project, { tmpRoot: tmp, alive: dead })).map(strip).join("\n");
    expect(text).toMatch(/\.jig here +[\d.]+ KB/);
    expect(text).toMatch(/\.jig\/trash +\d+ B {3}deleted for good after its days/);
    expect(text).toMatch(/orphaned temp +[\d.]+ KB {3}1 folder left by Jig processes that ended/);
    expect(text).toContain("jig-check-left");
  });
});

describe("jig run's cleanup", () => {
  it("marks the run it records, cleans up while it runs, and says once what it did", async () => {
    for (let i = 10; i < 30; i++) await run(id(i), 1);
    for (let i = 1; i <= 2; i++) await run(id(i), 45);
    const left = await orphan("jig-check-left");
    const notes: string[] = [];
    const io: RunnerIO = { out: () => {}, note: (l) => notes.push(strip(l)) };
    const r = await runTopology(
      { topology: "ralph-loop", task: "say hello", dir: project, json: true, iterations: "1", delay: "0" },
      io,
      { provider: scriptedProvider(), storage: null, handleSignals: false, housekeeping: { tmpRoot: tmp, alive: dead } },
    );
    const marker = JSON.parse(await readFile(jig("runs", r.runId, MARKER), "utf-8"));
    expect(marker).toMatchObject({ kind: "run", pid: process.pid });
    expect(existsSync(jig("runs", id(1)))).toBe(false);
    expect(existsSync(left)).toBe(false);
    const said = notes.filter((n) => /moved|deleted/.test(n));
    expect(said).toEqual([
      expect.stringMatching(/^ {2}moved 2 old runs, \d+ B, to \.jig\/trash; deleted for good after 7 days; jig clean --restore brings one back$/),
      "  deleted 1 temp folder left by Jig processes that ended",
    ]);
  });
});
