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
import { DEFAULT_SHELL_COMMANDS, ShellRefusal, checkCommand, insideWorkspace, unlistedPrograms } from "./shell-policy.js";

/** A command a role wants to run with programs off its allow-list, put to a person. */
export interface ShellApproval {
  command: string;
  /** The programs not on the list. */
  programs: string[];
  /** The directory it would run in, relative to the workspace. */
  cwd: string;
  /** The role asking, when the engine knows it. */
  role?: string;
  roleName?: string;
}

/** Run it this once, for the rest of the session, or not at all. */
export type ShellAnswer = "once" | "session" | "deny";

/**
 * Asks a person. Without one, a program off the list is refused, as in every
 * run nobody watches. Paths outside the workspace, expansions and the rest of
 * the policy are refused either way: only the allow-list can be widened.
 */
export type ShellApprover = (request: ShellApproval) => Promise<ShellAnswer>;

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

  /** Who is asked about a program off the list; nobody when absent. */
  readonly approver?: ShellApprover;

  constructor(options?: { timeout?: number; commands?: readonly string[]; approver?: ShellApprover }) {
    this.timeout = options?.timeout ?? 30000;
    this.commands = options?.commands ?? DEFAULT_SHELL_COMMANDS;
    if (options?.approver) this.approver = options.approver;
  }

  /** The same tool with another allow-list. */
  withCommands(commands: readonly string[]): ShellTool {
    return new ShellTool({ timeout: this.timeout, commands, ...(this.approver ? { approver: this.approver } : {}) });
  }

  /** The same tool, asking this approver about a program off the list. */
  withApprover(approver: ShellApprover): ShellTool {
    return new ShellTool({ timeout: this.timeout, commands: this.commands, approver });
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
    if (!context.permitted && !insideWorkspace(context.workingDir, path.relative(context.workingDir, cwd) || ".")) {
      throw new Error(`Refused: the working directory "${String(args.cwd)}" is outside the workspace`);
    }
    const unlisted = this.approver ? unlistedPrograms(command, this.commands) : [];
    if (!context.permitted) try {
      // With someone to ask, the programs off the list are theirs to allow; everything else is checked as always.
      checkCommand(command, { root: context.workingDir, cwd, commands: [...this.commands, ...unlisted] });
    } catch (error) {
      if (error instanceof ShellRefusal) throw new Error(`Refused: "${command}": ${error.message}`);
      throw error;
    }
    if (!context.permitted && unlisted.length && this.approver) {
      const answer = context.signal?.aborted ? "deny" : await this.approver({ command, programs: unlisted, cwd: path.relative(context.workingDir, cwd) || "." });
      if (answer === "deny") {
        throw new Error(`Refused: "${command}": ${unlisted.join(", ")} ${unlisted.length > 1 ? "are" : "is"} not on this role's allow-list, and the person at the terminal did not allow it`);
      }
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
