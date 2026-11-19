// ============================================
// File Write Tool
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolContext } from '../types/tools.js';
import type { ToolDefinition } from '../types/llm.js';

/**
 * Content a model sent with literal "\n" escapes and no real newline, as
 * qwen2.5 does through Ollama's raw tool arguments, turned into the lines it
 * meant, with how many were turned; null when there is nothing to fix.
 */
export function unescapeLiteralNewlines(content: string): { text: string; count: number } | null {
  if (content.includes("\n") || !content.includes("\\n")) return null;
  const count = content.split("\\n").length - 1;
  const text = content.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
  return { text, count };
}

export class FileWriteTool implements AgentTool {
  /** Turn literal "\n" escapes into newlines when the content has no real one (on by default). */
  constructor(private readonly options: { unescapeNewlines?: boolean } = {}) {}

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
    let content = args.content as string;
    // The lab's correction, said in the result the role and the step record get: never silent.
    let note = "";
    const fixed = this.options.unescapeNewlines === false ? null : unescapeLiteralNewlines(String(content ?? ""));
    if (fixed) {
      content = fixed.text;
      note = ` (the lab turned ${fixed.count} literal \\n sequence${fixed.count === 1 ? "" : "s"} into line breaks: the content had no real one)`;
    }
    const append = (args.append as boolean) || false;

    // Security: prevent path traversal outside working directory
    if (!context.permitted && !filePath.startsWith(context.workingDir)) {
      throw new Error(
        `Access denied: path "${args.path}" resolves outside the working directory`
      );
    }

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (append) {
        await fs.appendFile(filePath, content, 'utf-8');
        return `Appended ${content.length} characters to "${args.path}"${note}`;
      } else {
        await fs.writeFile(filePath, content, 'utf-8');
        return `Wrote ${content.length} characters to "${args.path}"${note}`;
      }
    } catch (error) {
      throw new Error(
        `Failed to write file "${args.path}": ${(error as Error).message}`
      );
    }
  }
}
