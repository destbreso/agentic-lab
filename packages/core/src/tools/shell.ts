// ============================================
// Shell Tool: run a command the role's allow-list permits, inside the workspace
// ============================================
// The command is read before it runs (shell-policy.ts): every program must be
// on the role's allow-list, and its arguments, its redirections and its
// working directory must stay inside the workspace. A refusal is an error the
// model reads, like a failed command.

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import type { AgentTool, ToolContext } from "../types/tools.js";
import type { ToolDefinition } from "../types/llm.js";
import { childEnv } from "./child-env.js";
import { DEFAULT_SHELL_COMMANDS, ShellRefusal, checkCommand, insideWorkspace } from "./shell-policy.js";

const execAsync = promisify(exec);

const SHELL_PARAMETERS: ToolDefinition["parameters"] = {
  type: "object",
  properties: {
    command: { type: "string", description: "The shell command to execute" },
    cwd: { type: "string", description: "Working directory for the command (relative to project root)" },
  },
  required: ["command"],
};

export class ShellTool implements AgentTool {
  private timeout: number;
  /** The programs this tool runs: the role's allow-list. */
  readonly commands: readonly string[];

  constructor(options?: { timeout?: number; commands?: readonly string[] }) {
    this.timeout = options?.timeout ?? 30000;
    this.commands = options?.commands ?? DEFAULT_SHELL_COMMANDS;
  }

  /** The same tool with another allow-list. */
  withCommands(commands: readonly string[]): ShellTool {
    return new ShellTool({ timeout: this.timeout, commands });
  }

  get definition(): ToolDefinition {
    return {
      name: "shell",
      description: `Run a shell command in the workspace and return its output. Only these programs run: ${this.commands.join(", ")}. No $ expansions, backticks, subshells or here-documents, and no path outside the workspace.`,
      parameters: SHELL_PARAMETERS,
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const command = String(args.command ?? "");
    const cwd = args.cwd ? path.resolve(context.workingDir, String(args.cwd)) : context.workingDir;
    if (!insideWorkspace(context.workingDir, path.relative(context.workingDir, cwd) || ".")) {
      throw new Error(`Refused: the working directory "${String(args.cwd)}" is outside the workspace`);
    }
    try {
      checkCommand(command, { root: context.workingDir, cwd, commands: this.commands });
    } catch (error) {
      if (error instanceof ShellRefusal) throw new Error(`Refused: "${command}": ${error.message}`);
      throw error;
    }

    context.log(`Executing: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: this.timeout,
        maxBuffer: 1024 * 1024 * 5, // 5MB
        env: childEnv({ FORCE_COLOR: "0" }),
        signal: context.signal,
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
