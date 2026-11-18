// ============================================
// CLI: run command
// ============================================
// Runs a topology on a task through AgentSession, the engine the chat and
// the builder use. Without --topology it runs the Ralph Loop: one turn at a
// time, again while PLAN.md has unchecked items, 20 turns at most.

import chalk from "chalk";
import { runTopologyCommand, type TopologyRunOptions } from "../session-runner.js";

export async function runCommand(options: TopologyRunOptions): Promise<void> {
  if (!options.json) process.stderr.write(chalk.cyan("\n🤖 Agentic Lab\n\n"));
  await runTopologyCommand(options);
}
