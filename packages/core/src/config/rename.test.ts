// The rename to Jig: the project folder and its ignore file, the old folder
// read as a fallback, the user's config directory and the config files'
// precedence.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProjectDir, existingProjectPath, listProjectEntries, userConfigDir } from "./places.js";
import { loadConfig } from "./loader.js";
import { IterationLogger } from "../engine/iteration-logger.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jig-rename-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the project folder", () => {
  it("is .jig, made with a .gitignore that ignores everything in it", async () => {
    const runs = await ensureProjectDir(dir, "runs", "r1");
    expect(runs).toBe(join(dir, ".jig", "runs", "r1"));
    expect(readFileSync(join(dir, ".jig", ".gitignore"), "utf-8").split("\n")).toContain("*");
  });

  it("leaves a .gitignore the user wrote alone", async () => {
    mkdirSync(join(dir, ".jig"));
    writeFileSync(join(dir, ".jig", ".gitignore"), "mine\n");
    await ensureProjectDir(dir, "sessions");
    expect(readFileSync(join(dir, ".jig", ".gitignore"), "utf-8")).toBe("mine\n");
  });

  it("reads .agentic-lab, its name before the rename, and writes only .jig", async () => {
    mkdirSync(join(dir, ".agentic-lab", "runs", "old-run"), { recursive: true });
    writeFileSync(join(dir, ".agentic-lab", "runs", "old-run", "result.json"), JSON.stringify({ summary: "old" }));
    await new IterationLogger(dir, "new-run").init();
    expect(await IterationLogger.listRuns(dir)).toEqual(["old-run", "new-run"]);
    expect(existingProjectPath(dir, "runs", "old-run", "result.json")).toBe(join(dir, ".agentic-lab", "runs", "old-run", "result.json"));
    expect(((await IterationLogger.loadResult(dir, "old-run")) as unknown as { summary: string }).summary).toBe("old");
    expect((await listProjectEntries(dir, "runs")).map((e) => [e.name, e.legacy])).toEqual([["new-run", false], ["old-run", true]]);
    expect(existsSync(join(dir, ".agentic-lab", "runs", "new-run"))).toBe(false);
  });
});

describe("the user's config", () => {
  it("lives in XDG_CONFIG_HOME/jig, ~/.config/jig, or %APPDATA%\\jig", () => {
    expect(userConfigDir({ HOME: "/h" }, "darwin")).toBe("/h/.config/jig");
    expect(userConfigDir({ HOME: "/h", XDG_CONFIG_HOME: "/x" }, "linux")).toBe("/x/jig");
    expect(userConfigDir({ HOME: "/h", XDG_CONFIG_HOME: "relative" }, "linux")).toBe("/h/.config/jig");
    expect(userConfigDir({ APPDATA: "C:\\A" }, "win32")).toBe(join("C:\\A", "jig"));
    expect(userConfigDir({ JIG_CONFIG_DIR: "/c" }, "linux")).toBe("/c");
  });

  it("is under the environment and the project's file, which wins; agentic-lab.config.json is read when there is no jig.config.json", async () => {
    const home = join(dir, "config");
    mkdirSync(home);
    writeFileSync(join(home, "config.json"), JSON.stringify({ providers: { ollama: { baseUrl: "http://user:1", defaultModel: "from-user" } }, loop: { maxIterations: 3 } }));
    const saved = { JIG_CONFIG_DIR: process.env.JIG_CONFIG_DIR, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL, OLLAMA_DEFAULT_MODEL: process.env.OLLAMA_DEFAULT_MODEL };
    process.env.JIG_CONFIG_DIR = home;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_DEFAULT_MODEL;
    try {
      const project = join(dir, "project");
      mkdirSync(project);
      let config = await loadConfig(project);
      expect(config.providers.ollama).toEqual({ baseUrl: "http://user:1", defaultModel: "from-user" });
      expect(config.loop.maxIterations).toBe(3);
      writeFileSync(join(project, "agentic-lab.config.json"), JSON.stringify({ providers: { ollama: { defaultModel: "from-old-file" } } }));
      config = await loadConfig(project);
      expect(config.providers.ollama).toEqual({ baseUrl: "http://user:1", defaultModel: "from-old-file" });
      writeFileSync(join(project, "jig.config.json"), JSON.stringify({ providers: { ollama: { defaultModel: "from-project" } } }));
      config = await loadConfig(project);
      expect(config.providers.ollama.defaultModel).toBe("from-project");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
