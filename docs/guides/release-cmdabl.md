# Releasing cmdAbl

A release is created automatically when `main` contains a version that hasn't been released
yet. Nothing bumps the version for you.

## Steps

1. **Bump the version** in both `package.json` and `manifest.json` to the same value. (CI and
   the release workflow fail if they differ — the `.ablx` carries the `manifest.json` version,
   the Git tag comes from `package.json`.)
2. Commit on a branch and open a PR into `main`. [CI](ci.md) builds it and attaches the `.ablx`.
3. **Merge the PR.**
4. [`package-release.yml`](../../.github/workflows/package-release.yml) runs on the push to
   `main`: it builds the `.ablx`, checks whether the tag `v<version>` exists, and if not
   creates the GitHub Release `v<version>` with the `.ablx` attached and generated notes. If
   the tag already exists it skips publishing.
5. **Update pakabl's list.** cmdAbl itself is an approved source in `pakabl/sources.json`, so
   the next [pakabl index](pakabl-index.md) run (daily, or trigger it manually) opens a PR with
   the new version. Merge it.

## Building and installing the `.ablx` locally

```sh
npm run package        # writes cmdabl-<version>.ablx into the project root (gitignored)
```

Install by dropping the file onto the Extensions page in Live's settings. If an older cmdAbl is
installed, remove it first and restart Live. Alternatively download the `.ablx` from the
GitHub Release or from a [CI](ci.md) run's artifact.

During development you don't need the `.ablx`: `npm start` loads the project folder directly
(Developer Mode on).
