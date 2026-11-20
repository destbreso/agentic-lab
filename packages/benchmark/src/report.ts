// ============================================
// The table and report.md
// ============================================
// Both are drawn from the lock and the results alone. Arms are listed in one
// order everywhere: the direct arm, then the baselines, then the arms.

import { countText, summarise, type ArmSummary, type Summary } from "./compare.js";
import type { Lock } from "./lock.js";
import { shownPath } from "./paths.js";
import { settled, type AttemptRecord } from "./results.js";
import type { ArmInfo } from "./spec.js";

const KIND: Record<ArmInfo["kind"], string> = { direct: "direct", baseline: "baseline", arm: "arm" };
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const tokensText = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "-");
export const timeText = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "-");
const cell = (s: string) => s.replace(/\|/g, "\\|");

export { shownPath };

/** The symbol for one attempt in the grid. */
function mark(r: AttemptRecord | undefined, countFallbacks: boolean): string {
  if (!r) return "·";
  if (!settled(r)) return "!";
  if (!countFallbacks && r.fallbacks.length) return "↪";
  if (r.outcome === "passed") return "✓";
  if (r.outcome === "failed") return "✗";
  return "?";
}

const notCounted = (s: ArmSummary) => [s.notStarted ? `${s.notStarted} did not start` : "", s.fellBack ? `${s.fellBack} fell back` : ""].filter(Boolean).join(", ");

/** The arms side by side, as plain text for the terminal. */
export function renderTable(summary: Summary): string {
  const rows = [
    ["Arm", "Kind", "Passed", "95% interval", "Median tokens", "Median time", "Not counted"],
    ...summary.arms.map((s) => [
      s.arm.label,
      KIND[s.arm.kind],
      s.count.n ? `${s.count.k} of ${s.count.n}` : "none yet",
      s.count.n ? `${pct(s.count.lower)} to ${pct(s.count.upper)}` : "-",
      tokensText(s.medianTokens),
      timeText(s.medianMs),
      notCounted(s) || "-",
    ]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => [...r[i]!].length)));
  const line = (r: string[]) => r.map((c, i) => c + " ".repeat(widths[i]! - [...c].length)).join("  ").trimEnd();
  return [line(rows[0]!), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(line)].join("\n");
}

/** The conclusions, one line each, grouped by what they compare against. */
export function renderConclusions(summary: Summary, bullet = "- "): string[] {
  const out: string[] = [];
  const groups = new Map<string, Summary["comparisons"]>();
  for (const c of summary.comparisons) groups.set(c.against.key, [...(groups.get(c.against.key) ?? []), c]);
  for (const [, list] of groups) {
    const against = list[0]!.against;
    out.push(`Against ${against.kind === "direct" ? "the direct arm" : `${against.label} (a baseline)`}:`);
    for (const c of list) out.push(`${bullet}${c.arm.label}: ${c.sentence}`);
  }
  return out;
}

export interface ReportInput {
  lock: Lock;
  records: AttemptRecord[];
  /** The jig-benchmark drawing the report. */
  version: string;
  generatedAt: Date;
  home?: string;
}

export function buildSummary(lock: Lock, records: AttemptRecord[]): Summary {
  return summarise(lock.arms, lock.taskSet, records, lock.spec.rule, lock.spec.count_fallbacks);
}

