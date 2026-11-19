#!/usr/bin/env node
// ============================================
// jig: the command
// ============================================

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { brainsCommand, doctorCommand, providersCommand } from "./commands/providers.js";
import { historyCommand } from "./commands/history.js";
import { pipelineCommand } from "./commands/pipeline.js";
import { recipesCommand } from "./commands/recipes.js";
import { startSession } from "./session/start.js";
import { configCommand } from "./commands/config.js";
import { showCommand } from "./commands/show.js";
import { validateCommand } from "./commands/validate.js";
import { convertCommand } from "./commands/convert.js";
import { replayCommand } from "./commands/replay.js";

const program = new Command();

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string }).version;

program
  .name("jig")
  .description("Jig, a Joint Inference Graph: your own topology of models, used for real work and measured. With no command, a session.")
  .version(version)
  // The session's options come before any command, so run, show and the rest keep their own.
  .enablePositionalOptions()
  .option("--resume [session-id]", "Open the last session here again, or the one named")
  .option("-t, --topology <id|file>", "The topology each task runs through (default: exec-eval, or the resumed session's)")
  .option("-p, --provider <name>", "The provider roles run on when nothing names one")
  .option("-m, --model <name>", "The model roles run on when nothing names one")
  .option("--dir <path>", "Working directory", ".")
  .option("--plain", "No colour or styles")
  .option("--ascii", "ASCII only, for a terminal that cannot show the glyphs")
  .action(async (options) => {
    await startSession(options, version);
  });

// ---- Commands ----

program
  .command("run")
  .description("Run a topology on a task (the Ralph Loop unless --topology says otherwise)")
  .option("-t, --topology <id|file>", "Topology to run: a built-in id or a definition file", "ralph-loop")
  .option("--task <text>", "The task (default: the prompt file's contents)")
  .option(
    "-p, --provider <name>",
    "LLM provider (ollama, openai, anthropic, google, openrouter)",
  )
  .option("-m, --model <name>", "Model to use")
  .option("-i, --iterations <n>", "Round limit (turns, for the Ralph Loop)")
  .option("-d, --delay <ms>", "Pause between rounds (ms)")
  .option("--prompt <file>", "Prompt file the task is read from", "PROMPT.md")
  .option("--plan <file>", "Plan file", "PLAN.md")
  .option("--specs <dir>", "Specs directory")
  .option("--dir <path>", "Working directory", ".")
  .option("--param <key=value>", "Topology parameter (repeatable)", collect, [])
  .option("--json", "Print every engine event as a JSON line")
  .option("-v, --verbose", "Verbose output (role starts and signals)")
  .option("--temperature <n>", "LLM temperature")
  .option("--max-tokens <n>", "Max tokens per LLM call")
  .option("--tools <names>", "Comma-separated list of tools to enable")
  .option("--task-file <file>", "A task with its checks, as JSON (task, checks, checkFiles)")
  .option("--check <command>", "A check the lab runs after the run: passes when it exits 0 (repeatable)", collect, [])
  .option("--check-file <path>", "A file a check depends on, copied back in before every check (repeatable)", collect, [])
  .option("--verdict-from <source>", "Check's verdict, with a check: measured (default) or model")
  .option("--token-budget <n>", "Tokens this attempt may spend")
  .option("--memory-scope <scope>", "How far back recall reaches: off, run, task or shared")
  .option("--live", "Draw the run on the topology's grid as it goes (the default in a terminal)")
  .option("--no-live", "Print the run's events as lines instead")
  .option("--frames <file>", "Write each frame of the live view to a file (plain), and with colours to <file>.ansi")
  .option("--record <file>", "Write every frame drawn, clock ticks included, with its time, as JSON lines")
  .option("--layout <name>", "For --live: auto, horizontal, vertical or strip", "auto")
  .option("--width <n>", "For --live: columns to draw for")
  .option("--plain", "No colour")
  .action(runCommand);

