#!/usr/bin/env node
// npm run release: publishes the versions in packages/*/package.json that npm
// does not have yet, engine first, and checks the result from the registry.
// Bump the versions and write the CHANGELOG entry first (CONTRIBUTING.md).
//
//   npm run release                  shows the plan, asks once, does the rest
//   npm run release -- --dry-run     the plan and the checks, nothing changes
//   npm run release -- --yes         no question (npm still asks for your key)
//   npm run release -- --skip-tests  for a rerun after the tests already passed
//
// It can be run again after a failure: what is already tagged or published is
// left as it is, and it goes on from there.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { releasePackages, satisfies } from "./versions.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const assumeYes = args.has("--yes");
const skipTests = args.has("--skip-tests");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const git = (...argv) => run("git", argv);
/** A step that talks to the person (npm login, npm publish): its output goes straight to the terminal. */
const live = (cmd, argv) => spawnSync(cmd, argv, { cwd: root, stdio: "inherit" }).status === 0;

const say = (line = "") => process.stdout.write(`${line}\n`);
const fail = (line, hint) => {
  process.stderr.write(`\n  release stopped: ${line}\n${hint ? `  ${hint}\n` : ""}\n`);
  process.exit(1);
};

/** Versions npm has for a package; none when the package does not exist yet. */
function publishedVersions(name) {
  try {
    const out = run("npm", ["view", name, "versions", "--json"]);
    const v = JSON.parse(out);
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}

async function served(name, version) {
  const url = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** npm lists a new version minutes before it serves its tarball; installs fail until it does. */
async function waitServed(name, version, minutes = 10) {
  const until = Date.now() + minutes * 60_000;
  process.stdout.write(`  waiting until npm serves ${name}@${version} `);
  while (Date.now() < until) {
    if (await served(name, version)) {
      say("ready");
      return true;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  say("not yet");
  return false;
}

async function confirm(question) {
  if (assumeYes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes" || answer === "s" || answer === "si" || answer === "sí";
}

// ---- What is to be released ----

const packages = releasePackages(root);
// The engine, then the packages built on it (jig-console, jig-benchmark), each with the jig-core range it needs.
const [core, ...dependents] = packages;
for (const p of dependents) {
  if (p.coreRange && !satisfies(core.version, p.coreRange)) {
    fail(`${p.name} ${p.version} needs jig-core ${p.coreRange}, but the repository's jig-core is ${core.version}`, `Fix the range in packages/${p.dir}/package.json.`);
  }
}

for (const p of packages) {
  p.onNpm = publishedVersions(p.name);
  p.publish = !p.onNpm.includes(p.version);
  p.tag = `${p.name}@${p.version}`;
}
const toPublish = packages.filter((p) => p.publish);
if (!toPublish.length) {
  say(`  npm already has ${packages.map((p) => p.tag).join(" and ")}: nothing to release.`);
  say("  Bump a version in packages/*/package.json and write its CHANGELOG entry first.");
  process.exit(0);
}
// A package whose engine is not on npm yet, and is not being released now, would not install.
if (!core.publish && dependents.some((p) => p.publish) && !core.onNpm.includes(core.version)) fail(`jig-core ${core.version} is not on npm`);

// ---- The repository ----

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const head = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
if (dirty.length) fail(`there are changes that are not committed:\n${dirty.map((l) => `    ${l}`).join("\n")}`, "Commit them (the version bump and the CHANGELOG entry too), then run it again.");

git("fetch", "-q", "origin", "--tags");
try {
  git("merge-base", "--is-ancestor", "origin/main", "HEAD");
} catch {
  fail(`${branch} does not contain origin/main, so main cannot move to it`, "Merge or rebase onto origin/main first.");
}
for (const p of toPublish) {
  let at = "";
  try {
    at = git("rev-parse", "--short", `${p.tag}^{commit}`);
  } catch {
    /* not tagged yet */
  }
  if (at && at !== head) fail(`${p.tag} is already tagged on ${at}, not on HEAD (${head})`, "The version was not bumped: bump it, or move HEAD to that commit.");
  p.tagged = Boolean(at);
}
const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf-8");
const firstEntry = (changelog.split("\n").find((l) => l.startsWith("## ")) ?? "").toLowerCase();
const missing = toPublish.filter((p) => !firstEntry.includes(p.version));
if (missing.length) say(`  note: CHANGELOG.md's first entry ("${firstEntry.slice(3, 70)}") does not name ${missing.map((p) => p.tag).join(" or ")}`);

// ---- The plan ----

say("");
say(`  release from ${head} (${branch})`);
for (const p of packages) {
  const last = p.onNpm.filter((v) => !v.includes("stage")).at(-1) ?? "none";
  say(`    ${p.name.padEnd(14)} ${p.version.padEnd(8)} ${p.publish ? `to publish (npm has ${last})` : "already on npm, left as it is"}${p.coreRange ? `, needs jig-core ${p.coreRange}` : ""}`);
}
say("");
say(`  ${skipTests ? "no tests (--skip-tests)" : "tests and type checks"}, tag ${toPublish.map((p) => p.tag).join(" and ")}, push ${branch === "main" ? "main" : `${branch} and main`} with the tags,`);
say(`  publish ${toPublish.map((p) => p.name).join(" then ")} (npm asks for your key each time), wait until npm serves them,`);
say(`  then install ${dependents.map((p) => p.name).join(" and ")} from npm, each in a temporary folder, and check their versions.`);
say("");
if (dryRun) say("  --dry-run: checking only, nothing is tagged, pushed or published.");
else if (!(await confirm("  Go ahead?"))) fail("you said no");

// ---- Checks ----

if (!skipTests) {
  say("\n  running the tests (a minute or two)");
  const log = path.join(tmpdir(), `jig-release-tests-${Date.now()}.log`);
  const t = spawnSync("sh", ["-c", `npm test > "${log}" 2>&1`], { cwd: root });
  const summary = readFileSync(log, "utf-8").split("\n").filter((l) => /Tests\s+\d/.test(l)).map((l) => l.trim());
  summary.forEach((l) => say(`    ${l}`));
  if (t.status !== 0) fail("the tests failed", `The full log is ${log}. A test that timed out under load may pass alone; rerun with --skip-tests once it does.`);
  for (const dir of ["core", "cli", "benchmark", "web"]) {
    const r = spawnSync("npx", ["tsc", "--noEmit", "-p", `packages/${dir}`], { cwd: root, encoding: "utf-8" });
    if (r.status !== 0) fail(`tsc found errors in packages/${dir}`, (r.stdout || r.stderr).split("\n").slice(0, 6).join("\n  "));
  }
  say("    tsc: clean in core, cli, benchmark and web");
}
for (const p of toPublish) {
  const r = spawnSync("npm", ["pack", "--dry-run", "-w", `packages/${p.dir}`], { cwd: root, encoding: "utf-8" });
  if (r.status !== 0) fail(`npm pack failed for ${p.name}`, r.stderr.split("\n").slice(-6).join("\n  "));
}
say(`  npm pack: ${toPublish.map((p) => p.name).join(", ")} build${toPublish.length === 1 ? "s" : ""}`);
if (dryRun) {
  say("\n  --dry-run: all checks passed.\n");
  process.exit(0);
}

// ---- npm account ----

let who = "";
try {
  who = run("npm", ["whoami"]);
} catch {
  say("\n  npm needs you to log in:");
  if (!live("npm", ["login"])) fail("npm login did not finish");
  who = run("npm", ["whoami"]);
}
say(`\n  npm: logged in as ${who}`);

// ---- Tag and push ----

for (const p of toPublish.filter((x) => !x.tagged)) {
  git("tag", "-a", p.tag, "-m", p.tag);
  say(`  tagged ${p.tag}`);
}
const push = (...refs) => {
  try {
    git("push", "-q", "origin", ...refs);
  } catch (e) {
    fail(`git push ${refs.join(" ")} was refused`, String(e.stderr || e.message).split("\n").slice(0, 4).join("\n  "));
  }
};
if (branch !== "main") push("HEAD");
push("HEAD:main");
push(...toPublish.map((p) => p.tag));
say(`  pushed ${branch === "main" ? "main" : `${branch} and main`} with the tags`);

// ---- Publish, engine first ----

for (const p of toPublish) {
  say(`\n  publishing ${p.tag}: npm asks for your security key or code`);
  if (!live("npm", ["publish", "-w", `packages/${p.dir}`, "--access", "public"])) {
    fail(
      `npm did not publish ${p.tag}`,
      `If npm said it holds the version as staged, approve it at npmjs.com (Staged Packages) or bump it. Run npm run release again to go on: what is done is kept.`,
    );
  }
  if (!(await waitServed(p.name, p.version))) fail(`npm has not served ${p.tag} after 10 minutes`, "Run npm run release -- --skip-tests in a few minutes; it checks again and goes on.");
}

// ---- From npm, as a person would get it ----

// Each package in a folder of its own, so each brings the jig-core it resolves to by itself.
for (const p of dependents) {
  say(`\n  installing ${p.name} from npm in a temporary folder`);
  const dir = mkdtempSync(path.join(tmpdir(), "jig-release-"));
  try {
    const r = spawnSync("npm", ["install", "--prefix", dir, "--no-fund", "--no-audit", `${p.name}@${p.version}`], { encoding: "utf-8" });
    if (r.status !== 0) fail(`installing ${p.tag} from npm failed`, r.stderr.split("\n").slice(-6).join("\n  "));
    const bin = path.join(dir, "node_modules", ".bin", p.bin);
    const version = execFileSync(bin, ["--version"], { encoding: "utf-8" }).trim();
    const installedCore = JSON.parse(readFileSync(path.join(dir, "node_modules", "jig-core", "package.json"), "utf-8")).version;
    if (version !== p.version) fail(`${p.bin} --version says ${version}, not ${p.version}`);
    if (p.coreRange && !satisfies(installedCore, p.coreRange)) fail(`${p.tag} brought jig-core ${installedCore}, outside its range ${p.coreRange}`);
    say(`  ${p.bin} ${version} with jig-core ${installedCore}, from npm`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

say(`\n  released: ${toPublish.map((p) => p.tag).join(" and ")}. npm install -g jig-console gets jig; npm install -g jig-benchmark gets jig-benchmark.\n`);
