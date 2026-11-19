# Contributing to Jig

## Working on it

```sh
npm install
npm run build:core && npm run build:cli
npm test --workspaces
```

Each package type-checks with `npx tsc --noEmit -p packages/<core|cli|web>`. Write in English, with no long dashes, one paragraph per line in markdown. A commit carries no AI co-author trailer.

## Releasing

Jig is two packages on npm: `jig-core` (the engine) and `jig-console` (the `jig` command), released from this repository's `main`. Each package's `prepublishOnly` runs `scripts/check-publish.mjs`, which refuses to publish when the package's folder has changes that aren't committed, when HEAD isn't tagged `<package>@<version>`, or, for `jig-console`, when its `jig-core` range doesn't include the `jig-core` version in the repository.

1. **Bump the versions.** Bump `jig-core` in `packages/core/package.json` if the engine changed. Bump `jig-console` in `packages/cli/package.json`, and make its `jig-core` dependency a range that includes the new core version. Run `npm install --package-lock-only` so the lockfile follows.
2. **Write the CHANGELOG entry.** It goes on top, in plain words: what a person will notice, and which `jig-core` the console needs.
3. **Check it.** `npm test --workspaces`, tsc in each package, and `npm pack --dry-run -w packages/core` and `-w packages/cli` to see what each package would ship.
4. **Commit and tag both packages:** `git tag jig-core@<version>` and `git tag jig-console@<version>` on the release commit.
5. **Push** the branch and the tags: `git push origin main --tags`.
6. **Publish the engine first, then the console:** `npm publish -w packages/core`, then `npm publish -w packages/cli`. A version that hasn't changed isn't published again; npm refuses a version it already has.
7. **Verify** from npm in a clean machine: `npm install -g jig-console`, then a run with a measured check.

`npm publish --dry-run` runs the guard too, so it fails on a commit that isn't tagged yet. Use `npm pack --dry-run` before you tag.
