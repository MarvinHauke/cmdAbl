# pakabl index

`pakabl list` shows what's in [`pakabl/index.json`](https://github.com/MarvinHauke/cmdAbl/blob/main/pakabl/index.json). That file is
**generated** — never edit it by hand.

```
pakabl/sources.json  ──►  scripts/pakabl-crawl.ts  ──►  pakabl/index.json       (what pakabl lists)
 (approved repos,         (daily workflow or            pakabl/candidates.json  (found, not approved yet)
  edited by hand)          run locally)                        │
                                                         opens a PR ──► you merge ──► `pakabl update` in Live
```

For every approved repo the crawler finds the newest `.ablx` (latest GitHub Release asset or a
committed `.ablx` file), downloads it, and reads the `manifest.json` inside for name, author
and version. The extension id is `<author-slug>.<name-slug>`. It also searches GitHub for the
topics `ableton-extension` and `ableton-extensions`; repos that ship an `.ablx` and aren't
approved yet go to `candidates.json`.

## One-time repo setup

Settings → Actions → General → Workflow permissions → tick **Allow GitHub Actions to create
and approve pull requests**. Without it the workflow can't open its PR.

## Workflow A — an approved extension has a new version

Fully automatic until the merge:

1. The [`pakabl index`](https://github.com/MarvinHauke/cmdAbl/blob/main/.github/workflows/pakabl-index.yml) workflow runs daily
   (04:17 UTC), or run it now: Actions → **pakabl index** → **Run workflow** (`main`), or
   `gh workflow run pakabl-index.yml`.
2. If anything changed, it opens a PR **"pakabl: refresh extension index"** from the branch
   `pakabl/index-update`. If nothing changed, no PR is opened.
3. Open the PR and check the diff: the extension's `version` and `url` lines changed.
4. **Merge it on GitHub** (merge button, or `gh pr merge <number> --squash --delete-branch`).
   The branch is deleted automatically.
5. In Live: `pakabl update`, then `pakabl list`. (GitHub's raw-file cache can take a few
   minutes.)

You don't have to approve the CI run on that PR. GitHub marks runs started for bot-created PRs
`action_required`; the PR only changes generated JSON, so the check adds nothing.

## Workflow B — adding a new extension

1. Find it in [`pakabl/candidates.json`](https://github.com/MarvinHauke/cmdAbl/blob/main/pakabl/candidates.json) (it appears in the next
   index PR), or pick any GitHub repo that publishes an `.ablx`.
2. Open a PR that adds one line to [`pakabl/sources.json`](https://github.com/MarvinHauke/cmdAbl/blob/main/pakabl/sources.json):
   ```json
   { "repo": "<owner>/<repo>" }
   ```
   Use `"exclude": ["<extension-id>"]` to skip one extension of a repo. Don't touch the
   generated files.
3. Merge it.
4. Run the **pakabl index** workflow (or wait for the daily run) — it opens an index PR that
   adds the extension and removes it from `candidates.json`.
5. Merge that PR, then `pakabl update` / `pakabl list` in Live.

A repo is only accepted if its `.ablx` has a valid `manifest.json` with `name`, `author`,
`version` and a `minimumApiVersion` starting with `1.`; otherwise the crawler skips it and
prints why in the workflow log.

Only approve repos you've looked at: an installed extension runs inside Live's Extension Host,
and a crash in one takes down all of them.

## Running the crawler locally

Needs Node 24, `unzip`, and a GitHub token (search is rate-limited without one):

```sh
GITHUB_TOKEN=$(gh auth token) npx tsx scripts/pakabl-crawl.ts
git diff pakabl/
```

It rewrites `index.json` and `candidates.json` and refuses to overwrite the index with an
empty result. Commit the result via a PR like any other change.

## Known quirk

`candidates.json` records each repo's star count and last-push date. Those change often, so the
scheduled run can open a refresh PR even when no approved extension changed. Merge or close it;
it's harmless.
