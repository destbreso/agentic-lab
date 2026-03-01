// ============================================
// File Read Tool — Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FileReadTool } from "./file-read.js";
import type { ToolContext } from "../types/tools.js";

describe("FileReadTool", () => {
  let tool: FileReadTool;
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tool = new FileReadTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fread-test-"));
    ctx = {
      workingDir: tmpDir,
      iteration: 1,
      log: () => {},
      verbose: false,
    };

    await fs.writeFile(
      path.join(tmpDir, "test.txt"),
      "line1\nline2\nline3\nline4\nline5",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads entire file", async () => {
    const result = await tool.execute({ path: "test.txt" }, ctx);
    expect(result).toBe("line1\nline2\nline3\nline4\nline5");
  });

  it("reads specific line range", async () => {
    const result = await tool.execute(
      { path: "test.txt", startLine: 2, endLine: 4 },
      ctx,
    );
    expect(result).toBe("line2\nline3\nline4");
  });

  it("reads from startLine to end when no endLine", async () => {
    const result = await tool.execute({ path: "test.txt", startLine: 4 }, ctx);
    expect(result).toBe("line4\nline5");
  });

  it("blocks path traversal (../ attack)", async () => {
    await expect(
      tool.execute({ path: "../../etc/passwd" }, ctx),
    ).rejects.toThrow("Access denied");
  });

  it("blocks absolute path outside workingDir", async () => {
    await expect(tool.execute({ path: "/etc/passwd" }, ctx)).rejects.toThrow(
      "Access denied",
    );
  });

  it("throws descriptive error for non-existent file", async () => {
    await expect(
      tool.execute({ path: "nonexistent.txt" }, ctx),
    ).rejects.toThrow("Failed to read file");
  });
});
