// ============================================
// Plan Manager — Parse and update PLAN.md
// ============================================

import * as fs from "fs/promises";
import * as path from "path";
import type { PlanItem, PlanStatus } from "../types/loop.js";

const STATUS_MARKERS: Record<string, PlanStatus> = {
  "[ ]": "pending",
  "[x]": "completed",
  "[~]": "in-progress",
  "[!]": "failed",
  "[B]": "blocked",
  "[-]": "skipped",
};

const REVERSE_MARKERS: Record<PlanStatus, string> = {
  pending: "[ ]",
  completed: "[x]",
  "in-progress": "[~]",
  failed: "[!]",
  blocked: "[B]",
  skipped: "[-]",
};

export class PlanManager {
  private planPath: string;

  constructor(workingDir: string, planFile: string = "PLAN.md") {
    this.planPath = path.resolve(workingDir, planFile);
  }

  /** Read and parse the plan file into structured items */
  async read(): Promise<PlanItem[]> {
    try {
      const content = await fs.readFile(this.planPath, "utf-8");
      return this.parse(content);
    } catch {
      return [];
    }
  }

  /** Write the plan items back to the file */
  async write(items: PlanItem[]): Promise<void> {
    const content = this.serialize(items);
    await fs.writeFile(this.planPath, content, "utf-8");
  }

  /** Update a specific plan item's status */
  async updateItem(
    itemId: string,
    updates: Partial<PlanItem>,
  ): Promise<PlanItem[]> {
    const items = await this.read();
    const idx = items.findIndex((item) => item.id === itemId);

    if (idx === -1) {
      throw new Error(`Plan item "${itemId}" not found`);
    }

    items[idx] = { ...items[idx], ...updates };
    await this.write(items);
    return items;
  }

  /** Get the next pending item (highest priority) */
  async getNextItem(): Promise<PlanItem | null> {
    const items = await this.read();
    const pending = items.filter(
      (item) => item.status === "pending" || item.status === "in-progress",
    );

    if (pending.length === 0) return null;

    // Sort by priority (lower = higher priority)
    pending.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    return pending[0];
  }

  /** Check if the plan exists */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.planPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Create a new plan file from items */
  async create(items: PlanItem[], title?: string): Promise<void> {
    const header = `# ${title || "Implementation Plan"}\n\n`;
    const content = header + this.serialize(items);
    await fs.mkdir(path.dirname(this.planPath), { recursive: true });
    await fs.writeFile(this.planPath, content, "utf-8");
  }

  /** Get raw content of the plan file */
  async getRawContent(): Promise<string> {
    try {
      return await fs.readFile(this.planPath, "utf-8");
    } catch {
      return "";
    }
  }

  // ---- Internal Parsing ----

  private parse(content: string): PlanItem[] {
    const items: PlanItem[] = [];
    const lines = content.split("\n");
    let currentPhase = "";
    let itemCounter = 0;

    for (const line of lines) {
      // Detect phases (## headers)
      const phaseMatch = line.match(/^##\s+(.+)/);
      if (phaseMatch) {
        currentPhase = phaseMatch[1].trim();
        continue;
      }

      // Detect plan items (- [ ] Task description)
      const itemMatch = line.match(/^[-*]\s+(\[[ x~!B\-]\])\s+(.+)/);
      if (itemMatch) {
        itemCounter++;
        const marker = itemMatch[1];
        const title = itemMatch[2].trim();
        const status = STATUS_MARKERS[marker] || "pending";

        items.push({
          id: `item-${itemCounter}`,
          title,
          status,
          phase: currentPhase || undefined,
          priority: itemCounter,
        });
      }
    }

    return items;
  }

  private serialize(items: PlanItem[]): string {
    const lines: string[] = [];
    let currentPhase = "";

    for (const item of items) {
      // Add phase header if changed
      if (item.phase && item.phase !== currentPhase) {
        if (currentPhase) lines.push("");
        lines.push(`## ${item.phase}`);
        lines.push("");
        currentPhase = item.phase;
      }

      const marker = REVERSE_MARKERS[item.status] || "[ ]";
      let line = `- ${marker} ${item.title}`;

      if (item.notes) {
        line += ` — ${item.notes}`;
      }

      lines.push(line);
    }

    return lines.join("\n") + "\n";
  }
}
