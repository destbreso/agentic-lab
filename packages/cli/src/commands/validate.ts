// ============================================
// CLI: validate a definition file
// ============================================
// Through the core's formats module: the syntax, the dialect, and every
// problem at its path and line. Exits 0 when the file is valid, 1 otherwise.

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import chalk from "chalk";
import { BUILT_IN_TOPOLOGIES, builtinFile, describeIssue, validateTopologyText } from "jig-core";

export interface ValidateOptions {
  dialect?: string;
  json?: boolean;
}

export async function validateCommand(arg: string, options: ValidateOptions): Promise<void> {
  try {
    // A built-in topology by its name is its file inside the installed jig-core.
    const file = !existsSync(arg) && (BUILT_IN_TOPOLOGIES as readonly string[]).includes(arg) ? builtinFile(arg) : arg;
    const result = validateTopologyText(await readFile(file, "utf-8"), { filename: file, dialect: options.dialect });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const what = result.dialect ? `${result.dialect} in ${result.syntax}` : (result.syntax ?? "unreadable");
      const errors = result.issues.filter((i) => i.severity === "error").length;
      const warnings = result.issues.length - errors;
      process.stdout.write(`${file}: ${what}\n`);
      for (const i of result.issues) process.stdout.write(`${(i.severity === "error" ? chalk.red : chalk.yellow)(describeIssue(i))}\n`);
      process.stdout.write(
        result.valid
          ? chalk.green(`  ✓ valid${warnings ? `, ${warnings} warning${warnings > 1 ? "s" : ""}` : ""}\n`)
          : chalk.red(`  ✗ not valid: ${errors} error${errors > 1 ? "s" : ""}\n`),
      );
    }
    process.exitCode = result.valid ? 0 : 1;
  } catch (e) {
    process.stderr.write(chalk.red(`  ✗ ${(e as Error).message}\n`));
    process.exitCode = 2;
  }
}
