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
import { pipelineCommand } from "./commands/pipeline.js";
import { recipesCommand } from "./commands/recipes.js";
import { chatCommand } from "./commands/chat.js";
import { configCommand } from "./commands/config.js";

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
    "LLM provider (ollama, openai, anthropic, google, openrouter)",
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
  .command("pipeline")
  .description("Run composable multi-loop pipelines from recipes")
  .option("--recipe <id>", "Recipe ID to instantiate and run")
  .option(
    "-p, --provider <name>",
    "LLM provider (ollama, openai, anthropic, google, openrouter)",
  )
  .option("-m, --model <name>", "Model to use")
  .option("--dir <path>", "Working directory", ".")
  .option("-v, --verbose", "Verbose output (show signals)")
  .option(
    "--param <key=value>",
    "Recipe parameter (repeatable)",
    collect,
    [],
  )
  .option("--list", "List available recipes")
  .option("--nodes", "List available node types")
  .option("--info <id>", "Show recipe details")
  .action(pipelineCommand);

program
  .command("recipes")
  .description("Browse, inspect, and run pipeline recipes")
  .option("--run <id>", "Run a recipe")
  .option("--info <id>", "Show recipe details")
  .option(
    "-p, --provider <name>",
    "LLM provider (ollama, openai, anthropic, google, openrouter)",
  )
  .option("-m, --model <name>", "Model to use")
  .option("--dir <path>", "Working directory", ".")
  .option(
    "--param <key=value>",
    "Recipe parameter (repeatable)",
    collect,
    [],
  )
  .option("-v, --verbose", "Verbose output")
  .option("--category <name>", "Filter by category")
  .action(recipesCommand);

program
  .command("chat")
  .description("Start a direct conversation with an LLM provider")
  .option(
    "-p, --provider <name>",
    "LLM provider (ollama, openai, anthropic, google, openrouter)",
  )
  .option("-m, --model <name>", "Model to use")
  .option("-s, --system <prompt>", "System prompt")
  .option("--temperature <n>", "LLM temperature")
  .option("--max-tokens <n>", "Max tokens per response")
  .option(
    "--one-shot <message>",
    "Send a single message and exit (non-interactive)",
  )
  .action(chatCommand);

program
  .command("config")
  .description("View and validate configuration")
  .option("--dir <path>", "Working directory", ".")
  .option("--check", "Run validation checks")
  .option("--meta", "Show system meta-knowledge")
  .action(configCommand);

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

// ---- Helpers ----

/** Collect repeatable options into an array */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

// ---- Parse ----

program.parse();
