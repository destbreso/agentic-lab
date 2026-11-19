// The publish guard (scripts/check-publish.mjs, each package's
// prepublishOnly): it refuses a package folder with uncommitted changes, a
// HEAD not tagged <package>@<version>, and a jig-console whose jig-core
// range leaves out the repository's jig-core; and lets a clean, tagged,
// matching release through. Each case is a throwaway git repository.

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const guard = resolve(import.meta.dirname, "..", "..", "..", "scripts", "check-publish.mjs");
const repos: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

function repo(core: string, consoleVersion: string, range: string): string {
  const root = mkdtempSync(join(tmpdir(), "jig-publish-"));
  repos.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  mkdirSync(join(root, "packages", "cli"), { recursive: true });
  writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "jig-core", version: core }));
  writeFileSync(join(root, "packages", "cli", "package.json"), JSON.stringify({ name: "jig-console", version: consoleVersion, dependencies: { "jig-core": range } }));
  git("add", ".");
  git("commit", "-q", "-m", "release");
  return root;
}

const check = (root: string, pkg: "core" | "cli") => spawnSync(process.execPath, [guard], { cwd: join(root, "packages", pkg), encoding: "utf-8" });
const tag = (root: string, t: string) => execFileSync("git", ["tag", t], { cwd: root });

describe("the publish guard", () => {
  it("lets a committed, tagged release through, and jig-console when its range includes the repository's jig-core", () => {
    const root = repo("0.1.3", "0.1.2", "^0.1.3");
    tag(root, "jig-core@0.1.3");
    tag(root, "jig-console@0.1.2");
    expect(check(root, "core").status).toBe(0);
    const cli = check(root, "cli");
    expect(cli.status).toBe(0);
    expect(cli.stdout).toMatch(/jig-console@0\.1\.2: committed, tagged, and its jig-core \^0\.1\.3 includes the repository's/);
  });

  it("refuses an untagged HEAD, and says the tag to make", () => {
    const root = repo("0.1.3", "0.1.2", "^0.1.3");
    const r = check(root, "core");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/HEAD is not tagged jig-core@0\.1\.3 \(its tags: none\): git tag jig-core@0\.1\.3/);
  });

  it("refuses a package folder with changes that are not committed", () => {
    const root = repo("0.1.3", "0.1.2", "^0.1.3");
    tag(root, "jig-core@0.1.3");
    writeFileSync(join(root, "packages", "core", "index.js"), "// not committed\n");
    const r = check(root, "core");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/jig-core's folder has changes that are not committed:\n\s+\?\? packages\/core\/index\.js/);
    // A change in another package's folder is not this one's.
    expect(check(root, "cli").stderr).not.toMatch(/not committed/);
  });

  it("refuses a jig-console whose jig-core range leaves out the repository's jig-core", () => {
    for (const [core, range] of [["0.1.1", "^0.1.2"], ["0.2.0", "^0.1.3"], ["0.1.3", "0.1.2"]]) {
      const root = repo(core, "0.1.2", range);
      tag(root, "jig-console@0.1.2");
      const r = check(root, "cli");
      expect(r.status, `${core} in ${range}`).toBe(1);
      expect(r.stderr).toContain(`jig-console needs jig-core ${range}, which does not include the repository's jig-core ${core}`);
    }
  });
});
