# Working on drydock

## Run the checks

Run `bun install` once, then run `bun run check` before you push. It type-checks the source with strict settings. CI runs the same check on every push.

## Release a version

Releases are Git tags. To release the next alpha:

1. Run `bun pm version prerelease --preid alpha -m "chore: release %s"`. It raises the version in `package.json`, for example from `0.1.0-alpha.1` to `0.1.0-alpha.2`, commits it, and creates the tag `v0.1.0-alpha.2`.
2. Run `git push --follow-tags`.

The release workflow runs the checks on the tag and publishes a GitHub release with notes generated from the commits. If the checks fail, it publishes nothing. A version with a suffix such as `-alpha.2` is published as a pre-release.

The nightly workflow runs once a day. If `main` has changed since the last nightly build and the checks pass, it moves the `nightly` tag and its pre-release to the newest commit on `main`. You can also start it by hand from the Actions tab.
