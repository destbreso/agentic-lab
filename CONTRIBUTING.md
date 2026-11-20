# Contributing to Jig

## Working on it

```sh
npm install
npm run build:core && npm run build:cli && npm run build:benchmark
npm test --workspaces
```

Build `jig-core` first: the other packages import its `dist`. Each package type-checks with `npx tsc --noEmit -p packages/<core|cli|benchmark|web>`. Write in English, with no long dashes, one paragraph per line in markdown. A commit carries no AI co-author trailer.

## Releasing

Jig is three packages on npm: `jig-core` (the engine), `jig-console` (the `jig` command) and `jig-benchmark` (the `jig-benchmark` command), released from this repository's `main`.

1. **Bump the versions.** Bump `jig-core` in `packages/core/package.json` if the engine changed. Bump `jig-console` in `packages/cli/package.json` and `jig-benchmark` in `packages/benchmark/package.json` when they changed, and make each one's `jig-core` dependency a range that includes the new core version. Run `npm install --package-lock-only` so the lockfile follows.
2. **Write the CHANGELOG entry.** It goes on top, in plain words: what a person will notice, and which `jig-core` each package needs. Name the versions in its heading.
3. **Commit**, then run `npm run release`.

`npm run release` (`scripts/release.mjs`) does the rest, in order, and asks once before it changes anything:

- it asks npm which versions it already has, and releases only the ones it does not, engine first;
- it refuses when there are changes that aren't committed, when the `jig-core` range of `jig-console` or `jig-benchmark` leaves out the repository's core, when a version tag already sits on another commit (a version that was not bumped), or when the branch does not contain `origin/main`;
- it runs the tests and tsc (core, cli, benchmark and web), and checks that every package to publish packs;
- it logs you in to npm if you aren't;
- it tags each package `<package>@<version>` on HEAD, pushes the branch, `main` and the tags;
- it publishes `jig-core`, waits until npm serves it (npm lists a new version minutes before its tarball can be downloaded), then `jig-console` and `jig-benchmark`; npm asks for your security key or code each time;
- it installs `jig-console` and `jig-benchmark` from npm, each in a temporary folder, and checks `jig --version`, `jig-benchmark --version` and the `jig-core` each brought.

`npm run release -- --dry-run` shows the plan and runs the checks without changing anything. `--yes` skips the question; `--skip-tests` is for a rerun after the tests already passed. If a step fails, run it again: what is already tagged or published is kept, and it goes on from there.

Each package's `prepublishOnly` still runs `scripts/check-publish.mjs`, which refuses a publish whose package folder has changes that aren't committed, whose HEAD isn't tagged `<package>@<version>`, or, for `jig-console` and `jig-benchmark`, whose `jig-core` range doesn't include the repository's core. It stops a hand-run `npm publish` that skipped a step.
