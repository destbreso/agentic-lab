// ============================================
// Git Tool — Git operations
// ============================================

import { exec } from 'child_process';
import { promisify } from 'util';
import type { AgentTool, ToolContext } from '../types/tools.js';
import type { ToolDefinition } from '../types/llm.js';

const execAsync = promisify(exec);

export class GitTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'git',
    description:
      'Execute git operations: status, add, commit, log, diff, branch, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The git subcommand to run (e.g., "status", "add -A", "commit -m \\"message\\"", "log --oneline -10", "diff HEAD~1")',
        },
      },
      required: ['command'],
    },
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<string> {
    const gitCommand = args.command as string;

    // Safety checks
    const dangerousPatterns = [
      /push\s+.*--force(?!-with-lease)/i,
      /reset\s+--hard\s+origin/i,
      /clean\s+-fdx?\s*$/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(gitCommand)) {
        throw new Error(
          `Blocked potentially dangerous git command: "git ${gitCommand}". Use with caution.`
        );
      }
    }

    const fullCommand = `git ${gitCommand}`;
    context.log(`Git: ${fullCommand}`);

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd: context.workingDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          FORCE_COLOR: '0',
        },
      });

      let result = stdout.trim();
      if (stderr.trim()) {
        result += (result ? '\n' : '') + stderr.trim();
      }

      return result || '(no output)';
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `Git command failed: ${fullCommand}\n${execError.stderr || execError.message}`
      );
    }
  }
}
