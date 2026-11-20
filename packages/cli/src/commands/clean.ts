// ============================================
// jig clean: what Jig keeps on disk, and cleaning it up on purpose
// ============================================
// With no flags it shows what the policy would do (path, kind, size, why)
// and changes nothing; --yes does it. --empty-trash deletes the trash now,
// after listing it; --restore brings an entry back; --keep and --unkeep pin
// and release a run; --adopt marks the records from before Jig marked them
// whose shape is exactly Jig's. Every change goes through jig-core's
// housekeeping, which acts only on what Jig made.

import * as path from "node:path";
import chalk from "chalk";
import {
  adoptRecords,
  applyPlan,
  appendLog,
  emptyTrash,
  findOrphans,
  formatAge,
  formatBytes,
  housekeepingSettings,
  keepRun,
  loadConfig,
  planRecords,
  restoreRecord,
  sizeOf,
  survey,
  sweepTemp,
  type RecordEntry,
} from "jig-core";
import { shown } from "../display-path.js";

export interface CleanOptions {
  dir?: string;
  yes?: boolean;
  emptyTrash?: boolean;
  restore?: string;
  keep?: string;
  unkeep?: string;
  adopt?: boolean;
}

export interface CleanDeps {
  /** The temp folder to look in (the system's by default). */
  tmpRoot?: string;
  now?: number;
  alive?: (pid: number) => boolean;
  out?: (line: string) => void;
}

