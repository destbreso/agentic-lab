// ============================================
// Shell Tool — Execute shell commands
// ============================================

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import type { AgentTool, ToolContext } from "../types/tools.js";
import type { ToolDefinition } from "../types/llm.js";

const execAsync = promisify(exec);

export class ShellTool implements AgentTool {
  private timeout: number;

  constructor(options?: { timeout?: number }) {
    this.timeout = options?.timeout ?? 30000;
  }

  definition: ToolDefinition = {
    name: "shell",
    description:
      "Execute a shell command and return its output. Use for build, test, git operations, or any CLI task.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        cwd: {
          type: "string",
          description:
            "Working directory for the command (relative to project root)",
        },
      },
      required: ["command"],
    },
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd
      ? path.resolve(context.workingDir, args.cwd as string)
      : context.workingDir;

    // Normalize command for safety checks (collapse whitespace, remove variable tricks)
    const normalized = command
      .replace(/\$\{?IFS\}?/g, " ")
      .replace(/\$\([^)]*\)/g, "__SUBSHELL__")
      .replace(/`[^`]*`/g, "__SUBSHELL__");

    // Safety: block dangerous commands
    const blockedPatterns = [
      /rm\s+(-rf?|--recursive)?\s*\/(?!\w)/i,
      /sudo\s+rm/i,
      /mkfs/i,
      /dd\s+if=/i,
      /:\(\)\s*\{\s*:\|:&\s*\};?\s*:/,
      /__SUBSHELL__.*rm/i,
      /chmod\s+.*777\s*\//i,
      /\bwget\b.*\|.*\bsh\b/i,
      /\bcurl\b.*\|.*\bsh\b/i,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(normalized)) {
        throw new Error(
          `Blocked dangerous command: "${command}". This command could be destructive.`,
        );
      }
    }

    context.log(`Executing: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: this.timeout,
        maxBuffer: 1024 * 1024 * 5, // 5MB
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      let result = "";
      if (stdout) result += stdout;
      if (stderr) result += (result ? "\n--- stderr ---\n" : "") + stderr;

      // Truncate if very long
      if (result.length > 50000) {
        result =
          result.substring(0, 25000) +
          "\n\n... [output truncated] ...\n\n" +
          result.substring(result.length - 25000);
      }

      return result || "(no output)";
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        message: string;
      };
      let output = "";
      if (execError.stdout) output += execError.stdout;
      if (execError.stderr) output += (output ? "\n" : "") + execError.stderr;
      throw new Error(
        `Command failed: ${command}\n${output || execError.message}`,
      );
    }
  }
}
