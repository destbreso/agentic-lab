// ============================================
// CLI: status command — Show workspace status
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { PlanManager } from '@agentic-lab/core';

interface StatusOptions {
  dir?: string;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const workingDir = path.resolve(options.dir || '.');

  console.log(chalk.cyan('\n🤖 Agentic Lab — Workspace Status\n'));
  console.log(chalk.gray(`  Directory: ${workingDir}\n`));

  // Check for key files
  const files = [
    { name: 'PROMPT.md', required: true },
    { name: 'PLAN.md', required: true },
    { name: 'specs/', required: false },
    { name: '.env', required: false },
    { name: '.agentic-lab/', required: false },
  ];

  console.log(chalk.white('  Files:'));
  for (const file of files) {
    const exists = await fileExists(path.join(workingDir, file.name));
    const icon = exists ? chalk.green('✅') : file.required ? chalk.red('❌') : chalk.gray('○');
    console.log(`    ${icon} ${file.name}`);
  }

  // Show plan status
  const planManager = new PlanManager(workingDir);
  const planExists = await planManager.exists();

  if (planExists) {
    const items = await planManager.read();
    const counts = {
      pending: items.filter((i) => i.status === 'pending').length,
      'in-progress': items.filter((i) => i.status === 'in-progress').length,
      completed: items.filter((i) => i.status === 'completed').length,
      failed: items.filter((i) => i.status === 'failed').length,
      blocked: items.filter((i) => i.status === 'blocked').length,
    };

    console.log(chalk.white('\n  Plan Status:'));
    console.log(chalk.gray(`    Total items: ${items.length}`));
    if (counts.pending > 0) console.log(chalk.white(`    ○ Pending:     ${counts.pending}`));
    if (counts['in-progress'] > 0) console.log(chalk.cyan(`    ~ In progress: ${counts['in-progress']}`));
    if (counts.completed > 0) console.log(chalk.green(`    ✓ Completed:   ${counts.completed}`));
    if (counts.failed > 0) console.log(chalk.red(`    ✗ Failed:      ${counts.failed}`));
    if (counts.blocked > 0) console.log(chalk.yellow(`    ⊘ Blocked:     ${counts.blocked}`));

    const next = await planManager.getNextItem();
    if (next) {
      console.log(chalk.white(`\n  Next item: ${chalk.cyan(next.title)}`));
    }
  }

  // Show run history
  try {
    const runsDir = path.join(workingDir, '.agentic-lab', 'runs');
    const runs = await fs.readdir(runsDir, { withFileTypes: true });
    const runDirs = runs.filter((r) => r.isDirectory());

    if (runDirs.length > 0) {
      console.log(chalk.white(`\n  Past runs: ${runDirs.length}`));
      console.log(chalk.gray(`    Latest: ${runDirs[runDirs.length - 1].name}`));
    }
  } catch {
    // No runs yet
  }

  console.log('');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
