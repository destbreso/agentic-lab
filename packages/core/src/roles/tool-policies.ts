// ============================================
// The tools each kind of role gets by default
// ============================================
// Do changes the workspace; Plan and Check only read it, so neither can write
// what Check verifies (FOUNDATIONS, H4). A deny list wins over tools a skill
// grants. Critique, Decide and Memory call their model without tools.

import type { ToolPolicy } from "../types/pipeline.js";

/** Tools that change the workspace or run commands in it. */
export const WRITE_TOOLS = ["file_write", "shell", "git"];

/** Read the workspace, never change it. */
export const READ_ONLY_TOOLS: ToolPolicy = { allow: ["file_read", "glob", "grep"], deny: WRITE_TOOLS };

/** No tools at all. */
export const NO_TOOLS: ToolPolicy = { allow: [], deny: WRITE_TOOLS };