const total = (xs: Array<{ bytes: number }>) => xs.reduce((n, x) => n + x.bytes, 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function cleanCommand(options: CleanOptions, deps: CleanDeps = {}): Promise<void> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const workingDir = path.resolve(options.dir ?? ".");
  const rel = (p: string) => {
    const r = path.relative(workingDir, p);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : shown(p);
  };
  const row = (p: string, kind: string, bytes: number, why: string) => `    ${rel(p).padEnd(46)} ${kind.padEnd(8)} ${formatBytes(bytes).padStart(9)}   ${why}`;
  const fail = (message: string) => {
    out(chalk.red(`  ✗ ${message}`));
    process.exitCode = 1;
  };
  const config = await loadConfig(workingDir);
  const settings = housekeepingSettings(config.housekeeping);
  const now = deps.now ?? Date.now();
  const temp = { ...(deps.tmpRoot ? { root: deps.tmpRoot } : {}), now, ...(deps.alive ? { alive: deps.alive } : {}) };

  // ---- The actions asked for by name ----
  let acted = false;
  for (const [id, keep] of [
    [options.keep, true],
    [options.unkeep, false],
  ] as const) {
    if (!id) continue;
    acted = true;
    const r = await keepRun(workingDir, id, keep);
    if (r.ok) out(chalk.green(`  ✓ ${r.message}`));
    else fail(r.message);
  }
  if (options.restore) {
    acted = true;
    const r = await restoreRecord(workingDir, options.restore);
    for (const x of r.restored) out(chalk.green(`  ✓ restored ${x.kind} ${x.name} to ${rel(x.to)}`));
    if (r.error) fail(r.error);
  }
  if (options.adopt) {
    acted = true;
    const r = await adoptRecords(workingDir, { apply: true });
    if (!r.length) out("  nothing to adopt: no record from before Jig marked them has exactly Jig's shape");
    for (const x of r) {
      if (x.adopted) out(chalk.green(`  ✓ adopted ${x.entry.kind} ${rel(x.entry.path)} (${formatBytes(x.entry.bytes)}): the policy applies to it now`));
      else fail(`${rel(x.entry.path)} was not adopted: ${x.reason ?? "it changed"}`);
    }
    if (r.some((x) => x.adopted)) out(chalk.gray("  jig clean shows what the policy would do with them"));
  }
  if (options.emptyTrash) {
    acted = true;
    const s = await survey(workingDir);
    if (!s.trash.length) out("  .jig/trash is empty");
    else {
      out(chalk.bold(`  deleting for good (${s.trash.length}, ${formatBytes(total(s.trash))})`));
      for (const t of s.trash) out(row(t.path, "trash", t.bytes, `${t.from === "runs" ? "run" : "session"} ${t.item}, in the trash for ${formatAge(now - t.trashedAt)}`));
      const r = await emptyTrash(workingDir, s);
      out(chalk.green(`  ✓ deleted ${plural(r.deleted.length, "entry", "entries")}, ${formatBytes(total(r.deleted))}`));
      for (const f of r.failed) fail(`${f.name} was kept: ${f.reason}`);
    }
    for (const x of s.strays) out(chalk.gray(`  left alone in .jig/trash: ${x.name} (${x.reason})`));
  }
  if (acted && !options.yes) return;
  if (acted) out("");

  // ---- What the policy would do ----
  const s = await survey(workingDir, deps.alive ? { alive: deps.alive } : {});
  const plan = planRecords(s, settings, now);
  const orphans = [];
  for (const o of (await findOrphans(temp)).orphans) orphans.push({ ...o, bytes: await sizeOf(o.path) });
  const recordsBytes = total([...s.runs, ...s.sessions]);
  const legacyBytes = total(s.unowned);
  out(chalk.bold(`  .jig in ${shown(workingDir)}: ${formatBytes(await sizeOf(path.join(workingDir, ".jig")))}`));
  out(chalk.gray(`  Jig's records ${formatBytes(recordsBytes)} (${plural(s.runs.length, "run")}, ${plural(s.sessions.length, "session")}), the trash ${formatBytes(total(s.trash))}${s.unowned.length ? `, from before Jig marked them ${formatBytes(legacyBytes)}` : ""}`));
  out(chalk.gray(`  kept ${settings.keepDays} days and up to ${settings.maxMB} MB, then ${settings.trashDays} days in the trash${settings.auto ? "" : "; automatic cleaning is off"} ("housekeeping" in your config)`));
  for (const r of s.refused) out(chalk.yellow(`  ! Jig does not clean in ${r.folder}: ${r.reason}`));

  const verb = options.yes ? "" : "would ";
  if (plan.moves.length) {
    out(chalk.bold(`\n  ${verb}move to .jig/trash (${plan.moves.length}, ${formatBytes(total(plan.moves.map((m) => m.entry)))})`));
    for (const m of plan.moves) out(row(m.entry.path, m.entry.kind, m.entry.bytes, m.why));
  }
  if (plan.deletes.length) {
    out(chalk.bold(`\n  ${verb}delete from the trash for good (${plan.deletes.length}, ${formatBytes(total(plan.deletes.map((d) => d.entry)))})`));
    for (const d of plan.deletes) out(row(d.entry.path, "trash", d.entry.bytes, d.why));
  }
  if (orphans.length) {
    out(chalk.bold(`\n  ${verb}delete temp folders left by Jig processes that ended (${orphans.length}, ${formatBytes(total(orphans))})`));
    for (const o of orphans) out(row(o.path, "temp", o.bytes, `its process ${o.pid} has ended; untouched for ${formatAge(o.idleMs)}`));
  }
  if (plan.kept.length) {
    out(chalk.bold("\n  kept, though past the limits"));
    const byWhy = new Map<string, RecordEntry[]>();
    for (const k of plan.kept) byWhy.set(k.why, [...(byWhy.get(k.why) ?? []), k.entry]);
    for (const [why, entries] of byWhy) out(`    ${plural(entries.length, entries[0].kind)}: ${why}`);
  }
  if (plan.overBy > 0) out(chalk.yellow(`  ! still ${formatBytes(plan.overBy)} over ${settings.maxMB} MB after the moves: the rest is kept by the rules above`));
  if (s.unowned.length) {
    out(chalk.bold(`\n  from before Jig marked its records: never moved or deleted by the policy (${s.unowned.length}, ${formatBytes(legacyBytes)})`));
    for (const u of s.unowned) out(row(u.path, u.kind, u.bytes, u.adoptable ? "exactly Jig's shape: jig clean --adopt marks it" : `left alone: ${u.notOwned}`));
  }
  for (const x of s.strays) out(chalk.gray(`  left alone in .jig/trash: ${x.name} (${x.reason})`));

  const nothing = !plan.moves.length && !plan.deletes.length && !orphans.length;
  if (!options.yes) {
    out(nothing ? chalk.gray("\n  nothing to clean") : chalk.gray("\n  nothing changed: jig clean --yes does it; jig clean --restore <name> brings back what was moved"));
    return;
  }
  if (nothing) {
    out(chalk.gray("\n  nothing to clean"));
    return;
  }
  const applied = await applyPlan(workingDir, plan, new Date(now));
  const swept = await sweepTemp({ ...temp, measure: true, log: (line) => appendLog(workingDir, line) });
  const done = [
    applied.moved.length ? `moved ${plural(applied.moved.length, "record")}, ${formatBytes(total(applied.moved.map((m) => m.entry)))}, to .jig/trash` : "",
    applied.deleted.length ? `deleted ${plural(applied.deleted.length, "trash entry", "trash entries")} for good` : "",
    swept.removed.length ? `deleted ${plural(swept.removed.length, "temp folder")}, ${formatBytes(total(swept.removed.map((r) => ({ bytes: r.bytes ?? 0 }))))}` : "",
  ].filter(Boolean);
  out(chalk.green(`\n  ✓ ${done.join("; ") || "nothing was changed"}`));
  for (const f of applied.failed) fail(`${f.name} was kept: ${f.reason}`);
  for (const f of swept.failed) fail(`${rel(f.path)} was kept: ${f.reason}`);
  out(chalk.gray(`  every action is a line in .jig/housekeeping.log; trash entries are deleted for good after ${settings.trashDays} days, and jig clean --restore <name> brings one back`));
}
