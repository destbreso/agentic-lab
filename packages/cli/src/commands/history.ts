// ============================================
// CLI: history command — Show past runs
// ============================================

import * as path from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';
import { IterationLogger, type LoopResult } from '@agentic-lab/core';

interface HistoryOptions {
  dir?: string;
  last?: string;
  detail?: string;
}

export async function historyCommand(options: HistoryOptions): Promise<void> {
  const workingDir = path.resolve(options.dir || '.');

  console.log(chalk.cyan('\n🤖 Agentic Lab — Run History\n'));

  // Show detail for a specific run
  if (options.detail) {
    await showRunDetail(workingDir, options.detail);
    return;
  }

  // List runs
  const runs = await IterationLogger.listRuns(workingDir);
  const limit = parseInt(options.last || '10');
  const displayRuns = runs.slice(0, limit);

  if (displayRuns.length === 0) {
    console.log(chalk.gray('  No runs found.\n'));
    return;
  }

  const table = new Table({
    head: [
      chalk.white('Run ID'),
      chalk.white('Iterations'),
      chalk.white('Status'),
      chalk.white('Duration'),
      chalk.white('Tokens'),
    ],
    style: { head: [], border: [] },
  });

  for (const runId of displayRuns) {
    const result = await IterationLogger.loadResult(workingDir, runId);
    if (result) {
      table.push([
        runId.slice(0, 12),
        String(result.totalIterations),
        result.success ? chalk.green('✅ OK') : chalk.red('❌ Failed'),
        formatMs(result.totalDurationMs),
        result.state.totalTokenUsage.totalTokens.toLocaleString(),
      ]);
    } else {
      table.push([runId.slice(0, 12), '-', chalk.gray('unknown'), '-', '-']);
    }
  }

  console.log(table.toString());
  console.log(
    chalk.gray(`\n  Showing ${displayRuns.length} of ${runs.length} runs`)
  );
  console.log(
    chalk.gray('  Use --detail <runId> to see details\n')
  );
}

async function showRunDetail(
  workingDir: string,
  runId: string
): Promise<void> {
  const result = await IterationLogger.loadResult(workingDir, runId);

  if (!result) {
    console.log(chalk.red(`  Run "${runId}" not found.\n`));
    return;
  }

  console.log(chalk.white(`  Run: ${runId}`));
  console.log(chalk.gray(`  Status: ${result.success ? '✅ Success' : '❌ Failed'}`));
  console.log(chalk.gray(`  Duration: ${formatMs(result.totalDurationMs)}`));
  console.log(chalk.gray(`  Iterations: ${result.totalIterations}`));
  console.log(
    chalk.gray(
      `  Tokens: ${result.state.totalTokenUsage.totalTokens.toLocaleString()}`
    )
  );

  if (Object.keys(result.state.totalToolCalls).length > 0) {
    console.log(chalk.white('\n  Tool calls:'));
    for (const [name, count] of Object.entries(result.state.totalToolCalls).sort(
      (a, b) => (b[1] as number) - (a[1] as number)
    )) {
      console.log(chalk.gray(`    ${name}: ${count}`));
    }
  }

  if (result.state.errors.length > 0) {
    console.log(chalk.white('\n  Errors:'));
    for (const err of result.state.errors.slice(0, 10)) {
      console.log(chalk.red(`    ❌ ${err}`));
    }
  }

  // Iteration summary
  if (result.state.iterations.length > 0) {
    console.log(chalk.white('\n  Iterations:'));
    const table = new Table({
      head: [
        chalk.white('#'),
        chalk.white('Duration'),
        chalk.white('Tools'),
        chalk.white('Tokens'),
        chalk.white('Status'),
      ],
      style: { head: [], border: [] },
    });

    for (const iter of result.state.iterations) {
      table.push([
        String(iter.number),
        formatMs(iter.durationMs || 0),
        String(iter.toolCalls.length),
        iter.tokenUsage.totalTokens.toLocaleString(),
        iter.success ? chalk.green('✓') : chalk.red('✗'),
      ]);
    }

    console.log(table.toString());
  }

  console.log('');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
