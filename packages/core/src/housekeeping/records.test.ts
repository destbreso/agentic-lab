// The records policy: runs and sessions moved to .jig/trash by age and by
// size, the trash's expiry, a restore that brings a session's runs back, pins,
// adopting records from before the marker, the log's one line per action, and
// the marker on every run and temp folder Jig makes now.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MARKER, SESSION_MARKER_FIELD, newMarker, sessionMarker } from "./marker.js";
import { inspect, moveToTrash, projectRoot } from "./guard.js";
import { MB } from "./disk.js";
import {
  HOUSEKEEPING_LOG,
  adoptRecords,
  applyPlan,
  ensureRunDir,
  housekeepingSettings,
  keepRun,
  planRecords,
  restoreRecord,
  survey,
} from "./records.js";
import { housekeep, housekeepingNotes } from "./index.js";
import { cloneTree, makeTempDir, removeTempDir, withTempDir } from "./temp.js";
import { IterationLogger } from "../engine/iteration-logger.js";

const DAY = 86_400_000;
const DEAD = 999_999;
const dead = () => false;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let project: string;
let tmp: string;
beforeEach(async () => {
  // By its real path, as Jig takes the temp folder (on a Mac, /var is a symlink to /private/var).
  project = await realpath(await mkdtemp(join(tmpdir(), "hk-records-")));
  tmp = join(project, "tmp");
  await mkdir(tmp);
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const jig = (...parts: string[]) => join(project, ".jig", ...parts);

async function run(name: string, o: { days?: number; bytes?: number; sessionId?: string; marked?: boolean; extra?: Record<string, unknown> } = {}) {
  const dir = jig("runs", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "steps.json"), "x".repeat(o.bytes ?? 100));
  await writeFile(join(dir, "record.json"), JSON.stringify({ runId: name, ...(o.sessionId ? { sessionId: o.sessionId } : {}) }));
  if (o.marked !== false) await writeFile(join(dir, MARKER), JSON.stringify({ ...newMarker("run", "a test's", { createdAt: ago(o.days ?? 40).toISOString() }), pid: DEAD, ...(o.extra ?? {}) }));
  for (const f of await readdir(dir)) await utimes(join(dir, f), ago(o.days ?? 40), ago(o.days ?? 40));
  return dir;
}

async function session(id: string, o: { days?: number; marked?: boolean; pid?: number; extra?: Record<string, unknown> } = {}) {
  const file = jig("sessions", `${id}.json`);
  await mkdir(dirname(file), { recursive: true });
  const t = ago(o.days ?? 40).toISOString();
  const field = o.marked === false ? {} : { [SESSION_MARKER_FIELD]: { ...sessionMarker(t), pid: o.pid ?? DEAD } };
  await writeFile(file, JSON.stringify({ id, version: 1, createdAt: t, updatedAt: t, workingDir: project, settings: {}, messages: [], ...field, ...(o.extra ?? {}) }, null, 1));
  return file;
}

const names = (xs: Array<{ entry: { name: string } }>) => xs.map((x) => x.entry.name).sort();
const log = async () => (existsSync(jig(HOUSEKEEPING_LOG)) ? (await readFile(jig(HOUSEKEEPING_LOG), "utf-8")).trim().split("\n") : []);
const id = (i: number) => `run-1700000000${String(i).padStart(3, "0")}-abcdef`;

describe("the records policy", () => {
  it("moves what is older than keepDays to the trash, past the 20 most recent, each move a line in the log", async () => {
    for (let i = 1; i <= 21; i++) await run(id(i), { days: i });
    for (const d of [35, 40, 45]) await run(id(100 + d), { days: d });
    const s = await survey(project, { alive: dead });
    const plan = planRecords(s, housekeepingSettings({}), Date.now());
    expect(names(plan.moves)).toEqual([id(135), id(140), id(145)]);
    expect(plan.moves.find((m) => m.entry.name === id(135))?.why).toBe("not written for 35 days, more than 30");
    expect(plan.deletes).toEqual([]);

    const applied = await applyPlan(project, plan);
    expect(applied.failed).toEqual([]);
    for (const d of [35, 40, 45]) {
      expect(existsSync(jig("runs", id(100 + d)))).toBe(false);
      expect(existsSync(jig("trash", id(100 + d), id(100 + d), "steps.json"))).toBe(true);
      const m = JSON.parse(await readFile(jig("trash", id(100 + d), MARKER), "utf-8"));
      expect(m).toMatchObject({ kind: "trash", from: "runs", name: id(100 + d) });
    }
    // The 21-day run is not one of the 20 most recent, and still younger than the limit.
    expect(existsSync(jig("runs", id(21), "steps.json"))).toBe(true);
    const lines = await log();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z moved run \.jig\/runs\/run-1700000000135-abcdef \(\d+ B\) to \.jig\/trash\/run-1700000000135-abcdef: not written for 35 days, more than 30$/);
  });

  it("keeps the 20 most recent runs whatever their age, and says so", async () => {
    for (let i = 1; i <= 22; i++) await run(id(i), { days: 100 + i });
    const plan = planRecords(await survey(project, { alive: dead }), housekeepingSettings({}), Date.now());
    expect(names(plan.moves)).toEqual([id(21), id(22)]);
    expect(plan.kept.filter((k) => k.why === "one of the 20 most recent runs")).toHaveLength(20);
  });

  it("over maxMB, moves the oldest runs that may go, and only as many as it takes", async () => {
    for (let i = 1; i <= 20; i++) await run(id(i), { days: i, bytes: 10_000 });
    for (let i = 21; i <= 25; i++) await run(id(i), { days: i, bytes: 400_000 });
    const s = await survey(project, { alive: dead });
    const settings = housekeepingSettings({ maxMB: 1 });
    const plan = planRecords(s, settings, Date.now());
    const moved = plan.moves.map((m) => m.entry);
    // The oldest first, every one of them from the five that are not among the 20 most recent.
    expect(moved.map((e) => e.name)).toEqual([id(25), id(24), id(23), id(22), id(21)].slice(0, moved.length));
    expect(moved.length).toBeGreaterThan(0);
    for (const m of plan.moves) expect(m.why).toBe("the records are over 1 MB, and it is the oldest run that may go");
    const left = plan.recordsBytes - moved.reduce((n, e) => n + e.bytes, 0);
    expect(left).toBeLessThanOrEqual(MB);
    expect(left + moved.at(-1)!.bytes).toBeGreaterThan(MB);
    expect(plan.overBy).toBe(0);
  });

  it("deletes a trash entry for good only after trashDays, and the log says so", async () => {
    await run(id(1), { days: 50 });
    await run(id(2), { days: 50 });
    for (const [name, days] of [
      [id(1), 10],
      [id(2), 2],
    ] as const) {
      const found = await inspect(projectRoot(project, "runs"), name);
      if (!found.ok) throw new Error(found.reason);
      await moveToTrash(found.candidate, ago(days));
    }
    const plan = planRecords(await survey(project), housekeepingSettings({}), Date.now());
    expect(plan.deletes.map((d) => [d.entry.name, d.why])).toEqual([[id(1), "in the trash for 10 days, more than 7"]]);
    await applyPlan(project, plan);
    expect(existsSync(jig("trash", id(1)))).toBe(false);
    expect(existsSync(jig("trash", id(2), id(2), "steps.json"))).toBe(true);
    expect((await log()).at(-1)).toMatch(/ deleted \.jig\/trash\/run-1700000000001-abcdef \(\d+ B\) for good: in the trash for 10 days, more than 7$/);
  });

  it("moves an old session, and with it the protection of its runs; a session still open or running is never moved", async () => {
    await session("session-20260901000000-gone", { days: 60 });
    await run(id(1), { days: 60, sessionId: "session-20260901000000-gone" });
    await session("session-20260901000000-open", { days: 60 });
    await run(id(2), { days: 60, sessionId: "session-20260901000000-open" });
    await session("session-20260901000000-busy", { days: 60, pid: process.pid });
    await run(id(3), { days: 60, sessionId: "session-20260901000000-busy" });
    // Twenty young runs, so the old ones are not among the most recent.
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    const plan = planRecords(await survey(project), housekeepingSettings({}), Date.now(), { openSession: "session-20260901000000-open" });
    expect(names(plan.moves)).toEqual([id(1), "session-20260901000000-gone.json"]);
    expect(plan.kept.map((k) => k.why)).toEqual(
      expect.arrayContaining(["it is the session being opened", "its process is still running", "its session session-20260901000000-open can still be resumed", "its session session-20260901000000-busy can still be resumed"]),
    );
  });

  it("keeps the runs of a session that can be resumed from the legacy folder, which it only reads", async () => {
    await mkdir(join(project, ".agentic-lab", "sessions"), { recursive: true });
    await writeFile(join(project, ".agentic-lab", "sessions", "session-20250101000000-lgcy.json"), "{}");
    await run(id(1), { days: 90, sessionId: "session-20250101000000-lgcy" });
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    const plan = planRecords(await survey(project, { alive: dead }), housekeepingSettings({}), Date.now());
    expect(plan.moves).toEqual([]);
    expect(plan.kept.map((k) => k.why)).toEqual(["its session session-20250101000000-lgcy can still be resumed"]);
  });

  it("restores a session from the trash with its runs, and the restored records start their days again", async () => {
    await session("session-20260901000000-back", { days: 60 });
    await run(id(1), { days: 60, sessionId: "session-20260901000000-back" });
    await run(id(2), { days: 60 });
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    await applyPlan(project, planRecords(await survey(project, { alive: dead }), housekeepingSettings({}), Date.now()));
    expect(existsSync(jig("sessions", "session-20260901000000-back.json"))).toBe(false);
    expect(existsSync(jig("runs", id(1)))).toBe(false);

    const r = await restoreRecord(project, "session-20260901000000-back");
    expect(r.error).toBeUndefined();
    expect(r.restored.map((x) => [x.kind, x.name])).toEqual([
      ["session", "session-20260901000000-back.json"],
      ["run", id(1)],
    ]);
    expect(existsSync(jig("sessions", "session-20260901000000-back.json"))).toBe(true);
    expect(existsSync(jig("runs", id(1), "steps.json"))).toBe(true);
    expect(existsSync(jig("trash", "session-20260901000000-back"))).toBe(false);
    // The other run stays in the trash until it is asked for by name.
    expect(existsSync(jig("trash", id(2), id(2)))).toBe(true);
    const again = planRecords(await survey(project, { alive: dead }), housekeepingSettings({}), Date.now());
    expect(names(again.moves)).toEqual([]);
    expect((await log()).filter((l) => l.includes(" restored "))).toHaveLength(2);

    expect((await restoreRecord(project, id(2))).restored.map((x) => x.name)).toEqual([id(2)]);
    expect((await restoreRecord(project, "run-1700000000999-nopeno")).error).toMatch(/nothing called run-1700000000999-nopeno in \.jig\/trash/);
  });

  it("never moves a pinned run, until it is released", async () => {
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    await run(id(1), { days: 90 });
    expect(await keepRun(project, id(1), true)).toEqual({ ok: true, message: `${id(1)} is pinned: Jig never moves it` });
    let plan = planRecords(await survey(project, { alive: dead }), housekeepingSettings({}), Date.now());
    expect(plan.moves).toEqual([]);
    expect(plan.kept.map((k) => k.why)).toEqual(["pinned (jig clean --unkeep releases it)"]);
    expect((await keepRun(project, id(1), false)).ok).toBe(true);
    plan = planRecords(await survey(project, { alive: dead }), housekeepingSettings({}), Date.now());
    expect(names(plan.moves)).toEqual([id(1)]);
    // A run from before the marker, and one in the trash, are said apart.
    await run(id(2), { days: 90, marked: false });
    expect((await keepRun(project, id(2), true)).message).toMatch(/from before Jig marked its runs/);
    await applyPlan(project, plan);
    expect((await keepRun(project, id(1), true)).message).toBe(`${id(1)} is in the trash: jig clean --restore ${id(1)} brings it back`);
  });

  it("never moves a record from before the marker; --adopt marks only the ones whose shape is exactly Jig's", async () => {
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    await run(id(1), { days: 90, marked: false });
    const extra = await run(id(2), { days: 90, marked: false });
    await writeFile(join(extra, "notes.txt"), "the person's own");
    await run("my-experiment", { days: 90, marked: false });
    await session("session-20260101000000-oldy", { days: 90, marked: false });
    await session("session-20260101000000-more", { days: 90, marked: false, extra: { mine: true } });

    let s = await survey(project, { alive: dead });
    expect(planRecords(s, housekeepingSettings({ maxMB: 0.000001 }), Date.now()).moves).toEqual([]);
    expect(s.unowned.filter((u) => u.adoptable).map((u) => u.name).sort()).toEqual([id(1), "session-20260101000000-oldy.json"]);

    const adopted = await adoptRecords(project, { apply: true });
    expect(adopted.filter((a) => a.adopted).map((a) => a.entry.name).sort()).toEqual([id(1), "session-20260101000000-oldy.json"]);
    s = await survey(project, { alive: dead });
    expect(s.unowned.map((u) => u.name).sort()).toEqual(["my-experiment", id(2), "session-20260101000000-more.json"]);
    // Adopted, their age is their own: the policy may move them now.
    expect(names(planRecords(s, housekeepingSettings({}), Date.now()).moves)).toEqual([id(1), "session-20260101000000-oldy.json"]);
    expect(await readFile(join(extra, "notes.txt"), "utf-8")).toBe("the person's own");
    expect((await log()).filter((l) => l.includes(" adopted "))).toHaveLength(2);
  });

  it("with auto off, leaves the records alone at startup but still sweeps Jig's orphaned temp folders", async () => {
    await run(id(1), { days: 900 });
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    const orphan = join(tmp, "jig-check-left");
    await mkdir(orphan);
    await writeFile(join(orphan, MARKER), JSON.stringify({ ...newMarker("temp", "a test's", { createdAt: ago(1).toISOString() }), pid: DEAD }));
    await utimes(orphan, ago(1), ago(1));
    const r = await housekeep(project, { settings: { auto: false }, tmpRoot: tmp, alive: dead });
    expect(r.applied).toBeNull();
    expect(r.temp.map((t) => t.path)).toEqual([orphan]);
    expect(existsSync(jig("runs", id(1), "steps.json"))).toBe(true);
    expect(r.notes).toEqual(["deleted 1 temp folder left by Jig processes that ended"]);
  });

  it("says what it moved once, in the words of the session's note", async () => {
    for (let i = 10; i < 30; i++) await run(id(i), { days: 1 });
    for (let i = 1; i <= 3; i++) await run(id(i), { days: 40, bytes: 1000 });
    const r = await housekeep(project, { tmpRoot: tmp, alive: dead });
    expect(r.notes).toEqual([expect.stringMatching(/^moved 3 old runs, [\d.]+ KB, to \.jig\/trash; deleted for good after 7 days; jig clean --restore brings one back$/)]);
    expect(housekeepingNotes({ temp: [], applied: null }, housekeepingSettings({}))).toEqual([]);
  });

  it("reads the config's values, and keeps a default for anything that is not a positive number", () => {
    expect(housekeepingSettings({})).toEqual({ keepDays: 30, maxMB: 500, trashDays: 7, auto: true });
    expect(housekeepingSettings({ keepDays: 3, maxMB: 50, trashDays: 1, auto: false })).toEqual({ keepDays: 3, maxMB: 50, trashDays: 1, auto: false });
    expect(housekeepingSettings({ keepDays: 0, maxMB: -1, trashDays: "7" as unknown as number })).toEqual({ keepDays: 30, maxMB: 500, trashDays: 7, auto: true });
  });
});

