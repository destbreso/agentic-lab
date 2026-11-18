// convert writes the compact form by default, and the full form with --expanded;
// both read back to the same topology.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { builtinFile, readTopologyText } from "@agentic-lab/core";

const cliRoot = resolve(__dirname, "..");
const cli = (args: string[]) =>
  spawnSync(resolve(cliRoot, "../../node_modules/.bin/vite-node"), [resolve(cliRoot, "src/index.ts"), ...args], {
    cwd: cliRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1" },
    encoding: "utf-8",
  });

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-convert-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("agentic-lab convert", () => {
  it("writes the compact form, or every node's inputs and outputs with --expanded", async () => {
    const compact = join(dir, "dr.yaml");
    const full = join(dir, "dr-full.yaml");
    expect(cli(["convert", builtinFile("deep-reasoning", "json"), "--to", "yaml", "-o", compact]).status).toBe(0);
    const r = cli(["convert", builtinFile("deep-reasoning", "json"), "--to", "yaml", "--expanded", "-o", full]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("agentspec in yaml, expanded");
    const [a, b] = [await readFile(compact, "utf-8"), await readFile(full, "utf-8")];
    expect(a).toBe(await readFile(builtinFile("deep-reasoning"), "utf-8").then((t) => t.slice(t.indexOf("component_type"))));
    expect(b.split("\n").length).toBeGreaterThan(a.split("\n").length);
    expect(readTopologyText(b, { syntax: "yaml" }).topology).toEqual(readTopologyText(a, { syntax: "yaml" }).topology);
  });
});
