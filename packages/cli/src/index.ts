#!/usr/bin/env node
// ============================================
// Agentic Lab CLI — Entry Point
// ============================================

import { Command } from "commander";
import chalk from "chalk";
import { runCommand } from "./commands/run.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { providersCommand } from "./commands/providers.js";
import { historyCommand } from "./commands/history.js";

const program = new Command();

program
  .name("agentic-lab")
  .description(
    chalk.cyan("🤖 Agentic Lab") +
      " — Extensible platform for agentic loop experimentation",
  )
  .version("0.1.0");

// ---- Commands ----

program
  .command("run")
  .description("Run an agentic loop")
  .option(
    "-p, --provider <name>",
    "LLM provider (ollama, openai, anthropic, openrouter)",
  )
  .option("-m, --model <name>", "Model to use")
  .option("-i, --iterations <n>", "Max iterations", "10")
  .option("-d, --delay <ms>", "Delay between iterations (ms)", "1000")
  .option("--prompt <file>", "Prompt file path", "PROMPT.md")
  .option("--plan <file>", "Plan file path", "PLAN.md")
  .option("--specs <dir>", "Specs directory")
  .option("--dir <path>", "Working directory", ".")
  .option("--auto-commit", "Auto-commit after each iteration")
  .option("--auto-push", "Auto-push after commits")
  .option("-v, --verbose", "Verbose output")
  .option("--log <file>", "Log file path")
  .option("--temperature <n>", "LLM temperature")
  .option("--max-tokens <n>", "Max tokens per LLM call")
  .option("--tools <names>", "Comma-separated list of tools to enable")
  .action(runCommand);

program
  .command("init")
  .description(
    "Initialize a new agentic workspace (creates PROMPT.md, PLAN.md, specs/)",
  )
  .option("--dir <path>", "Directory to initialize", ".")
  .option("--template <name>", "Prompt template (simple, advanced)", "simple")
  .action(initCommand);

program
  .command("status")
  .description("Show status of the current agentic workspace")
  .option("--dir <path>", "Working directory", ".")
  .action(statusCommand);

program
  .command("providers")
  .description("List and test available LLM providers")
  .option("--test", "Test connectivity to all configured providers")
  .action(providersCommand);

program
  .command("history")
  .description("Show history of past loop runs")
  .option("--dir <path>", "Working directory", ".")
  .option("--last <n>", "Show last N runs", "10")
  .option("--detail <runId>", "Show details for a specific run")
  .action(historyCommand);

// ---- Parse ----

program.parse();