describe("what Jig marks when it makes it", () => {
  it("marks a run's folder when it makes it, and never a folder that was already there", async () => {
    const dir = await ensureRunDir(project, "run-1700000000000-newrun");
    expect(JSON.parse(await readFile(join(dir, MARKER), "utf-8"))).toMatchObject({ kind: "run", pid: process.pid });
    await mkdir(jig("runs", "run-1700000000000-oldrun"));
    await ensureRunDir(project, "run-1700000000000-oldrun");
    expect(existsSync(jig("runs", "run-1700000000000-oldrun", MARKER))).toBe(false);
    // IterationLogger, which jig run and the session save results through, makes it the same way.
    await new IterationLogger(project, "run-1700000000001-logged").init();
    expect((await inspect(projectRoot(project, "runs"), "run-1700000000001-logged")).ok).toBe(true);
  });

  it("makes its temp folders with the prefix and the marker, and removes only its own", async () => {
    const dir = await makeTempDir("jig-check-", "a test's", tmp);
    expect(dir.startsWith(join(tmp, "jig-check-"))).toBe(true);
    expect(JSON.parse(await readFile(join(dir, MARKER), "utf-8"))).toMatchObject({ kind: "temp", pid: process.pid, purpose: "a test's" });
    // Another process's folder is not this one's to remove, even when Jig's.
    const theirs = join(tmp, "jig-check-theirs");
    await mkdir(theirs);
    await writeFile(join(theirs, MARKER), JSON.stringify({ ...newMarker("temp", "a test's"), pid: DEAD }));
    expect(await removeTempDir(theirs)).toBe(false);
    expect(existsSync(theirs)).toBe(true);
    expect(await removeTempDir(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
    await expect(withTempDir("jig-play-", "a test's", async (d) => {
      await writeFile(join(d, "x"), "y");
      throw new Error("the work failed");
    }, tmp)).rejects.toThrow("the work failed");
    expect((await readdir(tmp)).sort()).toEqual(["jig-check-theirs"]);
  });

  it("copies a workspace as clones where it can: the same files, symlinks kept as links, and a copy that changes nothing in the source", async () => {
    const src = join(project, "src-ws");
    await mkdir(join(src, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(src, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    await writeFile(join(src, "run.sh"), "echo hi\n", { mode: 0o755 });
    await symlink("pkg/index.js", join(src, "node_modules", "link.js"));
    await symlink(join(project, "outside"), join(src, "dangling"));
    const dest = join(tmp, "copy");
    await cloneTree(src, dest);
    expect(await readFile(join(dest, "node_modules", "pkg", "index.js"), "utf-8")).toBe("module.exports = 1;\n");
    expect(await readlink(join(dest, "node_modules", "link.js"))).toBe("pkg/index.js");
    expect(await readlink(join(dest, "dangling"))).toBe(join(project, "outside"));
    expect((await stat(join(dest, "run.sh"))).mode & 0o111).not.toBe(0);
    await writeFile(join(dest, "node_modules", "pkg", "index.js"), "changed");
    expect(await readFile(join(src, "node_modules", "pkg", "index.js"), "utf-8")).toBe("module.exports = 1;\n");
  });
});
