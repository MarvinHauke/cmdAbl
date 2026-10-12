# CI

[`ci.yml`](https://github.com/MarvinHauke/cmdAbl/blob/main/.github/workflows/ci.yml) checks that cmdAbl builds and packages. It never
publishes anything and never changes a version.

**Runs on:** every pull request, every push to `features` or `main`, weekly (to catch
dependency drift), and manually (Actions → CI → Run workflow).

**Steps:** check that `package.json` and `manifest.json` have the same version → `npm ci` →
`npm test` (unit tests for the command platform) →
`python3 -B -m unittest discover -s tests/remote-script` (the Remote Script's protocol tests;
standard library only; the tests live outside `remote-script/` so they are not packaged; run the same
command locally) → `npm run package` → upload the built `.ablx` as the artifact `cmdabl-ablx`.

## Getting a built `.ablx` from CI

Open a green run in the Actions tab → **Artifacts** → `cmdabl-ablx`.

## Reading the results

| Result | Meaning |
|---|---|
| Green | Type-check, bundle and packaging all worked |
| Red at "Check … versions match" | `package.json` and `manifest.json` differ — bump both to the same value |
| Red at `npm test` | A unit test failed — see the test name in the log |
| Red at "Remote Script tests" | A Python test of `remote-script/` failed — see the test name in the log |
| Red at `npm run package` | A real build/type error — see the log |
| `action_required` | GitHub holds runs triggered by bot-created PRs (e.g. the pakabl index PR) until someone clicks **Approve and run**. Optional for PRs that only change generated JSON. |

## Required checks

The ruleset "Protect main" requires the checks `build` (from CI) and `gitleaks` (from the secret
scan). GitHub matches a check by its job name, so job names must stay unique across workflows:
the docs workflow's job is named `docs-build` for that reason. A required check must also come
from a workflow that runs on every pull request: `docs.yml` has a `paths` filter, so its job must
never be made required (on a pull request that touches no docs it would not run and the check would
wait forever).

## Reference pages

`docs/reference/commands.md` and `docs/reference/remote-script.md` are generated from the code (the
command tree and `src/ableton/remoteScriptOps.ts`). The `build` job runs `npm run docs:reference --
--check`: it fails when a committed page differs from what the code produces, when a runnable command
has no example, or when an example does not parse. Fix it by running `npm run docs:reference` and
committing the result.

## Pinned actions

Third-party actions (everything outside `actions/*`, e.g. `peter-evans/create-pull-request`) are
pinned to a commit SHA with the version in a trailing comment, because a tag can be moved to
different code and these jobs run with write permissions. To update a pin, look up the tag's commit
with `git ls-remote --tags <repo-url> <tag>` and change the SHA and the version comment together.

## Secret scan

[`secret-scan.yml`](https://github.com/MarvinHauke/cmdAbl/blob/main/.github/workflows/secret-scan.yml)
runs [gitleaks](https://github.com/gitleaks/gitleaks) (MIT licence) and fails a pull request or push
that **adds** a secret-shaped string in any of its commits — not only in the final tree, so a secret
that was added and removed again in the same PR is still caught.

**Runs on:** every pull request and every push, weekly and manually (those two scan the whole
history).

**What it scans:** a pull request scans `base..head`; a push scans the commits the branch gained
(a new branch, or a force-push that lost the old tip, scans the whole history). The job uses
`ubuntu-24.04`, `permissions: contents: read` and no secrets of its own. The gitleaks binary is
pinned to an exact version and its SHA-256 is checked before it runs; to upgrade, change
`GITLEAKS_VERSION` and `GITLEAKS_SHA256` together (the hash is in the release's
`gitleaks_<version>_checksums.txt`). Findings are printed redacted — never the secret itself.

Limit: gitleaks reads `git log -p`, which shows no patch for a merge commit, so a string that first
appears in a hand-resolved merge conflict is not seen. Keep merges conflict-free or review such
resolutions by eye.

### Run the same scan locally

Install gitleaks (`brew install gitleaks`, or download the pinned release and verify its hash), then
from the repository root:

```bash
gitleaks git --config .gitleaks.toml --redact --no-banner .                         # whole history
gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts="origin/main..HEAD" . # your branch
```

Exit code 0 means nothing was found, 1 means findings. Always pass `--redact`, so a finding does
not put the value in your terminal or logs.

### Allow a false positive

Check first that it really is not a secret. Then add a **narrow** entry to
[`.gitleaks.toml`](https://github.com/MarvinHauke/cmdAbl/blob/main/.gitleaks.toml): a path *and* the
rule it triggered (`targetRules`), never a global pattern:

```toml
[[allowlists]]
description = "why this is not a secret"
targetRules = ["generic-api-key"]
paths = ['''^path/to/file\.ts$''']
```

The rule id is in the redacted finding. The allowlist applies to history too, so no history rewrite
is needed for a false positive. Today there are no entries: the test fixtures that use names like
`*_KEY` carry the value `fake`, which no rule matches.

### If it finds a real secret

1. **Rotate or revoke the secret first.** Once a value was pushed, treat it as public.
2. Remove it from the branch so the PR can pass.
3. Whether to rewrite history (and force-push) is the repository owner's decision; do not do it
   on your own. Rotation is what actually protects the account.

Releasing is a separate workflow — see [Releasing cmdAbl](release-cmdabl.md).
