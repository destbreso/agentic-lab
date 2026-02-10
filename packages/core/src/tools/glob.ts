// ============================================
// Glob Tool — Find files by pattern
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolContext } from '../types/tools.js';
import type { ToolDefinition } from '../types/llm.js';

export class GlobTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'glob',
    description:
      'Find files matching a glob pattern. Returns a list of file paths relative to working directory.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'The glob pattern to match (e.g., "**/*.ts", "src/**/*.test.ts")',
        },
        exclude: {
          type: 'string',
          description:
            'Patterns to exclude (comma-separated, e.g., "node_modules,dist")',
        },
      },
      required: ['pattern'],
    },
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<string> {
    const pattern = args.pattern as string;
    const excludeStr = (args.exclude as string) || 'node_modules,dist,.git';
    const excludes = excludeStr.split(',').map((e) => e.trim());

    try {
      // Use Node.js 22+ fs.glob or fallback to recursive walk
      const matches = await this.walkAndMatch(
        context.workingDir,
        pattern,
        excludes,
        context.workingDir
      );

      if (matches.length === 0) {
        return `No files found matching "${pattern}"`;
      }

      return matches.join('\n');
    } catch (error) {
      throw new Error(
        `Glob search failed for "${pattern}": ${(error as Error).message}`
      );
    }
  }

  private async walkAndMatch(
    dir: string,
    pattern: string,
    excludes: string[],
    rootDir: string
  ): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      // Skip excluded dirs
      if (excludes.some((ex) => entry.name === ex || relativePath.includes(ex))) {
        continue;
      }

      if (entry.isDirectory()) {
        const subResults = await this.walkAndMatch(
          fullPath,
          pattern,
          excludes,
          rootDir
        );
        results.push(...subResults);
      } else if (this.matchSimpleGlob(relativePath, pattern)) {
        results.push(relativePath);
      }
    }

    return results;
  }

  private matchSimpleGlob(filePath: string, pattern: string): boolean {
    // Convert simple glob patterns to regex
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<DOUBLESTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<DOUBLESTAR>>/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${regexStr}$`).test(filePath);
  }
}
