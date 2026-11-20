// ============================================
// Iteration Logger: Tracks iterations to disk
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import type { LoopIteration, LoopState, LoopResult } from "../types/loop.js";
import { ensureProjectDir, existingProjectPath, listProjectEntries, projectPath } from "../config/places.js";

export class IterationLogger {
  private logDir: string;
  private runId: string;

  constructor(
    private readonly workingDir: string,
    runId: string,
  ) {
    this.logDir = projectPath(workingDir, "runs", runId);
    this.runId = runId;
  }

  /** Initialize the log directory (in .jig/, made with its .gitignore when new). */
  async init(): Promise<void> {
    await ensureProjectDir(this.workingDir, "runs", this.runId);
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

  /** List all runs in the working directory, in .jig/ and in .agentic-lab/ from before the rename. */
  static async listRuns(workingDir: string): Promise<string[]> {
    const entries = await listProjectEntries(workingDir, "runs");
    const dirs = await Promise.all(entries.map(async (e) => ((await fs.stat(e.dir).catch(() => null))?.isDirectory() ? e.name : null)));
    return dirs.filter((d): d is string => d !== null).sort().reverse();
  }

  /** Load a specific run's result */
  static async loadResult(
    workingDir: string,
    runId: string,
  ): Promise<LoopResult | null> {
    try {
      const filePath = existingProjectPath(workingDir, "runs", runId, "result.json");
      if (!filePath) return null;
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
      const filePath = existingProjectPath(workingDir, "runs", runId, "state.json");
      if (!filePath) return null;
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