export function renderReport(input: ReportInput): string {
  const { lock, records } = input;
  const spec = lock.spec;
  const summary = buildSummary(lock, records);
  const reps = spec.repetitions;
  const tasks = lock.taskSet.tasks;
  const directTasks = tasks.filter((t) => t.direct !== undefined);
  const planned = reps * (tasks.length * (lock.arms.length - 1) + directTasks.length);
  const settledCount = records.filter(settled).length;
  const md: string[] = [];
  const say = (...lines: string[]) => md.push(...lines);

  say(`# ${spec.name}`, "", `> ${spec.question.trim().replace(/\n+/g, " ")}`, "");
  say(
    settledCount >= planned
      ? `Complete: all ${planned} attempts ran.`
      : `Not complete: ${settledCount} of ${planned} attempts ran to an outcome. Everything below counts only what has run; \`jig-benchmark run\` on the same spec goes on from here.`,
    "",
  );

  // ---- The experiment ----
  const rounds = spec.budget.rounds ? `at most ${spec.budget.rounds} round${spec.budget.rounds === 1 ? "" : "s"} in every arm (the spec's limit replaces each topology's own)` : "each topology's own round limit";
  const perms = [
    spec.permissions.mode === "acceptEdits" ? "edits inside the attempt's workspace run" : spec.permissions.mode === "plan" ? "plan mode: reads and read-only commands only" : "the default mode: edits and commands would ask",
    spec.permissions.allow.length ? `allowed: ${spec.permissions.allow.map((r) => `\`${r}\``).join(", ")}` : "",
    spec.permissions.deny.length ? `denied: ${spec.permissions.deny.map((r) => `\`${r}\``).join(", ")}` : "",
    "anything else that would ask is denied, since nobody is there to ask",
  ].filter(Boolean);
  const margin = spec.rule.margin !== undefined ? `, or when the 95% Newcombe interval of the difference lies inside ${Math.round(spec.rule.margin * 100)} points either way (no practical difference)` : "";
  const baselineArms = lock.arms.filter((a) => a.kind === "baseline");
  say(
    "## The experiment",
    "",
    `- **Spec:** \`${shownPath(lock.specFile, input.home)}\`, hash \`${lock.hash}\`, locked ${lock.lockedAt} before its first attempt.`,
    `- **Tasks:** ${lock.taskSet.name} (\`${lock.taskSetFile}\`), ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${lock.taskSet.description.trim()}`,
    `- **Model:** \`${spec.model}\`, for every role of every arm.`,
    `- **Versions:** jig-core ${lock.core} for every attempt; locked by jig-benchmark ${lock.benchmark}, reported by jig-benchmark ${input.version}.`,
    `- **Arms:** the direct arm (the model asked once, with the task and its files, no tools), ${baselineArms.length ? `the baseline${baselineArms.length > 1 ? "s" : ""} ${baselineArms.map((a) => a.label).join(", ")}` : "no baseline (the spec removed the Ralph Loop)"}, and ${lock.arms.filter((a) => a.kind === "arm").map((a) => `${a.label} (\`${a.source === "built in" ? a.topology : a.source}\`)`).join(", ") || "no other arm"}.`,
    `- **Repetitions:** ${reps} per task and arm.`,
    `- **Budget per attempt:** ${tokensText(spec.budget.tokens)} tokens (a run stops after the model call that crosses it), and ${rounds}.`,
    `- **Permissions:** ${perms.join("; ")}.`,
    `- **Check's verdict:** ${spec.verdict_from === "measured" ? "the measured checks' result, with its model's verdict kept beside it (Jig's default)" : "its model's own verdict"}.`,
    `- **Fallbacks:** ${spec.count_fallbacks ? "an attempt where a role fell back to another model counts like any other" : "an attempt where a role fell back to another model counts for nothing"}.`,
    `- **Rule, fixed before the first attempt:** per arm, k passed of n with a 95% Wilson interval. Against another arm: supports when the arm's interval lies wholly above the other's; against when it lies wholly below${margin}; inconclusive otherwise.`,
    "",
  );

  // ---- The arms side by side ----
  say("## The arms side by side", "", "| Arm | Kind | Passed | 95% interval | Median tokens | Median time | Not counted |", "|---|---|---|---|---|---|---|");
  for (const s of summary.arms) {
    say(`| ${cell(s.arm.label)} | ${KIND[s.arm.kind]} | ${s.count.n ? `${s.count.k} of ${s.count.n}` : "none yet"} | ${s.count.n ? `${pct(s.count.lower)} to ${pct(s.count.upper)}` : "-"} | ${tokensText(s.medianTokens)} | ${timeText(s.medianMs)} | ${notCounted(s) || "-"} |`);
  }
  say("");
  const notes: string[] = [];
  if (directTasks.length < tasks.length) notes.push(`The direct arm's count is over the ${directTasks.length} of ${tasks.length} tasks that say where its answer goes; on the others it is not applicable, never a failure.`);
  const noVerdict = summary.arms.filter((s) => s.noVerdict);
  if (noVerdict.length) notes.push(`Attempts that ended without a result from the checks (stopped, or the checks could not run) count as not passed: ${noVerdict.map((s) => `${s.arm.label} ${s.noVerdict}`).join(", ")}.`);
  const callErrors = summary.arms.filter((s) => s.callErrors);
  if (callErrors.length) notes.push(`Model calls that ended in an error (a timeout, a refused connection), inside attempts that still counted: ${callErrors.map((s) => `${s.arm.label} ${s.callErrors}`).join(", ")}.`);
  notes.push("Medians are over the attempts that count. Tokens are what the provider reported, input and output together.");
  // One paragraph each.
  say(...notes.flatMap((n) => [n, ""]));

  // ---- Every attempt ----
  say("## Every attempt, by task", "", `| Task | ${lock.arms.map((a) => cell(a.label)).join(" | ")} |`, `|---|${lock.arms.map(() => "---").join("|")}|`);
  const byKey = new Map(records.map((r) => [`${r.arm}\u0000${r.task}\u0000${r.repetition}`, r]));
  for (const t of tasks) {
    const cells = lock.arms.map((a) => {
      if (a.kind === "direct" && t.direct === undefined) return "n/a";
      return Array.from({ length: reps }, (_, i) => mark(byKey.get(`${a.key}\u0000${t.id}\u0000${i + 1}`), spec.count_fallbacks)).join("");
    });
    say(`| \`${t.id}\` | ${cells.join(" | ")} |`);
  }
  say("", "One mark per repetition, in order: ✓ passed, ✗ failed, ? ended without a result from the checks (counted as not passed), ! did not start (not counted), ↪ fell back to another model (not counted), · not run yet; n/a: the task does not say where the direct arm's answer goes.", "");

  // ---- Conclusions ----
  say("## Conclusions", "");
  const groups = new Map<string, Summary["comparisons"]>();
  for (const c of summary.comparisons) groups.set(c.against.key, [...(groups.get(c.against.key) ?? []), c]);
  if (!groups.size) say("Nothing to compare.", "");
  for (const [, list] of groups) {
    const against = list[0]!.against;
    say(`### Against ${against.kind === "direct" ? "the direct arm" : `${cell(against.label)}, a baseline`}`, "");
    for (const c of list) say(`- **${cell(c.arm.label)}** ${c.sentence}`);
    say("");
  }

  // ---- What this does not show ----
  const topologyAttempts = reps * tasks.length;
  const tags = [...new Set(tasks.flatMap((t) => t.tags))];
  say(
    "## What this does not show",
    "",
    `- **One model.** Every role of every arm ran on \`${spec.model}\`. Another model, or different models in different roles, may order the arms differently.`,
    `- **Few runs.** ${reps} repetition${reps === 1 ? "" : "s"} of ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${topologyAttempts} attempts per topology arm${directTasks.length !== tasks.length ? `, ${reps * directTasks.length} for the direct arm` : ""}. Intervals this wide tell apart only large differences. Inconclusive means these counts cannot tell the arms apart, not that they are equal.`,
    `- **A small task set.** ${tasks.length} task${tasks.length === 1 ? "" : "s"}${tags.length ? ` (${tags.join(", ")})` : ""}, chosen by whoever wrote the set. They are not a sample of any wider kind of work, and what holds on them may not hold on yours.`,
    "- **Attempts are not independent draws.** Each interval treats every attempt as one independent try. Attempts on the same task share its difficulty, so the real uncertainty is larger than the intervals show.",
    "- **The direct arm gets one call and no tools, by design.** It measures the model asked plainly, so the other arms show what a harness adds. Writing its answer into the task's file is the lab's doing, not the model's: the last line of its reply, or its last code block, is written where the task says, and nothing else is done to it.",
    spec.verdict_from === "measured"
      ? "- **Who hears the checks.** In the arms with a Check role, Check's verdict is the lab's measured check, so on a way back Do learns whether the checks passed and what they printed (never the checks themselves). The direct arm and the Ralph Loop get no such signal. This compares the topologies as Jig runs them by default, not the roles' reasoning alone."
      : "- **Who hears the checks.** Check's verdict came from its own model, so no role learned what the lab's checks said before the end.",
    "- **No best-of-N baseline yet.** Best-of-N at the same budget (independent single-loop attempts until the budget is spent, kept if any passes the checks) is planned and not built.",
    "- **Tokens and time, not money.** No prices are applied. Time is wall-clock on one machine and depends on whatever else it was running.",
    "",
  );

  // ---- Runs ----
  say("## Runs", "", "<details><summary>Every attempt with its run id</summary>", "", "| Task | Arm | # | Outcome | Checks | Tokens | Time | Rounds | Run id |", "|---|---|---|---|---|---|---|---|---|");
  const label = new Map(lock.arms.map((a) => [a.key, a.label]));
  const order = new Map(lock.arms.map((a, i) => [a.key, i]));
  const taskOrder = new Map(tasks.map((t, i) => [t.id, i]));
  const sorted = [...records].sort((a, b) => (taskOrder.get(a.task) ?? 0) - (taskOrder.get(b.task) ?? 0) || (order.get(a.arm) ?? 0) - (order.get(b.arm) ?? 0) || a.repetition - b.repetition);
  for (const r of sorted) {
    const outcome = r.error ? `did not start: ${cell(r.error.split("\n")[0]!.slice(0, 120))}` : (r.outcome ?? "-");
    say(`| \`${r.task}\` | ${cell(label.get(r.arm) ?? r.arm)} | ${r.repetition} | ${outcome}${r.fallbacks.length ? " (fell back)" : ""} | ${r.checks_passed} of ${r.checks_total} | ${tokensText(r.tokens.total)} | ${timeText(r.duration_ms)} | ${r.rounds ?? "-"} | ${r.run_id ? `\`${r.run_id}\`` : "-"} |`);
  }
  say(
    "",
    "</details>",
    "",
    "A topology run's step records are in `runs/<run id>/steps.json`, with `record.json` beside them, in the layout `jig run` keeps. The direct arm's prompt, reply, what was written and the checks' results are in `runs/<run id>/direct.json`. `jig replay` reads a run only from `.jig/runs/` inside the folder its `--dir` names, so to replay one, copy its folder there: `mkdir -p .jig/runs && cp -R runs/<run id> .jig/runs/ && jig replay <run id>`.",
    "",
    `Report drawn ${input.generatedAt.toISOString()} from ${records.length} recorded attempt${records.length === 1 ? "" : "s"}.`,
    "",
  );
  return md.join("\n");
}

export { countText };
