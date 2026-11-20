// ============================================
// jig-benchmark: run, report, estimate
// ============================================

import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { coreVersion } from "jig-core";
import { estimate, renderEstimate } from "./estimate.js";
import { readLock } from "./lock.js";
import { buildSummary, renderConclusions, renderReport, renderTable, shownPath, timeText, tokensText } from "./report.js";
import { readResults, type AttemptRecord } from "./results.js";
import { runExperiment } from "./runner.js";
import { providerFor } from "./provider.js";
import { loadSpec } from "./spec.js";
import { benchmarkVersion } from "./version.js";

const out = (line = "") => process.stdout.write(`${line}\n`);
const note = (line = "") => process.stderr.write(`${line}\n`);

const defaultOut = (name: string) => resolve("benchmark-results", name);

const MARK: Record<string, string> = { passed: "✓ passed", failed: "✗ failed" };

function progressLine(r: AttemptRecord, index: number, queued: number): string {
  const head = `[${String(index + 1).padStart(String(queued).length)}/${queued}] ${r.arm} ∙ ${r.task} ∙ #${r.repetition}`;
  if (r.error) return `${head}  ! did not start: ${r.error.split("\n")[0]}`;
  const outcome = MARK[r.outcome ?? ""] ?? `? ${r.outcome}`;
  const facts = [`${r.checks_passed} of ${r.checks_total} checks`, `${tokensText(r.tokens.total)} tok`, timeText(r.duration_ms), r.rounds !== null ? `${r.rounds} round${r.rounds === 1 ? "" : "s"}` : "", r.fallbacks.length ? "fell back to another model" : "", r.call_errors ? `${r.call_errors} call error${r.call_errors === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `${head}  ${outcome}  ${facts.join(" ∙ ")}`;
}

async function writeReport(outDir: string): Promise<{ table: string; conclusions: string[]; file: string }> {
  const lock = await readLock(outDir);
  if (!lock) throw new Error(`${outDir} has no lock.json: it is not a jig-benchmark output folder`);
  const { records, unreadable } = await readResults(outDir);
  if (unreadable.length) note(`  results.jsonl: line${unreadable.length > 1 ? "s" : ""} ${unreadable.join(", ")} could not be read and ${unreadable.length > 1 ? "were" : "was"} left out`);
  const summary = buildSummary(lock, records);
  const file = join(outDir, "report.md");
  await writeFile(file, renderReport({ lock, records, version: benchmarkVersion(), generatedAt: new Date() }));
  return { table: renderTable(summary), conclusions: renderConclusions(summary, "  "), file };
}

async function runCommand(specPath: string, opts: { out?: string }): Promise<number> {
  const loaded = await loadSpec(specPath);
  for (const w of loaded.warnings) note(`  ${w}`);
  const outDir = resolve(opts.out ?? defaultOut(loaded.data.name));
  const model = await providerFor(loaded.data.model, process.cwd());
  const problem = await model.check();
  if (problem) throw new Error(`${loaded.data.model} cannot run: ${problem}`);
  const e = estimate(loaded, (await readResults(outDir)).records);
  note(`jig-benchmark ${benchmarkVersion()} ∙ jig-core ${coreVersion()} ∙ ${loaded.data.model}`);
  note(`  ${loaded.data.name}: ${e.attempts} attempts (${e.byArm.map((a) => `${a.key} ${a.attempts}`).join(", ")}), ${e.alreadyRecorded} already recorded`);
  note(`  output: ${shownPath(outDir)}`);

  const controller = new AbortController();
  let interrupts = 0;
  const onSigint = () => {
    interrupts++;
    if (interrupts > 1) process.exit(130);
    note("\n  Stopping: the attempts in flight are stopped and not recorded (Ctrl+C again to quit at once)...");
    controller.abort();
  };
  process.on("SIGINT", onSigint);
  try {
    const summary = await runExperiment(loaded, {
      outDir,
      provider: model.provider,
      signal: controller.signal,
      ready: () => model.check(),
      onStart: (p, i, n) => note(`[${String(i + 1).padStart(String(n).length)}/${n}] ${p.arm.key} ∙ ${p.task.id} ∙ #${p.repetition} ...`),
      onEnd: (r, i, n) => out(progressLine(r, i, n)),
    });
    note(`  locked: hash ${summary.lock.hash.slice(0, 12)}${summary.lockCreated ? ", now" : `, on ${summary.lock.lockedAt}`}; ${summary.skipped} already recorded, ${summary.ran.length} run now`);
    const report = await writeReport(outDir);
    out("");
    out(report.table);
    out("");
    for (const line of report.conclusions) out(line);
    out("");
    out(`report: ${shownPath(report.file)}`);
    if (summary.interrupted) {
      note(`  interrupted: ${summary.remaining} attempts still to run; run the same command to go on`);
      return 130;
    }
    if (summary.remaining) {
      note(`  ${summary.remaining} attempt${summary.remaining === 1 ? "" : "s"} could not start; run the same command to try ${summary.remaining === 1 ? "it" : "them"} again`);
      return 1;
    }
    return 0;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

async function main(argv: string[]): Promise<number> {
  const program = new Command();
  let code = 0;
  program
    .name("jig-benchmark")
    .description("Benchmarks for Jig topologies: task sets with measured checks, run through your topologies, the model asked directly and the Ralph Loop, repeated, and compared by a rule fixed before the first run.")
    .version(benchmarkVersion(), "-v, --version")
    .showHelpAfterError();
  program
    .command("run <spec>")
    .description("Run every attempt the spec asks for that is not recorded yet, then print the table and write report.md")
    .option("--out <dir>", "The output folder (default: benchmark-results/<spec name>)")
    .action(async (spec: string, opts: { out?: string }) => {
      code = await runCommand(spec, opts);
    });
  program
    .command("report <out>")
    .description("Print the table and the conclusions of an output folder again, and write its report.md")
    .action(async (dir: string) => {
      const report = await writeReport(resolve(dir));
      out(report.table);
      out("");
      for (const line of report.conclusions) out(line);
      out("");
      out(`report: ${shownPath(report.file)}`);
    });
  program
    .command("estimate <spec>")
    .description("Print how many attempts the spec asks for and the bound on their tokens, before anything runs")
    .option("--out <dir>", "The output folder, to count what is already recorded (default: benchmark-results/<spec name>)")
    .action(async (spec: string, opts: { out?: string }) => {
      const loaded = await loadSpec(spec);
      for (const w of loaded.warnings) note(`  ${w}`);
      const outDir = resolve(opts.out ?? defaultOut(loaded.data.name));
      const recorded = (await readResults(outDir)).records;
      for (const line of renderEstimate(loaded, estimate(loaded, recorded), shownPath(outDir))) out(line);
    });
  await program.parseAsync(argv);
  return code;
}

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (e: Error) => {
    // Paths in a message show the home folder as ~, as every path Jig prints does.
    process.stderr.write(`\n  ✗ ${e.message.split(`${homedir()}/`).join("~/")}\n\n`);
    process.exitCode = 2;
  },
);
