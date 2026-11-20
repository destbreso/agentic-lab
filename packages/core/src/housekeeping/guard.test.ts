// The guard under attack: Jig's cleanup is run as hard as it goes over a
// project and a temp folder full of things that are not Jig's to delete
// (symlinks to the home folder and the project, folders shaped like runs
// without the marker, names that walk up, a resumable session's run, a pinned
// run, the 20 most recent runs, the person's settings, the legacy folder, a
// temp folder of a live process, a young one, markers of the wrong kind, a
// project's roots and .jig as symlinks), and every one of them must survive,
// while the real candidates beside them go. The temp folder alone is taken by
// its real path. Fixtures live in a fresh temp folder per test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MARKER, SESSION_MARKER_FIELD, bootTime, newMarker, sessionMarker, type OwnedKind } from "./marker.js";
import { inspect, moveToTrash, projectRoot, removeOwned, restoreFromTrash, tempRoot } from "./guard.js";
import { emptyTrash, keepRun, restoreRecord, survey } from "./records.js";
import { housekeep } from "./index.js";
import { findOrphans, makeTempDir, removeTempDir, sweepTemp } from "./temp.js";

const DAY = 86_400_000;
const DEAD = 999_999;
const dead = () => false;

let base: string;
let project: string;
let home: string;
let tmp: string;

beforeEach(async () => {
  // By its real path, as Jig takes the temp folder (on a Mac, /var is a symlink to /private/var).
  base = await realpath(await mkdtemp(join(tmpdir(), "hk-guard-")));
  project = join(base, "project");
  home = join(base, "home");
  tmp = join(base, "tmp");
  for (const d of [project, home, tmp]) await mkdir(d);
  await writeFile(join(home, "precious.txt"), "mine");
  // The home folder even carries a run's marker, so only the guard's other rules can save it.
  await writeFile(join(home, MARKER), JSON.stringify(marker("run", 100)));
  await writeFile(join(project, "src.ts"), "code");
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const ago = (days: number) => new Date(Date.now() - days * DAY);
const marker = (kind: OwnedKind, days: number, extra: Record<string, unknown> = {}) => ({ ...newMarker(kind, "a test's", { createdAt: ago(days).toISOString() }), pid: DEAD, ...extra });
async function age(p: string, days: number) {
  await utimes(p, ago(days), ago(days));
}

/** A run folder as Jig writes it, marked unless told not to, its files as old as asked. */
async function run(root: string, name: string, o: { days?: number; bytes?: number; sessionId?: string; marked?: boolean; extra?: Record<string, unknown> } = {}) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "steps.json"), "x".repeat(o.bytes ?? 100));
  await writeFile(join(dir, "record.json"), JSON.stringify({ runId: name, ...(o.sessionId ? { sessionId: o.sessionId } : {}) }));
  if (o.marked !== false) await writeFile(join(dir, MARKER), JSON.stringify(marker("run", o.days ?? 40, o.extra)));
  for (const f of await readdir(dir)) await age(join(dir, f), o.days ?? 40);
  return dir;
}

async function session(root: string, id: string, o: { days?: number; marked?: boolean; field?: unknown } = {}) {
  const file = join(root, `${id}.json`);
  await mkdir(dirname(file), { recursive: true });
  const t = ago(o.days ?? 40).toISOString();
  const field = o.field ?? (o.marked === false ? undefined : { ...sessionMarker(t), pid: DEAD });
  await writeFile(file, JSON.stringify({ id, version: 1, createdAt: t, updatedAt: t, workingDir: project, settings: {}, messages: [], ...(field ? { [SESSION_MARKER_FIELD]: field } : {}) }));
  await age(file, o.days ?? 40);
  return file;
}

async function tempFolder(root: string, name: string, m: Record<string, unknown> | null, hoursAgo = 3) {
  const dir = join(root, name);
  await mkdir(join(dir, "ws"), { recursive: true });
  await writeFile(join(dir, "ws", "copy.txt"), "a copy");
  if (m) await writeFile(join(dir, MARKER), JSON.stringify(m));
  const t = new Date(Date.now() - hoursAgo * 3_600_000);
  await utimes(dir, t, t);
  return dir;
}

