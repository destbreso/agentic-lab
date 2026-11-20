// ============================================
// Grep Tool: Search for text in files
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import type { AgentTool, ToolContext } from "../types/tools.js";
import type { ToolDefinition } from "../types/llm.js";

export class GrepTool implements AgentTool {
  definition: ToolDefinition = {
    name: "grep",
    description:
      "Search for a text pattern in files. Returns matching lines with file paths and line numbers.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The text or regex pattern to search for",
        },
        path: {
          type: "string",
          description:
            'Directory or file to search in (relative to working directory, default: ".")',
        },
        include: {
          type: "string",
          description: 'File extensions to include (e.g., "ts,js,md")',
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default: 50)",
        },
      },
      required: ["pattern"],
    },
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const pattern = args.pattern as string;
    const searchPath = path.resolve(
      context.workingDir,
      (args.path as string) || ".",
    );
    const includeStr = args.include as string | undefined;
    const maxResults = (args.maxResults as number) || 50;
    const extensions = includeStr
      ? includeStr.split(",").map((e) => `.${e.trim().replace(/^\./, "")}`)
      : undefined;

    try {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "gi");
      } catch {
        throw new Error(`Invalid regex pattern: "${pattern}"`);
      }
      const results: string[] = [];

      // A file is searched as grep searches a file it is given: a model that greps solution.py and hears
      // "not a directory" concludes the file is missing. A named file is searched whatever `include` says.
      const target = await fs.stat(searchPath).catch(() => null);
      if (!target) throw new Error(`no file or directory at "${(args.path as string) || "."}"`);
      if (target.isFile()) {
        await this.searchFile(searchPath, regex, context.workingDir, results, maxResults);
      } else {
        await this.searchDir(
          searchPath,
          regex,
          extensions,
          context.workingDir,
          results,
          maxResults,
        );
      }

      if (results.length === 0) {
        return `No matches found for "${pattern}"`;
      }

      const header = `Found ${results.length} match(es) for "${pattern}":`;
      return `${header}\n\n${results.join("\n")}`;
    } catch (error) {
      throw new Error(
        `Grep failed for "${pattern}": ${(error as Error).message}`,
      );
    }
  }

  private async searchDir(
    dir: string,
    regex: RegExp,
    extensions: string[] | undefined,
    rootDir: string,
    results: string[],
    maxResults: number,
  ): Promise<void> {
    if (results.length >= maxResults) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dir, entry.name);

      // Skip excluded directories
      if (
        entry.isDirectory() &&
        ["node_modules", ".git", "dist", ".next", "coverage"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.searchDir(
          fullPath,
          regex,
          extensions,
          rootDir,
          results,
          maxResults,
        );
      } else {
        // Check extension filter
        if (extensions && !extensions.some((ext) => entry.name.endsWith(ext))) {
          continue;
        }

        // Skip binary/large files
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > 1024 * 1024) continue; // > 1MB
          await this.searchFile(fullPath, regex, rootDir, results, maxResults);
        } catch {
          // Skip files that can't be read as text
        }
      }
    }
  }

  private async searchFile(
    file: string,
    regex: RegExp,
    rootDir: string,
    results: string[],
    maxResults: number,
  ): Promise<void> {
    const lines = (await fs.readFile(file, "utf-8")).split("\n");
    const relativePath = path.relative(rootDir, file);
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break;
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
}
