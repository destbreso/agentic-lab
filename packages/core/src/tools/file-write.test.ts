// ============================================
// File Write Tool — Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FileWriteTool } from "./file-write.js";
import type { ToolContext } from "../types/tools.js";

describe("FileWriteTool", () => {
  let tool: FileWriteTool;
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tool = new FileWriteTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fwrite-test-"));
    ctx = {
      workingDir: tmpDir,
      iteration: 1,
      log: () => {},
      verbose: false,
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a new file", async () => {
    const result = await tool.execute(
      { path: "output.txt", content: "hello world" },
      ctx,
    );

    expect(result).toContain("Wrote 11 characters");
    const content = await fs.readFile(path.join(tmpDir, "output.txt"), "utf-8");
    expect(content).toBe("hello world");
  });

  it("creates nested directories", async () => {
    await tool.execute({ path: "sub/deep/file.txt", content: "nested" }, ctx);

    const content = await fs.readFile(
      path.join(tmpDir, "sub/deep/file.txt"),
      "utf-8",
    );
    expect(content).toBe("nested");
  });

  it("appends to existing file", async () => {
    await fs.writeFile(path.join(tmpDir, "existing.txt"), "first");

    const result = await tool.execute(
      { path: "existing.txt", content: " second", append: true },
      ctx,
    );

    expect(result).toContain("Appended");
    const content = await fs.readFile(
      path.join(tmpDir, "existing.txt"),
      "utf-8",
    );
    expect(content).toBe("first second");
  });

  it("blocks path traversal", async () => {
    await expect(
      tool.execute({ path: "../../../tmp/evil.txt", content: "pwned" }, ctx),
    ).rejects.toThrow("Access denied");
  });
});
