// ============================================
// CLI: convert a definition between dialects and syntaxes
// ============================================
// Through the core's formats module and its model: read in any dialect and
// syntax, written in the one asked for. What the conversion drops, and what
// only the lab will read of the result, is reported on stderr.

import { readFile, writeFile } from "fs/promises";
import chalk from "chalk";
import { convertTopologyText, describeIssue, type Loss } from "jig-core";

export interface ConvertOptions {
  to?: string;
  dialect?: string;
  from?: string;
  output?: string;
  /** Write every node's inputs, outputs and branches instead of the compact form. */
  expanded?: boolean;
}

function report(title: string, losses: Loss[]): string[] {
  if (losses.length === 0) return [];
  return [chalk.bold(title), ...losses.map((l) => `  - ${l.what}${l.path ? chalk.gray(` (${l.path})`) : ""}`)];
}

export async function convertCommand(file: string, options: ConvertOptions): Promise<void> {
  try {
    if (options.to && !["yaml", "json"].includes(options.to)) throw new Error("--to must be yaml or json");
    const syntax = (options.to ?? (/\.json$/i.test(file) ? "yaml" : "json")) as "yaml" | "json";
    const result = convertTopologyText(await readFile(file, "utf-8"), { dialect: options.dialect ?? "agentspec", syntax, form: options.expanded ? "expanded" : "compact" }, { filename: file, dialect: options.from });
    if (options.output) await writeFile(options.output, result.text, "utf-8");
    else process.stdout.write(result.text);
    const lines = [
      chalk.gray(`${file}: ${result.from.dialect} in ${result.from.syntax} → ${options.dialect ?? "agentspec"} in ${syntax}${options.expanded ? ", expanded" : ""}${options.output ? `, written to ${options.output}` : ""}`),
      ...result.warnings.map((w) => chalk.yellow(describeIssue(w))),
      ...report("Lost when reading the source:", result.readLosses),
      ...report("Not kept by the target:", result.losses.filter((l) => l.kind === "dropped")),
      ...report("Kept only in the lab's extension, which another runtime ignores:", result.losses.filter((l) => l.kind === "ignored")),
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
  } catch (e) {
    const issues = (e as { issues?: Parameters<typeof describeIssue>[0][] }).issues;
    process.stderr.write(chalk.red(`  ✗ ${issues ? issues.map(describeIssue).join("\n") : (e as Error).message}\n`));
    process.exitCode = 1;
  }
}
