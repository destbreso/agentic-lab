#!/usr/bin/env node
// Refuses an npm publish that is not the release it says it is. It runs as
// each package's prepublishOnly, from the package's folder, and stops the
// publish when:
//   - the package's folder has changes that are not committed;
//   - HEAD is not tagged <package>@<version>;
//   - for jig-console, its jig-core range does not include the jig-core
//     version in this repository.
// The release steps are in CONTRIBUTING.md.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const dir = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
const problems = [];

const changed = git("status", "--porcelain", "--", ".");
if (changed) problems.push(`${pkg.name}'s folder has changes that are not committed:\n${changed.split("\n").map((l) => `    ${l}`).join("\n")}`);

const tag = `${pkg.name}@${pkg.version}`;
const tags = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean);
if (!tags.includes(tag)) problems.push(`HEAD is not tagged ${tag} (its tags: ${tags.join(", ") || "none"}): git tag ${tag}`);

/** Whether a version is in a range: exact, ^, ~, >= or *, as this repository writes them. */
function satisfies(version, range) {
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

const coreRange = pkg.dependencies?.["jig-core"];
if (coreRange) {
  const root = git("rev-parse", "--show-toplevel");
  const core = JSON.parse(readFileSync(path.join(root, "packages", "core", "package.json"), "utf-8")).version;
  if (!satisfies(core, coreRange)) problems.push(`${pkg.name} needs jig-core ${coreRange}, which does not include the repository's jig-core ${core}`);
}

if (problems.length) {
  process.stderr.write(`\n  refused: ${tag} is not ready to publish\n\n${problems.map((p) => `  - ${p}`).join("\n")}\n\n  The release steps are in CONTRIBUTING.md.\n\n`);
  process.exit(1);
}
process.stdout.write(`  ${tag}: committed, tagged${coreRange ? `, and its jig-core ${coreRange} includes the repository's` : ""}\n`);
