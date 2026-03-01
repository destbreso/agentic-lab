// ============================================
// File Read Tool
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolContext } from '../types/tools.js';
import type { ToolDefinition } from '../types/llm.js';

export class FileReadTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'file_read',
    description:
      'Read the contents of a file. Returns the file content as text. Can optionally read specific line ranges.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to read (relative to working directory)',
        },
        startLine: {
          type: 'number',
          description: 'Optional start line (1-based)',
        },
        endLine: {
          type: 'number',
          description: 'Optional end line (1-based, inclusive)',
        },
      },
      required: ['path'],
    },
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<string> {
    const filePath = path.resolve(context.workingDir, args.path as string);

    // Security: prevent path traversal outside working directory
    if (!filePath.startsWith(context.workingDir)) {
      throw new Error(
        `Access denied: path "${args.path}" resolves outside the working directory`
      );
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (args.startLine || args.endLine) {
        const lines = content.split('\n');
        const start = ((args.startLine as number) || 1) - 1;
        const end = (args.endLine as number) || lines.length;
        return lines.slice(start, end).join('\n');
      }

      return content;
    } catch (error) {
      throw new Error(
        `Failed to read file "${args.path}": ${(error as Error).message}`
      );
    }
  }
}
