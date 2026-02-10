// ============================================
// Prompt Builder — Build prompts from templates
// ============================================

import * as fs from "fs/promises";
import * as path from "path";

export class PromptBuilder {
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /**
   * Load a prompt from a file.
   */
  async loadPrompt(promptFile: string): Promise<string> {
    const fullPath = path.resolve(this.workingDir, promptFile);
    try {
      return await fs.readFile(fullPath, "utf-8");
    } catch (error) {
      throw new Error(
        `Failed to load prompt file "${promptFile}": ${(error as Error).message}`,
      );
    }
  }

  /**
   * Build the system prompt for an iteration.
   * Combines static prompt with dynamic context.
   */
  async buildIterationPrompt(options: {
    promptFile: string;
    planContent?: string;
    specsContent?: string;
    iterationNumber: number;
    maxIterations: number;
    additionalContext?: string;
  }): Promise<string> {
    const basePrompt = await this.loadPrompt(options.promptFile);

    const parts: string[] = [];

    // Add the base prompt
    parts.push(basePrompt);

    // Add plan context if available
    if (options.planContent) {
      parts.push("\n---\n");
      parts.push("## Current Plan (PLAN.md)\n");
      parts.push(options.planContent);
    }

    // Add specs context if available
    if (options.specsContent) {
      parts.push("\n---\n");
      parts.push("## Specifications\n");
      parts.push(options.specsContent);
    }

    // Add iteration metadata
    parts.push("\n---\n");
    parts.push(`## Iteration Context`);
    parts.push(
      `- Current iteration: ${options.iterationNumber}/${options.maxIterations}`,
    );
    parts.push(`- Timestamp: ${new Date().toISOString()}`);

    // Add any additional context
    if (options.additionalContext) {
      parts.push("\n---\n");
      parts.push(options.additionalContext);
    }

    return parts.join("\n");
  }

  /**
   * Load all specs from a directory.
   */
  async loadSpecs(specsDir: string): Promise<string> {
    const fullPath = path.resolve(this.workingDir, specsDir);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const specParts: string[] = [];

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const content = await fs.readFile(
            path.join(fullPath, entry.name),
            "utf-8",
          );
          specParts.push(`### ${entry.name}\n\n${content}`);
        }
      }

      return specParts.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  /**
   * Check if a prompt file exists.
   */
  async exists(promptFile: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(this.workingDir, promptFile));
      return true;
    } catch {
      return false;
    }
  }
}
