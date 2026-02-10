// ============================================
// CLI: init command — Initialize agentic workspace
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";

interface InitOptions {
  dir?: string;
  template?: string;
}

const SIMPLE_PROMPT = `# Agent Prompt

## Instructions

You are an autonomous AI agent. Follow these steps each turn:

1. **Read the Plan**: Study PLAN.md to understand remaining work.

2. **Select ONE Item**: Pick the SINGLE most important incomplete item from PLAN.md.
   Work ONLY on this item until completion, failure, or escalation.

3. **Implement**: Use the available tools to implement the selected item.
   - Read files to understand context
   - Write/edit files to implement changes
   - Run shell commands to build and test
   - Use git to track changes

4. **Test**: After implementing, verify your work by running relevant tests or builds.

5. **Update Plan**: Update PLAN.md with your progress:
   - Mark completed items as \`[x]\`
   - Mark failed items as \`[!]\`
   - Add notes about discoveries or blockers

6. **End Turn**: When the selected item is complete (or blocked), finish your turn.
   Do NOT start on the next item.

## Rules

- Pick ONE task per turn
- Always verify your work (tests, builds)
- Keep PLAN.md up to date
- If stuck after 3 attempts, document the blocker and move on
- Never modify files outside the working directory without explicit permission
`;

const ADVANCED_PROMPT = `# Agent Prompt

## Critical Paths

| File       | Path           |
| ---------- | -------------- |
| PLAN.md    | ./PLAN.md      |
| Specs      | ./specs/       |

## Definitions

**Turn**: The complete cycle of selecting and working on ONE item from PLAN.md until completion, failure, or escalation.

**Turn Scope Constraints**:
- ONE item per turn
- NEVER start the next item if current completes early
- If you finish early, update PLAN.md and end the turn

## Workflow

### Prerequisites
1. Study these files before starting:
   - \`./specs/\` — project specifications
   - \`./PLAN.md\` — implementation plan

### Execution Steps

1. **Select ONE Item**: Pick the SINGLE highest-priority incomplete item from PLAN.md.
   Work ONLY on this item until completion, failure, or escalation.

   **Before writing any code, verify:**
   - [ ] I have selected exactly ONE item
   - [ ] I will stop after this item completes, even if time remains

2. **Test Strategically**: After implementing functionality, run tests for the affected code.

3. **Track Issues**: When you discover an issue, update PLAN.md with findings.
   When resolved, update PLAN.md and remove the item.

4. **Commit Changes**: When tests pass, commit all changes with a descriptive message.

5. **Failure Protocol**: When tests fail repeatedly, document the issue in PLAN.md.
   Mark it as priority for the next turn, then stop.

6. **Keep PLAN.md Current**: ALWAYS keep PLAN.md up to date with your learnings.

7. **Bug Discovery**: Document bugs in PLAN.md. If related to current work, resolve it.
   If unrelated, record it as the next priority.

8. **PLAN.md Size Management**: When PLAN.md grows above 300 lines, clean out completed items.

9. **Escalation**: If an item has been worked on for 3+ consecutive turns without completion,
   document blockers in PLAN.md and finish your turn.

## PLAN.md Update Rules

### Status Markers

| Marker | Status      |
| ------ | ----------- |
| \`[ ]\` | Pending     |
| \`[x]\` | Completed   |
| \`[~]\` | In Progress |
| \`[!]\` | Failed      |
| \`[B]\` | Blocked     |
| \`[-]\` | Skipped     |
`;

const DEFAULT_PLAN = `# Implementation Plan

## Phase 1: Setup

- [ ] Initial project setup
- [ ] Define project structure

## Phase 2: Core Implementation

- [ ] Implement core functionality
- [ ] Add error handling

## Phase 3: Testing & Polish

- [ ] Write tests
- [ ] Documentation
- [ ] Final review
`;

const DEFAULT_SPEC = `# Project Specification

## Overview

Describe what you're building here.

## Requirements

### Functional Requirements

1. ...

### Non-Functional Requirements

1. ...

## Architecture

Describe the high-level architecture.

## Tech Stack

- ...
`;

export async function initCommand(options: InitOptions): Promise<void> {
  const workingDir = path.resolve(options.dir || ".");
  const template = options.template || "simple";

  console.log(chalk.cyan("\n🤖 Agentic Lab — Initialize Workspace\n"));
  console.log(chalk.gray(`  Directory: ${workingDir}`));
  console.log(chalk.gray(`  Template: ${template}\n`));

  const spinner = ora("Creating workspace...").start();

  try {
    // Create directories
    await fs.mkdir(path.join(workingDir, "specs"), { recursive: true });
    await fs.mkdir(path.join(workingDir, ".agentic-lab", "runs"), {
      recursive: true,
    });

    // Create PROMPT.md
    const promptContent =
      template === "advanced" ? ADVANCED_PROMPT : SIMPLE_PROMPT;
    await writeIfNotExists(path.join(workingDir, "PROMPT.md"), promptContent);

    // Create PLAN.md
    await writeIfNotExists(path.join(workingDir, "PLAN.md"), DEFAULT_PLAN);

    // Create specs
    await writeIfNotExists(
      path.join(workingDir, "specs", "SPEC.md"),
      DEFAULT_SPEC,
    );

    // Create .env.example
    const envExample = `# LLM Provider Configuration
# Uncomment and fill the provider you want to use

# --- Ollama (Local) ---
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=llama3.1

# --- OpenAI ---
# OPENAI_API_KEY=sk-...
# OPENAI_DEFAULT_MODEL=gpt-4o

# --- Anthropic ---
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-20250514

# --- OpenRouter ---
# OPENROUTER_API_KEY=sk-or-...
# OPENROUTER_DEFAULT_MODEL=anthropic/claude-sonnet-4-20250514

# --- Defaults ---
DEFAULT_PROVIDER=ollama
DEFAULT_MAX_ITERATIONS=10
DEFAULT_DELAY_MS=1000
`;
    await writeIfNotExists(path.join(workingDir, ".env.example"), envExample);

    spinner.succeed("Workspace initialized");

    console.log(chalk.green("\n  ✅ Created:"));
    console.log(chalk.gray("     PROMPT.md       — Agent instructions"));
    console.log(chalk.gray("     PLAN.md         — Implementation plan"));
    console.log(chalk.gray("     specs/SPEC.md   — Project specifications"));
    console.log(chalk.gray("     .env.example    — Environment template"));
    console.log(chalk.gray("     .agentic-lab/   — Run data directory"));

    console.log(chalk.cyan("\n  Next steps:"));
    console.log(
      chalk.white("  1. Edit specs/SPEC.md with your project requirements"),
    );
    console.log(
      chalk.white("  2. Edit PLAN.md with your implementation tasks"),
    );
    console.log(
      chalk.white("  3. Copy .env.example to .env and configure your LLM"),
    );
    console.log(chalk.white("  4. Run: agentic-lab run\n"));
  } catch (error) {
    spinner.fail("Failed to initialize workspace");
    console.error(chalk.red(`  ${(error as Error).message}\n`));
    process.exit(1);
  }
}

async function writeIfNotExists(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await fs.access(filePath);
    // File exists, skip
  } catch {
    await fs.writeFile(filePath, content, "utf-8");
  }
}
