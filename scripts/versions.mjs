// Version helpers shared by the publish guard and the release script.

import { readFileSync } from "node:fs";
import * as path from "node:path";

/** Whether a version is in a range: exact, ^, ~, >= or *, as this repository writes them. */
export function satisfies(version, range) {
  const v = version.split(".").map(Number);
  const r = range.trim();
  if (r === "*" || r === "") return true;
  const m = /^(\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(r);
  if (!m) return false;
  const [, op, ...parts] = m;
  const base = parts.map(Number);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (!op) return cmp(v, base) === 0;
  if (cmp(v, base) < 0) return false;
  if (op === ">=") return true;
  if (op === "~") return v[0] === base[0] && v[1] === base[1];
  // A caret keeps the first number that is not zero.
  if (base[0] > 0) return v[0] === base[0];
  if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
  return v[0] === 0 && v[1] === 0 && v[2] === base[2];
}

/**
 * The published packages, engine first: the order they are released in. Each
 * package after the engine names the jig-core range it needs (coreRange) and
 * the command whose --version the release checks from npm (bin).
 */
export function releasePackages(root) {
  const read = (dir) => JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf-8"));
  const core = read("core");
  const cli = read("cli");
  const benchmark = read("benchmark");
  return [
    { dir: "core", name: core.name, version: core.version },
    { dir: "cli", name: cli.name, version: cli.version, coreRange: cli.dependencies?.["jig-core"], bin: "jig" },
    { dir: "benchmark", name: benchmark.name, version: benchmark.version, coreRange: benchmark.dependencies?.["jig-core"], bin: "jig-benchmark" },
  ];
}
