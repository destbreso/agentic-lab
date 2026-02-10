// ============================================
// Iteration Logger — Tracks iterations to disk
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import type { LoopIteration, LoopState, LoopResult } from "../types/loop.js";

export class IterationLogger {
  private logDir: string;
  private runId: string;

  constructor(workingDir: string, runId: string) {
    this.logDir = path.resolve(workingDir, ".agentic-lab", "runs", runId);
    this.runId = runId;
  }

  /** Initialize the log directory */
  async init(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  /** Log an iteration */
  async logIteration(iteration: LoopIteration): Promise<void> {
    const fileName = `iteration-${String(iteration.number).padStart(4, "0")}.json`;
    const filePath = path.join(this.logDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(iteration, null, 2), "utf-8");
  }

  /** Save the full loop state */
  async saveState(state: LoopState): Promise<void> {
    const filePath = path.join(this.logDir, "state.json");
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
  }

  /** Save the final result */
  async saveResult(result: LoopResult): Promise<void> {
    const filePath = path.join(this.logDir, "result.json");
    await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  }

  /** List all runs in the working directory */
  static async listRuns(workingDir: string): Promise<string[]> {
    const runsDir = path.resolve(workingDir, ".agentic-lab", "runs");
    try {
      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** Load a specific run's result */
  static async loadResult(
    workingDir: string,
    runId: string,
  ): Promise<LoopResult | null> {
    try {
      const filePath = path.resolve(
        workingDir,
        ".agentic-lab",
        "runs",
        runId,
        "result.json",
      );
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Load a specific run's state */
  static async loadState(
    workingDir: string,
    runId: string,
  ): Promise<LoopState | null> {
    try {
      const filePath = path.resolve(
        workingDir,
        ".agentic-lab",
        "runs",
        runId,
        "state.json",
      );
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Get the log directory path */
  getLogDir(): string {
    return this.logDir;
  }

  /** Get the run ID */
  getRunId(): string {
    return this.runId;
  }
}
