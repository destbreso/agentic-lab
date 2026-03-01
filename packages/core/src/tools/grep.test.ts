// ============================================
// Grep Tool — Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { GrepTool } from "./grep.js";
import type { ToolContext } from "../types/tools.js";

describe("GrepTool", () => {
  let tool: GrepTool;
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tool = new GrepTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-test-"));
    ctx = {
      workingDir: tmpDir,
      iteration: 1,
      log: () => {},
      verbose: false,
    };

    // Create test files
    await fs.writeFile(
      path.join(tmpDir, "hello.ts"),
      'const greeting = "hello world";\nconsole.log(greeting);\n',
    );
    await fs.writeFile(
      path.join(tmpDir, "data.json"),
      '{"name": "test", "value": 42}',
    );
    await fs.mkdir(path.join(tmpDir, "sub"));
    await fs.writeFile(
      path.join(tmpDir, "sub", "nested.ts"),
      "// nested greeting file\nconst x = 'hello from sub';\n",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds pattern in files", async () => {
    const result = await tool.execute({ pattern: "hello" }, ctx);
    expect(result).toContain("hello");
    expect(result).toContain("hello.ts");
  });

  it("searches recursively", async () => {
    const result = await tool.execute({ pattern: "hello" }, ctx);
    expect(result).toContain("nested.ts");
  });

  it("filters by file extension", async () => {
    const result = await tool.execute(
      { pattern: "test", include: "json" },
      ctx,
    );
    expect(result).toContain("data.json");
    expect(result).not.toContain(".ts");
  });

  it("reports no matches", async () => {
    const result = await tool.execute({ pattern: "zzz_nonexistent_zzz" }, ctx);
    expect(result).toContain("No matches found");
  });

  it("respects maxResults", async () => {
    const result = await tool.execute({ pattern: "hello", maxResults: 1 }, ctx);
    expect(result).toContain("1 match");
  });

  it("handles invalid regex gracefully (ReDoS fix verification)", async () => {
    await expect(tool.execute({ pattern: "[invalid" }, ctx)).rejects.toThrow(
      "Invalid regex pattern",
    );
  });

  it("skips node_modules directory", async () => {
    const nm = path.join(tmpDir, "node_modules", "pkg");
    await fs.mkdir(nm, { recursive: true });
    await fs.writeFile(path.join(nm, "index.js"), "hello");

    const result = await tool.execute({ pattern: "hello" }, ctx);
    expect(result).not.toContain("node_modules");
  });
});