const exists = async (p: string) => Boolean(await lstat(p).catch(() => null));
const jig = (...parts: string[]) => join(project, ".jig", ...parts);

describe("the guard: nothing that is not Jig's survives less than intact", () => {
  it("survives Jig's hardest cleanup: everything not Jig's stays, and only the real candidates beside it go", async () => {
    const runs = jig("runs");
    await mkdir(runs, { recursive: true });
    await writeFile(jig(".gitignore"), "*\n");
    await writeFile(jig("settings.local.json"), '{"permissions":{"allow":["Shell(npm test *)"]}}');
    await writeFile(jig("history.jsonl"), '{"text":"hello"}\n');
    for (const f of [".gitignore", "settings.local.json", "history.jsonl"]) await age(jig(f), 400);

    // Symlinks in runs/: to the home folder (one named like a run, its target carrying a run's marker) and to the project.
    await symlink(home, join(runs, "evil-home"));
    await symlink(home, join(runs, "run-1700000000000-aaaaaa"));
    await symlink(project, join(runs, "evil-project"));
    // A folder shaped like a run, without the marker.
    await run(runs, "run-1600000000000-nomark", { days: 300, marked: false });
    // Markers of the wrong kind, and a marker that is a symlink to one in the home folder.
    await run(runs, "run-1700000000001-wrongk", { days: 300, marked: false });
    await writeFile(join(runs, "run-1700000000001-wrongk", MARKER), JSON.stringify(marker("temp", 300)));
    await run(runs, "run-1700000000002-mlinkd", { days: 300, marked: false });
    await symlink(join(home, MARKER), join(runs, "run-1700000000002-mlinkd", MARKER));
    // A marker that is not JSON.
    await run(runs, "run-1700000000003-broken", { days: 300, marked: false });
    await writeFile(join(runs, "run-1700000000003-broken", MARKER), "{ not json");
    // A pinned run and a run of a session that can still be resumed, both very old.
    await run(runs, "run-1700000000004-pinned", { days: 300, extra: { keep: true } });
    await session(jig("sessions"), "session-20261118000000-live", { days: 1 });
    await run(runs, "run-1700000000005-ofsess", { days: 300, sessionId: "session-20261118000000-live" });
    // 25 plain runs, 40 to 64 days old: the 20 most recent stay, the 5 oldest may go.
    const plain = Array.from({ length: 25 }, (_, i) => `run-17000000001${String(i).padStart(2, "0")}-plain${String.fromCharCode(97 + i)}`);
    for (const [i, name] of plain.entries()) await run(runs, name, { days: 40 + i });
    // Sessions: one without the marker, one that is a symlink to a marked file in the home folder, one with a marker of the wrong kind.
    await session(jig("sessions"), "session-20260101000000-oldx", { days: 300, marked: false });
    await writeFile(join(home, "session.json"), JSON.stringify({ id: "x", [SESSION_MARKER_FIELD]: { ...sessionMarker(ago(300).toISOString()), pid: DEAD } }));
    await symlink(join(home, "session.json"), jig("sessions", "session-20260101000000-link.json"));
    await session(jig("sessions"), "session-20260101000000-kind", { days: 300, field: marker("run", 300) });
    // The trash: an entry whose marker walks up, one whose item is a symlink to the home folder, one of the wrong kind, a plain folder.
    await mkdir(jig("trash", "walks-up"), { recursive: true });
    await writeFile(jig("trash", "walks-up", MARKER), JSON.stringify(marker("trash", 300, { trashedAt: ago(300).toISOString(), from: "runs", name: "../../../home" })));
    await mkdir(jig("trash", "sneaky"), { recursive: true });
    await writeFile(jig("trash", "sneaky", MARKER), JSON.stringify(marker("trash", 300, { trashedAt: ago(300).toISOString(), from: "runs", name: "inner" })));
    await symlink(home, jig("trash", "sneaky", "inner"));
    await mkdir(jig("trash", "wrong-kind"), { recursive: true });
    await writeFile(jig("trash", "wrong-kind", MARKER), JSON.stringify(marker("run", 300)));
    await mkdir(jig("trash", "plain-folder"), { recursive: true });
    await writeFile(jig("trash", "plain-folder", "notes.txt"), "mine");
    // The legacy folder, even with a marked old run in it.
    await run(join(project, ".agentic-lab", "runs"), "run-1500000000000-legacy", { days: 400 });
    await session(join(project, ".agentic-lab", "sessions"), "session-20250101000000-lgcy", { days: 400 });

    // The temp folder: a young orphan, a symlink with Jig's prefix to the home folder, markers of the wrong kind and of
    // another machine, a marked folder without Jig's prefix, and one real orphan as the control.
    await tempFolder(tmp, "jig-check-young", marker("temp", 0), 0);
    await symlink(home, join(tmp, "jig-check-link"));
    await tempFolder(tmp, "jig-check-kind", marker("run", 1));
    await tempFolder(tmp, "jig-play-elsewhere", marker("temp", 1, { host: "another-machine" }));
    await tempFolder(tmp, "other-tool-tmp", marker("temp", 1));
    await tempFolder(tmp, "jig-sight-nomarker", null);
    const orphan = await tempFolder(tmp, "jig-check-orphan", marker("temp", 1));

    const before = await readFile(jig("settings.local.json"), "utf-8");
    // As hard as it goes: a size limit of nothing, every process taken for ended, the trash emptied, and all of it twice.
    for (let pass = 0; pass < 2; pass++) {
      await housekeep(project, { settings: { keepDays: 30, maxMB: 0.000001, trashDays: 7 }, tmpRoot: tmp, alive: dead });
      await emptyTrash(project);
      await sweepTemp({ root: tmp, alive: dead });
    }

    // The home folder and the project, whole.
    expect(await readFile(join(home, "precious.txt"), "utf-8")).toBe("mine");
    expect(await exists(join(home, MARKER))).toBe(true);
    expect(await exists(join(home, "session.json"))).toBe(true);
    expect(await readFile(join(project, "src.ts"), "utf-8")).toBe("code");
    // Every symlink is still there, as a symlink.
    for (const l of ["evil-home", "run-1700000000000-aaaaaa", "evil-project"]) expect((await lstat(join(runs, l))).isSymbolicLink()).toBe(true);
    expect((await lstat(jig("sessions", "session-20260101000000-link.json"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(tmp, "jig-check-link"))).isSymbolicLink()).toBe(true);
    // Not Jig's, so not touched.
    for (const n of ["run-1600000000000-nomark", "run-1700000000001-wrongk", "run-1700000000002-mlinkd", "run-1700000000003-broken"]) expect(await exists(join(runs, n, "steps.json"))).toBe(true);
    for (const n of ["session-20260101000000-oldx", "session-20260101000000-kind"]) expect(await exists(jig("sessions", `${n}.json`))).toBe(true);
    for (const n of ["walks-up", "wrong-kind"]) expect(await exists(jig("trash", n, MARKER))).toBe(true);
    expect(await readFile(jig("trash", "plain-folder", "notes.txt"), "utf-8")).toBe("mine");
    // Kept by the rules, whatever their age and size.
    expect(await exists(join(runs, "run-1700000000004-pinned", "steps.json"))).toBe(true);
    expect(await exists(join(runs, "run-1700000000005-ofsess", "steps.json"))).toBe(true);
    expect(await exists(jig("sessions", "session-20261118000000-live.json"))).toBe(true);
    for (const name of plain.slice(0, 20)) expect(await exists(join(runs, name, "steps.json")), name).toBe(true);
    // The person's files in .jig and the legacy folder, as they were.
    expect(await readFile(jig("settings.local.json"), "utf-8")).toBe(before);
    expect(await readFile(jig(".gitignore"), "utf-8")).toBe("*\n");
    expect(await readFile(jig("history.jsonl"), "utf-8")).toBe('{"text":"hello"}\n');
    expect(await exists(join(project, ".agentic-lab", "runs", "run-1500000000000-legacy", "steps.json"))).toBe(true);
    expect(await exists(join(project, ".agentic-lab", "sessions", "session-20250101000000-lgcy.json"))).toBe(true);
    // The temp folders that are not orphans.
    for (const n of ["jig-check-young", "jig-check-kind", "jig-play-elsewhere", "other-tool-tmp", "jig-sight-nomarker"]) expect(await exists(join(tmp, n, "ws", "copy.txt")), n).toBe(true);

    // The controls: the real candidates did go.
    for (const name of plain.slice(20)) expect(await exists(join(runs, name)), name).toBe(false);
    expect(await exists(orphan)).toBe(false);
    // The trash entry whose item was a symlink to the home folder was Jig's entry: it went, and only the link with it.
    expect(await exists(jig("trash", "sneaky"))).toBe(false);
  });

  it("refuses names that walk up, everywhere a name comes in", async () => {
    await run(jig("runs"), "run-1700000000000-realrn", { days: 300 });
    const runs = projectRoot(project, "runs");
    for (const name of ["..", ".", "../..", "../../home", "a/../../home", "/etc", "run/..", "", ".jig-owned.json", "x\0y"]) {
      const r = await inspect(runs, name);
      expect(r.ok, JSON.stringify(name)).toBe(false);
    }
    expect((await restoreRecord(project, "../../home")).error).toMatch(/is not a name in \.jig\/trash/);
    expect((await keepRun(project, "../home", true)).ok).toBe(false);
    expect(await removeTempDir(home)).toBe(false);
    expect(await removeTempDir(join(tmp, "..", "home"))).toBe(false);
    expect(await exists(join(home, "precious.txt"))).toBe(true);
  });

  it("never touches a temp folder whose process is alive, however old", async () => {
    const child: ChildProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 100));
      const busy = await tempFolder(tmp, "jig-check-busy", marker("temp", 10, { pid: child.pid }), 240);
      const gone = await tempFolder(tmp, "jig-check-gone", marker("temp", 10), 240);
      // A live pid from before the machine last started is another process: its folder is an orphan.
      const reboot = await tempFolder(tmp, "jig-check-reboot", marker("temp", 10, { pid: child.pid, boot: bootTime() - 86_400 }), 240);
      // The real check of the process, no stub.
      const r = await sweepTemp({ root: tmp });
      expect(r.removed.map((x) => x.path).sort()).toEqual([gone, reboot].sort());
      expect(await exists(join(busy, "ws", "copy.txt"))).toBe(true);
      expect(await exists(gone)).toBe(false);
    } finally {
      child.kill();
    }
  });

  it("works in no root that is itself a symlink, nor through a .jig that is one", async () => {
    // A project whose .jig/runs and .jig/trash point elsewhere, holding Jig's own old runs and expired entries.
    const elsewhere = join(base, "elsewhere");
    await run(join(elsewhere, "runs"), "run-1700000000000-farawy", { days: 300 });
    await mkdir(join(elsewhere, "trash", "expired"), { recursive: true });
    await writeFile(join(elsewhere, "trash", "expired", MARKER), JSON.stringify(marker("trash", 300, { trashedAt: ago(300).toISOString(), from: "runs", name: "x" })));
    await mkdir(jig(), { recursive: true });
    await symlink(join(elsewhere, "runs"), jig("runs"));
    await symlink(join(elsewhere, "trash"), jig("trash"));
    // A second project whose whole .jig is a symlink.
    const other = join(base, "other");
    await mkdir(other);
    await run(join(base, "other-jig", "runs"), "run-1700000000000-viajig", { days: 300 });
    await symlink(join(base, "other-jig"), join(other, ".jig"));

    for (const p of [project, other]) {
      await housekeep(p, { settings: { keepDays: 1, maxMB: 0.000001, trashDays: 1 }, tmpRoot: tmp, alive: dead });
      await emptyTrash(p);
    }
    expect(await exists(join(elsewhere, "runs", "run-1700000000000-farawy", "steps.json"))).toBe(true);
    expect(await exists(join(elsewhere, "trash", "expired", MARKER))).toBe(true);
    expect(await exists(join(base, "other-jig", "runs", "run-1700000000000-viajig", "steps.json"))).toBe(true);
    // And the survey says why it would not look there.
    expect((await survey(project)).refused.map((r) => r.reason)).toContain("its folder is a symlink");
    expect((await survey(other)).refused.map((r) => r.reason)).toContain(".jig is a symlink or not a folder");
  });

  it("takes the temp folder by its real path, as the system's often is a symlink, and holds what is in it to every rule", async () => {
    // On a Mac /tmp is a symlink to /private/tmp; refusing it would leave every check copy behind.
    const real = join(base, "real-tmp");
    await tempFolder(real, "jig-check-orphan", marker("temp", 1));
    await tempFolder(real, "jig-check-nomark", null);
    await tempFolder(real, "other-tool", marker("temp", 1));
    await symlink(home, join(real, "jig-check-tohome"));
    await symlink(real, join(base, "tmp-link"));
    const mine = await makeTempDir("jig-play-", "a test's", join(base, "tmp-link"));
    expect(mine.startsWith(await realpath(real))).toBe(true);

    await sweepTemp({ root: join(base, "tmp-link"), alive: dead });
    expect(await exists(join(real, "jig-check-orphan"))).toBe(false);
    for (const n of ["jig-check-nomark", "other-tool"]) expect(await exists(join(real, n, "ws", "copy.txt")), n).toBe(true);
    expect((await lstat(join(real, "jig-check-tohome"))).isSymbolicLink()).toBe(true);
    expect(await exists(join(home, "precious.txt"))).toBe(true);
    // This process's own folder is in use, and goes only when it is done with it.
    expect(await exists(mine)).toBe(true);
    expect(await removeTempDir(join(base, "tmp-link", mine.split("/").pop()!))).toBe(true);
    expect(await exists(mine)).toBe(false);
  });

  it("asks again just before it acts: a candidate swapped for a symlink is refused", async () => {
    const dir = await run(jig("runs"), "run-1700000000000-swappd", { days: 300 });
    const found = await inspect(projectRoot(project, "runs"), "run-1700000000000-swappd");
    expect(found.ok).toBe(true);
    await rm(dir, { recursive: true });
    await symlink(home, dir);
    await expect(moveToTrash((found as { ok: true; candidate: import("./guard.js").Candidate }).candidate)).rejects.toThrow(/no longer Jig's to touch: it is a symlink/);
    const t = await makeTempDir("jig-check-", "a test's", tmp);
    const temp = await inspect(tempRoot(tmp), t.split("/").pop()!);
    await rm(t, { recursive: true });
    await symlink(home, t);
    await expect(removeOwned((temp as { ok: true; candidate: import("./guard.js").Candidate }).candidate)).rejects.toThrow(/no longer Jig's/);
    expect(await exists(join(home, "precious.txt"))).toBe(true);
  });

  it("deletes only temp folders and trash entries: a run or a session is never deleted where it is", async () => {
    await run(jig("runs"), "run-1700000000000-direct", { days: 300 });
    const found = await inspect(projectRoot(project, "runs"), "run-1700000000000-direct");
    if (!found.ok) throw new Error(found.reason);
    await expect(removeOwned(found.candidate)).rejects.toThrow(/never from runs directly/);
    expect(await exists(jig("runs", "run-1700000000000-direct", "steps.json"))).toBe(true);
  });

  it("refuses to restore an entry whose item is not as Jig left it", async () => {
    await mkdir(jig("trash", "sneaky"), { recursive: true });
    await writeFile(jig("trash", "sneaky", MARKER), JSON.stringify(marker("trash", 1, { trashedAt: ago(1).toISOString(), from: "runs", name: "inner" })));
    await symlink(home, jig("trash", "sneaky", "inner"));
    const found = await inspect(projectRoot(project, "trash"), "sneaky");
    if (!found.ok) throw new Error(found.reason);
    await expect(restoreFromTrash(found.candidate)).rejects.toThrow(/not in its trash entry as Jig left it/);
    expect(existsSync(jig("runs", "inner"))).toBe(false);
  });
});
