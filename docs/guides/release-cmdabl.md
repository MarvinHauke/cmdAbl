# Releasing cmdAbl

A release is created automatically when `main` contains a version that hasn't been released
yet. Nothing bumps the version for you.

## Steps

1. **Bump the version** in both `package.json` and `manifest.json` to the same value. (CI and
   the release workflow fail if they differ — the `.ablx` carries the `manifest.json` version,
   the Git tag comes from `package.json`.)
2. **Regenerate the reference pages.** Run `npm run docs:reference` and commit the result. CI fails
   when a committed page differs from the code.
3. **Docs review pass.** Before the release PR, read the pages the release touched as a whole, not
   only the lines that changed. The reviewer checks the facts against the code. `mkdocs build --strict`
   must pass.
4. **Test the installed `.ablx`.** See [Building and installing the `.ablx` locally](#building-and-installing-the-ablx-locally).
5. Commit on a branch and open a PR into `main`. [CI](ci.md) builds it and attaches the `.ablx`.
6. **Merge the PR.**
7. [`package-release.yml`](https://github.com/MarvinHauke/cmdAbl/blob/main/.github/workflows/package-release.yml) runs on the push to
   `main`: it builds the `.ablx`, checks whether the tag `v<version>` exists, and if not
   creates the GitHub Release `v<version>` with the `.ablx` attached and generated notes. If
   the tag already exists it skips publishing.
8. **Update pakabl's list.** cmdAbl itself is an approved source in `pakabl/sources.json`, so
   the next [pakabl index](pakabl-index.md) run (daily, or trigger it manually) opens a PR with
   the new version. Merge it.
9. **Clean up the plans** (the architect, right after the merge):
   - `docs/feature-plans/STATUS.md` keeps only open things: in work, small items, untested
     leftovers, backlog and known issues. Anything finished is removed; Git, the PRs and the release
     notes keep that history.
   - Each released plan stays. Its status line reads "Released in 0.1.x", and finished rollout steps
     shrink to one line. Decisions, known limits and open questions stay, because the code doesn't
     explain why.
   - The plan index (`docs/feature-plans/README.md`) moves the plan to "Released" and sorts "Next"
     by what builds on what again.
   - Ideas stay until built or dropped; dropped ones go to "Deferred" with one reason.

When a new major version of Live comes out, set `LIVE_MANUAL_VERSION` in
`src/modules/man/topics.ts` to it before releasing: `man ableton <words>` searches only that
version of the manual, because the Extensions SDK does not tell an extension which Live it runs in.

## Building and installing the `.ablx` locally

```sh
npm run package        # writes cmdabl-<version>.ablx into the project root (gitignored)
```

Install in Live's Settings → Extensions: drag the file onto the box, or click Choose file and pick it. If an older
cmdAbl is installed, remove it first and restart Live. Alternatively download the `.ablx` from the
GitHub Release or from a [CI](ci.md) run's artifact.

During development you don't need the `.ablx`: `npm start` loads the project folder directly
(Developer Mode on).

**Test the installed `.ablx` before a release.** An installed extension runs in a sandbox that `npm start`
does not use. It may read only Live's Extensions and Extensions Data folders and its temp folder, so a
file access that works in development can fail when installed. Install the `.ablx` as above, restart Live and
check the commands that touch files outside the bundle, such as `cmdabl bridge` and `cmdabl setup`.