program
  .command("show <topology>")
  .description("Draw a topology at rest: a built-in id or a definition file (.yaml or .json)")
  .option("--layout <name>", "auto, horizontal, vertical or strip", "auto")
  .option("--width <n>", "Columns to draw for (default: the terminal's)")
  .option("--sight", "Add the walls: what each role sees, measured with a mock model (no tokens)")
  .option("--model <name>", "The model to name in each box")
  .option("--plain", "No colour")
  .option("--play", "Animate a dry run on a scripted model, no tokens: until a key or Ctrl+C")
  .option("--speed <x>", "For --play: how fast (1 is a model call every 0.7 s, 4 four times as fast)", "1")
  .option("--once", "For --play: play it once, then stop")
  .option("--frames <file>", "For --play: write each event's frame to a file (plain), and with colours to <file>.ansi")
  .option("--record <file>", "For --play: write every frame drawn, with its time, as JSON lines")
  .action(showCommand);

program
  .command("replay <run-id>")
  .description("Play a recorded run on its topology's screen, from its step records (Postgres, or the run's folder)")
  .option("--dir <path>", "Working directory the run was in", ".")
  .option("--speed <x>", "1 plays it at the speed it ran, 10 ten times as fast", "1")
  .option("-t, --topology <id|file>", "Draw it with this topology instead of the one its record names")
  .option("--layout <name>", "auto, horizontal, vertical or strip", "auto")
  .option("--width <n>", "Columns to draw for (default: the terminal's)")
  .option("--plain", "No colour")
  .option("--frames <file>", "Write each event's frame to a file (plain), and with colours to <file>.ansi")
  .option("--record <file>", "Write every frame drawn, with its time, as JSON lines")
  .action(replayCommand);

program
  .command("validate <file>")
  .description("Check a definition file (or a built-in topology by name): its syntax, its dialect, and every problem at its path and line")
  .option("--dialect <id>", "Read as this dialect (agentspec or legacy) instead of recognising it")
  .option("--json", "Print the result as JSON")
  .action(validateCommand);

program
  .command("convert <file>")
  .description("Convert a definition between dialects and between JSON and YAML, reporting what is lost")
  .option("--to <syntax>", "yaml or json (default: the other one)")
  .option("--dialect <id>", "The dialect to write: agentspec (default) or legacy")
  .option("--from <id>", "Read as this dialect instead of recognising it")
  .option("-o, --output <file>", "Write to a file instead of stdout")
  .option("--expanded", "Write every node's inputs, outputs and branches, as an SDK's export does (default: compact, with what Agent Spec infers left out)")
  .action(convertCommand);

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
  .option("--task <text>", "The task (default: the prompt file's contents)")
  .option("-i, --iterations <n>", "Round limit")
  .option("--json", "Print every engine event as a JSON line")
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
  .option("--task <text>", "The task (default: the prompt file's contents)")
  .option("-i, --iterations <n>", "Round limit")
  .option("--json", "Print every engine event as a JSON line")
  .option("-v, --verbose", "Verbose output")
  .option("--category <name>", "Filter by category")
  .action(recipesCommand);

// The one-model chat became the session: a single-role topology answers as one model did.
program
  .command("chat", { hidden: true })
  .allowUnknownOption()
  .action(() => {
    process.stderr.write("jig chat is gone: run jig for a session, where each message is a task (/topology ralph-loop has one role). For one answer from a script: jig run --topology ralph-loop --task \"...\".\n");
    process.exitCode = 2;
  });

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
  .command("providers [action] [names...]")
  .description("Provider entries: list, add <name>, test [names], remove <name>. Keys are references, never written in clear")
  .option("--kind <kind>", "For add: ollama, anthropic, openai, gemini, openrouter or openai-compatible")
  .option("--preset <name>", "For add: an openai-compatible server Jig knows (lmstudio, llamacpp, vllm, jan, groq, mistral, deepseek, together)")
  .option("--base-url <url>", "For add: where the server is")
  .option("--key <ref>", "For add: env:NAME or command:<program and arguments>")
  .option("--keychain", "For add: type the key, hidden, and keep it in the OS keychain")
  .option("--default-model <model>", "For add: the model it answers with when none is named")
  .option("--model <model>", "For test: the model to call")
  .action((action, names, options) => providersCommand(action, names ?? [], options));

program
  .command("brains [action] [args...]")
  .description("Brains, named chains of models: list, set <name> <entry/model>..., test [names] (which model would answer now)")
  .action((action, args) => brainsCommand(action, args ?? []));

program
  .command("doctor")
  .description("Providers, whether each has its key (never shown), and which model each brain would answer with now")
  .action(doctorCommand);

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
