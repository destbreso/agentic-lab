// The terminal viewer and the definition-file commands: a run drawn live on
// its topology's grid, frames written as text, a topology read from a file,
// and show, validate and convert through the core's formats module.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { builtinFile, getRecipe, writeTopologyText, type Topology } from "jig-core";
import { runTopology, type RunnerIO } from "./session-runner.js";
import { scriptedProvider } from "../../core/src/test-support/scripted-provider.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-view-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["e"], corrections: ["c"], confidence: 0.5 });

function terminal(columns: number): { io: RunnerIO; screen: string[]; lines: string[] } {
  const screen: string[] = [];
  const lines: string[] = [];
  return { io: { out: (l) => lines.push(l), note: () => {}, write: (t) => screen.push(t), tty: { columns, rows: 60 } }, screen, lines };
}

const cliRoot = resolve(__dirname, "..");
function cli(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(resolve(cliRoot, "../../node_modules/.bin/vite-node"), [resolve(cliRoot, "src/index.ts"), ...args], {
    cwd: cliRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1" },
    encoding: "utf-8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("jig run, live", () => {
  it("draws the run on the grid in place, and writes every frame as text", async () => {
    const { io, screen, lines } = terminal(140);
    let checks = 0;
    const provider = scriptedProvider((c) => (c.role === "check" && ++checks === 1 ? FAIL : undefined));
    const frames = join(dir, "frames.txt");
    const run = await runTopology({ topology: "exec-eval", task: "say hello", dir, delay: "0", frames }, io, { provider, storage: null, handleSignals: false, skipUnverifiable: false });
    expect(run.outcome).toBe("passed");
    const drawn = screen.join("");
    // Redrawn in place: each frame from the top, every line erased after it is written, inside a synchronized update.
    expect(drawn).toContain("\x1b[?2026h\x1b[H");
    expect(drawn).toContain("\x1b[K");
    expect(drawn).toContain("check fails: back to Do");
    // The summary follows the drawing.
    expect(lines[0]).toMatch(/passed/);
    const text = await readFile(frames, "utf-8");
    const titles = [...text.matchAll(/^── (\d+) ∙ (.*)$/gm)].map((m) => m[2]);
    expect(titles[0]).toBe("run:start");
    expect(titles).toContain("round 1 ends: fail, next at exec");
    expect(titles.at(-1)).toBe("run ends: passed");
    expect(text).not.toContain("\x1b[");
    expect(text).toContain("✓ passed after 2 rounds");
    expect(await readFile(`${frames}.ansi`, "utf-8")).toContain("\x1b[1;32m");
  });

  it("draws the strip below 80 columns", async () => {
    const { io } = terminal(60);
    const frames = join(dir, "narrow.txt");
    await runTopology({ topology: "deep-reasoning", task: "t", dir, delay: "0", frames, iterations: "1" }, io, { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false });
    const text = await readFile(frames, "utf-8");
    for (const line of text.split("\n")) expect([...line].length).toBeLessThanOrEqual(60);
    expect(text).toContain("[≣ Plan]─▸[> Do]");
  });

  it("prints events as lines with --no-live", async () => {
    const { io, screen, lines } = terminal(140);
    await runTopology({ topology: "exec-eval", task: "t", dir, delay: "0", live: false }, io, { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false });
    expect(screen).toEqual([]);
    expect(lines[0]).toMatch(/Execute & Evaluate/);
  });

  it("runs a topology from a definition file", async () => {
    const t = structuredClone(getRecipe("exec-eval")!) as Topology;
    t.id = "my-loop";
    t.name = "My loop";
    const file = join(dir, "my-loop.yaml");
    await writeFile(file, writeTopologyText(t).text);
    const { io, lines } = terminal(140);
    const run = await runTopology({ topology: file, task: "t", dir, delay: "0", live: false }, io, { provider: scriptedProvider(), storage: null, handleSignals: false, skipUnverifiable: false });
    expect(run.success).toBe(true);
    expect(lines[0]).toMatch(/My loop/);
  });
});

describe("show, validate, convert", () => {
  it("shows a topology at rest, with its walls", () => {
    const r = cli(["show", "deep-reasoning", "--width", "140", "--sight"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("↺ refine: back to Do");
    expect(r.stdout).toContain("what each role sees");
    expect(r.stdout).not.toContain("\x1b[");
  });

  it("validates a file and points at the exact path and line of an error", async () => {
    const doc = YAML.parse(await readFile(builtinFile("exec-eval"), "utf-8"));
    delete doc.$referenced_components["model.run"].model_id;
    const file = join(dir, "broken.yaml");
    const text = YAML.stringify(doc);
    await writeFile(file, text);
    const r = cli(["validate", file]);
    expect(r.code).toBe(1);
    const line = Number(/line (\d+)/.exec(r.stdout)?.[1]);
    expect(r.stdout).toContain('/$referenced_components/model.run: missing required property "model_id"');
    expect(text.split("\n")[line - 1]).toContain("component_type: LlmConfig");
    expect(cli(["validate", builtinFile("advisor")]).stdout).toContain("✓ valid");
  });

  it("converts Agent Spec to a legacy recipe and says what the recipe cannot hold", async () => {
    const out = join(dir, "advisor.recipe.json");
    const r = cli(["convert", builtinFile("advisor"), "--dialect", "legacy", "--to", "json", "-o", out]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Not kept by the target:");
    expect(r.stderr).toMatch(/consult edge/);
    expect(JSON.parse(await readFile(out, "utf-8")).nodes[0].id).toBe("exec");
  });
});
