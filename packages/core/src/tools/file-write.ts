// ============================================
// File Write Tool
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolContext } from '../types/tools.js';
import type { ToolDefinition } from '../types/llm.js';

export class FileWriteTool implements AgentTool {
  definition: ToolDefinition = {
    name: 'file_write',
    description:
      'Write content to a file. Creates the file and parent directories if they do not exist. Can also append to a file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to write to (relative to working directory)',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
        append: {
          type: 'boolean',
          description: 'If true, append instead of overwrite (default: false)',
        },
      },
      required: ['path', 'content'],
    },
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<string> {
    const filePath = path.resolve(context.workingDir, args.path as string);
    const content = args.content as string;
    const append = (args.append as boolean) || false;

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (append) {
        await fs.appendFile(filePath, content, 'utf-8');
        return `Appended ${content.length} characters to "${args.path}"`;
      } else {
        await fs.writeFile(filePath, content, 'utf-8');
        return `Wrote ${content.length} characters to "${args.path}"`;
      }
    } catch (error) {
      throw new Error(
        `Failed to write file "${args.path}": ${(error as Error).message}`
      );
    }
  }
}
