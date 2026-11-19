// ============================================
// The permission guard around a role's tools
// ============================================
// Each call of a role's tool is decided (permissions.ts) before it runs. An
// allowed call runs with `permitted`, so the tool skips its own containment
// checks: the decision already covered them. A call that asks is put to the
// person with what it would do (a write's diff, a command's warning); with no
// one to ask, it is denied and says so. A denial is the tool's result, so the
// role reads it, the person's words included. Every decision is recorded on
// the role's step.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool, ToolContext, ToolRegistry } from "../types/tools.js";
import { fileDiff } from "../engine/workspace-diff.js";
import { decide, type Action, type Decision, type PermissionSettings, type SessionGrants } from "./permissions.js";

export interface PermissionQuestion {
  role: string;
  roleName: string;
  tool: "Read" | "Write" | "Shell";
  /** The path or the command. */
  target: string;
  reason: string;
  diff?: string;
  warning?: string;
  /** The rules "don't ask again" would save. */
  remember?: string[];
}

/** Once; for the session (edits, or reads in a folder outside); as a rule saved for the project (shell prefixes); or no. Words can go with a once or a no. */
export interface PermissionAnswer {
  answer: "once" | "session" | "rule" | "deny";
  feedback?: string;
}

export interface PermissionRecord {
  tool: "Read" | "Write" | "Shell";
  target: string;
  behavior: "allowed" | "denied";
  /** Who decided: you, a rule, the mode, read-only by nature, or nobody there to ask. */
  by: "you" | "rule" | "mode" | "read-only" | "nobody to ask";
  reason: string;
  rule?: string;
  answer?: PermissionAnswer["answer"];
  feedback?: string;
  /** Your answer is given; a rule's or the mode's decision is measured. */
  provenance: "given" | "measured";
}

export interface PermissionContext {
  settings: PermissionSettings;
  grants: SessionGrants;
  /** Asks the person; absent when nobody can be asked (jig run), and what would ask is denied. */
  ask?: (q: PermissionQuestion) => Promise<PermissionAnswer>;
  /** Keeps rules "don't ask again" saved, for the project. */
  saveRules?: (rules: string[]) => void;
}

function actionOf(tool: string, args: Record<string, unknown>, workingDir: string): Action | null {
  switch (tool) {
    case "file_read":
      return { tool: "Read", path: String(args.path ?? "") };
    case "glob":
    case "grep":
      return { tool: "Read", path: String(args.path ?? args.cwd ?? ".") };
    case "file_write":
      return { tool: "Write", path: String(args.path ?? "") };
    case "shell":
      return { tool: "Shell", command: String(args.command ?? ""), cwd: path.resolve(workingDir, String(args.cwd ?? ".")) };
    case "git":
      return { tool: "Shell", command: `git ${String(args.command ?? "")}`.trim(), cwd: workingDir };
    default:
      return null;
  }
}

const byOf = (d: Decision): PermissionRecord["by"] =>
  d.rule ? "rule" : d.reason.includes("session") ? "you" : d.reason === "read-only" || d.reason.startsWith("reading inside") || d.reason.includes("read-only command") ? "read-only" : "mode";

/** The same registry, every call decided first. */
export function guardTools(registry: ToolRegistry, ctx: PermissionContext, role: { id: string; name: string }, record: (r: PermissionRecord) => void): ToolRegistry {
  const wrap = (tool: AgentTool): AgentTool => ({
    get definition() {
      return tool.definition;
    },
    ...(tool.validate ? { validate: (args: Record<string, unknown>) => tool.validate!(args) } : {}),
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const action = actionOf(tool.definition.name, args, context.workingDir);
      if (!action) return tool.execute(args, context);
      const target = action.tool === "Shell" ? action.command : path.resolve(context.workingDir, action.path);
      // Said plainly to the role, so even a small model does not report as done what was not.
      const what = action.tool === "Shell" ? `running \`${target}\`` : `${action.tool === "Write" ? "writing" : "reading"} ${path.relative(context.workingDir, target).startsWith("..") ? target : path.relative(context.workingDir, target)}`;
      const nothing = `Nothing was ${action.tool === "Write" ? "written" : action.tool === "Read" ? "read" : "run"}.`;
      const run = () => tool.execute(args, { ...context, permitted: true });
      const d = decide(action, ctx.settings, ctx.grants);
      if (d.behavior === "allow") {
        const by = byOf(d);
        record({ tool: action.tool, target, behavior: "allowed", by, reason: d.reason, ...(d.rule ? { rule: d.rule } : {}), provenance: by === "you" ? "given" : "measured" });
        return run();
      }
      if (d.behavior === "deny") {
        record({ tool: action.tool, target, behavior: "denied", by: d.rule ? "rule" : "mode", reason: d.reason, ...(d.rule ? { rule: d.rule } : {}), provenance: "measured" });
        return `Not done: ${what} is not allowed (${d.reason}). ${nothing}`;
      }
      if (!ctx.ask) {
        record({ tool: action.tool, target, behavior: "denied", by: "nobody to ask", reason: d.reason, provenance: "measured" });
        return `Not done: ${what} needs the person's permission (${d.reason}), and nobody is there to ask. ${nothing}`;
      }
      let diff: string | undefined;
      if (action.tool === "Write") {
        const before = await readFile(target, "utf-8").catch(() => null);
        const content = String(args.content ?? "");
        diff = fileDiff(path.relative(context.workingDir, target) || target, before, args.append ? `${before ?? ""}${content}` : content);
      }
      const a = await ctx.ask({ role: role.id, roleName: role.name, tool: action.tool, target, reason: d.reason, ...(diff ? { diff } : {}), ...(d.warning ? { warning: d.warning } : {}), ...(d.remember ? { remember: d.remember } : {}) });
      const base = { tool: action.tool, target, by: "you" as const, reason: d.reason, answer: a.answer, provenance: "given" as const };
      if (a.feedback) context.onPersonSaid?.({ tool: action.tool, target: what.replace(/^(writing|reading|running) /, "").replace(/^`|`$/g, ""), answer: a.answer === "deny" ? "no" : "yes", words: a.feedback });
      if (a.answer === "deny") {
        record({ ...base, behavior: "denied", ...(a.feedback ? { feedback: a.feedback } : {}) });
        return a.feedback ? `Not done: the person did not allow ${what}, and said: ${a.feedback}` : `Not done: the person did not allow ${what}. ${nothing}`;
      }
      if (a.answer === "session" && action.tool === "Write") ctx.grants.edits = true;
      if (a.answer === "session" && action.tool === "Read" && d.remember?.length) ctx.grants.rules.push(...d.remember);
      if (a.answer === "rule" && action.tool === "Shell" && d.remember?.length) {
        ctx.grants.rules.push(...d.remember);
        ctx.saveRules?.(d.remember);
      }
      record({ ...base, behavior: "allowed", ...(a.feedback ? { feedback: a.feedback } : {}) });
      const result = await run();
      // A yes can carry words too; the role reads them after the result, as in Claude Code.
      return a.feedback ? `${result}\n\n(The person allowed this, and added: ${a.feedback})` : result;
    },
  });
  return {
    register: (tool) => registry.register(tool),
    get: (name) => {
      const t = registry.get(name);
      return t ? wrap(t) : undefined;
    },
    getAll: () => registry.getAll().map(wrap),
    getDefinitions: () => registry.getDefinitions(),
    has: (name) => registry.has(name),
    remove: (name) => registry.remove(name),
  };
}
